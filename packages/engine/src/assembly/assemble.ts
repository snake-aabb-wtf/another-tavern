/**
 * Prompt 组装器（docs/prompt-assembly.md）。
 *
 * 纯函数、确定性：零 IO、零时钟、零随机。执行顺序严格遵循 §6.2：
 * 0 宏替换 → 1 世界书 → 2 system 区 → 3 历史骨架 → 4 裁剪 → 5 深度注入与 PHI 落位。
 */

import type { CharacterCard } from "../cards/model.js";
import type { WorldInfoBook } from "../worldinfo/model.js";
import { resolveWorldInfo, type ResolveWorldInfoSettings } from "../worldinfo/resolve.js";
import type { Tokenizer } from "../tokenizer/tokenizer.js";
import { substituteMacros, substituteOriginal } from "./macros.js";

/** 内置默认 main prompt（对齐 ST 源码 default_main_prompt 原文）。 */
export const DEFAULT_MAIN_PROMPT =
  "Write {{char}}'s next reply in a fictional chat between {{charIfNotGroup}} and {{user}}.";

/** system 区段 id（§2.1）。 */
export type SystemSectionId =
  | "main"
  | "wiBefore"
  | "persona"
  | "description"
  | "personality"
  | "scenario"
  | "wiAfter"
  | "examples";

export interface Persona {
  name: string;
  description: string;
}

export interface ChatMessage {
  /** server 层存储的消息 id，裁剪统计与 UI 引用用。 */
  id: string;
  role: "user" | "assistant";
  /** 显示名（includeNames 扫描前缀用；不进最终 content）。 */
  name: string;
  content: string;
}

export interface AssemblyInput {
  card: CharacterCard;
  persona: Persona;
  /** 正序历史（不含 greeting）。 */
  history: readonly ChatMessage[];
  /** 选定的开场消息（first_mes 或某 alternate_greeting）；null=无开场。 */
  greeting: string | null;
  globalPrompts: {
    /** 空串 → 内置默认（§3.1）。 */
    main: string;
    postHistory: string;
  };
  /** 作者注；null=关闭。depth 语义见 §5.2（0=历史最末）。 */
  authorNote: { text: string; depth: number } | null;
  worldInfo: {
    books: readonly WorldInfoBook[];
    settings: Omit<ResolveWorldInfoSettings, "contextSize">;
  };
  budget: {
    /** 必填，无规范级默认（§6.1.1）。 */
    contextSize: number;
    /** 为回复预留（§6.1.2）。 */
    reserveCompletion: number;
  };
  tokenizer: Tokenizer;
}

export interface AssemblyMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AssemblyStats {
  tokensTotal: number;
  /** 段 id → token；含深度注入伪段 "an"、"wiAtDepth:<d>:<role>"、"phi"、"chat"。 */
  tokensBySection: Record<string, number>;
  worldInfo: Array<{
    bookId: string;
    used: number;
    limit: number;
    droppedEntries: string[];
  }>;
  pruned: {
    exampleBlocksDropped: number;
    /** 被丢弃历史消息的 id（按丢弃顺序）。 */
    messagesDropped: string[];
  };
}

export interface AssemblyResult {
  messages: readonly AssemblyMessage[];
  stats: AssemblyStats;
  /** §4.3 标注义务。 */
  tokenizer: { id: string; estimated: boolean };
  warnings: readonly string[];
}

export type AssemblyErrorCode = "budget_exceeded";

export class AssemblyError extends Error {
  readonly code: AssemblyErrorCode;
  /** 各段 token 明细（§6.3 轮 3：错误信息列出明细）。 */
  readonly sections: Readonly<Record<string, number>>;

  constructor(code: AssemblyErrorCode, message: string, sections: Record<string, number>) {
    super(`[${code}] ${message}`);
    this.name = "AssemblyError";
    this.code = code;
    this.sections = sections;
  }
}

const SECTION_ORDER: readonly SystemSectionId[] = [
  "main",
  "wiBefore",
  "persona",
  "description",
  "personality",
  "scenario",
  "wiAfter",
  "examples",
];

interface DepthSlot {
  an: AssemblyMessage | null;
  wi: Map<"system" | "user" | "assistant", string[]>;
}

