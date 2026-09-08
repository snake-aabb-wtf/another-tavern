/**
 * V2 `character_book` / ST 扩展字段 → 引擎世界书模型映射。
 * 规则见 docs/world-info-spec.md §8；"先 extensions、后 V2 顶层"。
 */

import type { CardWarning } from "../cards/model.js";
import {
  isRecord,
  pickExtensions,
  pickInteger,
  pickString,
  pickStringArray,
  pickTristateBoolean,
  type WarnFn,
} from "../cards/pick.js";
import type {
  InjectionRole,
  SelectiveLogic,
  WorldInfoBook,
  WorldInfoEntry,
  WorldInfoPosition,
} from "./model.js";

/** 数字编码 ↔ 位置（对齐 ST world_info_position，world-info-spec §8.2）。 */
export const POSITION_BY_NUMBER: readonly WorldInfoPosition[] = [
  "beforeChar",
  "afterChar",
  "anTop",
  "anBottom",
  "atDepth",
  "beforeExample",
  "afterExample",
  "outlet",
];

/** 数字编码 ↔ 副关键词逻辑（对齐 ST world_info_logic）。 */
export const LOGIC_BY_NUMBER: readonly SelectiveLogic[] = ["andAny", "notAll", "notAny", "andAll"];

/** 数字编码 ↔ 注入角色（【⚠️ 待确认】映射，world-info-spec §10.4）。 */
export const ROLE_BY_NUMBER: readonly InjectionRole[] = ["system", "user", "assistant"];

/** V2 entry 已知顶层键（不在此列的并入 extensions，不销毁）。 */
const KNOWN_ENTRY_KEYS = new Set([
  "keys",
  "secondary_keys",
  "comment",
  "content",
  "constant",
  "selective",
  "insertion_order",
  "enabled",
  "position",
  "case_sensitive",
  "id",
  "name",
  "priority",
  "extensions",
  "selectiveLogic",
]);

export interface MappedBook {
  book: WorldInfoBook;
  warnings: CardWarning[];
}

/** 映射 V2 character_book 原始对象为引擎模型（宽容导入）。 */
export function mapCharacterBook(raw: Record<string, unknown>, bookId: string): MappedBook {
  const warnings: CardWarning[] = [];
  const warn = (code: string, message: string, path?: string): void => {
    if (path === undefined) {
      warnings.push({ code, message });
    } else {
      warnings.push({ code, message, path });
    }
  };

  const rawEntries = raw.entries;
  let entries: WorldInfoEntry[] = [];
  if (rawEntries === undefined || rawEntries === null) {
    warn("book_entries_missing", `Book "${bookId}" has no entries array.`, "character_book");
  } else if (!Array.isArray(rawEntries)) {
    warn("book_entries_invalid", `Entries of book "${bookId}" is not an array.`, "character_book");
  } else {
    entries = rawEntries.flatMap((entry, index) => mapEntry(entry, index, bookId, warn));
  }

  const book: WorldInfoBook = {
    id: bookId,
    name: bookText(raw.name, `character_book.name`, warn),
    description: bookText(raw.description, `character_book.description`, warn),
    scanDepth: pickInteger(raw, "scan_depth", "character_book.scan_depth", warn),
    tokenBudget: pickInteger(raw, "token_budget", "character_book.token_budget", warn),
    recursiveScanning: pickTristateBoolean(
      raw,
      "recursive_scanning",
      "character_book.recursive_scanning",
      warn,
    ),
    entries,
    extensions: mergeUnknownTopLevel(raw, KNOWN_BOOK_KEYS, "extensions", "character_book", warn),
  };
  return { book, warnings };
}

const KNOWN_BOOK_KEYS = new Set([
  "name",
  "description",
  "scan_depth",
  "token_budget",
  "recursive_scanning",
  "entries",
  "extensions",
]);

function bookText(value: unknown, path: string, warn: WarnFn): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  warn("field_type_mismatch", `Field "${path}" is not a string; ignored.`, path);
  return null;
}

/** 把未知顶层键并入 extensions（键名原样；raw.extensions 同名键优先）。 */
function mergeUnknownTopLevel(
  raw: Record<string, unknown>,
  known: Set<string>,
  extensionsKey: string,
  path: string,
  warn: WarnFn,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!known.has(key)) {
      merged[key] = value;
    }
  }
  const own = pickExtensions(raw, extensionsKey, path, warn);
  return { ...merged, ...own };
}

