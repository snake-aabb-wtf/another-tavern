/** 读取并执行当前会话可见的正则脚本。 */

import {
  applyRegexScripts,
  normalizeRegexScripts,
  type CharacterCard,
  type RegexApplyResult,
  type RegexPlacement,
  type RegexScript,
} from "@another-tavern/engine";

import type { AppDeps } from "./app.js";
import type { SessionRow } from "./db/client.js";

/** 取角色卡或组装计划扩展中的 regex_scripts。 */
function scriptsFromExtension(
  value: Record<string, unknown> | undefined,
  source: string,
): RegexScript[] {
  return normalizeRegexScripts(value?.regex_scripts, source).scripts;
}

/** 组合全局、角色卡、组装计划三层规则；顺序固定且可复现。 */
export function loadRegexScripts(
  deps: AppDeps,
  card: CharacterCard,
  plan: { extensions: Record<string, unknown> } | undefined,
): RegexScript[] {
  const settings = deps.db.repo.getSettings();
  const global = normalizeRegexScripts(settings.regexScripts, "global").scripts;
  const scoped = scriptsFromExtension(card.extensions, "character");
  const preset = scriptsFromExtension(plan?.extensions, "plan");
  return [...global, ...scoped, ...preset];
}

/** 将 AI 输出规则应用于展示副本，不改变数据库中的原始消息。 */
export function presentMessageContent(
  content: string,
  scripts: readonly RegexScript[],
): RegexApplyResult {
  return applyRegexScripts(content, scripts, "aiOutput");
}

/** 以指定作用位置执行脚本，供 API 预览和服务端组装调用。 */
export function applyServerRegex(
  text: string,
  scripts: readonly RegexScript[],
  placement: RegexPlacement,
): RegexApplyResult {
  return applyRegexScripts(text, scripts, placement);
}

/** 读取计划 JSON；坏计划按未提供处理，由原有组装流程继续兜底。 */
export function loadPlanExtension(
  deps: AppDeps,
  session: SessionRow,
): { extensions: Record<string, unknown> } | undefined {
  const settings = deps.db.repo.getSettings();
  const planId = session.planId ?? settings.defaultPlanId;
  if (planId === null) {
    return undefined;
  }
  const row = deps.db.repo.getPlan(planId);
  if (row === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(row.data);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const extensions = (parsed as { extensions?: unknown }).extensions;
      if (typeof extensions === "object" && extensions !== null && !Array.isArray(extensions)) {
        return { extensions: extensions as Record<string, unknown> };
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}
