/**
 * 宽容导入的字段提取助手（docs/cards-spec.md §8：字段级问题只警告不失败）。
 */

import type { CardWarning } from "./model.js";

/** 收集警告的回调。 */
export type WarnFn = (code: string, message: string, path?: string) => void;

/** 创建向 list 追加警告的 WarnFn。 */
export function makeWarner(list: CardWarning[]): WarnFn {
  return (code, message, path) => {
    if (path === undefined) {
      list.push({ code, message });
    } else {
      list.push({ code, message, path });
    }
  };
}

/** 普通对象判定（排除数组与 null）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 提取字符串字段。
 * required=true 时缺失产生 field_missing；类型不符一律产生 field_type_mismatch。
 */
export function pickString(
  raw: Record<string, unknown>,
  key: string,
  path: string,
  warn: WarnFn,
  required: boolean,
): string {
  const value = raw[key];
  if (value === undefined || value === null) {
    if (required) {
      warn("field_missing", `Required string field "${key}" missing; defaulted to "".`, path);
    }
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  warn("field_type_mismatch", `Field "${key}" is not a string; defaulted to "".`, path);
  return "";
}

/** 提取字符串数组：过滤非字符串项并告警；缺失返回 fallback。 */
export function pickStringArray(
  raw: Record<string, unknown>,
  key: string,
  path: string,
  warn: WarnFn,
  opts: { singleWrap?: boolean } = {},
): string[] {
  const value = raw[key];
  if (value === undefined || value === null) {
    return [];
  }
  if (typeof value === "string" && opts.singleWrap) {
    warn(
      "alternate_greetings_normalized",
      `Field "${key}" is a single string; wrapped into an array.`,
      path,
    );
    return [value];
  }
  if (!Array.isArray(value)) {
    warn("field_type_mismatch", `Field "${key}" is not an array; defaulted to [].`, path);
    return [];
  }
  const kept: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      kept.push(item);
    } else {
      warn(
        value === raw[key] && opts.singleWrap
          ? "alternate_greetings_normalized"
          : "field_type_mismatch",
        `Non-string item in "${key}" was dropped.`,
        path,
      );
    }
  }
  return kept;
}

/** 提取布尔字段；缺失或非法返回 fallback（非法时告警）。 */
export function pickBoolean(
  raw: Record<string, unknown>,
  key: string,
  path: string,
  warn: WarnFn,
  fallback: boolean,
  silentOnMissing: boolean,
): boolean {
  const value = raw[key];
  if (value === undefined || value === null) {
    if (!silentOnMissing) {
      warn("field_missing", `Boolean field "${key}" missing; defaulted.`, path);
    }
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  warn("field_type_mismatch", `Field "${key}" is not a boolean; defaulted.`, path);
  return fallback;
}

/** 提取三态布尔（null = 继承）；键不存在返回 null，不告警。 */
export function pickTristateBoolean(
  raw: Record<string, unknown>,
  key: string,
  path: string,
  warn: WarnFn,
): boolean | null {
  const value = raw[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  warn("field_type_mismatch", `Field "${key}" is not a boolean; treated as inherit.`, path);
  return null;
}

/** 提取整数字段；缺失返回 null；非数字/非有限告警后返回 null；小数截断。 */
export function pickInteger(
  raw: Record<string, unknown>,
  key: string,
  path: string,
  warn: WarnFn,
): number | null {
  const value = raw[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  warn("field_type_mismatch", `Field "${key}" is not a finite number; ignored.`, path);
  return null;
}

/** 提取对象扩展袋；缺失/非法返回 {}（非法时告警）。 */
export function pickExtensions(
  raw: Record<string, unknown>,
  key: string,
  path: string,
  warn: WarnFn,
): Record<string, unknown> {
  const value = raw[key];
  if (value === undefined || value === null) {
    return {};
  }
  if (isRecord(value)) {
    return value;
  }
  warn("field_type_mismatch", `Field "${key}" is not an object; defaulted to {}.`, path);
  return {};
}
