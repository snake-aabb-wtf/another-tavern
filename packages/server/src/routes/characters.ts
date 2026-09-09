/**
 * 角色卡导入与读取（M3 任务 §2）。
 */

import {
  parseCharacterCardJson,
  parseCharacterCardPng,
  type CardParseError,
} from "@another-tavern/engine";
import { Hono } from "hono";

import type { AppDeps } from "../app.js";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47] as const;

/** 安全基线（M7）：角色卡上传大小上限。 */
export const MAX_CARD_BYTES = 20 * 1024 * 1024;

export function charactersRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  // multipart 上传 PNG/JSON，解析入库（失败返回可读错误）
  app.post("/api/characters/import", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      return c.json(
        { error: { code: "file_missing", message: 'multipart 字段 "file" 缺失。' } },
        400,
      );
    }
    if (file.size > MAX_CARD_BYTES) {
      return c.json(
        {
          error: {
            code: "file_too_large",
            message: `文件超过大小上限（${Math.floor(MAX_CARD_BYTES / 1024 / 1024)}MB）。`,
          },
        },
        413,
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());

    let parsed;
    try {
      if (isPng(bytes)) {
        parsed = parseCharacterCardPng(bytes);
      } else {
        parsed = parseCharacterCardJson(new TextDecoder("utf-8").decode(bytes));
      }
    } catch (error) {
      const code = (error as CardParseError).code ?? "parse_failed";
      return c.json(
        { error: { code, message: error instanceof Error ? error.message : String(error) } },
        400,
      );
    }

    const id = crypto.randomUUID();
    deps.db.repo.insertCharacter(id, parsed.card.name, JSON.stringify(parsed.card));
    return c.json({ id, name: parsed.card.name, warnings: parsed.warnings }, 201);
  });

  app.get("/api/characters", (c) => {
    return c.json(
      deps.db.repo.listCharacters().map(({ id, name, createdAt }) => ({ id, name, createdAt })),
    );
  });

  app.get("/api/characters/:id", (c) => {
    const row = deps.db.repo.getCharacter(c.req.param("id"));
    if (row === undefined) {
      return c.json({ error: { code: "not_found", message: "角色卡不存在。" } }, 404);
    }
    return c.json({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      card: JSON.parse(row.data),
    });
  });

  // M5：编辑卡基本信息（引擎卡模型 camelCase 字段；未知字段保留）
  app.put("/api/characters/:id", async (c) => {
    const row = deps.db.repo.getCharacter(c.req.param("id"));
    if (row === undefined) {
      return c.json({ error: { code: "not_found", message: "角色卡不存在。" } }, 404);
    }
    const body = await c.req
      .json<{
        name?: unknown;
        description?: unknown;
        personality?: unknown;
        scenario?: unknown;
        firstMes?: unknown;
      }>()
      .catch(() => ({}) as Record<string, never>);
    const card = JSON.parse(row.data) as Record<string, unknown>;
    for (const key of ["name", "description", "personality", "scenario", "firstMes"] as const) {
      const value = body[key];
      if (typeof value === "string") {
        card[key] = value;
      }
    }
    const newName = typeof card.name === "string" ? card.name : row.name;
    deps.db.repo.updateCharacter(row.id, newName, JSON.stringify(card));
    return c.json({ id: row.id, name: newName, card });
  });

  // M4：世界书挂载（全量设置挂载集合）
  app.get("/api/characters/:id/lorebooks", (c) => {
    if (deps.db.repo.getCharacter(c.req.param("id")) === undefined) {
      return c.json({ error: { code: "not_found", message: "角色卡不存在。" } }, 404);
    }
    return c.json({ bookIds: deps.db.repo.listCharacterLorebookIds(c.req.param("id")) });
  });

  app.put("/api/characters/:id/lorebooks", async (c) => {
    const characterId = c.req.param("id");
    if (deps.db.repo.getCharacter(characterId) === undefined) {
      return c.json({ error: { code: "not_found", message: "角色卡不存在。" } }, 404);
    }
    const body = await c.req
      .json<{ bookIds?: unknown }>()
      .catch(() => ({}) as Record<string, never>);
    if (!Array.isArray(body.bookIds) || body.bookIds.some((b) => typeof b !== "string")) {
      return c.json(
        { error: { code: "invalid_request", message: "bookIds 必须是字符串数组。" } },
        400,
      );
    }
    const bookIds = body.bookIds as string[];
    for (const bookId of bookIds) {
      if (deps.db.repo.getLorebook(bookId) === undefined) {
        return c.json({ error: { code: "not_found", message: `世界书 ${bookId} 不存在。` } }, 404);
      }
    }
    deps.db.repo.setCharacterLorebooks(characterId, bookIds);
    return c.json({ bookIds });
  });

  return app;
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === PNG_MAGIC[0] &&
    bytes[1] === PNG_MAGIC[1] &&
    bytes[2] === PNG_MAGIC[2] &&
    bytes[3] === PNG_MAGIC[3]
  );
}
