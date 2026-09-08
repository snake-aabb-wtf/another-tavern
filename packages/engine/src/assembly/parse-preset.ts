/**
 * ST OpenAI 预设（Chat Completion preset）JSON → AssemblyPlan 导入解析器（M4 任务 §3）。
 *
 * 输入形态（一手依据：ST release `PromptManager.js` 的默认 preset 结构）：
 * `{ prompts: [{identifier, name, role, content, system_prompt, marker, ...}],
 *    prompt_order: [{character_id, order: [{identifier, enabled}]}], ...sampler }`
 *
 * 映射规则：
 * - 已知 identifier ↔ 槽位（见 SLOT_BY_IDENTIFIER）；order 数组的次序 = 槽位 order（升序 ×10）
 * - order 中未出现的已知槽位 → enabled=false（ST 语义：列表外不发送）
 * - jailbreak → postHistory.enabled
 * - marker 条目（chatHistory 等占位）与未知 identifier 条目：内容原样保留（不丢弃）
 * - 已映射槽位的自定义 content（v1 不支持内容来源）保留进 extensions 并告警
 */

import { isRecord } from "../cards/pick.js";
import {
  defaultAssemblyPlan,
  normalizePlan,
  type AssemblyPlan,
  type SystemSlotId,
} from "./plan.js";

export class PresetParseError extends Error {
  readonly code: "preset_parse_failed" | "preset_not_object";

  constructor(code: "preset_parse_failed" | "preset_not_object", message: string) {
    super(`[${code}] ${message}`);
    this.name = "PresetParseError";
    this.code = code;
  }
}

export interface ParsedPreset {
  plan: AssemblyPlan;
  warnings: string[];
}

const SLOT_BY_IDENTIFIER: Readonly<Record<string, SystemSlotId>> = {
  main: "main",
  worldInfoBefore: "wiBefore",
  personaDescription: "persona",
  charDescription: "description",
  charPersonality: "personality",
  scenario: "scenario",
  worldInfoAfter: "wiAfter",
  dialogueExamples: "examples",
};

/** 解析 ST OpenAI 预设 JSON 为 AssemblyPlan。 */
export function parseOpenAiPreset(source: string | unknown, planId = "imported"): ParsedPreset {
  let value: unknown = source;
  if (typeof source === "string") {
    try {
      value = JSON.parse(source);
    } catch {
      throw new PresetParseError("preset_parse_failed", "Preset payload is not valid JSON.");
    }
  }
  if (!isRecord(value)) {
    throw new PresetParseError("preset_not_object", "Preset payload is not a JSON object.");
  }

  const warnings: string[] = [];
  const rawPrompts = Array.isArray(value.prompts) ? value.prompts.filter(isRecord) : [];
  const orderList = extractOrder(value);

  // —— 启停与顺序（以 prompt_order 为准；列表外 = 不发送）——
  const enabledById = new Map<string, boolean>();
  const orderById = new Map<string, number>();
  orderList.forEach((item, index) => {
    if (typeof item?.identifier !== "string") {
      return;
    }
    enabledById.set(item.identifier, item.enabled !== false);
    orderById.set(item.identifier, (index + 1) * 10);
  });

  // —— system 槽位 ——
  const slots: AssemblyPlan["systemSlots"] = [];
  for (const [identifier, slotId] of Object.entries(SLOT_BY_IDENTIFIER)) {
    const enabled = enabledById.get(identifier) ?? false;
    const order = orderById.get(identifier) ?? (Object.keys(SLOT_BY_IDENTIFIER).length + 1) * 10;
    slots.push({ id: slotId, enabled, order, source: "default", content: "" });
  }

  // —— PHI（jailbreak）——
  const postHistory = {
    enabled: enabledById.get("jailbreak") ?? false,
    position: "historyAfter" as const,
  };

  // —— 不可映射内容的保留（不丢弃）——
  const unmappedPrompts: unknown[] = [];
  const customPromptTexts: Record<string, string> = {};
  for (const prompt of rawPrompts) {
    const identifier = prompt.identifier;
    if (typeof identifier !== "string") {
      unmappedPrompts.push(prompt);
      continue;
    }
    if (identifier === "chatHistory") {
      continue; // 历史区固定（docs §5），marker 占位条目无保留价值
    }
    if (SLOT_BY_IDENTIFIER[identifier] !== undefined || identifier === "jailbreak") {
      // 已映射：自定义 content（v1 不支持内容来源）保留并告警
      if (
        prompt.marker !== true &&
        typeof prompt.content === "string" &&
        prompt.content.trim() !== ""
      ) {
        customPromptTexts[identifier] = prompt.content;
        warnings.push(`feature_unsupported:prompt_content:${identifier}`);
      }
      continue;
    }
    unmappedPrompts.push(prompt);
    if (enabledById.get(identifier) === true) {
      warnings.push(`feature_unsupported:prompt:${identifier}`);
    }
  }

  const extensions: Record<string, unknown> = {};
  if (Object.keys(customPromptTexts).length > 0) {
    extensions.customPromptTexts = customPromptTexts;
  }
  if (unmappedPrompts.length > 0) {
    extensions.unmappedPrompts = unmappedPrompts;
  }

  const draft: AssemblyPlan = {
    ...defaultAssemblyPlan(typeof value.name === "string" ? value.name : "导入的预设"),
    id: planId,
    systemSlots: slots,
    postHistory,
    extensions,
    unknownFields: collectUnknown(value, ["prompts", "prompt_order", "name"]),
  };

  const normalized = normalizePlan(draft);
  warnings.push(...normalized.warnings);
  return { plan: normalized.plan, warnings };
}

/** 取 prompt_order 第一个分组的顺序列表（ST 的全局 order；多角色分组 v1 不支持）。 */
function extractOrder(
  root: Record<string, unknown>,
): Array<{ identifier: unknown; enabled: unknown }> {
  const groups = root.prompt_order;
  if (!Array.isArray(groups) || groups.length === 0) {
    return [];
  }
  const first = groups[0];
  if (!isRecord(first) || !Array.isArray(first.order)) {
    return [];
  }
  return first.order.filter((item): item is { identifier: unknown; enabled: unknown } =>
    isRecord(item),
  );
}

function collectUnknown(
  root: Record<string, unknown>,
  known: readonly string[],
): Record<string, unknown> {
  const unknown: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(root)) {
    if (!known.includes(key)) {
      unknown[key] = value;
    }
  }
  return unknown;
}
