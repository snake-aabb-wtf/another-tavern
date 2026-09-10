/**
 * 会话与消息 CRUD（M3 任务 §2）。
 * 创建会话时把角色卡 first_mes 作为首条 assistant 消息落库（swipe 候选=[first_mes]）。
 */

import { Hono } from "hono";

import type { AppDeps } from "../app.js";
import type { SessionMemberInput } from "../db/client.js";

const DEFAULT_GROUP_SETTINGS: Record<string, unknown> = {
  replyStrategy: "manual",
  generationMode: "swap",
  scenarioOverride: null,
  allowSelfResponses: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGroup(session: { kind: "single" | "group" }): boolean {
  return session.kind === "group";
}

export function sessionsRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post("/api/sessions", async (c) => {
    const body = await c.req
      .json<{
        characterId?: unknown;
        characterIds?: unknown;
        kind?: unknown;
        title?: unknown;
        planId?: unknown;
      }>()
      .catch(() => ({}) as Record<string, never>);
    const title = typeof body.title === "string" ? body.title : "";

    if (body.kind === "group") {
      if (!Array.isArray(body.characterIds) || body.characterIds.length < 2) {
        return c.json(
          { error: { code: "group_members_required", message: "群聊至少需要两个角色。" } },
          400,
        );
      }
      if (!body.characterIds.every((id): id is string => typeof id === "string" && id !== "")) {
        return c.json(
          { error: { code: "invalid_request", message: "characterIds 必须是非空字符串数组。" } },
          400,
        );
      }
      const characterIds = body.characterIds as string[];
      if (new Set(characterIds).size !== characterIds.length) {
        return c.json(
          { error: { code: "duplicate_character", message: "群聊不能重复添加同一角色。" } },
          400,
        );
      }
      const characters = characterIds.map((id) => deps.db.repo.getCharacter(id));
      if (characters.some((character) => character === undefined)) {
        return c.json({ error: { code: "not_found", message: "群聊中的角色卡不存在。" } }, 404);
      }

      let planId: string | null = null;
      if (typeof body.planId === "string" && body.planId !== "") {
        if (deps.db.repo.getPlan(body.planId) === undefined) {
          return c.json({ error: { code: "not_found", message: "组装计划不存在。" } }, 404);
        }
        planId = body.planId;
      }

      const id = crypto.randomUUID();
      const members: SessionMemberInput[] = characterIds.map((characterId, position) => ({
        characterId,
        position,
      }));
      const session = deps.db.repo.insertGroupSession(
        id,
        characterIds[0]!,
        title,
        planId,
        { ...DEFAULT_GROUP_SETTINGS },
        members,
      );
      const firstCharacter = characters[0]!;
      const firstCard = JSON.parse(firstCharacter.data) as { firstMes?: string };
      if (typeof firstCard.firstMes === "string" && firstCard.firstMes !== "") {
        deps.db.repo.insertMessage(id, {
          role: "assistant",
          content: firstCard.firstMes,
          swipeCandidates: [firstCard.firstMes],
          speakerCharacterId: firstCharacter.id,
          speakerName: firstCharacter.name,
        });
      }
      return c.json(session, 201);
    }

    const characterId = typeof body.characterId === "string" ? body.characterId : "";
    if (characterId === "") {
      return c.json({ error: { code: "character_required", message: "characterId 必填。" } }, 400);
    }
    const character = deps.db.repo.getCharacter(characterId);
    if (character === undefined) {
      return c.json({ error: { code: "not_found", message: "角色卡不存在。" } }, 404);
    }
    // M4：可选组装计划（null/缺省 = 引擎默认计划）
    let planId: string | null = null;
    if (typeof body.planId === "string" && body.planId !== "") {
      if (deps.db.repo.getPlan(body.planId) === undefined) {
        return c.json({ error: { code: "not_found", message: "组装计划不存在。" } }, 404);
      }
      planId = body.planId;
    }

    const id = crypto.randomUUID();
    const session = deps.db.repo.insertSession(id, characterId, title, planId);

    const card = JSON.parse(character.data) as { firstMes?: string };
    if (typeof card.firstMes === "string" && card.firstMes !== "") {
      deps.db.repo.insertMessage(id, {
        role: "assistant",
        content: card.firstMes,
        swipeCandidates: [card.firstMes],
      });
    }
    return c.json(session, 201);
  });

  app.get("/api/sessions", (c) => {
    return c.json(deps.db.repo.listSessions());
  });

  app.get("/api/sessions/:id", (c) => {
    const session = deps.db.repo.getSession(c.req.param("id"));
    if (session === undefined) {
      return c.json({ error: { code: "not_found", message: "会话不存在。" } }, 404);
    }
    return c.json({
      session,
      members: deps.db.repo.listSessionMembers(session.id),
      messages: deps.db.repo.listMessages(session.id),
    });
  });

  app.get("/api/sessions/:id/members", (c) => {
    const session = deps.db.repo.getSession(c.req.param("id"));
    if (session === undefined) {
      return c.json({ error: { code: "not_found", message: "会话不存在。" } }, 404);
    }
    return c.json({ sessionId: session.id, members: deps.db.repo.listSessionMembers(session.id) });
  });

  app.put("/api/sessions/:id/members", async (c) => {
    const session = deps.db.repo.getSession(c.req.param("id"));
    if (session === undefined) {
      return c.json({ error: { code: "not_found", message: "会话不存在。" } }, 404);
    }
    if (!isGroup(session)) {
      return c.json(
        { error: { code: "not_group_session", message: "只有群聊会话可以管理成员。" } },
        400,
      );
    }
    const body = await c.req
      .json<{ members?: unknown }>()
      .catch(() => ({}) as Record<string, never>);
    if (!Array.isArray(body.members) || body.members.length < 2) {
      return c.json(
        { error: { code: "group_members_required", message: "群聊至少需要两个角色。" } },
        400,
      );
    }
    const ids: string[] = [];
    const members: SessionMemberInput[] = [];
    for (const [position, value] of body.members.entries()) {
      if (!isRecord(value) || typeof value.characterId !== "string" || value.characterId === "") {
        return c.json(
          { error: { code: "invalid_request", message: "members.characterId 必须是非空字符串。" } },
          400,
        );
      }
      if (ids.includes(value.characterId)) {
        return c.json(
          { error: { code: "duplicate_character", message: "群聊不能重复添加同一角色。" } },
          400,
        );
      }
      if (deps.db.repo.getCharacter(value.characterId) === undefined) {
        return c.json({ error: { code: "not_found", message: "群聊中的角色卡不存在。" } }, 404);
      }
      const muted = value.muted === undefined ? false : value.muted;
      const talkativeness = value.talkativeness === undefined ? 50 : value.talkativeness;
      if (
        typeof muted !== "boolean" ||
        typeof talkativeness !== "number" ||
        !Number.isInteger(talkativeness) ||
        talkativeness < 0 ||
        talkativeness > 100
      ) {
        return c.json(
          { error: { code: "invalid_request", message: "成员静音和活跃度参数无效。" } },
          400,
        );
      }
      ids.push(value.characterId);
      members.push({ characterId: value.characterId, position, muted, talkativeness });
    }
    deps.db.repo.replaceSessionMembers(session.id, members);
    return c.json({ sessionId: session.id, members: deps.db.repo.listSessionMembers(session.id) });
  });

  app.put("/api/sessions/:id/group-settings", async (c) => {
    const session = deps.db.repo.getSession(c.req.param("id"));
    if (session === undefined) {
      return c.json({ error: { code: "not_found", message: "会话不存在。" } }, 404);
    }
    if (!isGroup(session)) {
      return c.json(
        { error: { code: "not_group_session", message: "只有群聊会话可以修改群聊设置。" } },
        400,
      );
    }
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    if (!isRecord(body)) {
      return c.json({ error: { code: "invalid_request", message: "群聊设置必须是对象。" } }, 400);
    }
    const next = { ...DEFAULT_GROUP_SETTINGS, ...(session.groupSettings ?? {}), ...body };
    if (next.replyStrategy !== "manual" && next.replyStrategy !== "list") {
      return c.json(
        { error: { code: "invalid_request", message: "replyStrategy 只能是 manual 或 list。" } },
        400,
      );
    }
    if (next.generationMode !== "swap") {
      return c.json(
        { error: { code: "invalid_request", message: "generationMode 目前只能是 swap。" } },
        400,
      );
    }
    if (next.scenarioOverride !== null && typeof next.scenarioOverride !== "string") {
      return c.json(
        { error: { code: "invalid_request", message: "scenarioOverride 必须是字符串或 null。" } },
        400,
      );
    }
    if (typeof next.allowSelfResponses !== "boolean") {
      return c.json(
        { error: { code: "invalid_request", message: "allowSelfResponses 必须是布尔值。" } },
        400,
      );
    }
    deps.db.repo.setGroupSettings(session.id, next);
    return c.json({ sessionId: session.id, groupSettings: next });
  });

  // M4：切换会话组装计划（null = 回落默认）
  app.put("/api/sessions/:id/plan", async (c) => {
    const sessionId = c.req.param("id");
    if (deps.db.repo.getSession(sessionId) === undefined) {
      return c.json({ error: { code: "not_found", message: "会话不存在。" } }, 404);
    }
    const body = await c.req
      .json<{ planId?: unknown }>()
      .catch(() => ({}) as Record<string, never>);
    if (typeof body.planId === "string" && body.planId !== "") {
      if (deps.db.repo.getPlan(body.planId) === undefined) {
        return c.json({ error: { code: "not_found", message: "组装计划不存在。" } }, 404);
      }
      deps.db.repo.setSessionPlan(sessionId, body.planId);
      return c.json({ sessionId, planId: body.planId });
    }
    deps.db.repo.setSessionPlan(sessionId, null);
    return c.json({ sessionId, planId: null });
  });

  // M4：调试端点——最近一次组装的最终 messages
  app.get("/api/sessions/:id/last-prompt", (c) => {
    const sessionId = c.req.param("id");
    if (deps.db.repo.getSession(sessionId) === undefined) {
      return c.json({ error: { code: "not_found", message: "会话不存在。" } }, 404);
    }
    const last = deps.db.repo.getLastMessages(sessionId);
    if (last === null) {
      return c.json({ error: { code: "no_prompt", message: "该会话尚未进行过组装。" } }, 404);
    }
    return c.json({ sessionId, messages: JSON.parse(last) });
  });

  app.delete("/api/sessions/:id", (c) => {
    if (!deps.db.repo.deleteSession(c.req.param("id"))) {
      return c.json({ error: { code: "not_found", message: "会话不存在。" } }, 404);
    }
    return c.body(null, 204);
  });

  app.post("/api/sessions/:id/messages", async (c) => {
    const sessionId = c.req.param("id");
    if (deps.db.repo.getSession(sessionId) === undefined) {
      return c.json({ error: { code: "not_found", message: "会话不存在。" } }, 404);
    }
    const body = await c.req
      .json<{ role?: unknown; content?: unknown }>()
      .catch(() => ({}) as Record<string, never>);
    const role = body.role === "assistant" || body.role === "system" ? body.role : "user";
    const content = typeof body.content === "string" ? body.content : "";
    if (content === "") {
      return c.json({ error: { code: "content_required", message: "content 必填。" } }, 400);
    }
    const message = deps.db.repo.insertMessage(sessionId, {
      role,
      content,
      swipeCandidates: role === "assistant" ? [content] : [],
    });
    return c.json(message, 201);
  });

  // M5：编辑消息内容 / 切换 swipe 候选
  app.put("/api/sessions/:id/messages/:messageId", async (c) => {
    const sessionId = c.req.param("id");
    const messageId = c.req.param("messageId");
    const body = await c.req
      .json<{ content?: unknown; swipeIndex?: unknown }>()
      .catch(() => ({}) as Record<string, never>);
    const patch: { content?: string; swipeIndex?: number } = {};
    if (typeof body.content === "string") {
      patch.content = body.content;
    }
    if (typeof body.swipeIndex === "number" && Number.isInteger(body.swipeIndex)) {
      patch.swipeIndex = body.swipeIndex;
    }
    if (Object.keys(patch).length === 0) {
      return c.json(
        { error: { code: "invalid_request", message: "content 或 swipeIndex 至少提供一项。" } },
        400,
      );
    }
    const updated = deps.db.repo.updateMessage(sessionId, messageId, patch);
    if (updated === undefined) {
      return c.json(
        { error: { code: "not_found", message: "消息不存在或 swipeIndex 越界。" } },
        404,
      );
    }
    return c.json(updated);
  });

  app.delete("/api/sessions/:id/messages/:messageId", (c) => {
    if (!deps.db.repo.deleteMessage(c.req.param("id"), c.req.param("messageId"))) {
      return c.json({ error: { code: "not_found", message: "消息不存在。" } }, 404);
    }
    return c.body(null, 204);
  });

  return app;
}