function mapEntry(
  rawEntry: unknown,
  index: number,
  bookId: string,
  warn: WarnFn,
): WorldInfoEntry[] {
  const path = `character_book.entries[${index}]`;
  if (!isRecord(rawEntry)) {
    warn("entry_invalid", `Entry #${index} of book "${bookId}" is not an object; skipped.`, path);
    return [];
  }

  const extensions = pickExtensions(rawEntry, "extensions", path, warn);

  // position：extensions.position（数字）优先，回退 V2 字符串（world-info-spec §8.2）
  let position: WorldInfoPosition = "afterChar";
  const extPosition = extensions.position;
  if (extPosition !== undefined && extPosition !== null) {
    if (
      typeof extPosition === "number" &&
      Number.isInteger(extPosition) &&
      extPosition >= 0 &&
      extPosition < POSITION_BY_NUMBER.length
    ) {
      position = POSITION_BY_NUMBER[extPosition] as WorldInfoPosition;
    } else {
      warn(
        "entry_extensions_position_invalid",
        `extensions.position ${JSON.stringify(extPosition)} unknown; falling back to V2 position.`,
        path,
      );
      position = v2Position(rawEntry.position, path, warn);
    }
  } else {
    position = v2Position(rawEntry.position, path, warn);
  }

  const depth = pickInteger(extensions, "depth", `${path}.extensions.depth`, warn);

  let role: InjectionRole | null = null;
  const extRole = extensions.role;
  if (extRole !== undefined && extRole !== null) {
    if (
      typeof extRole === "number" &&
      Number.isInteger(extRole) &&
      extRole >= 0 &&
      extRole < ROLE_BY_NUMBER.length
    ) {
      role = ROLE_BY_NUMBER[extRole] as InjectionRole;
    } else {
      warn(
        "entry_role_invalid",
        `extensions.role ${JSON.stringify(extRole)} unknown; defaulted to null.`,
        path,
      );
    }
  }

  // selective logic：extensions.selective_logic 优先，回退顶层 selectiveLogic，再回退默认
  // （两处存储变体并存，优先级【⚠️ 待确认】world-info-spec §10.2 —— 暂定 extensions 优先）
  let logic: SelectiveLogic = "andAny";
  const logicRaw = extensions.selective_logic ?? rawEntry.selectiveLogic;
  if (logicRaw !== undefined && logicRaw !== null) {
    if (
      typeof logicRaw === "number" &&
      Number.isInteger(logicRaw) &&
      logicRaw >= 0 &&
      logicRaw < LOGIC_BY_NUMBER.length
    ) {
      logic = LOGIC_BY_NUMBER[logicRaw] as SelectiveLogic;
    } else {
      warn(
        "entry_selective_logic_invalid",
        `selective logic ${JSON.stringify(logicRaw)} unknown; using andAny.`,
        path,
      );
    }
  }

  const idValue = rawEntry.id;
  const id =
    typeof idValue === "number" || typeof idValue === "string"
      ? String(idValue)
      : `${bookId}:${index}`;

  // case_sensitive：V2 顶层与 extensions 两处都可能是来源（extensions 优先）
  const caseSensitive = asTristate(
    extensions.case_sensitive ?? rawEntry.case_sensitive,
    `${path}.case_sensitive`,
    warn,
  );

  return [
    {
      id,
      comment: pickString(rawEntry, "comment", `${path}.comment`, warn, false),
      keys: pickStringArray(rawEntry, "keys", `${path}.keys`, warn),
      secondaryKeys: pickStringArray(rawEntry, "secondary_keys", `${path}.secondary_keys`, warn),
      selective: booleanOr(rawEntry.selective, false),
      logic,
      content: pickString(rawEntry, "content", `${path}.content`, warn, false),
      enabled: booleanOr(rawEntry.enabled, true),
      constant: booleanOr(rawEntry.constant, false),
      insertionOrder: entryOrder(rawEntry.insertion_order, path, warn),
      position,
      depth,
      role,
      scanDepth: pickInteger(extensions, "scan_depth", `${path}.extensions.scan_depth`, warn),
      caseSensitive,
      matchWholeWords: pickTristateBoolean(
        extensions,
        "match_whole_words",
        `${path}.extensions.match_whole_words`,
        warn,
      ),
      preventRecursion: booleanOr(extensions.prevent_recursion, false),
      excludeRecursion: booleanOr(extensions.exclude_recursion, false),
      extensions: mergeUnknownTopLevel(rawEntry, KNOWN_ENTRY_KEYS, "extensions", path, warn),
    },
  ];
}

function v2Position(value: unknown, path: string, warn: WarnFn): WorldInfoPosition {
  if (value === undefined || value === null) {
    return "afterChar";
  }
  if (value === "before_char") {
    return "beforeChar";
  }
  if (value === "after_char") {
    return "afterChar";
  }
  warn(
    "entry_position_invalid",
    `position ${JSON.stringify(value)} not a V2 enum; using afterChar.`,
    path,
  );
  return "afterChar";
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** 三态布尔规范化：undefined/null → null；boolean 原样；其他告警 → null。 */
function asTristate(value: unknown, path: string, warn: WarnFn): boolean | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  warn("field_type_mismatch", `Field "${path}" is not a boolean; treated as inherit.`, path);
  return null;
}

function entryOrder(value: unknown, path: string, warn: WarnFn): number {
  if (value === undefined || value === null) {
    return 100;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  warn("field_type_mismatch", `insertion_order ${JSON.stringify(value)} invalid; using 100.`, path);
  return 100;
}
