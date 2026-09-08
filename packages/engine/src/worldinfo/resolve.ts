/**
 * 世界书引擎（docs/world-info-spec.md §3–§7）。
 * 纯函数、确定性；计数经 TokenCounter 回调注入，不做宏替换。
 */

import type { InjectionRole, WorldInfoBook, WorldInfoEntry, WorldInfoPosition } from "./model.js";

/** 消息形态。content 必须已完成宏替换（world-info-spec §7.3）。 */
export interface WorldInfoScanMessage {
  role: "user" | "assistant" | "system";
  /** 说话人显示名（includeNames 前缀用）。 */
  name: string;
  content: string;
}

/** 极简 token 计数回调；正式定义见 docs/prompt-assembly.md §4。 */
export type TokenCounter = (text: string) => number;

export interface ResolveWorldInfoSettings {
  scanDepth: number;
  includeNames: boolean;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  recursiveScanning: boolean;
  maxRecursionSteps: number;
  contextSize: number;
  wiBudgetPercent: number;
}

export interface ResolveWorldInfoInput {
  books: readonly WorldInfoBook[];
  chatHistory: readonly WorldInfoScanMessage[];
  authorNote: string | null;
  settings: ResolveWorldInfoSettings;
  countTokens: TokenCounter;
}

/** 一条已入选注入（组内已按 world-info-spec §6.1 排序）。 */
export interface WorldInfoInjection {
  entryId: string;
  bookId: string;
  position: "beforeChar" | "afterChar" | "atDepth";
  depth: number | null;
  role: InjectionRole | null;
  content: string;
  tokenCount: number;
  activation: "constant" | "keyword" | "recursive";
  insertionOrder: number;
}

export interface ResolveWorldInfoBudget {
  limit: number;
  used: number;
  droppedEntries: readonly string[];
}

export interface ResolveWorldInfoResult {
  byPosition: {
    readonly beforeChar: readonly WorldInfoInjection[];
    readonly afterChar: readonly WorldInfoInjection[];
    readonly atDepth: readonly WorldInfoInjection[];
  };
  budget: ResolveWorldInfoBudget[];
  warnings: readonly string[];
}

type ActivationKind = "constant" | "keyword" | "recursive";

interface Activated {
  entry: WorldInfoEntry;
  activation: ActivationKind;
}

/** 激活来源的预算优先级层（world-info-spec §6.2）。 */
function tierOf(activation: ActivationKind): number {
  if (activation === "constant") {
    return 0;
  }
  return activation === "keyword" ? 1 : 2;
}

/** canonical ST 源码风格：order 降序 + 同层 id 升序，用于预算分配顺序。 */
function budgetOrder(a: Activated, b: Activated): number {
  const tier = tierOf(a.activation) - tierOf(b.activation);
  if (tier !== 0) {
    return tier;
  }
  const order = b.entry.insertionOrder - a.entry.insertionOrder;
  if (order !== 0) {
    return order;
  }
  return a.entry.id < b.entry.id ? -1 : 1;
}

/** 注入输出的插入排序：insertionOrder 升序，同序 id 升序（§6.1）。 */
function insertOrder(a: WorldInfoInjection, b: WorldInfoInjection): number {
  const order = a.insertionOrder - b.insertionOrder;
  if (order !== 0) {
    return order;
  }
  return a.entryId < b.entryId ? -1 : 1;
}

const SUPPORTED_POSITIONS: readonly WorldInfoPosition[] = ["beforeChar", "afterChar", "atDepth"];
const UNSUPPORTED_POSITIONS: readonly WorldInfoPosition[] = [
  "anTop",
  "anBottom",
  "beforeExample",
  "afterExample",
  "outlet",
];

