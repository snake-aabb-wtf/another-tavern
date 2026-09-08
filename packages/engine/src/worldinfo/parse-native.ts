/**
 * ST 原生世界书（World Info）JSON 导入解析器（M4 任务 §3）。
 *
 * 输入形态（一手依据：ST release 源码与导出文件惯例）：
 * `{ entries: { "0": { uid, key, keysecondary, comment, content, constant, selective,
 *    order, position(数字), depth, role, disable, excludeRecursion, preventRecursion,
 *    selectiveLogic, scanDepth, caseSensitive, matchWholeWords, ... } }, name? }`
 *
 * 原则：未知字段一律保留进 extensions（不丢弃，cards-spec §7 同款）；
 * ST 未实现特性照常保留，由 resolveWorldInfo 运行时告警。
 */

import type { CardWarning } from "../cards/model.js";
import { isRecord } from "../cards/pick.js";
import type {
  InjectionRole,
  SelectiveLogic,
  WorldInfoBook,
  WorldInfoEntry,
  WorldInfoPosition,
} from "./model.js";
import { LOGIC_BY_NUMBER, POSITION_BY_NUMBER, ROLE_BY_NUMBER } from "./map-book.js";

export class WorldInfoParseError extends Error {
  readonly code: "worldinfo_parse_failed" | "worldinfo_not_object" | "worldinfo_entries_invalid";

  constructor(
    code: "worldinfo_parse_failed" | "worldinfo_not_object" | "worldinfo_entries_invalid",
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = "WorldInfoParseError";
    this.code = code;
  }
}

export interface ParsedWorldInfo {
  book: WorldInfoBook;
  warnings: CardWarning[];
}

/** ST 原生条目中已知会被映射的键（其余进 extensions）。 */
const KNOWN_ST_ENTRY_KEYS = new Set([
  "uid",
  "key",
  "keysecondary",
  "comment",
  "content",
  "constant",
  "selective",
  "order",
  "position",
  "depth",
  "role",
  "disable",
  "excludeRecursion",
  "preventRecursion",
  "selectiveLogic",
  "scanDepth",
  "caseSensitive",
  "matchWholeWords",
  "extensions",
]);

/** 解析 ST 原生世界书 JSON 为引擎世界书模型。 */
export function parseSillyTavernWorldInfo(
  source: string | unknown,
  bookId = "imported",
): ParsedWorldInfo {
  let value: unknown = source;
  if (typeof source === "string") {
    try {
      value = JSON.parse(source);
    } catch {
      throw new WorldInfoParseError(
        "worldinfo_parse_failed",
        "World info payload is not valid JSON.",
      );
    }
  }
  if (!isRecord(value)) {
    throw new WorldInfoParseError(
      "worldinfo_not_object",
      "World info payload is not a JSON object.",
    );
  }

  const warnings: CardWarning[] = [];
  const rawEntries = value.entries;
  let rawList: unknown[] = [];
  if (Array.isArray(rawEntries)) {
    rawList = rawEntries;
  } else if (isRecord(rawEntries)) {
    rawList = Object.values(rawEntries);
  } else {
    throw new WorldInfoParseError("worldinfo_entries_invalid", '"entries" is missing or invalid.');
  }

  const entries: WorldInfoEntry[] = [];
  rawList.forEach((raw, index) => {
    if (!isRecord(raw)) {
      warnings.push({
        code: "entry_invalid",
        message: `Entry #${index} is not an object; skipped.`,
        path: `entries[${index}]`,
      });
      return;
    }
    entries.push(mapStEntry(raw, index, bookId, warnings));
  });

  const name = typeof value.name === "string" ? value.name : null;
  const book: WorldInfoBook = {
    id: bookId,
    name,
    description: typeof value.description === "string" ? value.description : null,
    scanDepth: asIntegerOrNull(value.scanDepth),
    tokenBudget: asIntegerOrNull(value.tokenBudget),
    recursiveScanning: asBooleanOrNull(value.recursiveScanning),
    entries,
    extensions: collectUnknown(value, [
      "entries",
      "name",
      "description",
      "scanDepth",
      "tokenBudget",
      "recursiveScanning",
    ]),
  };
  return { book, warnings };
}

