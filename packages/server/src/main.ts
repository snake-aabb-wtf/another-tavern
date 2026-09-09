/**
 * server 启动入口：node dist/main.js。
 * 环境变量：
 * - PORT（默认 3001）
 * - DB_PATH（默认 data/app.db）
 * - MIGRATIONS_DIR（默认 drizzle）
 * - STATIC_DIR（设置后托管 SPA 静态文件；分发模式由启动器设为 web-dist）
 * - OPEN_BROWSER=1（启动后自动打开浏览器；分发模式启用）
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { openDatabase } from "./db/client.js";

const dbPath = resolve(process.env.DB_PATH ?? "data/app.db");
const migrationsDir = resolve(process.env.MIGRATIONS_DIR ?? "drizzle");
const port = Number(process.env.PORT ?? 3001);
const staticDir = process.env.STATIC_DIR;

mkdirSync(dirname(dbPath), { recursive: true });
const db = openDatabase(dbPath, migrationsDir);
const app = createApp({ db });

// 分发模式：托管 web 构建产物（API 路由优先，其余回落 SPA index.html）。
// 自实现静态处理（MIME 映射 + SPA fallback），不依赖 serveStatic 的路径解析行为。
if (staticDir !== undefined && staticDir !== "") {
  const root = resolve(staticDir);
  const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".woff2": "font/woff2",
    ".ico": "image/x-icon",
  };

  app.get("*", (c) => {
    console.log("[debug] wildcard hit:", c.req.path, "root:", root);
    if (c.req.path.startsWith("/api")) {
      return c.json({ error: { code: "not_found", message: "未知 API 路径。" } }, 404);
    }
    const relative = c.req.path === "/" ? "/index.html" : c.req.path;
    const file = join(root, relative);
    console.log("[debug] file:", file, "exists:", existsSync(file));
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      // SPA fallback：未知路径回 index.html
      const index = join(root, "index.html");
      return c.body(readFileSync(index), 200, { "content-type": MIME[".html"] ?? "text/html" });
    }
    const type = MIME[extname(file)] ?? "application/octet-stream";
    return c.body(readFileSync(file), 200, { "content-type": type });
  });
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[another-tavern] server listening on http://localhost:${info.port}`);
  console.log(`[another-tavern] database: ${dbPath}`);
  if (staticDir !== undefined && staticDir !== "") {
    console.log(`[another-tavern] web ui: http://localhost:${info.port} (static: ${staticDir})`);
    if (process.env.OPEN_BROWSER === "1") {
      const url = `http://localhost:${info.port}`;
      const cmd =
        process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
      const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
      try {
        spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
      } catch {
        console.log("[another-tavern] auto-open browser failed; open the URL manually.");
      }
    }
  }
});
