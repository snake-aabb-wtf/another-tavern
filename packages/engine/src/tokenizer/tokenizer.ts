/**
 * Tokenizer 契约（docs/prompt-assembly.md §4）。
 */

/** 组装器与世界书引擎（经 TokenCounter 回调）共用的计数能力。 */
export interface Tokenizer {
  /** 唯一标识，如 "js-tiktoken:o200k_base"、"estimate:default"。 */
  readonly id: string;
  /** true = 估算模式（结果必须显式标注，不得伪装成精确计数）。 */
  readonly estimated: boolean;
  /** 计数唯一原语；预算全部由此驱动。 */
  count(text: string): number;
}
