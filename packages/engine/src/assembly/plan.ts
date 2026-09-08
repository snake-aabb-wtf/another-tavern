/**
 * 组装计划（AssemblyPlan，M4 草案经人类批准）。
 *
 * v1 范围：system 区槽位的「顺序 + 启停」与 PHI 启停；槽位内容来源固定
 * （docs/prompt-assembly.md §3），深度注入不进计划（AN 是输入参数、
 * WI 条目自带 depth，见 world-info-spec §2）。
 * 缺省计划与 docs §2.1 的固定段序逐位等价——不带 plan 的组装行为不变。
 */

/** system 区槽位 id。 */
export type SystemSlotId =
  | "main"
  | "wiBefore"
  | "persona"
  | "description"
  | "personality"
  | "scenario"
  | "wiAfter"
  | "examples";

export const SYSTEM_SLOT_IDS: readonly SystemSlotId[] = [
  "main",
  "wiBefore",
  "persona",
  "description",
  "personality",
  "scenario",
  "wiAfter",
  "examples",
];

/** 单个 system 槽位的编排。 */
export interface SystemPlanSlot {
  id: SystemSlotId;
  /** false = 整段跳过（等价该段为空）。 */
  enabled: boolean;
  /** 相对顺序，升序 = 靠 prompt 上方；同值按槽位数组序稳定排序。 */
  order: number;
}

/** PHI（post_history_instructions）编排除编号。 */
export interface PostHistoryPlan {
  enabled: boolean;
  /** v1 仅支持 historyAfter（docs/prompt-assembly.md §3.5 的既定形态）。 */
  position: "historyAfter";
}

/** 可序列化的组装计划。 */
export interface AssemblyPlan {
  id: string;
  name: string;
  /** system 区编排；缺省槽位按默认序补齐并启用。 */
  systemSlots: SystemPlanSlot[];
  postHistory: PostHistoryPlan;
  /** 未实现特性/透传数据（如 ST 预设 sampler）原样保留，不注入。 */
  extensions: Record<string, unknown>;
  /** 来源 JSON 中不属于本模型的顶层字段原样保留（cards-spec §7 同款原则）。 */
  unknownFields: Record<string, unknown>;
}

/** 缺省槽位编排：与 docs/prompt-assembly.md §2.1 固定段序逐位等价。 */
export const DEFAULT_SYSTEM_SLOTS: readonly SystemPlanSlot[] = [
  { id: "main", enabled: true, order: 10 },
  { id: "wiBefore", enabled: true, order: 20 },
  { id: "persona", enabled: true, order: 30 },
  { id: "description", enabled: true, order: 40 },
  { id: "personality", enabled: true, order: 50 },
  { id: "scenario", enabled: true, order: 60 },
  { id: "wiAfter", enabled: true, order: 70 },
  { id: "examples", enabled: true, order: 80 },
];

export const DEFAULT_PLAN_ID = "default";

/** 构造缺省计划（每次返回新对象，调用方可安全修改）。 */
export function defaultAssemblyPlan(name = "默认计划"): AssemblyPlan {
  return {
    id: DEFAULT_PLAN_ID,
    name,
    systemSlots: DEFAULT_SYSTEM_SLOTS.map((slot) => ({ ...slot })),
    postHistory: { enabled: true, position: "historyAfter" },
    extensions: {},
    unknownFields: {},
  };
}

export interface NormalizedPlan {
  plan: AssemblyPlan;
  warnings: string[];
}

/**
 * 宽容规范化任意输入为 AssemblyPlan（面向存储回读与导入）：
 * 未知槽 id 告警并忽略；缺失槽位按默认序补齐并启用；非法类型回退默认。
 */
export function normalizePlan(input: unknown): NormalizedPlan {
  const warnings: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { plan: defaultAssemblyPlan(), warnings: ["plan_invalid:root"] };
  }
  const raw = input as Record<string, unknown>;

  const slotWarnings = normalizeSlots(raw.systemSlots);
  const postHistory = normalizePostHistory(raw.postHistory, warnings);

  const plan: AssemblyPlan = {
    id: typeof raw.id === "string" && raw.id !== "" ? raw.id : DEFAULT_PLAN_ID,
    name: typeof raw.name === "string" ? raw.name : "",
    systemSlots: slotWarnings.slots,
    postHistory,
    extensions: asRecord(raw.extensions),
    // 来源可能已把未知键收进 unknownFields（导入器），也可能散在顶层（手工 JSON）——两层合并
    unknownFields: {
      ...asRecord(raw.unknownFields),
      ...collectUnknown(raw, [
        "id",
        "name",
        "systemSlots",
        "postHistory",
        "extensions",
        "unknownFields",
      ]),
    },
  };
  warnings.push(...slotWarnings.warnings);
  return { plan, warnings };
}

function normalizeSlots(value: unknown): { slots: SystemPlanSlot[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!Array.isArray(value)) {
    return { slots: DEFAULT_SYSTEM_SLOTS.map((slot) => ({ ...slot })), warnings: [] };
  }
  const slots: SystemPlanSlot[] = [];
  const seen = new Set<SystemSlotId>();
  let fallbackOrder = 10;
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      warnings.push("plan_invalid:slot");
      continue;
    }
    const slot = item as Record<string, unknown>;
    const id = slot.id;
    if (typeof id !== "string" || !SYSTEM_SLOT_IDS.includes(id as SystemSlotId)) {
      warnings.push(`plan_unknown_slot:${String(id)}`);
      continue;
    }
    if (seen.has(id as SystemSlotId)) {
      warnings.push(`plan_duplicate_slot:${id}`);
      continue;
    }
    seen.add(id as SystemSlotId);
    const order =
      typeof slot.order === "number" && Number.isFinite(slot.order) ? slot.order : fallbackOrder;
    slots.push({
      id: id as SystemSlotId,
      enabled: typeof slot.enabled === "boolean" ? slot.enabled : true,
      order,
    });
    fallbackOrder += 10;
  }
  // 缺失槽位按默认序补齐并启用（宽容原则）
  for (const fallback of DEFAULT_SYSTEM_SLOTS) {
    if (!seen.has(fallback.id)) {
      slots.push({ ...fallback });
    }
  }
  return { slots, warnings };
}

function normalizePostHistory(value: unknown, warnings: string[]): PostHistoryPlan {
  if (typeof value !== "object" || value === null) {
    return { enabled: true, position: "historyAfter" };
  }
  const raw = value as Record<string, unknown>;
  if (raw.position !== undefined && raw.position !== "historyAfter") {
    warnings.push(`plan_unknown_post_history_position:${String(raw.position)}`);
  }
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    position: "historyAfter",
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function collectUnknown(
  raw: Record<string, unknown>,
  known: readonly string[],
): Record<string, unknown> {
  const unknown: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!known.includes(key)) {
      unknown[key] = value;
    }
  }
  return unknown;
}
