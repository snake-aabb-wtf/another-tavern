/**
 * 正则脚本纯引擎。
 *
 * 只负责规则规范化、RegExp 编译和顺序替换，不访问 UI、网络或数据库。
 * 规则数据兼容 ST 的 camelCase 字段，并接受常见 snake_case 导入形态。
 */

import type {
  RegexApplyResult,
  RegexMacroContext,
  RegexPlacement,
  RegexScript,
  RegexSubstitution,
} from "./model.js";

const ST_PLACEMENT: Readonly<Record<number, RegexPlacement | null>> = {
  0: "markdown",
  1: "userInput",
  2: "aiOutput",
  5: "worldInfo",
};

const PLACEMENTS: readonly RegexPlacement[] = [
  "userInput",
  "aiOutput",
  "prompt",
  "worldInfo",
  "markdown",
];

/** 将未知 JSON 值规范化为可执行的正则脚本。 */
export function normalizeRegexScript(
  value: unknown,
  fallbackId: string,
): { script: RegexScript | null; warnings: string[] } {
  if (!isRecord(value)) {
    return { script: null, warnings: [`regex_invalid_script:${fallbackId}`] };
  }

  const id = readString(value.id) || fallbackId;
  const placements = readPlacements(value.placement);
  const substituteRegex = readSubstitution(value.substituteRegex ?? value.substitute_regex);
  const script: RegexScript = {
    id,
    scriptName: readString(value.scriptName ?? value.script_name) || id,
    findRegex: readString(value.findRegex ?? value.find_regex),
    replaceString: readString(value.replaceString ?? value.replace_string),
    trimStrings: readStringArray(value.trimStrings ?? value.trim_strings),
    placement: placements,
    disabled: readBoolean(value.disabled, false),
    markdownOnly: readBoolean(value.markdownOnly ?? value.markdown_only, false),
    promptOnly: readBoolean(value.promptOnly ?? value.prompt_only, false),
    runOnEdit: readBoolean(value.runOnEdit ?? value.run_on_edit, false),
    substituteRegex,
    minDepth: readNullableNumber(value.minDepth ?? value.min_depth),
    maxDepth: readNullableNumber(value.maxDepth ?? value.max_depth),
  };
  return { script, warnings: [] };
}

/** 从数组中规范化正则脚本，并保留每条坏数据的稳定告警。 */
export function normalizeRegexScripts(
  value: unknown,
  source = "regex",
): {
  scripts: RegexScript[];
  warnings: string[];
} {
  if (!Array.isArray(value)) {
    return { scripts: [], warnings: [`regex_scripts_not_array:${source}`] };
  }
  const scripts: RegexScript[] = [];
  const warnings: string[] = [];
  value.forEach((item, index) => {
    const normalized = normalizeRegexScript(item, `${source}:${index}`);
    warnings.push(...normalized.warnings);
    if (normalized.script !== null) {
      scripts.push(normalized.script);
    }
  });
  return { scripts, warnings };
}

/** 按规则数组顺序执行一组正则脚本。 */
export function applyRegexScripts(
  text: string,
  scripts: readonly RegexScript[],
  placement: RegexPlacement,
  options: {
    macroContext?: RegexMacroContext;
    depth?: number;
    isEdit?: boolean;
  } = {},
): RegexApplyResult {
  let current = text;
  const warnings: string[] = [];
  const appliedScriptIds: string[] = [];

  for (const script of scripts) {
    if (!shouldRun(script, placement, options.depth, options.isEdit === true)) {
      continue;
    }
    if (script.findRegex === "") {
      warnings.push(`regex_empty:${script.id}`);
      continue;
    }
    const pattern = substituteFindRegex(
      script.findRegex,
      script.substituteRegex,
      options.macroContext,
    );
    let regex: RegExp;
    try {
      regex = parseRegex(pattern);
    } catch {
      warnings.push(`regex_invalid:${script.id}`);
      continue;
    }
    regex.lastIndex = 0;
    try {
      current = current.replace(regex, (...args: unknown[]) => {
        const match = typeof args[0] === "string" ? args[0] : "";
        const captures = args.slice(1, -2);
        const groups = args.at(-1);
        return expandReplacement(script.replaceString, match, captures, groups, script.trimStrings);
      });
      appliedScriptIds.push(script.id);
    } catch {
      warnings.push(`regex_replace_failed:${script.id}`);
    }
  }

  return { text: current, warnings, appliedScriptIds };
}