function mapStEntry(
  raw: Record<string, unknown>,
  index: number,
  bookId: string,
  warnings: CardWarning[],
): WorldInfoEntry {
  const warn = (code: string, message: string, path: string): void => {
    warnings.push({ code, message, path });
  };

  const id =
    typeof raw.uid === "number" || typeof raw.uid === "string"
      ? String(raw.uid)
      : `${bookId}:${index}`;

  let position: WorldInfoPosition = "afterChar";
  if (raw.position !== undefined && raw.position !== null) {
    if (
      typeof raw.position === "number" &&
      Number.isInteger(raw.position) &&
      raw.position >= 0 &&
      raw.position < POSITION_BY_NUMBER.length
    ) {
      position = POSITION_BY_NUMBER[raw.position] as WorldInfoPosition;
    } else {
      warn(
        "entry_position_invalid",
        `position ${JSON.stringify(raw.position)} unknown; using afterChar.`,
        `entries[${index}].position`,
      );
    }
  }

  let logic: SelectiveLogic = "andAny";
  if (raw.selectiveLogic !== undefined && raw.selectiveLogic !== null) {
    if (
      typeof raw.selectiveLogic === "number" &&
      Number.isInteger(raw.selectiveLogic) &&
      raw.selectiveLogic >= 0 &&
      raw.selectiveLogic < LOGIC_BY_NUMBER.length
    ) {
      logic = LOGIC_BY_NUMBER[raw.selectiveLogic] as SelectiveLogic;
    } else {
      warn(
        "entry_selective_logic_invalid",
        `selectiveLogic ${JSON.stringify(raw.selectiveLogic)} unknown; using andAny.`,
        `entries[${index}].selectiveLogic`,
      );
    }
  }

  let role: InjectionRole | null = null;
  if (raw.role !== undefined && raw.role !== null) {
    if (
      typeof raw.role === "number" &&
      Number.isInteger(raw.role) &&
      raw.role >= 0 &&
      raw.role < ROLE_BY_NUMBER.length
    ) {
      role = ROLE_BY_NUMBER[raw.role] as InjectionRole;
    } else if (raw.role === "system" || raw.role === "user" || raw.role === "assistant") {
      role = raw.role;
    } else {
      warn(
        "entry_role_invalid",
        `role ${JSON.stringify(raw.role)} unknown; defaulted to null.`,
        `entries[${index}].role`,
      );
    }
  }

  return {
    id,
    comment: asString(raw.comment),
    keys: parseKeyList(raw.key, `entries[${index}].key`, warn),
    secondaryKeys: parseKeyList(raw.keysecondary, `entries[${index}].keysecondary`, warn),
    selective: raw.selective === true,
    logic,
    content: asString(raw.content),
    enabled: raw.disable === undefined ? true : raw.disable !== true,
    constant: raw.constant === true,
    insertionOrder: asIntegerOrNull(raw.order) ?? 100,
    position,
    depth: asIntegerOrNull(raw.depth),
    role,
    scanDepth: asIntegerOrNull(raw.scanDepth),
    caseSensitive: asTristate(raw.caseSensitive),
    matchWholeWords: asTristate(raw.matchWholeWords),
    preventRecursion: raw.preventRecursion === true,
    excludeRecursion: raw.excludeRecursion === true,
    extensions: collectUnknown(raw, [...KNOWN_ST_ENTRY_KEYS]),
  };
}

/** ST 的 key 字段：逗号分隔字符串或字符串数组，两种形态都宽容处理。 */
function parseKeyList(value: unknown, path: string, warn: CardWarningWarn): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((key) => key.trim())
      .filter((key) => key !== "");
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  warn("field_type_mismatch", `Key list ${JSON.stringify(value)} invalid; defaulted to [].`, path);
  return [];
}

type CardWarningWarn = (code: string, message: string, path: string) => void;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asIntegerOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  return null;
}

function asBooleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asTristate(value: unknown): boolean | null {
  return asBooleanOrNull(value);
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
