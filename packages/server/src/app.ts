import { Hono } from "hono";

/**
 * 创建 Hono 应用实例。
 *
 * M0 仅包含健康检查端点；完整路由、SSE 流式与 SQLite 存储在后续里程碑实现。
 */
export function createApp(): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));

  return app;
}