/** §9 不实现特性 → extensions 键探测表。 */
const UNSUPPORTED_FEATURE_KEYS: readonly (readonly [string, readonly string[]])[] = [
  ["probability", ["probability", "useProbability"]],
  ["inclusion_group", ["group", "group_weight", "group_override"]],
  ["group_scoring", ["use_group_scoring"]],
  ["timed_effects", ["sticky", "cooldown", "delay"]],
  ["vector_storage", ["vectorized"]],
  ["delay_until_recursion", ["delay_until_recursion"]],
  [
    "additional_matching_sources",
    [
      "match_persona_description",
      "match_character_description",
      "match_character_personality",
      "match_character_depth_prompt",
      "match_scenario",
      "match_creator_notes",
    ],
  ],
  ["automation_id", ["automation_id"]],
  ["character_filter", ["character_filter"]],
  ["triggers", ["triggers"]],
];

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** 世界书引擎唯一对外入口（纯函数）。 */
export function resolveWorldInfo(input: ResolveWorldInfoInput): ResolveWorldInfoResult {
  const warnings: string[] = [];
  const budgets: ResolveWorldInfoBudget[] = [];
  const injections: WorldInfoInjection[] = [];

  for (const book of input.books) {
    const outcome = resolveBook(book, input, warnings);
    budgets.push(outcome.budget);
    injections.push(...outcome.injections);
  }

  const byPosition = {
    beforeChar: injections.filter((i) => i.position === "beforeChar").sort(insertOrder),
    afterChar: injections.filter((i) => i.position === "afterChar").sort(insertOrder),
    atDepth: injections.filter((i) => i.position === "atDepth").sort(insertOrder),
  };

  return { byPosition, budget: budgets, warnings };
}

function resolveBook(
  book: WorldInfoBook,
  input: ResolveWorldInfoInput,
  warnings: string[],
): { budget: ResolveWorldInfoBudget; injections: WorldInfoInjection[] } {
  const { settings, chatHistory, authorNote } = input;

  // 扫描文本池（§3）：includeNames 前缀
  const chatPool = chatHistory.map((m) =>
    settings.includeNames ? `${m.name}: ${m.content}` : m.content,
  );

  const activated = new Map<string, Activated>();

  // —— 初始 sweep（§3.1 + §4）——
  for (const entry of book.entries) {
    if (!entry.enabled) {
      continue;
    }
    warnUnsupportedExtensions(entry, warnings);

    if (entry.constant) {
      activated.set(entry.id, { entry, activation: "constant" });
      continue;
    }
    if (entry.keys.length === 0) {
      continue;
    }
    const depth = entry.scanDepth ?? book.scanDepth ?? settings.scanDepth;
    const window = depth > 0 ? chatPool.slice(-depth) : [];
    if (authorNote !== null && authorNote !== "") {
      window.push(authorNote); // §3.2 作者注始终参与
    }
    warnRegexKeys(entry, warnings);
    if (matches(entry, window, settings)) {
      activated.set(entry.id, { entry, activation: "keyword" });
    }
  }

  // —— 递归 sweep（§5）——
  const recursiveOn = book.recursiveScanning ?? settings.recursiveScanning;
  if (recursiveOn) {
    let stepsUsed = 1;
    let frontier = collectFrontier(activated);
    while (
      frontier.length > 0 &&
      (settings.maxRecursionSteps === 0 || stepsUsed < settings.maxRecursionSteps)
    ) {
      stepsUsed += 1;
      const newly: WorldInfoEntry[] = [];
      for (const entry of book.entries) {
        if (!entry.enabled || entry.excludeRecursion || entry.constant || entry.keys.length === 0) {
          continue;
        }
        if (activated.has(entry.id)) {
          continue;
        }
        if (matches(entry, frontier, settings)) {
          activated.set(entry.id, { entry, activation: "recursive" });
          newly.push(entry);
        }
      }
      frontier = newly.filter((e) => !e.preventRecursion && e.content !== "").map((e) => e.content);
    }
  }

  // —— 预算竞争（§6.2 / §6.3）——
  const limit =
    book.tokenBudget ?? Math.floor(settings.contextSize * (settings.wiBudgetPercent / 100));
  let used = 0;
  const droppedEntries: string[] = [];
  const injections: WorldInfoInjection[] = [];

  const contenders = [...activated.values()].sort(budgetOrder);
  for (const act of contenders) {
    const tokens = input.countTokens(act.entry.content);
    if (used + tokens > limit) {
      droppedEntries.push(act.entry.id);
      continue;
    }
    used += tokens;

    const entry = act.entry;
    if (UNSUPPORTED_POSITIONS.includes(entry.position)) {
      warnings.push(`feature_unsupported:position:${entry.id}`);
      droppedEntries.push(entry.id);
      continue;
    }
    if (!SUPPORTED_POSITIONS.includes(entry.position)) {
      // 理论不可达（枚举穷尽），防御性丢弃
      droppedEntries.push(entry.id);
      continue;
    }
    if (entry.content === "") {
      warnings.push(`empty_content_skipped:${entry.id}`);
      continue;
    }
    injections.push({
      entryId: entry.id,
      bookId: book.id,
      position: entry.position as "beforeChar" | "afterChar" | "atDepth",
      depth: entry.position === "atDepth" ? (entry.depth ?? 4) : null,
      role: entry.position === "atDepth" ? (entry.role ?? "system") : null,
      content: entry.content,
      tokenCount: tokens,
      activation: act.activation,
      insertionOrder: entry.insertionOrder,
    });
  }

  return { budget: { limit, used, droppedEntries }, injections };
}