/** 组装器唯一对外入口（纯函数；§6.3 轮 3 以 AssemblyError 抛出）。 */
export function assemblePrompt(input: AssemblyInput): AssemblyResult {
  const { card, persona, tokenizer } = input;
  const warnings: string[] = [];
  const count = (text: string): number => tokenizer.count(text);

  // —— 步骤 0：宏替换（§7，单次、不递归求值）——
  const macroCtx = { charName: card.name, userName: persona.name };
  const M = (text: string): string => substituteMacros(text, macroCtx);

  // main：卡 system_prompt 覆盖全局，全局空则内置默认；{{original}} 支持（§3.1）
  const globalMain =
    input.globalPrompts.main.trim() !== "" ? input.globalPrompts.main : DEFAULT_MAIN_PROMPT;
  const mainText =
    card.systemPrompt.trim() !== ""
      ? M(substituteOriginal(card.systemPrompt, globalMain))
      : M(globalMain);

  // PHI：卡值覆盖全局（§3.5）；皆空 → 不注入
  const globalPhi = input.globalPrompts.postHistory;
  const phiText =
    card.postHistoryInstructions.trim() !== ""
      ? M(substituteOriginal(card.postHistoryInstructions, globalPhi))
      : M(globalPhi);

  const sectionSources: Record<
    Exclude<SystemSectionId, "wiBefore" | "wiAfter" | "examples">,
    string
  > = {
    main: mainText,
    persona: M(persona.description),
    description: M(card.description),
    personality: M(card.personality),
    scenario: M(card.scenario),
  };

  const exampleBlocks = M(card.mesExample)
    .split("<START>")
    .map((block) => block.trim())
    .filter((block) => block !== "");

  // 世界书 entry.content 的替换副本（world-info-spec §7.3：原文保留在卡模型中）
  const replacedBooks: WorldInfoBook[] = input.worldInfo.books.map((book) => ({
    ...book,
    entries: book.entries.map((entry) => ({ ...entry, content: M(entry.content) })),
  }));

  // —— 步骤 1：世界书（基于完整历史，先于裁剪，§6.2）——
  const hasGreeting = input.greeting !== null && input.greeting.trim() !== "";
  if (!hasGreeting) {
    warnings.push("no_greeting");
  }
  const scanHistory = [
    ...(hasGreeting
      ? [{ role: "assistant" as const, name: card.name, content: M(input.greeting ?? "") }]
      : []),
    ...input.history.map((m) => ({ role: m.role, name: m.name, content: M(m.content) })),
  ];
  const wiResult = resolveWorldInfo({
    books: replacedBooks,
    chatHistory: scanHistory,
    authorNote:
      input.authorNote !== null && input.authorNote.text.trim() !== ""
        ? M(input.authorNote.text)
        : null,
    settings: {
      ...input.worldInfo.settings,
      contextSize: input.budget.contextSize,
    },
    countTokens: count,
  });
  warnings.push(...wiResult.warnings);

  const wiTexts: Pick<Record<SystemSectionId, string>, "wiBefore" | "wiAfter"> = {
    wiBefore: wiResult.byPosition.beforeChar.map((i) => i.content).join("\n"),
    wiAfter: wiResult.byPosition.afterChar.map((i) => i.content).join("\n"),
  };

  // —— 深度注入槽（§5.2；world-info-spec §7.2：同 (depth,role) 合并责任在组装器）——
  const slots = new Map<number, DepthSlot>();
  const slotAt = (depth: number): DepthSlot => {
    let slot = slots.get(depth);
    if (slot === undefined) {
      slot = { an: null, wi: new Map() };
      slots.set(depth, slot);
    }
    return slot;
  };
  if (input.authorNote !== null && input.authorNote.text.trim() !== "") {
    slotAt(input.authorNote.depth).an = { role: "system", content: M(input.authorNote.text) };
  }
  for (const injection of wiResult.byPosition.atDepth) {
    // byPosition 已按 insertionOrder 升序（world-info-spec §6.1/§7.1）
    const depth = injection.depth ?? 4;
    const role = injection.role ?? "system";
    const bucket = slotAt(depth);
    const list = bucket.wi.get(role) ?? [];
    list.push(injection.content);
    bucket.wi.set(role, list);
  }

  // —— 步骤 3：历史骨架（greeting 保护 + 最新消息保护）——
  interface ChatEntry {
    id: string;
    message: AssemblyMessage;
    tokens: number;
  }
  const chat: ChatEntry[] = [];
  if (hasGreeting) {
    const content = M(input.greeting ?? "");
    chat.push({ id: "greeting", message: { role: "assistant", content }, tokens: count(content) });
  }
  for (const m of input.history) {
    const content = M(m.content);
    chat.push({ id: m.id, message: { role: m.role, content }, tokens: count(content) });
  }

  // —— 步骤 4：裁剪循环（§6.3：examples 块 → 最旧历史 → 硬错误）——
  const usable = Math.max(0, input.budget.contextSize - input.budget.reserveCompletion);
  const fixedSectionTokens: Record<string, number> = {};
  for (const id of SECTION_ORDER) {
    if (id === "examples") {
      continue;
    }
    const text = id === "wiBefore" || id === "wiAfter" ? wiTexts[id] : sectionSources[id];
    fixedSectionTokens[id] = text.trim() !== "" ? count(text) : 0;
  }
  const depthToken = (text: string): number => (text.trim() !== "" ? count(text) : 0);
  const phiTokens = depthToken(phiText);
  let anTokens = 0;
  let wiAtDepthTokens = 0;
  for (const slot of slots.values()) {
    if (slot.an !== null) {
      anTokens += count(slot.an.content);
    }
    for (const parts of slot.wi.values()) {
      wiAtDepthTokens += count(parts.join("\n"));
    }
  }
  const fixedOther = anTokens + wiAtDepthTokens + phiTokens;

  const examplesTextAt = (from: number): string =>
    from >= exampleBlocks.length
      ? ""
      : exampleBlocks
          .slice(from)
          .map((b) => `<START>\n${b}`)
          .join("\n");

  const dropped = new Set<string>();
  // 丢弃候选：最旧优先；保护 greeting（若有）与最后一条消息
  const dropCandidates = chat.slice(hasGreeting ? 1 : 0, Math.max(0, chat.length - 1));

  const totalWith = (examplesFrom: number): number => {
    const examplesTokens = depthToken(examplesTextAt(examplesFrom));
    const chatTokens = chat.reduce((sum, e) => sum + (dropped.has(e.id) ? 0 : e.tokens), 0);
    const fixedSum = Object.values(fixedSectionTokens).reduce((a, b) => a + b, 0);
    return fixedSum + examplesTokens + chatTokens + fixedOther;
  };

  let examplesFrom = 0;
  let exampleBlocksDropped = 0;
  let total = totalWith(0);

  while (total > usable && exampleBlocks.length - examplesFrom > 0) {
    examplesFrom += 1;
    exampleBlocksDropped += 1;
    total = totalWith(examplesFrom);
  }
  const messagesDropped: string[] = [];
  for (const candidate of dropCandidates) {
    if (total <= usable) {
      break;
    }
    dropped.add(candidate.id);
    total -= candidate.tokens;
    messagesDropped.push(candidate.id);
  }

  if (total > usable) {
    const detail: Record<string, number> = { ...fixedSectionTokens };
    detail.examples = depthToken(examplesTextAt(examplesFrom));
    detail.chat = chat.reduce((sum, e) => sum + (dropped.has(e.id) ? 0 : e.tokens), 0);
    if (anTokens > 0) {
      detail.an = anTokens;
    }
    if (phiTokens > 0) {
      detail.phi = phiTokens;
    }
    throw new AssemblyError(
      "budget_exceeded",
      `Fixed content exceeds budget (needed ${total}, usable ${usable}).`,
      detail,
    );
  }

  // —— 步骤 5：messages 装配 ——
  const systemSections: string[] = [];
  const tokensBySection: Record<string, number> = {};
  for (const id of SECTION_ORDER) {
    const text =
      id === "examples"
        ? examplesTextAt(examplesFrom)
        : id === "wiBefore" || id === "wiAfter"
          ? wiTexts[id]
          : sectionSources[id];
    if (text.trim() !== "") {
      systemSections.push(text);
      tokensBySection[id] = count(text);
    }
  }
  const messages: AssemblyMessage[] = [];
  if (systemSections.length > 0) {
    messages.push({ role: "system", content: systemSections.join("\n\n") });
  }

  const chatOnly = chat.filter((e) => !dropped.has(e.id)).map((e) => e.message);
  const baseLen = chatOnly.length; // 槽位相对原始 kept 序列定位，插入偏移单独累计
  let chatTokens = 0;
  for (const e of chat) {
    if (!dropped.has(e.id)) {
      chatTokens += e.tokens;
    }
  }
  if (chatOnly.length > 0) {
    tokensBySection.chat = chatTokens;
  }

  let inserted = 0;
  for (const depth of [...slots.keys()].sort((a, b) => b - a)) {
    const slot = slots.get(depth);
    if (slot === undefined) {
      continue;
    }
    const slotMessages: AssemblyMessage[] = [];
    if (slot.an !== null) {
      slotMessages.push(slot.an);
      tokensBySection.an = (tokensBySection.an ?? 0) + count(slot.an.content);
    }
    for (const role of ["system", "user", "assistant"] as const) {
      const parts = slot.wi.get(role);
      if (parts !== undefined && parts.length > 0) {
        const joined = parts.join("\n");
        slotMessages.push({ role, content: joined });
        const key = `wiAtDepth:${depth}:${role}`;
        tokensBySection[key] = (tokensBySection[key] ?? 0) + count(joined);
      }
    }
    if (slotMessages.length === 0) {
      continue;
    }
    const position = Math.max(0, Math.min(baseLen + inserted, baseLen - depth + inserted));
    chatOnly.splice(position, 0, ...slotMessages);
    inserted += slotMessages.length;
  }
  messages.push(...chatOnly);

  if (phiText.trim() !== "") {
    messages.push({ role: "system", content: phiText });
    tokensBySection.phi = count(phiText);
  }

  // —— 统计与标注义务 ——
  const tokensTotal = Object.values(tokensBySection).reduce((a, b) => a + b, 0);
  if (tokenizer.estimated) {
    warnings.push(`tokenizer_estimated:${tokenizer.id}`);
  }

  const worldInfoStats = input.worldInfo.books.map((book, i) => ({
    bookId: book.id,
    used: wiResult.budget[i]?.used ?? 0,
    limit: wiResult.budget[i]?.limit ?? 0,
    droppedEntries: [...(wiResult.budget[i]?.droppedEntries ?? [])],
  }));

  return {
    messages,
    stats: {
      tokensTotal,
      tokensBySection,
      worldInfo: worldInfoStats,
      pruned: { exampleBlocksDropped, messagesDropped },
    },
    tokenizer: { id: tokenizer.id, estimated: tokenizer.estimated },
    warnings,
  };
}
