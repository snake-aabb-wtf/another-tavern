/**
 * server 启动入口：node dist/main.js（M3）。
 * 环境变量：PORT（默认 3001）、DB_PATH（默认 data/app.db）、MIGRATIONS_DIR（默认 drizzle）。
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { openDatabase } from "./db/client.js";

const dbPath = resolve(process.env.DB_PATH ?? "data/app.db");
const migrationsDir = resolve(process.env.MIGRATIONS_DIR ?? "drizzle");
const port = Number(process.env.PORT ?? 3001);

mkdirSync(dirname(dbPath), { recursive: true });
const db = openDatabase(dbPath, migrationsDir);
const app = createApp({ db });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[another-tavern] server listening on http://localhost:${info.port}`);
  console.log(`[another-tavern] database: ${dbPath}`);
});