/** 本轮激活条目中可触发下一轮递归的 content 集合。 */
function collectFrontier(activated: Map<string, Activated>): string[] {
  return [...activated.values()]
    .filter((a) => !a.entry.preventRecursion && a.entry.content !== "")
    .map((a) => a.entry.content);
}

function matches(
  entry: WorldInfoEntry,
  pool: readonly string[],
  settings: ResolveWorldInfoSettings,
): boolean {
  const caseSensitive = entry.caseSensitive ?? settings.caseSensitive;
  const wholeWords = entry.matchWholeWords ?? settings.matchWholeWords;

  const primary = entry.keys.some((key) =>
    pool.some((text) => keyHits(text, key, caseSensitive, wholeWords)),
  );
  if (!primary) {
    return false;
  }
  if (!entry.selective || entry.secondaryKeys.length === 0) {
    return true;
  }
  const hits = entry.secondaryKeys.filter((key) =>
    pool.some((text) => keyHits(text, key, caseSensitive, wholeWords)),
  ).length;
  const total = entry.secondaryKeys.length;
  switch (entry.logic) {
    case "andAny":
      return hits >= 1;
    case "andAll":
      return hits === total;
    case "notAny":
      return hits === 0;
    case "notAll":
      return hits !== total;
  }
}

function keyHits(text: string, key: string, caseSensitive: boolean, wholeWords: boolean): boolean {
  if (key === "") {
    return false; // 空 key 永不命中（防止 indexOf('') 误判）
  }
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? key : key.toLowerCase();
  const singleWord = wholeWords && !/\s/.test(key);
  if (!singleWord) {
    return hay.includes(needle);
  }
  let index = hay.indexOf(needle);
  while (index !== -1) {
    const before = index === 0 ? "" : hay[index - 1];
    const afterIndex = index + needle.length;
    const after = afterIndex >= hay.length ? "" : hay[afterIndex];
    if (
      !(before !== undefined && WORD_CHAR.test(before)) &&
      !(after !== undefined && WORD_CHAR.test(after))
    ) {
      return true;
    }
    index = hay.indexOf(needle, index + 1);
  }
  return false;
}

/** 形如 /.../flags 的 key：v1 按字面处理并告警（§3.5）。 */
function warnRegexKeys(entry: WorldInfoEntry, warnings: string[]): void {
  for (const key of entry.keys) {
    if (/^\/(.+)\/[a-z]*$/i.test(key)) {
      warnings.push(`regex_key_not_supported:${entry.id}`);
      return; // 每条只告警一次
    }
  }
}

function warnUnsupportedExtensions(entry: WorldInfoEntry, warnings: string[]): void {
  for (const [feature, keys] of UNSUPPORTED_FEATURE_KEYS) {
    if (keys.some((k) => entry.extensions[k] !== undefined)) {
      warnings.push(`feature_unsupported:${feature}:${entry.id}`);
    }
  }
}
