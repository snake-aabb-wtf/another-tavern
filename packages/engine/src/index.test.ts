import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ENGINE_VERSION } from "./index.js";

describe("engine smoke test", () => {
  it("exposes a non-empty version constant", () => {
    expect(typeof ENGINE_VERSION).toBe("string");
    expect(ENGINE_VERSION.length).toBeGreaterThan(0);
  });

  it("keeps ENGINE_VERSION in sync with package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };

    expect(ENGINE_VERSION).toBe(pkg.version);
  });
});

describe("public API surface（index.ts 唯一出口）", () => {
  it("导出三模块的公开符号且可完成最小集成链路", async () => {
    const api = await import("./index.js");

    for (const name of [
      "parseCharacterCardJson",
      "parseCharacterCardPng",
      "CardParseError",
      "resolveWorldInfo",
      "createEstimateTokenizer",
      "createJsTiktokenTokenizer",
      "tokenizerForModel",
      "assemblePrompt",
      "AssemblyError",
      "DEFAULT_MAIN_PROMPT",
    ]) {
      expect(api, name).toHaveProperty(name);
      expect(typeof (api as Record<string, unknown>)[name], name).not.toBe("undefined");
    }

    // 最小链路：JSON 卡（含内嵌书）→ resolve → assemble
    const { card, warnings } = api.parseCharacterCardJson({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "Aria",
        description: "d",
        personality: "",
        scenario: "",
        first_mes: "hi",
        mes_example: "",
        extensions: {},
        character_book: {
          extensions: {},
          entries: [{ keys: ["x"], content: "lore-x", constant: true, extensions: {} }],
        },
      },
    });
    expect(warnings).toEqual([]);
    expect(card.characterBook?.entries).toHaveLength(1);

    const result = api.assemblePrompt({
      card,
      persona: { name: "Kai", description: "" },
      history: [{ id: "m1", role: "user", name: "Kai", content: "x" }],
      greeting: card.firstMes,
      globalPrompts: { main: "", postHistory: "" },
      authorNote: null,
      worldInfo: {
        books: card.characterBook ? [card.characterBook] : [],
        settings: {
          scanDepth: 2,
          includeNames: false,
          caseSensitive: false,
          matchWholeWords: false,
          recursiveScanning: false,
          maxRecursionSteps: 0,
          wiBudgetPercent: 25,
        },
      },
      budget: { contextSize: 4096, reserveCompletion: 300 },
      tokenizer: api.createEstimateTokenizer(),
    });
    expect(result.messages[0]?.content).toContain("lore-x");
    expect(result.tokenizer.estimated).toBe(true);
  });
});
