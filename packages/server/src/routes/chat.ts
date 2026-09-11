/**
 * 流式对话端点（M3 任务 §3）：
 * 读会话历史 → engine 组装 prompt → OpenAI 兼容上游 → SSE 逐 delta 转发 → assistant 消息落库。
 * 客户端断开时 abort 上游请求。
 */

import type {
  AssemblyResult,
  CharacterCard,
  WorldInfoBook,
  WorldInfoEntry,
} from "@another-tavern/engine";
import {
  AssemblyError,
  assemblePrompt,
  chooseNextSpeaker,
  normalizePlan,
  SpeakerSelectionError,
  tokenizerForModel,
} from "@another-tavern/engine";
import type { SpeakerHistoryItem, SpeakerMember, SpeakerStrategy } from "@another-tavern/engine";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { AppDeps } from "../app.js";
import type { LorebookRow, MessageRow } from "../db/client.js";
import { loadRegexScripts } from "../regex.js";
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
  "seed",
] as const;

const activeGenerations = new Set<string>();

function groupReplyStrategy(settings: Record<string, unknown> | null): "manual" | "list" {
  return settings?.replyStrategy === "list" ? "list" : "manual";
}

function groupScenarioOverride(settings: Record<string, unknown> | null): string | null {
  return typeof settings?.scenarioOverride === "string" ? settings.scenarioOverride : null;
}

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
      .json<{
        sessionId?: unknown;
        content?: unknown;
        messageId?: unknown;
        regenerate?: unknown;
        speakerId?: unknown;
        force?: unknown;
      }>()
      .catch(() => ({}) as Record<string, never>);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const regenerate = body.regenerate === true;
    const content = typeof body.content === "string" ? body.content : "";
    const messageId = typeof body.messageId === "string" ? body.messageId : "";
    const requestedSpeakerId = typeof body.speakerId === "string" ? body.speakerId : "";
    const force = body.force === true;
    if (
      sessionId === "" ||
      (!regenerate && content === "" && messageId === "") ||
      (!regenerate && content !== "" && messageId !== "")
    ) {
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: "sessionId 与 content 或 messageId 二选一必填。",
          },
        },
        400,
      );
    }

    const session = deps.db.repo.getSession(sessionId);
    if (session === undefined) {
      return c.json({ error: { code: "not_found", message: "会话不存在。" } }, 404);
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

    const sessionMembers = deps.db.repo.listSessionMembers(sessionId);
    if (sessionMembers.length === 0) {
      return c.json(
        { error: { code: "no_available_speaker", message: "会话没有可用成员。" } },
        400,
      );
    }

    const memberCards = new Map<string, { name: string; card: CharacterCard }>();
    for (const member of sessionMembers) {
      const row = deps.db.repo.getCharacter(member.characterId);
      if (row === undefined) {
        return c.json({ error: { code: "not_found", message: "会话成员角色卡不存在。" } }, 404);
      }
      memberCards.set(member.characterId, {
        name: row.name,
        card: JSON.parse(row.data) as CharacterCard,
      });
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

    let activeSpeakerId = session.characterId;
    let speakerReason: SpeakerStrategy = "manual";
    if (session.kind === "group") {
      const regeneratedSpeakerId =
        regenerateTarget?.speakerCharacterId !== null
          ? (regenerateTarget?.speakerCharacterId ?? "")
          : "";
      const speakerId = requestedSpeakerId !== "" ? requestedSpeakerId : regeneratedSpeakerId;
      const preservingRegeneratedSpeaker = requestedSpeakerId === "" && regeneratedSpeakerId !== "";
      speakerReason =
        speakerId !== ""
          ? force || preservingRegeneratedSpeaker
            ? "force"
            : "manual"
          : groupReplyStrategy(session.groupSettings);
      const speakerMembers: SpeakerMember[] = sessionMembers.map((member) => ({
        characterId: member.characterId,
        position: member.position,
        muted: member.muted,
      }));
      const speakerHistory: SpeakerHistoryItem[] = allMessages.map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        ...(message.speakerCharacterId !== null ? { speakerId: message.speakerCharacterId } : {}),
      }));
      try {
        activeSpeakerId = chooseNextSpeaker({
          strategy: speakerReason,
          members: speakerMembers,
          history: speakerHistory,
          ...(speakerId !== "" ? { speakerId } : {}),
        }).characterId;
      } catch (error) {
        if (error instanceof SpeakerSelectionError) {
          return c.json({ error: { code: error.code, message: error.message } }, 400);
        }
        throw error;
      }
    }
    const activeCharacter = deps.db.repo.getCharacter(activeSpeakerId);
    if (activeCharacter === undefined) {
      return c.json({ error: { code: "not_found", message: "当前发言角色卡不存在。" } }, 404);
    }
    const activeCard =
      memberCards.get(activeSpeakerId)?.card ?? (JSON.parse(activeCharacter.data) as CharacterCard);
    const activeSpeakerName = memberCards.get(activeSpeakerId)?.name ?? activeCharacter.name;

    if (activeGenerations.has(sessionId)) {
      return c.json(
        { error: { code: "generation_in_progress", message: "该会话已有生成任务进行中。" } },
        409,
      );
    }
    activeGenerations.add(sessionId);

    // 正常模式：新消息先以 pending 落库；重试复用 failed/cancelled 消息，避免重复插入。
    let userMessage: MessageRow | null = null;
    if (!regenerate) {
      if (messageId !== "") {
        const existing = deps.db.repo.getMessage(sessionId, messageId);
        if (
          existing === undefined ||
          existing.role !== "user" ||
          (existing.status !== "failed" && existing.status !== "cancelled")
        ) {
          activeGenerations.delete(sessionId);
          return c.json(
            {
              error: {
                code: "retry_target_invalid",
                message: "只能重试已失败或已取消的用户消息。",
              },
            },
            400,
          );
        }
        deps.db.repo.setMessageStatus(sessionId, messageId, "pending");
        userMessage = { ...existing, status: "pending" };
      } else {
        userMessage = deps.db.repo.insertMessage(sessionId, {
          role: "user",
          content,
          status: "pending",
          swipeCandidates: [],
        });
      }
    }

    // M4/M6：会话组装计划 → 全局默认计划 → 引擎内置默认（三级 fallback）
    let plan;
    const planSourceId = session.planId ?? settings.defaultPlanId;
    if (planSourceId !== null) {
      const planRow = deps.db.repo.getPlan(planSourceId);
      if (planRow === undefined) {
        if (session.planId !== null) {
          // 会话显式绑定的计划被删 → 显式 404（全局默认被删则静默回落内置默认）
          if (userMessage !== null) {
            deps.db.repo.setMessageStatus(sessionId, userMessage.id, "failed");
          }
          activeGenerations.delete(sessionId);
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
    const linkedIds = deps.db.repo.listCharacterLorebookIds(activeCharacter.id);
    const linkedBooks = linkedIds
      .map((id) => deps.db.repo.getLorebook(id))
      .filter((book): book is NonNullable<typeof book> => book !== undefined);
    const globalBooks = deps.db.repo.listGlobalLorebooks();
    const books: WorldInfoBook[] = [];
    if (activeCard.characterBook !== null) {
      books.push(activeCard.characterBook);
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
        ? allMessages.filter(
            (m) =>
              m.seq < regenerateTarget.seq && m.status !== "failed" && m.status !== "cancelled",
          )
        : [
            ...allMessages.filter((m) => m.id !== userMessage?.id),
            ...(userMessage !== null ? [userMessage] : []),
          ].filter((m) => m.status !== "failed" && m.status !== "cancelled");
    let result: AssemblyResult;
    try {
      result = assemblePrompt({
        card: activeCard,
        ...(session.kind === "group"
          ? {
              group: {
                activeCharacterId: activeSpeakerId,
                participants: sessionMembers.map((member) => ({
                  id: member.characterId,
                  card: memberCards.get(member.characterId)!.card,
                  muted: member.muted,
                })),
                generationMode: "swap" as const,
                scenarioOverride: groupScenarioOverride(session.groupSettings),
              },
            }
          : {}),
        ...(plan !== undefined ? { plan } : {}),
        persona: { name: personaName, description: "" },
        history: historyRows.map((m) => ({
          id: m.id,
          role: m.role === "assistant" ? "assistant" : "user",
          name:
            m.role === "assistant"
              ? (m.speakerName ??
                (m.speakerCharacterId === null
                  ? activeSpeakerName
                  : (memberCards.get(m.speakerCharacterId)?.name ?? activeSpeakerName)))
              : personaName,
          content: m.content,
          ...(m.speakerCharacterId !== null ? { speakerId: m.speakerCharacterId } : {}),
        })),
        greeting: null, // greeting 已作为首条 assistant 消息入库
        globalPrompts: { main: "", postHistory: "" },
        authorNote: null,
        worldInfo: {
          books,
          settings: { ...WI_SETTINGS },
        },
        budget: { ...BUDGET },
        regex: { scripts: loadRegexScripts(deps, activeCard, plan) },
        tokenizer: tokenizerForModel(settings.model),
      });
    } catch (error) {
      if (userMessage !== null) {
        deps.db.repo.setMessageStatus(sessionId, userMessage.id, "failed");
      }
      activeGenerations.delete(sessionId);
      const message = error instanceof Error ? error.message : String(error);
      return c.json(
        {
          error: {
            code: error instanceof AssemblyError ? error.code : "assembly_failed",
            message,
          },
        },
        422,
      );
    }

    // M4：记录最近一次组装的最终 messages（调试端点用）
    deps.db.repo.updateLastMessages(sessionId, JSON.stringify(result.messages));

    const fetchImpl = deps.upstreamFetch ?? globalThis.fetch;
    const controller = new AbortController();

    return streamSSE(c, async (stream) => {
      try {
        stream.onAbort(() => controller.abort());
        await stream.writeSSE({
          event: "meta",
          data: JSON.stringify({
            sessionId,
            userMessageId: userMessage?.id ?? null,
            speakerId: activeSpeakerId,
            speakerName: activeSpeakerName,
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
                  speakerCharacterId: activeSpeakerId,
                  speakerName: activeSpeakerName,
                });
          if (saved === undefined) {
            throw new Error("保存回复失败：目标消息不存在。");
          }
          if (userMessage !== null) {
            deps.db.repo.setMessageStatus(sessionId, userMessage.id, "completed");
          }
          await stream.writeSSE({
            event: "done",
            data: JSON.stringify({ messageId: saved.id, content: accumulated }),
          });
        } catch (error) {
          if (controller.signal.aborted) {
            if (userMessage !== null) {
              deps.db.repo.setMessageStatus(sessionId, userMessage.id, "cancelled");
            }
            return;
          }
          if (userMessage !== null) {
            deps.db.repo.setMessageStatus(sessionId, userMessage.id, "failed");
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
      } finally {
        activeGenerations.delete(sessionId);
      }
    });
  });

  return app;
}
