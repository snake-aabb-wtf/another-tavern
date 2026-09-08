/**
 * 世界书 CRUD、ST 世界书 JSON 导入与条目管理（M4 任务 §5）。
 */

import { randomUUID } from "node:crypto";

import {
  parseSillyTavernWorldInfo,
  WorldInfoParseError,
  type WorldInfoEntry,
} from "@another-tavern/engine";
import { Hono } from "hono";

import type { AppDeps } from "../app.js";

export function lorebooksRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post("/api/lorebooks", async (c) => {
    const body = await c.req
      .json<{ name?: unknown; description?: unknown; isGlobal?: unknown }>()
      .catch(() => ({}) as Record<string, never>);
    const name = typeof body.name === "string" ? body.name : "";
    if (name === "") {
      return c.json({ error: { code: "name_required", message: "name 必填。" } }, 400);
    }
    const id = randomUUID();
    const book = deps.db.repo.insertLorebook(
      id,
      name,
      typeof body.description === "string" ? body.description : "",
      body.isGlobal === true,
    );
    return c.json(book, 201);
  });

  // ST 原生世界书 JSON 文件导入（entries 字典 + key 数组 + 数字 position）
  app.post("/api/lorebooks/import", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      return c.json(
        { error: { code: "file_missing", message: 'multipart 字段 "file" 缺失。' } },
        400,
      );
    }
    const isGlobal = body.isGlobal === "1" || body.isGlobal === "true";
    const text = await file.text();
    try {
      const parsed = parseSillyTavernWorldInfo(text);
      const id = randomUUID();
      const name = parsed.book.name ?? (file.name.replace(/\.[^.]+$/, "") || "导入的世界书");
      const book = deps.db.repo.insertLorebook(id, name, parsed.book.description ?? "", isGlobal);
      for (const entry of parsed.book.entries) {
        deps.db.repo.insertEntry(randomUUID(), id, entry.id, JSON.stringify(entry));
      }
      return c.json(
        {
          id: book.id,
          name: book.name,
          entryCount: parsed.book.entries.length,
          warnings: parsed.warnings,
        },
        201,
      );
    } catch (error) {
      const code = (error as WorldInfoParseError).code ?? "worldinfo_parse_failed";
      return c.json(
        { error: { code, message: error instanceof Error ? error.message : String(error) } },
        400,
      );
    }
  });

  app.get("/api/lorebooks", (c) => {
    return c.json(deps.db.repo.listLorebooks());
  });

  app.get("/api/lorebooks/:id", (c) => {
    const book = deps.db.repo.getLorebook(c.req.param("id"));
    if (book === undefined) {
      return c.json({ error: { code: "not_found", message: "世界书不存在。" } }, 404);
    }
    const entries = deps.db.repo
      .listEntries(book.id)
      .map((row) => JSON.parse(row.data) as WorldInfoEntry);
    return c.json({ ...book, entries });
  });

  app.put("/api/lorebooks/:id", async (c) => {
    const id = c.req.param("id");
    const existing = deps.db.repo.getLorebook(id);
    if (existing === undefined) {
      return c.json({ error: { code: "not_found", message: "世界书不存在。" } }, 404);
    }
    const body = await c.req
      .json<{
        name?: unknown;
        description?: unknown;
        isGlobal?: unknown;
        tokenBudget?: unknown;
        scanDepth?: unknown;
        recursiveScanning?: unknown;
      }>()
      .catch(() => ({}) as Record<string, never>);
    const book = deps.db.repo.updateLorebook(id, {
      name: typeof body.name === "string" && body.name !== "" ? body.name : existing.name,
      description: typeof body.description === "string" ? body.description : existing.description,
      isGlobal: typeof body.isGlobal === "boolean" ? body.isGlobal : existing.isGlobal,
      ...(typeof body.tokenBudget === "number" && Number.isFinite(body.tokenBudget)
        ? { tokenBudget: Math.trunc(body.tokenBudget) }
        : {}),
      ...(typeof body.scanDepth === "number" && Number.isFinite(body.scanDepth)
        ? { scanDepth: Math.trunc(body.scanDepth) }
        : {}),
      ...(typeof body.recursiveScanning === "boolean"
        ? { recursiveScanning: body.recursiveScanning }
        : {}),
    });
    return c.json(book);
  });

  app.delete("/api/lorebooks/:id", (c) => {
    if (!deps.db.repo.deleteLorebook(c.req.param("id"))) {
      return c.json({ error: { code: "not_found", message: "世界书不存在。" } }, 404);
    }
    return c.body(null, 204);
  });

  // 条目管理（body 为引擎条目形状；uid 缺省自动生成）
  app.post("/api/lorebooks/:id/entries", async (c) => {
    const bookId = c.req.param("id");
    if (deps.db.repo.getLorebook(bookId) === undefined) {
      return c.json({ error: { code: "not_found", message: "世界书不存在。" } }, 404);
    }
    const body = (await c.req.json().catch(() => ({}) as Record<string, never>)) as Record<
      string,
      unknown
    >;
    const uid = typeof body.id === "string" && body.id !== "" ? body.id : randomUUID();
    const entry = sanitizeEntry(body, uid);
    const row = deps.db.repo.insertEntry(randomUUID(), bookId, uid, JSON.stringify(entry));
    return c.json({ uid: row.uid, entry }, 201);
  });

  app.put("/api/lorebooks/:id/entries/:uid", async (c) => {
    const bookId = c.req.param("id");
    const uid = c.req.param("uid");
    if (deps.db.repo.getEntry(bookId, uid) === undefined) {
      return c.json({ error: { code: "not_found", message: "条目不存在。" } }, 404);
    }
    const body = (await c.req.json().catch(() => ({}) as Record<string, never>)) as Record<
      string,
      unknown
    >;
    const entry = sanitizeEntry(body, uid);
    deps.db.repo.updateEntry(bookId, uid, JSON.stringify(entry));
    return c.json({ uid, entry });
  });

  app.delete("/api/lorebooks/:id/entries/:uid", (c) => {
    if (!deps.db.repo.deleteEntry(c.req.param("id"), c.req.param("uid"))) {
      return c.json({ error: { code: "not_found", message: "条目不存在。" } }, 404);
    }
    return c.body(null, 204);
  });

  return app;
}

