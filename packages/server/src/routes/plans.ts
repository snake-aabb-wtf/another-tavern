/**
 * 组装计划 CRUD 与 ST 预设导入端点（M4 任务 §5）。
 */

import { randomUUID } from "node:crypto";

import { normalizePlan } from "@another-tavern/engine";
import { Hono } from "hono";

import type { AppDeps } from "../app.js";

export function plansRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post("/api/plans", async (c) => {
    const body = await c.req
      .json<{ name?: unknown; plan?: unknown }>()
      .catch(() => ({}) as Record<string, never>);
    if (typeof body.plan !== "object" || body.plan === null) {
      return c.json({ error: { code: "plan_required", message: "plan 必填。" } }, 400);
    }
    const { plan, warnings } = normalizePlan({
      ...(body.plan as Record<string, unknown>),
      name:
        typeof body.name === "string" ? body.name : ((body.plan as { name?: unknown }).name ?? ""),
    });
    const id = randomUUID();
    deps.db.repo.insertPlan(id, plan.name, JSON.stringify(plan));
    return c.json({ id, name: plan.name, plan, warnings }, 201);
  });

  // ST OpenAI 预设 JSON 文件导入
  app.post("/api/plans/import", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) {
      return c.json(
        { error: { code: "file_missing", message: 'multipart 字段 "file" 缺失。' } },
        400,
      );
    }
    if (file.size > 5 * 1024 * 1024) {
      return c.json(
        { error: { code: "file_too_large", message: "文件超过大小上限（5MB）。" } },
        413,
      );
    }
    const text = await file.text();
    try {
      const { parseOpenAiPreset } = await import("@another-tavern/engine");
      const parsed = parseOpenAiPreset(text);
      const id = randomUUID();
      const name =
        parsed.plan.name !== ""
          ? parsed.plan.name
          : file.name.replace(/\.[^.]+$/, "") || "导入的预设";
      const withName = { ...parsed.plan, name };
      deps.db.repo.insertPlan(id, name, JSON.stringify(withName));
      return c.json({ id, name, plan: withName, warnings: parsed.warnings }, 201);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "preset_parse_failed";
      return c.json(
        { error: { code, message: error instanceof Error ? error.message : String(error) } },
        400,
      );
    }
  });

  app.get("/api/plans", (c) => {
    return c.json(
      deps.db.repo
        .listPlans()
        .map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt })),
    );
  });

  app.get("/api/plans/:id", (c) => {
    const row = deps.db.repo.getPlan(c.req.param("id"));
    if (row === undefined) {
      return c.json({ error: { code: "not_found", message: "计划不存在。" } }, 404);
    }
    return c.json({
      id: row.id,
      name: row.name,
      plan: JSON.parse(row.data),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  });

  app.put("/api/plans/:id", async (c) => {
    const id = c.req.param("id");
    const existing = deps.db.repo.getPlan(id);
    if (existing === undefined) {
      return c.json({ error: { code: "not_found", message: "计划不存在。" } }, 404);
    }
    const body = await c.req
      .json<{ name?: unknown; plan?: unknown }>()
      .catch(() => ({}) as Record<string, never>);
    const source =
      typeof body.plan === "object" && body.plan !== null
        ? (body.plan as Record<string, unknown>)
        : (JSON.parse(existing.data) as Record<string, unknown>);
    const { plan } = normalizePlan({
      ...source,
      name: typeof body.name === "string" ? body.name : existing.name,
    });
    deps.db.repo.updatePlan(id, plan.name, JSON.stringify(plan));
    return c.json({ id, name: plan.name, plan });
  });

  app.delete("/api/plans/:id", (c) => {
    // 引用该计划的会话 plan_id 会被置空（ON DELETE SET NULL），回落默认计划
    if (!deps.db.repo.deletePlan(c.req.param("id"))) {
      return c.json({ error: { code: "not_found", message: "计划不存在。" } }, 404);
    }
    return c.body(null, 204);
  });

  return app;
}
