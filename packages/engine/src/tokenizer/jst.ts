/**
 * js-tiktoken 后端与模型解析表（docs/prompt-assembly.md §4.2）。
 *
 * 编码映射表为 v1 初版【决定】，作为交付物提交人类评审（prompt-assembly §11.5）。
 */

import { getEncoding, type Tiktoken } from "js-tiktoken";

import { createEstimateTokenizer } from "./estimate.js";
import type { Tokenizer } from "./tokenizer.js";

export type TiktokenEncoding = "cl100k_base" | "o200k_base";

const cache = new Map<TiktokenEncoding, Tiktoken>();

/** 创建（或复用缓存的）js-tiktoken 计数实现。 */
export function createJsTiktokenTokenizer(encoding: TiktokenEncoding): Tokenizer {
  return {
    id: `js-tiktoken:${encoding}`,
    estimated: false,
    count(text: string): number {
      if (text.length === 0) {
        return 0;
      }
      let enc = cache.get(encoding);
      if (enc === undefined) {
        enc = getEncoding(encoding);
        cache.set(encoding, enc);
      }
      return enc.encode(text).length;
    },
  };
}

interface ModelRule {
  readonly pattern: RegExp;
  readonly encoding: TiktokenEncoding;
}

/** v1 初版模型家族 → 编码映射（顺序敏感：先匹配先生效）。 */
export const DEFAULT_MODEL_RULES: readonly ModelRule[] = [
  { pattern: /^(o[1-9][a-z0-9-]*|gpt-4o|gpt-4\.1|chatgpt-4o|gpt-5)/i, encoding: "o200k_base" },
  { pattern: /^(gpt-3\.5|gpt-4[-./]|text-embedding-ada|text-davinci)/i, encoding: "cl100k_base" },
];

/**
 * 按模型 id 解析 tokenizer；未识别模型必须返回 estimated=true 的实现
 * （docs/prompt-assembly.md §4.1/§4.3）。
 */
export function tokenizerForModel(
  modelId: string,
  rules: readonly ModelRule[] = DEFAULT_MODEL_RULES,
): Tokenizer {
  for (const rule of rules) {
    if (rule.pattern.test(modelId)) {
      return createJsTiktokenTokenizer(rule.encoding);
    }
  }
  return createEstimateTokenizer();
}
