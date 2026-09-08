/**
 * 角色卡 JSON 结构校验（docs/cards-spec.md §2）。
 *
 * zod 用于**结构信封**：顶层对象形态与 character_book 骨架；
 * 字段级宽容导入（cards-spec §8：补默认 + 警告，不硬失败）由 json.ts 显式实现。
 */

import { z } from "zod";

/** V2 卡顶层信封。 */
export const cardEnvelopeSchema = z.looseObject({
  spec: z.optional(z.string()),
  spec_version: z.optional(z.string()),
  data: z.optional(z.unknown()),
});

/** V2 character_book 信封（宽容：所有字段可选，运行时再规范化）。 */
export const characterBookEnvelopeSchema = z.looseObject({
  name: z.optional(z.unknown()),
  description: z.optional(z.unknown()),
  scan_depth: z.optional(z.unknown()),
  token_budget: z.optional(z.unknown()),
  recursive_scanning: z.optional(z.unknown()),
  extensions: z.optional(z.unknown()),
  entries: z.optional(z.unknown()),
});

/** 判定信封是否满足 V2 的 { spec, spec_version, data } 形态。 */
export function matchesCardEnvelope(
  value: unknown,
): value is { spec?: string; spec_version?: string } {
  return cardEnvelopeSchema.safeParse(value).success;
}

/** 判定对象是否可作为 character_book 处理。 */
export function isBookShaped(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