function shouldRun(
  script: RegexScript,
  placement: RegexPlacement,
  depth?: number,
  isEdit = false,
): boolean {
  if (script.disabled || !script.placement.includes(placement)) {
    return false;
  }
  if (script.markdownOnly && placement !== "markdown") {
    return false;
  }
  if (script.promptOnly && placement !== "prompt") {
    return false;
  }
  if (isEdit && !script.runOnEdit) {
    return false;
  }
  if (depth !== undefined) {
    if (script.minDepth !== null && script.minDepth >= -1 && depth < script.minDepth) {
      return false;
    }
    if (script.maxDepth !== null && script.maxDepth >= 0 && depth > script.maxDepth) {
      return false;
    }
  }
  return true;
}

function parseRegex(value: string): RegExp {
  if (!value.startsWith("/")) {
    return new RegExp(value);
  }
  let slash = -1;
  for (let index = value.length - 1; index > 0; index -= 1) {
    if (value[index] === "/" && value[index - 1] !== "\\") {
      slash = index;
      break;
    }
  }
  if (slash <= 0) {
    throw new Error("invalid regex literal");
  }
  return new RegExp(value.slice(1, slash), value.slice(slash + 1));
}

function substituteFindRegex(
  value: string,
  mode: RegexSubstitution,
  context: RegexMacroContext | undefined,
): string {
  if (mode === "none") {
    return value;
  }
  const macros: Readonly<Record<string, string>> = {
    char: context?.char ?? "",
    user: context?.user ?? "",
  };
  return value.replace(/\{\{(char|user)\}\}/gi, (_match, key: string) => {
    const raw = macros[key.toLowerCase()] ?? "";
    return mode === "escaped" ? escapeRegex(raw) : raw;
  });
}

function expandReplacement(
  template: string,
  fullMatch: string,
  captures: unknown[],
  groups: unknown,
  trimStrings: readonly string[],
): string {
  const getCapture = (value: unknown): string => {
    if (typeof value !== "string") {
      return "";
    }
    return trimStrings.reduce((result, trim) => result.replaceAll(trim, ""), value);
  };
  const trimmedFull = getCapture(fullMatch);
  return template
    .replace(/\{\{match\}\}/gi, trimmedFull)
    .replace(/\$\$/g, "\0")
    .replace(/\$&/g, trimmedFull)
    .replace(/\$(\d{1,2})/g, (_match, number: string) => getCapture(captures[Number(number) - 1]))
    .replace(/\$<([^>]+)>/g, (_match, name: string) => {
      if (!isRecord(groups)) {
        return "";
      }
      return getCapture(groups[name]);
    })
    .replace(/\0/g, "$");
}

function readPlacements(value: unknown): RegexPlacement[] {
  const raw = Array.isArray(value) ? value : [];
  const result: RegexPlacement[] = [];
  for (const item of raw) {
    const placement =
      typeof item === "number"
        ? (ST_PLACEMENT[item] ?? null)
        : PLACEMENTS.includes(item as RegexPlacement)
          ? (item as RegexPlacement)
          : null;
    if (placement !== null && !result.includes(placement)) {
      result.push(placement);
    }
  }
  return result;
}

function readSubstitution(value: unknown): RegexSubstitution {
  if (value === 1 || value === "raw") {
    return "raw";
  }
  if (value === 2 || value === "escaped") {
    return "escaped";
  }
  return "none";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
