/**
 * 角色卡 JSON 解析与规范化（docs/cards-spec.md §5、§6、§8）。
 */

import { mapCharacterBook } from "../worldinfo/map-book.js";
import type { WorldInfoBook } from "../worldinfo/model.js";
import {
  CardParseError,
  type CardWarning,
  type CharacterCard,
  type ParseCardResult,
} from "./model.js";
import { isRecord, makeWarner, pickString, pickStringArray, type WarnFn } from "./pick.js";
import { cardEnvelopeSchema } from "./schema.js";

export { CardParseError };

/** V2 data 已知键（未知键进 unknownFields，cards-spec §7.2）。 */
const KNOWN_DATA_KEYS = new Set([
  "name",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "creator_notes",
  "system_prompt",
  "post_history_instructions",
  "alternate_greetings",
  "character_book",
  "tags",
  "creator",
  "character_version",
  "extensions",
]);

/**
 * 解析 V2 / 裸 V2 / V1 形态的角色卡 JSON（宽容导入）。
 * 结构级失败抛 CardParseError；字段级问题进 warnings。
 */
export function parseCharacterCardJson(source: string | unknown): ParseCardResult {
  let value: unknown = source;
  if (typeof source === "string") {
    try {
      value = JSON.parse(source);
    } catch {
      throw new CardParseError("json_parse_failed", "Card payload is not valid JSON.");
    }
  }

  if (cardEnvelopeSchema.safeParse(value).success && isRecord(value)) {
    return normalizeRootRecord(value);
  }
  throw new CardParseError("json_not_object", "Card payload is not a JSON object.");
}

function normalizeRootRecord(root: Record<string, unknown>): ParseCardResult {
  const spec = root.spec;
  const data = root.data;

  if (typeof spec === "string" && spec !== "chara_card_v2") {
    throw new CardParseError("spec_unsupported", `Unsupported card spec "${spec}".`);
  }

  if (spec === "chara_card_v2") {
    if (!isRecord(data)) {
      throw new CardParseError("card_data_invalid", "V2 card has no data object.");
    }
    const warnings: CardWarning[] = [];
    const warn = makeWarner(warnings);
    const version = root.spec_version;
    if (version !== "2.0") {
      warn(
        "spec_version_unexpected",
        `spec_version is ${JSON.stringify(version) ?? "missing"}; expected "2.0".`,
        "spec_version",
      );
    }
    const card = normalizeData(data, "chara_card_v2", warn);
    return { card, warnings };
  }

  if (isRecord(data)) {
    // 无 spec 但含 data 对象 → 裸 V2（cards-spec §5 规则 2）
    const warnings: CardWarning[] = [];
    const warn = makeWarner(warnings);
    warn("spec_missing", 'Card has "data" but no "spec" field; treated as V2.', "spec");
    const card = normalizeData(data, "chara_card_v2", warn);
    return { card, warnings };
  }

  // 其余 → V1 平铺（cards-spec §6）
  const warnings: CardWarning[] = [];
  const warn = makeWarner(warnings);
  warn("v1_imported", "V1 card detected; upgraded to V2 structure with defaults.");
  const card = normalizeData(root, "chara_card_v1", warn);
  return { card, warnings };
}

function normalizeData(
  raw: Record<string, unknown>,
  sourceSpec: "chara_card_v2" | "chara_card_v1",
  warn: WarnFn,
): CharacterCard {
  const v1 = sourceSpec === "chara_card_v1";
  const data = raw;
  const book = normalizeBook(data.character_book, warn);

  const card: CharacterCard = {
    sourceSpec,
    specVersion: "2.0",
    name: pickString(data, "name", "name", warn, true),
    description: pickString(data, "description", "description", warn, true),
    personality: pickString(data, "personality", "personality", warn, true),
    scenario: pickString(data, "scenario", "scenario", warn, true),
    firstMes: pickString(data, "first_mes", "first_mes", warn, true),
    mesExample: pickString(data, "mes_example", "mes_example", warn, true),
    creatorNotes: pickString(data, "creator_notes", "creator_notes", warn, false),
    systemPrompt: pickString(data, "system_prompt", "system_prompt", warn, false),
    postHistoryInstructions: pickString(
      data,
      "post_history_instructions",
      "post_history_instructions",
      warn,
      false,
    ),
    alternateGreetings: pickStringArray(data, "alternate_greetings", "alternate_greetings", warn, {
      singleWrap: true,
    }),
    tags: pickStringArray(data, "tags", "tags", warn),
    creator: pickString(data, "creator", "creator", warn, false),
    characterVersion: pickString(data, "character_version", "character_version", warn, false),
    characterBook: book.book,
    extensions: normalizeExtensions(data, v1, warn),
    unknownFields: collectUnknownFields(data, book.invalidValue),
  };
  return card;
}

function normalizeBook(
  value: unknown,
  warn: WarnFn,
): { book: WorldInfoBook | null; invalidValue?: unknown } {
  if (value === undefined || value === null) {
    return { book: null };
  }
  if (!isRecord(value)) {
    // 不销毁：invalidValue 由 collectUnknownFields 保留
    warn(
      "field_type_mismatch",
      'Field "character_book" is not an object; kept as unknown field.',
      "character_book",
    );
    return { book: null, invalidValue: value };
  }
  const mapped = mapCharacterBook(value, "character_book");
  for (const warning of mapped.warnings) {
    warn(warning.code, warning.message, warning.path);
  }
  return { book: mapped.book };
}

function normalizeExtensions(
  data: Record<string, unknown>,
  isV1: boolean,
  warn: WarnFn,
): Record<string, unknown> {
  const value = data.extensions;
  if (value === undefined || value === null) {
    if (!isV1) {
      warn("field_missing", 'V2 card missing "extensions"; defaulted to {}.', "extensions");
    }
    return {};
  }
  if (isRecord(value)) {
    return value;
  }
  warn(
    "field_type_mismatch",
    'Field "extensions" is not an object; defaulted to {}.',
    "extensions",
  );
  return {};
}

function collectUnknownFields(
  data: Record<string, unknown>,
  invalidCharacterBook: unknown,
): Record<string, unknown> {
  const unknown: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_DATA_KEYS.has(key)) {
      unknown[key] = value;
    }
  }
  if (invalidCharacterBook !== undefined) {
    unknown.character_book = invalidCharacterBook;
  }
  return unknown;
}
