/**
 * 会话与消息 CRUD（M3 任务 §2）。
 * 创建会话时把角色卡 first_mes 作为首条 assistant 消息落库（swipe 候选=[first_mes]）。
 */

import { Hono } from "hono";

import type { AppDeps } from "../app.js";

export function sessionsRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post("/api/sessions", async (c) => {
    const body = await c.req
      .json<{ characterId?: unknown; title?: unknown }>()
      .catch(() => ({}) as Record<string, never>);
    const characterId = typeof body.characterId === "string" ? body.characterId : "";
    if (characterId === "") {
      return c.json({ error: { code: "character_required", message: "characterId 必填。" } }, 400);
    }
    const character = deps.db.repo.getCharacter(characterId);
    if (character === undefined) {
      return c.json({ error: { code: "not_found", message: "角色卡不存在。" } }, 404);
    }

    const id = crypto.randomUUID();
    const title = typeof body.title === "string" ? body.title : "";
    const session = deps.db.repo.insertSession(id, characterId, title);

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
    return c.json({ session, messages: deps.db.repo.listMessages(session.id) });
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

  app.delete("/api/sessions/:id/messages/:messageId", (c) => {
    if (!deps.db.repo.deleteMessage(c.req.param("id"), c.req.param("messageId"))) {
      return c.json({ error: { code: "not_found", message: "消息不存在。" } }, 404);
    }
    return c.body(null, 204);
  });

  return app;
}
