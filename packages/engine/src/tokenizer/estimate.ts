/**
 * 估算 tokenizer（docs/prompt-assembly.md §4.3）。
 * 启发式系数为实现细节（规范不锁定数值），CJK 与拉丁分别计权。
 */

import type { Tokenizer } from "./tokenizer.js";

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** 创建估算模式的 Tokenizer（用于未识别模型）。 */
export function createEstimateTokenizer(): Tokenizer {
  return {
    id: "estimate:default",
    estimated: true,
    count(text: string): number {
      if (text.length === 0) {
        return 0;
      }
      let cjk = 0;
      let other = 0;
      for (const ch of text) {
        if (CJK.test(ch)) {
          cjk += 1;
        } else {
          other += 1;
        }
      }
      // CJK ≈ 1 token/字；其余 ≈ 4 字符/token（ST 文档口径）
      return Math.max(1, cjk + Math.ceil(other / 4));
    },
  };
}
