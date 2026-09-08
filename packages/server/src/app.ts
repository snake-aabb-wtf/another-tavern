/**
 * Hono 应用工厂（docs 架构：server 只通过 engine 完成组装逻辑）。
 * 依赖注入便于测试（内存 SQLite + fake 上游 fetch）。
 */

import { Hono } from "hono";

import type { AppDatabase } from "./db/client.js";
import { chatRoutes } from "./routes/chat.js";
import { charactersRoutes } from "./routes/characters.js";
import { lorebooksRoutes } from "./routes/lorebooks.js";
import { plansRoutes } from "./routes/plans.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { settingsRoutes } from "./routes/settings.js";

export interface AppDeps {
  db: AppDatabase;
  /** 上游 fetch（默认 globalThis.fetch；测试注入 fake）。 */
  upstreamFetch?: typeof fetch;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/", charactersRoutes(deps));
  app.route("/", settingsRoutes(deps));
  app.route("/", sessionsRoutes(deps));
  app.route("/", plansRoutes(deps));
  app.route("/", lorebooksRoutes(deps));
  app.route("/", chatRoutes(deps));

  return app;
}
