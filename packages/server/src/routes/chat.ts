/**
 * 流式对话端点（M3 任务 §3）：
 * 读会话历史 → engine 组装 prompt → OpenAI 兼容上游 → SSE 逐 delta 转发 → assistant 消息落库。
 * 客户端断开时 abort 上游请求。
 */

import type { CharacterCard, WorldInfoBook, WorldInfoEntry } from "@another-tavern/engine";
import { assemblePrompt, normalizePlan, tokenizerForModel } from "@another-tavern/engine";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { AppDeps } from "../app.js";
import type { LorebookRow, MessageRow } from "../db/client.js";
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

/** 采样参数白名单：仅这些键会透传到上游请求体。 */
const SAMPLING_WHITELIST = [
  "temperature",
  "top_p",
  "max_tokens",
  "frequency_penalty",
  "presence_penalty",
  "stop",
] as const;

function allowedSampling(sampling: Record<string, unknown>): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const key of SAMPLING_WHITELIST) {
    if (sampling[key] !== undefined) {
      extra[key] = sampling[key];
    }
  }
  return extra;
}

/** 把库中的世界书行 + 条目还原为引擎 WorldInfoBook。 */
function loadBookWithEntries(deps: AppDeps, row: LorebookRow): WorldInfoBook {
  return {
    id: row.id,
    name: row.name,
    description: row.description === "" ? null : row.description,
    scanDepth: row.scanDepth,
    tokenBudget: row.tokenBudget,
    recursiveScanning: row.recursiveScanning,
    entries: deps.db.repo
      .listEntries(row.id)
      .map((entry) => JSON.parse(entry.data) as WorldInfoEntry),
    extensions: {},
  };
}

export function chatRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post("/api/chat/stream", async (c) => {
    const body = await c.req
      .json<{ sessionId?: unknown; content?: unknown; regenerate?: unknown }>()
      .catch(() => ({}) as Record<string, never>);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const regenerate = body.regenerate === true;
    const content = typeof body.content === "string" ? body.content : "";
    if (sessionId === "" || (!regenerate && content === "")) {
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

    // M5 regenerate：目标 = 最后一条 assistant 消息；新回复作为其 swipe 候选追加
    const allMessages = deps.db.repo.listMessages(sessionId);
    let regenerateTarget: MessageRow | null = null;
    if (regenerate) {
      for (let i = allMessages.length - 1; i >= 0; i -= 1) {
        const m = allMessages[i];
        if (m !== undefined && m.role === "assistant") {
          regenerateTarget = m;
          break;
        }
      }
      if (regenerateTarget === null) {
        return c.json(
          { error: { code: "regenerate_target_missing", message: "会话中没有可重新生成的回复。" } },
          400,
        );
      }
    }

    // 正常模式：用户消息先落库，使组装历史与会话记录一致
    const userMessage = regenerate
      ? null
      : deps.db.repo.insertMessage(sessionId, {
          role: "user",
          content,
          swipeCandidates: [],
        });
    const card = JSON.parse(character.data) as CharacterCard;

    // M4/M6：会话组装计划 → 全局默认计划 → 引擎内置默认（三级 fallback）
    let plan;
    const planSourceId = session.planId ?? settings.defaultPlanId;
    if (planSourceId !== null) {
      const planRow = deps.db.repo.getPlan(planSourceId);
      if (planRow === undefined) {
        if (session.planId !== null) {
          // 会话显式绑定的计划被删 → 显式 404（全局默认被删则静默回落内置默认）
          return c.json(
            {
              error: {
                code: "not_found",
                message: "会话绑定的组装计划不存在（已回落默认计划可重置）。",
              },
            },
            404,
          );
        }
      } else {
        plan = normalizePlan(JSON.parse(planRow.data)).plan;
      }
    }

    // M4：三源世界书——卡内书 + 角色挂载书 + 全局书（按 id 去重，先到先得）
    const linkedIds = deps.db.repo.listCharacterLorebookIds(session.characterId);
    const linkedBooks = linkedIds
      .map((id) => deps.db.repo.getLorebook(id))
      .filter((book): book is NonNullable<typeof book> => book !== undefined);
    const globalBooks = deps.db.repo.listGlobalLorebooks();
    const books: WorldInfoBook[] = [];
    if (card.characterBook !== null) {
      books.push(card.characterBook);
    }
    for (const row of [...linkedBooks, ...globalBooks]) {
      if (books.some((b) => b.id === row.id)) {
        continue;
      }
      books.push(loadBookWithEntries(deps, row));
    }

    const personaName = "User";
    // 组装用历史：正常模式 = 含新 user 消息的全量；regenerate = 排除目标回复及其后
    const historyRows: readonly MessageRow[] =
      regenerateTarget !== null
        ? allMessages.filter((m) => m.seq < regenerateTarget.seq)
        : [...allMessages, ...(userMessage !== null ? [userMessage] : [])];
    const result = assemblePrompt({
      card,
      ...(plan !== undefined ? { plan } : {}),
      persona: { name: personaName, description: "" },
      history: historyRows.map((m) => ({
        id: m.id,
        role: m.role === "assistant" ? "assistant" : "user",
        name: m.role === "assistant" ? card.name : personaName,
        content: m.content,
      })),
      greeting: null, // greeting 已作为首条 assistant 消息入库
      globalPrompts: { main: "", postHistory: "" },
      authorNote: null,
      worldInfo: {
        books,
        settings: { ...WI_SETTINGS },
      },
      budget: { ...BUDGET },
      tokenizer: tokenizerForModel(settings.model),
    });

    // M4：记录最近一次组装的最终 messages（调试端点用）
    deps.db.repo.updateLastMessages(sessionId, JSON.stringify(result.messages));

    const fetchImpl = deps.upstreamFetch ?? globalThis.fetch;
    const controller = new AbortController();

    return streamSSE(c, async (stream) => {
      stream.onAbort(() => controller.abort());
      await stream.writeSSE({
        event: "meta",
        data: JSON.stringify({
          sessionId,
          userMessageId: userMessage?.id ?? null,
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
            extraBody: allowedSampling(settings.sampling),
          },
          fetchImpl,
        )) {
          accumulated += delta;
          await stream.writeSSE({ event: "delta", data: JSON.stringify({ text: delta }) });
        }
        const saved =
          regenerateTarget !== null
            ? deps.db.repo.appendSwipeCandidate(sessionId, regenerateTarget.id, accumulated)
            : deps.db.repo.insertMessage(sessionId, {
                role: "assistant",
                content: accumulated,
                swipeCandidates: [accumulated],
              });
        if (saved === undefined) {
          throw new Error("保存回复失败：目标消息不存在。");
        }
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
