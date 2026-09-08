import { describe, expect, it } from "vitest";

import { createEstimateTokenizer } from "./estimate.js";
import { createJsTiktokenTokenizer, tokenizerForModel } from "./jst.js";

describe("estimate tokenizer", () => {
  const t = createEstimateTokenizer();

  it("显式标注为估算模式", () => {
    expect(t.estimated).toBe(true);
    expect(t.id).toBe("estimate:default");
  });

  it("空文本计 0", () => {
    expect(t.count("")).toBe(0);
  });

  it("CJK 约 1 token/字，拉丁约 4 字符/token", () => {
    expect(t.count("你好世界")).toBe(4);
    expect(t.count("abcdefgh")).toBe(2);
  });

  it("确定性：同输入同输出", () => {
    expect(t.count("混合 mixed 文本")).toBe(t.count("混合 mixed 文本"));
  });
});

describe("js-tiktoken tokenizer", () => {
  const t = createJsTiktokenTokenizer("cl100k_base");

  it("精确计数且非估算", () => {
    expect(t.estimated).toBe(false);
    expect(t.id).toBe("js-tiktoken:cl100k_base");
    expect(t.count("Hello, world!")).toBeGreaterThan(2);
    expect(t.count("")).toBe(0);
  });

  it("确定性：重复调用一致", () => {
    expect(t.count("Aria 月光旅店")).toBe(t.count("Aria 月光旅店"));
  });
});

describe("tokenizerForModel 解析", () => {
  it("识别 OpenAI 家族选择编码", () => {
    expect(tokenizerForModel("gpt-4o-2024-08-06").id).toBe("js-tiktoken:o200k_base");
    expect(tokenizerForModel("gpt-3.5-turbo").id).toBe("js-tiktoken:cl100k_base");
    expect(tokenizerForModel("o3-mini").id).toBe("js-tiktoken:o200k_base");
  });

  it("未识别模型 → 估算 + estimated 标注", () => {
    const t = tokenizerForModel("llama-3.3-70b-instruct");

    expect(t.estimated).toBe(true);
    expect(t.id).toMatch(/^estimate:/);
  });
});
