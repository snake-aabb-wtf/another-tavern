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
// 静态托管：显式 STATIC_DIR 优先；否则探测分发布局（web-dist 存在即启用，双击/一条命令零配置）
const staticDir =
  process.env.STATIC_DIR ??
  (existsSync(resolve("web-dist", "index.html")) ? "web-dist" : undefined);

mkdirSync(dirname(dbPath), { recursive: true });
const db = openDatabase(dbPath, migrationsDir);
const app = createApp({ db });

/** SPA 静态文件处理（M7）：MIME 映射 + 目录穿越防护 + index.html 回落。 */
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

function staticResponse(pathname: string): Response | undefined {
  if (staticDir === undefined || staticDir === "") {
    return undefined;
  }
  const root = resolve(staticDir);
  const relative = pathname === "/" ? "/index.html" : pathname;
  const file = join(root, relative);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    const index = join(root, "index.html");
    if (!existsSync(index)) {
      return new Response("web dist missing", { status: 500 });
    }
    return new Response(readFileSync(index), {
      headers: { "content-type": MIME[".html"] ?? "text/html" },
    });
  }
  return new Response(readFileSync(file), {
    headers: { "content-type": MIME[extname(file)] ?? "application/octet-stream" },
  });
}

/** 分发模式：非 /api 请求由静态处理接管（server 层分流，不依赖 Hono 路由匹配）。 */
const fetchHandler = (req: Request): Response | Promise<Response> => {
  const url = new URL(req.url);
  if (staticDir !== undefined && staticDir !== "" && !url.pathname.startsWith("/api")) {
    const res = staticResponse(url.pathname);
    if (res !== undefined) {
      return res;
    }
  }
  return app.fetch(req);
};

serve({ fetch: fetchHandler, port }, (info) => {
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
