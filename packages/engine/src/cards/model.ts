/**
 * 角色卡解析产物模型。语义对应 docs/cards-spec.md。
 */

import type { WorldInfoBook } from "../worldinfo/model.js";

/** 解析 / 规范化过程中产出的结构化警告。 */
export interface CardWarning {
  /** 稳定码，如 field_missing。 */
  code: string;
  /** 人类可读信息。 */
  message: string;
  /** JSON 路径（相对卡片根），供 UI 定位；缺省表示卡片级。 */
  path?: string;
}

/** 规范化的角色卡（V2 语义等价；V1 输入已被升级映射）。 */
export interface CharacterCard {
  /** 来源 spec：v2 表示 V2/裸 V2 JSON，v1 表示平铺卡升级而来。 */
  sourceSpec: "chara_card_v2" | "chara_card_v1";
  /** 源 spec_version；V1 升级后为 "2.0"。 */
  specVersion: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  /** 仅 UI 展示，不进 prompt。 */
  creatorNotes: string;
  /** 非空时覆盖全局 main prompt（prompt-assembly §3.1）。 */
  systemPrompt: string;
  /** 非空时覆盖全局 PHI。 */
  postHistoryInstructions: string;
  alternateGreetings: string[];
  /** 仅 UI 过滤/展示。 */
  tags: string[];
  creator: string;
  characterVersion: string;
  /** 卡内嵌世界书，已映射为引擎形态；无则为 null。 */
  characterBook: WorldInfoBook | null;
  /** V2 extensions：原样保留（规范 MUST 不销毁）。 */
  extensions: Record<string, unknown>;
  /** data 顶层未知字段：原样保留，round-trip 导出时写回原位（cards-spec §7.2）。 */
  unknownFields: Record<string, unknown>;
}

export interface ParseCardResult {
  card: CharacterCard;
  warnings: CardWarning[];
}

/** 无法解析（结构级失败）时的错误；字段级问题一律走 warnings。 */
export type CardParseErrorCode =
  | "invalid_png"
  | "png_chunk_not_found"
  | "base64_decode_failed"
  | "json_parse_failed"
  | "json_not_object"
  | "spec_unsupported"
  | "card_data_invalid";

export class CardParseError extends Error {
  readonly code: CardParseErrorCode;

  constructor(code: CardParseErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "CardParseError";
    this.code = code;
  }
}
