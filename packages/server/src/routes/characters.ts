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
