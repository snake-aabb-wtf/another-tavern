/**
 * 连接设置（M3 任务 §2）：GET 返回打码后的 apiKey，PUT 落库全文。
 */

import { Hono } from "hono";

import type { AppDeps } from "../app.js";

export function settingsRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.get("/api/settings", (c) => {
    const value = deps.db.repo.getSettings();
    return c.json({
      baseUrl: value.baseUrl,
      model: value.model,
      apiKey: maskApiKey(value.apiKey),
      hasApiKey: value.apiKey !== "",
      sampling: value.sampling,
    });
  });

  app.put("/api/settings", async (c) => {
    const body = await c.req
      .json<{ baseUrl?: unknown; apiKey?: unknown; model?: unknown; sampling?: unknown }>()
      .catch(() => ({}) as Record<string, never>);
    const sampling =
      typeof body.sampling === "object" && body.sampling !== null && !Array.isArray(body.sampling)
        ? (body.sampling as Record<string, unknown>)
        : {};
    const saved = deps.db.repo.putSettings({
      baseUrl: readString(body.baseUrl),
      apiKey: readString(body.apiKey),
      model: readString(body.model),
      sampling,
    });
    return c.json({
      baseUrl: saved.baseUrl,
      model: saved.model,
      apiKey: maskApiKey(saved.apiKey),
      hasApiKey: saved.apiKey !== "",
      sampling: saved.sampling,
    });
  });

  return app;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 打码：长度 ≤8 全掩码；否则保留前 3 位与后 4 位。 */
export function maskApiKey(key: string): string {
  if (key === "") {
    return "";
  }
  if (key.length <= 8) {
    return "****";
  }
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}
