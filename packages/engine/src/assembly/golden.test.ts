/**
 * golden-file 测试（M2 任务要求）：把典型场景的最终输出固定为
 * packages/engine/testdata/assembly-<name>.json 逐一比对。
 *
 * 更新快照：UPDATE_GOLDEN=1 pnpm --filter @another-tavern/engine test
 * 更新后必须人工审阅 diff 再提交。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import chunkText from "png-chunk-text";
import encodePng from "png-chunks-encode";
import { describe, expect, it } from "vitest";

import { parseCharacterCardJson } from "../cards/json.js";
import type { CharacterCard } from "../cards/model.js";
import { parseCharacterCardPng } from "../cards/png.js";
import type { WorldInfoBook, WorldInfoEntry } from "../worldinfo/model.js";
import type { Tokenizer } from "../tokenizer/tokenizer.js";
import { assemblePrompt, type AssemblyInput, type AssemblyResult } from "./assemble.js";

const charCount: Tokenizer = {
  id: "test:char-count",
  estimated: false,
  count: (text: string) => text.length,
};

const estimate: Tokenizer = {
  id: "estimate:default",
  estimated: true,
  count: (text: string) => Math.max(1, Math.ceil(text.length / 4)),
};

function card(over: Partial<CharacterCard> = {}): CharacterCard {
  return {
    sourceSpec: "chara_card_v2",
    specVersion: "2.0",
    name: "Aria",
    description: "Aria 是月光旅店的管理员，说话温柔而简洁。",
    personality: "冷静、体贴，略带神秘感。",
    scenario: "深夜，{{user}} 淋雨走进了月光旅店。",
    firstMes: "*她从柜台后抬起头* 欢迎光临。",
    mesExample: "",
    creatorNotes: "",
    systemPrompt: "",
    postHistoryInstructions: "",
    alternateGreetings: [],
    tags: [],
    creator: "",
    characterVersion: "",
    characterBook: null,
    extensions: {},
    unknownFields: {},
    ...over,
  };
}

function wiEntry(over: Partial<WorldInfoEntry> = {}): WorldInfoEntry {
  return {
    id: "e",
    comment: "",
    keys: [],
    secondaryKeys: [],
    selective: false,
    logic: "andAny",
    content: "content",
    enabled: true,
    constant: false,
    insertionOrder: 100,
    position: "afterChar",
    depth: null,
    role: null,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    preventRecursion: false,
    excludeRecursion: false,
    extensions: {},
    ...over,
  };
}

function book(entries: WorldInfoEntry[], over: Partial<WorldInfoBook> = {}): WorldInfoBook {
  return {
    id: "lore",
    name: "l",
    description: null,
    scanDepth: null,
    tokenBudget: null,
    recursiveScanning: null,
    entries,
    extensions: {},
    ...over,
  };
}

const wiSettings = {
  scanDepth: 2,
  includeNames: true,
  caseSensitive: false,
  matchWholeWords: false,
  recursiveScanning: false,
  maxRecursionSteps: 0,
  wiBudgetPercent: 25,
};

function mkHistory(n: number, size = 20) {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i + 1}`,
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    name: i % 2 === 0 ? "Kai" : "Aria",
    content: `消息${i + 1} ${"x".repeat(size)}`,
  }));
}

function checkGolden(name: string, result: AssemblyResult): void {
  const dir = new URL("../../testdata/", import.meta.url);
  const file = new URL(`assembly-${name}.json`, dir);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;

  if (process.env.UPDATE_GOLDEN === "1") {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, serialized, "utf8");
    return;
  }
  if (!existsSync(file)) {
    throw new Error(`golden file missing: ${file}（用 UPDATE_GOLDEN=1 生成后人工审阅）`);
  }
  expect(readFileSync(file, "utf8")).toBe(serialized);
}

function run(input: AssemblyInput): AssemblyResult {
  return assemblePrompt(input);
}

describe("golden: 典型组装场景", () => {
  it("basic-full：persona+卡段+世界书+示例+历史全量在场", () => {
    const result = run({
      card: card({
        mesExample: "<START>\n{{user}}: 有什么特别的吗\n{{char}}: 一切都会被记住。",
      }),
      persona: { name: "Kai", description: "Kai 是一位旅人。" },
      history: [
        { id: "m1", role: "user", name: "Kai", content: "打扰了，能避避雨吗" },
        { id: "m2", role: "assistant", name: "Aria", content: "当然可以。" },
        { id: "m3", role: "user", name: "Kai", content: "推荐点什么吗，比如一壶茶？" },
      ],
      greeting: card().firstMes,
      globalPrompts: { main: "", postHistory: "" },
      authorNote: null,
      worldInfo: {
        books: [
          book([
            wiEntry({
              id: "w1",
              keys: ["月光旅店"],
              constant: true,
              position: "beforeChar",
              insertionOrder: 10,
              content: "月光旅店是边境小镇上唯一的旅店，只有烛光。",
            }),
            wiEntry({
              id: "w2",
              keys: ["茶"],
              position: "afterChar",
              insertionOrder: 20,
              content: "旅店只供应红茶，茶很浓、很烫。",
            }),
          ]),
        ],
        settings: { ...wiSettings },
      },
      budget: { contextSize: 8192, reserveCompletion: 300 },
      tokenizer: charCount,
    });
    checkGolden("basic-full", result);
  });

  it("long-history-pruning：长历史+示例触发两级裁剪", () => {
    const result = run({
      card: card({ mesExample: "<START>\n旧示例块\n<START>\n新示例块" }),
      persona: { name: "Kai", description: "Kai 是一位旅人。" },
      history: mkHistory(10, 60),
      greeting: "欢迎光临。",
      globalPrompts: { main: "", postHistory: "" },
      authorNote: null,
      worldInfo: { books: [], settings: { ...wiSettings } },
      budget: { contextSize: 420, reserveCompletion: 20 },
      tokenizer: charCount,
    });
    checkGolden("long-history-pruning", result);
  });

  it("worldinfo-budget-contention：书预算内的条目竞争", () => {
    const result = run({
      card: card(),
      persona: { name: "Kai", description: "" },
      history: [{ id: "m1", role: "user", name: "Kai", content: "alpha beta gamma" }],
      greeting: "嗨",
      globalPrompts: { main: "", postHistory: "" },
      authorNote: null,
      worldInfo: {
        books: [
          book(
            [
              wiEntry({ id: "c1", constant: true, content: "CONST", insertionOrder: 1 }),
              wiEntry({ id: "k10", keys: ["alpha"], content: "KW10", insertionOrder: 10 }),
              wiEntry({ id: "k20", keys: ["beta"], content: "KW20", insertionOrder: 20 }),
              wiEntry({ id: "k30", keys: ["gamma"], content: "KW30", insertionOrder: 30 }),
            ],
            { tokenBudget: 14 },
          ),
        ],
        settings: { ...wiSettings },
      },
      budget: { contextSize: 8192, reserveCompletion: 100 },
      tokenizer: charCount,
    });
    checkGolden("worldinfo-budget-contention", result);
  });

  it("author-note-depth：AN 与 WI atDepth 同深度共存", () => {
    const result = run({
      card: card(),
      persona: { name: "Kai", description: "" },
      history: mkHistory(5, 10),
      greeting: "欢迎光临。",
      globalPrompts: { main: "", postHistory: "" },
      authorNote: { text: "保持简短的文风。", depth: 3 },
      worldInfo: {
        books: [
          book([
            wiEntry({
              id: "at",
              constant: true,
              position: "atDepth",
              depth: 3,
              role: "system",
              content: "旁白：烛火摇曳。",
              insertionOrder: 50,
            }),
          ]),
        ],
        settings: { ...wiSettings },
      },
      budget: { contextSize: 8192, reserveCompletion: 100 },
      tokenizer: charCount,
    });
    checkGolden("author-note-depth", result);
  });

  it("no-persona-phi-override：无人设 + 卡级覆盖 main/PHI", () => {
    const result = run({
      card: card({
        systemPrompt: "你是 {{char}}，用中文回复。{{original}}",
        postHistoryInstructions: "只输出一段。",
      }),
      persona: { name: "Kai", description: "" },
      history: [{ id: "m1", role: "user", name: "Kai", content: "你好" }],
      greeting: null,
      globalPrompts: { main: "GLOBAL MAIN", postHistory: "GLOBAL PHI" },
      authorNote: null,
      worldInfo: { books: [], settings: { ...wiSettings } },
      budget: { contextSize: 8192, reserveCompletion: 100 },
      tokenizer: charCount,
    });
    checkGolden("no-persona-phi-override", result);
  });

  it("estimated-tokenizer：估算模式下输出与标注", () => {
    const result = run({
      card: card(),
      persona: { name: "Kai", description: "旅人。" },
      history: [{ id: "m1", role: "user", name: "Kai", content: "你好呀" }],
      greeting: "欢迎光临。",
      globalPrompts: { main: "", postHistory: "" },
      authorNote: null,
      worldInfo: { books: [], settings: { ...wiSettings } },
      budget: { contextSize: 4096, reserveCompletion: 300 },
      tokenizer: estimate,
    });
    checkGolden("estimated-tokenizer", result);
  });

  it("png-e2e：从合成 PNG 到最终 messages 的全链路", () => {
    const cardJson = JSON.stringify({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "Aria",
        description: "月光旅店管理员。",
        personality: "神秘。",
        scenario: "{{user}} 推门而入。",
        first_mes: "欢迎光临。",
        mes_example: "<START>\n{{user}}: 好\n{{char}}: 嗯",
        system_prompt: "",
        post_history_instructions: "",
        alternate_greetings: [],
        tags: [],
        creator: "",
        character_version: "",
        extensions: {},
        character_book: {
          name: "inn",
          description: "",
          scan_depth: null,
          token_budget: null,
          recursive_scanning: false,
          extensions: {},
          entries: [
            {
              id: 1,
              keys: ["旅店"],
              secondary_keys: [],
              comment: "",
              content: "旅店只有烛光照明。",
              constant: true,
              selective: false,
              insertion_order: 10,
              enabled: true,
              position: "before_char",
              extensions: {},
            },
          ],
        },
      },
    });
    const ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
    const png = encodePng([
      { name: "IHDR", data: ihdr },
      chunkText.encode("chara", Buffer.from(cardJson, "utf8").toString("base64")),
      { name: "IDAT", data: new Uint8Array([1]) },
      { name: "IEND", data: new Uint8Array(0) },
    ]);
    const parsed = parseCharacterCardPng(png);
    const viaJson = parseCharacterCardJson(cardJson);
    expect(parsed.card).toEqual(viaJson.card); // PNG 与 JSON 路径产物一致

    const result = run({
      card: parsed.card,
      persona: { name: "Kai", description: "旅人。" },
      history: [{ id: "m1", role: "user", name: "Kai", content: "这里有什么设施？" }],
      greeting: parsed.card.firstMes,
      globalPrompts: { main: "", postHistory: "" },
      authorNote: null,
      worldInfo: {
        books: parsed.card.characterBook !== null ? [parsed.card.characterBook] : [],
        settings: { ...wiSettings },
      },
      budget: { contextSize: 8192, reserveCompletion: 300 },
      tokenizer: charCount,
    });
    checkGolden("png-e2e", {
      ...result,
      warnings: [...result.warnings, ...parsed.warnings.map((w) => w.code)],
    } as AssemblyResult);
  });
});
