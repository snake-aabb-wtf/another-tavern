/**
 * 流式对话端点（M3 任务 §3）：
 * 读会话历史 → engine 组装 prompt → OpenAI 兼容上游 → SSE 逐 delta 转发 → assistant 消息落库。
 * 客户端断开时 abort 上游请求。
 */

import type { CharacterCard } from "@another-tavern/engine";
import { assemblePrompt, tokenizerForModel } from "@another-tavern/engine";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { AppDeps } from "../app.js";
import { streamUpstreamCompletion, UpstreamError } from "../upstream.js";

/** 组装器预算的 M3 出厂常量（docs/prompt-assembly §6.1 默认值由配置层提供）。 */
const BUDGET = { contextSize: 8192, reserveCompletion: 300 } as const;

/** 组装器的世界书设置出厂默认（docs/prompt-assembly §9.1 输入）。 */
const WI_SETTINGS = {
  scanDepth: 2,
  includeNames: true,
  caseSensitive: false,
  matchWholeWords: false,
  recursiveScanning: false,
  maxRecursionSteps: 0,
  wiBudgetPercent: 25,
} as const;

export function chatRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post("/api/chat/stream", async (c) => {
    const body = await c.req
      .json<{ sessionId?: unknown; content?: unknown }>()
      .catch(() => ({}) as Record<string, never>);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const content = typeof body.content === "string" ? body.content : "";
    if (sessionId === "" || content === "") {
      return c.json(
        { error: { code: "invalid_request", message: "sessionId 与 content 必填。" } },
        400,
      );
    }

    const session = deps.db.repo.getSession(sessionId);
    if (session === undefined) {
      return c.json({ error: { code: "not_found", message: "会话不存在。" } }, 404);
    }
    const character = deps.db.repo.getCharacter(session.characterId);
    if (character === undefined) {
      return c.json({ error: { code: "not_found", message: "会话绑定的角色卡不存在。" } }, 404);
    }
    const settings = deps.db.repo.getSettings();
    if (settings.baseUrl === "" || settings.model === "") {
      return c.json(
        {
          error: {
            code: "settings_missing",
            message: "请先在 /api/settings 配置 baseUrl 与 model。",
          },
        },
        400,
      );
    }

    // 用户消息先落库，使组装历史与会话记录一致
    const userMessage = deps.db.repo.insertMessage(sessionId, {
      role: "user",
      content,
      swipeCandidates: [],
    });

    const card = JSON.parse(character.data) as CharacterCard;
    const personaName = "User";
    const result = assemblePrompt({
      card,
      persona: { name: personaName, description: "" },
      history: deps.db.repo.listMessages(sessionId).map((m) => ({
        id: m.id,
        role: m.role === "assistant" ? "assistant" : "user",
        name: m.role === "assistant" ? card.name : personaName,
        content: m.content,
      })),
      greeting: null, // greeting 已作为首条 assistant 消息入库
      globalPrompts: { main: "", postHistory: "" },
      authorNote: null,
      worldInfo: {
        books: card.characterBook !== null ? [card.characterBook] : [],
        settings: { ...WI_SETTINGS },
      },
      budget: { ...BUDGET },
      tokenizer: tokenizerForModel(settings.model),
    });

    const fetchImpl = deps.upstreamFetch ?? globalThis.fetch;
    const controller = new AbortController();

    return streamSSE(c, async (stream) => {
      stream.onAbort(() => controller.abort());
      await stream.writeSSE({
        event: "meta",
        data: JSON.stringify({
          sessionId,
          userMessageId: userMessage.id,
          tokensTotal: result.stats.tokensTotal,
        }),
      });

      let accumulated = "";
      try {
        for await (const delta of streamUpstreamCompletion(
          {
            baseUrl: settings.baseUrl,
            apiKey: settings.apiKey,
            model: settings.model,
            messages: result.messages,
            signal: controller.signal,
          },
          fetchImpl,
        )) {
          accumulated += delta;
          await stream.writeSSE({ event: "delta", data: JSON.stringify({ text: delta }) });
        }
        const saved = deps.db.repo.insertMessage(sessionId, {
          role: "assistant",
          content: accumulated,
          swipeCandidates: [accumulated],
        });
        await stream.writeSSE({
          event: "done",
          data: JSON.stringify({ messageId: saved.id, content: accumulated }),
        });
      } catch (error) {
        if (controller.signal.aborted) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ code: "aborted", message: "客户端已断开。" }),
          });
          return;
        }
        const message =
          error instanceof UpstreamError
            ? `上游错误（${error.status}）：${error.detail.slice(0, 200)}`
            : error instanceof Error
              ? error.message
              : String(error);
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ code: "upstream_failed", message }),
        });
      }
    });
  });

  return app;
}
