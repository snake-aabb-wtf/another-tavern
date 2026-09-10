/**
 * Another Tavern —— 无头引擎（headless engine）公共 API。
 *
 * 职责：角色卡解析（V2/V1）、世界书引擎、Prompt 组装器、tokenizer 接口。
 * 约束：零 UI 依赖、不发网络请求、不碰文件系统与数据库（PNG 解析接受内存字节）。
 * 规范依据：docs/cards-spec.md、docs/world-info-spec.md、docs/prompt-assembly.md。
 *
 * 本文件是唯一公共出口；内部模块（pick/schema/macros 等）不得外泄。
 */

export const ENGINE_VERSION = "0.2.0";

// —— 角色卡解析（cards-spec）——
export { parseCharacterCardJson } from "./cards/json.js";
export { parseCharacterCardPng } from "./cards/png.js";
export { CardParseError, type CardParseErrorCode } from "./cards/model.js";
export type { CardWarning, CharacterCard, ParseCardResult } from "./cards/model.js";

// —— 世界书引擎（world-info-spec）——
export { resolveWorldInfo } from "./worldinfo/resolve.js";
export type {
  ResolveWorldInfoBudget,
  ResolveWorldInfoInput,
  ResolveWorldInfoResult,
  ResolveWorldInfoSettings,
  TokenCounter,
  WorldInfoInjection,
  WorldInfoScanMessage,
} from "./worldinfo/resolve.js";
export type {
  InjectionRole,
  SelectiveLogic,
  WorldInfoBook,
  WorldInfoEntry,
  WorldInfoPosition,
} from "./worldinfo/model.js";

// —— tokenizer（prompt-assembly §4）——
export type { Tokenizer } from "./tokenizer/tokenizer.js";
export { createEstimateTokenizer } from "./tokenizer/estimate.js";
export {
  createJsTiktokenTokenizer,
  tokenizerForModel,
  type TiktokenEncoding,
} from "./tokenizer/jst.js";

// —— Prompt 组装器（prompt-assembly）——
export {
  assemblePrompt,
  AssemblyError,
  DEFAULT_MAIN_PROMPT,
  type AssemblyErrorCode,
  type AssemblyInput,
  type AssemblyMessage,
  type AssemblyResult,
  type AssemblyStats,
  type ChatMessage,
  type GroupAssemblyInput,
  type GroupParticipant,
  type Persona,
  type SystemSectionId,
} from "./assembly/assemble.js";

// —— 组装计划与生态导入（M4）——
export {
  DEFAULT_PLAN_ID,
  DEFAULT_SYSTEM_SLOTS,
  SYSTEM_SLOT_IDS,
  defaultAssemblyPlan,
  normalizePlan,
} from "./assembly/plan.js";
export type {
  AssemblyPlan,
  PostHistoryPlan,
  SystemPlanSlot,
  SystemSlotId,
} from "./assembly/plan.js";

// —— 群聊第一阶段（group-chat-spec）——
export {
  chooseNextSpeaker,
  SpeakerSelectionError,
  type ChooseNextSpeakerInput,
  type SpeakerHistoryItem,
  type SpeakerMember,
  type SpeakerSelection,
  type SpeakerSelectionErrorCode,
  type SpeakerStrategy,
} from "./group/scheduler.js";
export { parseOpenAiPreset, PresetParseError } from "./assembly/parse-preset.js";
export type { ParsedPreset } from "./assembly/parse-preset.js";
export { parseSillyTavernWorldInfo, WorldInfoParseError } from "./worldinfo/parse-native.js";
export type { ParsedWorldInfo } from "./worldinfo/parse-native.js";
