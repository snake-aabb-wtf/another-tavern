/** 全局正则脚本 CRUD 与测试接口。 */

import { applyServerRegex } from "../regex.js";
import { normalizeRegexScripts, type RegexPlacement } from "@another-tavern/engine";
import { Hono } from "hono";

import type { AppDeps } from "../app.js";

export function regexRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.get("/api/regex-scripts", (c) => {
    const value = deps.db.repo.getSettings();
    return c.json({ scripts: value.regexScripts });
  });

  app.put("/api/regex-scripts", async (c) => {
    const body = await c.req
      .json<{ scripts?: unknown }>()
      .catch(() => ({}) as Record<string, never>);
    if (!Array.isArray(body.scripts)) {
      return c.json({ error: { code: "invalid_request", message: "scripts 必须是数组。" } }, 400);
    }
    const normalized = normalizeRegexScripts(body.scripts, "global");
    const current = deps.db.repo.getSettings();
    deps.db.repo.putSettings({ ...current, regexScripts: normalized.scripts });
    return c.json({ scripts: normalized.scripts, warnings: normalized.warnings });
  });

  app.post("/api/regex-scripts/test", async (c) => {
    const body = await c.req
      .json<{ script?: unknown; text?: unknown; placement?: unknown }>()
      .catch(() => ({}) as Record<string, never>);
    const placement = body.placement;
    if (
      typeof body.text !== "string" ||
      (placement !== "userInput" &&
        placement !== "aiOutput" &&
        placement !== "prompt" &&
        placement !== "worldInfo" &&
        placement !== "markdown")
    ) {
      return c.json(
        { error: { code: "invalid_request", message: "text 和合法 placement 必填。" } },
        400,
      );
    }
    const normalized = normalizeRegexScripts([body.script], "test");
    if (normalized.scripts.length !== 1) {
      return c.json({ error: { code: "invalid_request", message: "script 格式无效。" } }, 400);
    }
    const result = applyServerRegex(body.text, normalized.scripts, placement as RegexPlacement);
    return c.json(result);
  });

  return app;
}