/** 宽容构造可存储的条目（id/bookId 由服务端控制）。 */
function sanitizeEntry(body: Record<string, unknown>, uid: string): WorldInfoEntry {
  return {
    id: uid,
    comment: typeof body.comment === "string" ? body.comment : "",
    keys: stringArray(body.keys),
    secondaryKeys: stringArray(body.secondaryKeys),
    selective: body.selective === true,
    logic:
      body.logic === "andAll" || body.logic === "notAny" || body.logic === "notAll"
        ? body.logic
        : "andAny",
    content: typeof body.content === "string" ? body.content : "",
    enabled: body.enabled !== false,
    constant: body.constant === true,
    insertionOrder:
      typeof body.insertionOrder === "number" && Number.isFinite(body.insertionOrder)
        ? Math.trunc(body.insertionOrder)
        : 100,
    position:
      body.position === "beforeChar" ||
      body.position === "afterChar" ||
      body.position === "atDepth" ||
      body.position === "anTop" ||
      body.position === "anBottom" ||
      body.position === "beforeExample" ||
      body.position === "afterExample" ||
      body.position === "outlet"
        ? body.position
        : "afterChar",
    depth:
      typeof body.depth === "number" && Number.isFinite(body.depth) ? Math.trunc(body.depth) : null,
    role:
      body.role === "user" || body.role === "assistant"
        ? body.role
        : body.role === "system"
          ? "system"
          : null,
    scanDepth:
      typeof body.scanDepth === "number" && Number.isFinite(body.scanDepth)
        ? Math.trunc(body.scanDepth)
        : null,
    caseSensitive: typeof body.caseSensitive === "boolean" ? body.caseSensitive : null,
    matchWholeWords: typeof body.matchWholeWords === "boolean" ? body.matchWholeWords : null,
    preventRecursion: body.preventRecursion === true,
    excludeRecursion: body.excludeRecursion === true,
    extensions:
      typeof body.extensions === "object" &&
      body.extensions !== null &&
      !Array.isArray(body.extensions)
        ? (body.extensions as Record<string, unknown>)
        : {},
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
