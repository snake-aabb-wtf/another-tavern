import { describe, expect, it } from "vitest";

import type { CharacterCard } from "../cards/model.js";
import type { WorldInfoBook, WorldInfoEntry } from "../worldinfo/model.js";
import type { Tokenizer } from "../tokenizer/tokenizer.js";
import {
  assemblePrompt,
  AssemblyError,
  DEFAULT_MAIN_PROMPT,
  type AssemblyInput,
} from "./assemble.js";

const charCountTokenizer: Tokenizer = {
  id: "test:char-count",
  estimated: false,
  count: (text: string) => text.length,
};

function card(over: Partial<CharacterCard> = {}): CharacterCard {
  return {
    sourceSpec: "chara_card_v2",
    specVersion: "2.0",
    name: "Aria",
    description: "旅店管理员。",
    personality: "冷静。",
    scenario: "深夜。",
    firstMes: "欢迎光临。",
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
    content: "wi-content",
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

function wiBook(entries: WorldInfoEntry[], over: Partial<WorldInfoBook> = {}): WorldInfoBook {
  return {
    id: "book",
    name: "b",
    description: null,
    scanDepth: null,
    tokenBudget: null,
    recursiveScanning: null,
    entries,
    extensions: {},
    ...over,
  };
}

const defaultWiSettings = {
  scanDepth: 2,
  includeNames: false,
  caseSensitive: false,
  matchWholeWords: false,
  recursiveScanning: false,
  maxRecursionSteps: 0,
  wiBudgetPercent: 25,
} as const;

function baseInput(over: Partial<AssemblyInput> = {}): AssemblyInput {
  return {
    card: card(),
    persona: { name: "Kai", description: "旅人。" },
    history: [],
    greeting: "欢迎光临。",
    globalPrompts: { main: "", postHistory: "" },
    authorNote: null,
    worldInfo: { books: [], settings: { ...defaultWiSettings } },
    budget: { contextSize: 100000, reserveCompletion: 300 },
    tokenizer: charCountTokenizer,
    ...over,
  };
}

describe("assemblePrompt: system 区顺序（prompt-assembly §2.1）", () => {
  it("全段在场时按规范段序拼接为单条 system 消息", () => {
    const result = assemblePrompt(
      baseInput({
        card: card({ mesExample: "<START>\nKai: 你好\nAria: 早安" }),
        worldInfo: {
          books: [
            wiBook([
              wiEntry({ id: "wb", constant: true, position: "beforeChar", content: "WB" }),
              wiEntry({ id: "wa", constant: true, position: "afterChar", content: "WA" }),
            ]),
          ],
          settings: { ...defaultWiSettings },
        },
      }),
    );

    expect(result.messages[0]?.role).toBe("system");
    const sections = (result.messages[0]?.content ?? "").split("\n\n");
    expect(sections.map((s) => s.split("\n")[0]).slice(0, 8)).toEqual([
      "Write Aria's next reply in a fictional chat between Aria and Kai.",
      "WB",
      "旅人。",
      "旅店管理员。",
      "冷静。",
      "深夜。",
      "WA",
      "<START>",
    ]);
  });

  it("无 persona / 空段跳过，不产生多余空行", () => {
    const result = assemblePrompt(
      baseInput({
        persona: { name: "Kai", description: "" },
        card: card({ personality: "", scenario: "" }),
      }),
    );

    const content = result.messages[0]?.content ?? "";
    expect(content).toBe(
      "Write Aria's next reply in a fictional chat between Aria and Kai.\n\n旅店管理员。",
    );
    expect(Object.keys(result.stats.tokensBySection)).toEqual(["main", "description", "chat"]);
  });

  it("main 三级回退：卡值 > 全局 > 内置默认，且支持 {{original}}", () => {
    // 内置默认
    expect(
      assemblePrompt(baseInput()).messages[0]?.content.startsWith(
        DEFAULT_MAIN_PROMPT.replace("{{charIfNotGroup}}", "Aria")
          .replace(/{{char}}/g, "Aria")
          .replace("{{user}}", "Kai"),
      ),
    ).toBe(true);

    // 全局覆盖
    const g = assemblePrompt(
      baseInput({ globalPrompts: { main: "G-M {{char}}", postHistory: "" } }),
    );
    expect(g.messages[0]?.content.startsWith("G-M Aria")).toBe(true);

    // 卡值覆盖 + {{original}} 引用全局
    const c = assemblePrompt(
      baseInput({
        globalPrompts: { main: "G-M", postHistory: "" },
        card: card({ systemPrompt: "{{original}}\nS-M for {{user}}" }),
      }),
    );
    expect(c.messages[0]?.content.startsWith("G-M\nS-M for Kai")).toBe(true);
  });
});

describe("assemblePrompt: 宏（§7）", () => {
  it("{{char}}/{{user}}/<BOT>/<USER> 替换，未知宏原样保留", () => {
    const result = assemblePrompt(
      baseInput({
        card: card({
          scenario: "{{char}} 与 {{user}}，<BOT> 对 <USER>，{{unknown}} 保留",
        }),
      }),
    );
    const content = result.messages[0]?.content ?? "";
    expect(content).toContain("Aria 与 Kai，Aria 对 Kai，{{unknown}} 保留");
  });

  it("宏替换单次求值：name 中的 {{user}} 不被替换，也不二次扫描", () => {
    const result = assemblePrompt(
      baseInput({
        card: card({ name: "N{{user}}", description: "{{char}}!", scenario: "{{user}}" }),
        persona: { name: "Kai", description: "" },
      }),
    );
    const content = result.messages[0]?.content ?? "";
    expect(content).toContain("N{{user}}!"); // description 的 {{char}} → name 原文
    expect(content).toContain("\n\nKai"); // scenario 的 {{user}} → persona.name
  });

  it("greeting 与历史消息执行宏替换", () => {
    const result = assemblePrompt(
      baseInput({
        greeting: "你好 {{user}}",
        history: [{ id: "m1", role: "user", name: "Kai", content: "{{char}} 你好" }],
      }),
    );
    expect(result.messages[1]?.content).toBe("你好 Kai");
    expect(result.messages[2]?.content).toBe("Aria 你好");
  });
});

describe("assemblePrompt: PHI 与作者注（§3.5、§5.2）", () => {
  it("PHI 卡值覆盖全局，注入为末尾独立 system 消息", () => {
    const result = assemblePrompt(
      baseInput({
        globalPrompts: { main: "", postHistory: "G-PHI" },
        card: card({ postHistoryInstructions: "C-PHI" }),
      }),
    );
    const last = result.messages[result.messages.length - 1];
    expect(last).toEqual({ role: "system", content: "C-PHI" });
  });

  it("PHI 皆空时不注入", () => {
    const result = assemblePrompt(baseInput());
    const last = result.messages[result.messages.length - 1];
    expect(last?.role).toBe("assistant");
  });

  it("作者注 depth=2 落在倒数第 2 条消息之前", () => {
    const history = [
      { id: "m1", role: "user" as const, name: "Kai", content: "1" },
      { id: "m2", role: "assistant" as const, name: "Aria", content: "2" },
      { id: "m3", role: "user" as const, name: "Kai", content: "3" },
      { id: "m4", role: "assistant" as const, name: "Aria", content: "4" },
    ];
    // chat kept = [greeting, m1..m4]（len 5）；depth 2 → index 3
    const result = assemblePrompt(baseInput({ history, authorNote: { text: "AN", depth: 2 } }));

    expect(result.messages.map((m) => m.content)).toEqual([
      expect.any(String), // system
      "欢迎光临。", // greeting
      "1",
      "2",
      "AN",
      "3",
      "4",
    ]);
    expect(result.stats.tokensBySection.an).toBe(2);
  });

  it("作者注参与世界书扫描（§3.2：key 在 AN 中也能激活条目）", () => {
    const result = assemblePrompt(
      baseInput({
        authorNote: { text: "提醒 mention-key", depth: 0 },
        worldInfo: {
          books: [wiBook([wiEntry({ id: "x", keys: ["mention-key"], content: "X" })])],
          settings: { ...defaultWiSettings, scanDepth: 0 },
        },
      }),
    );
    expect(result.messages[0]?.content).toContain("X");
  });
});

describe("assemblePrompt: 世界书集成（§2.1 段 2/7 与 §5.2）", () => {
  it("beforeChar 注入在 main 之后、persona 之前", () => {
    const result = assemblePrompt(
      baseInput({
        worldInfo: {
          books: [
            wiBook([
              wiEntry({ id: "w1", constant: true, position: "beforeChar", content: "LORE" }),
            ]),
          ],
          settings: { ...defaultWiSettings },
        },
      }),
    );
    const sections = (result.messages[0]?.content ?? "").split("\n\n");
    expect(sections[1]).toBe("LORE");
    expect(result.stats.tokensBySection.wiBefore).toBe(4);
  });

  it("atDepth 注入按 (depth, role) 合并为消息", () => {
    const history = [
      { id: "m1", role: "user" as const, name: "Kai", content: "a" },
      { id: "m2", role: "assistant" as const, name: "Aria", content: "b" },
    ];
    const result = assemblePrompt(
      baseInput({
        greeting: null,
        history,
        worldInfo: {
          books: [
            wiBook([
              wiEntry({
                id: "d1",
                constant: true,
                position: "atDepth",
                depth: 2,
                role: "system",
                content: "P1",
                insertionOrder: 5,
              }),
              wiEntry({
                id: "d2",
                constant: true,
                position: "atDepth",
                depth: 2,
                role: "system",
                content: "P2",
                insertionOrder: 9,
              }),
            ]),
          ],
          settings: { ...defaultWiSettings },
        },
      }),
    );
    // chat kept=[m1,m2]；depth 2 → index 0；两条同 (2,system) 合并、order 升序
    // messages[0] 为 system 区消息（main/description 等）
    expect(result.messages[0]?.role).toBe("system");
    expect(result.messages[1]).toEqual({ role: "system", content: "P1\nP2" });
    expect(result.messages[2]?.content).toBe("a");
    expect(result.stats.tokensBySection["wiAtDepth:2:system"]).toBe(5);
  });
});

describe("assemblePrompt: 裁剪（§6.3）", () => {
  const twoExamples = card({
    mesExample: "<START>\nOLD-BLOCK\n<START>\nNEW-BLOCK",
  });

  function withHistory(n: number, size = 10) {
    return Array.from({ length: n }, (_, i) => ({
      id: `m${i + 1}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      name: "Kai",
      content: "x".repeat(size),
    }));
  }

  it("超预算先整块丢弃 examples（从最早块）", () => {
    // 先测全量保留时的总量，再回退 1 token 强制丢弃最早块
    const full = assemblePrompt(
      baseInput({ card: twoExamples, budget: { contextSize: 100000, reserveCompletion: 0 } }),
    ).stats.tokensTotal;

    const result = assemblePrompt(
      baseInput({
        card: twoExamples,
        budget: { contextSize: full - 1, reserveCompletion: 0 },
      }),
    );
    expect(result.stats.pruned.exampleBlocksDropped).toBe(1);
    expect(result.messages[0]?.content).not.toContain("OLD-BLOCK");
    expect(result.messages[0]?.content).toContain("NEW-BLOCK");
  });

  it("再丢弃最旧历史消息；greeting 与最后一条受保护", () => {
    const history = withHistory(4, 100);
    const full = assemblePrompt(
      baseInput({ history, budget: { contextSize: 100000, reserveCompletion: 0 } }),
    ).stats.tokensTotal;

    // 缺 150 → 必须丢弃 100×2 的两条最旧消息
    const result = assemblePrompt(
      baseInput({ history, budget: { contextSize: full - 150, reserveCompletion: 0 } }),
    );

    expect(result.stats.pruned.messagesDropped).toEqual(["m1", "m2"]);
    const contents = result.messages.map((m) => m.content);
    expect(contents).toContain("欢迎光临。"); // greeting 保留
    const keptLong = contents.filter((c) => c.length >= 100).length;
    expect(keptLong).toBe(2); // m3、m4 保留（m4 = 最后一条受保护）
  });

  it("固定段已超预算 → AssemblyError budget_exceeded（含明细）", () => {
    try {
      assemblePrompt(baseInput({ budget: { contextSize: 20, reserveCompletion: 0 } }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AssemblyError);
      const err = e as AssemblyError;
      expect(err.code).toBe("budget_exceeded");
      expect(err.sections.main).toBeGreaterThan(0);
    }
  });
});

describe("assemblePrompt: 标注义务（§4.3、§5.1、§6.4）", () => {
  it("估算 tokenizer → tokenizer.estimated=true 且 warnings 显式标注", () => {
    const result = assemblePrompt(
      baseInput({
        tokenizer: { id: "estimate:default", estimated: true, count: (t) => t.length },
      }),
    );
    expect(result.tokenizer).toEqual({ id: "estimate:default", estimated: true });
    expect(result.warnings).toContain("tokenizer_estimated:estimate:default");
  });

  it("greeting 缺失 → no_greeting 警告且历史照常", () => {
    const result = assemblePrompt(
      baseInput({
        greeting: null,
        history: [{ id: "m1", role: "user", name: "Kai", content: "hi" }],
      }),
    );
    expect(result.warnings).toContain("no_greeting");
    expect(result.messages[result.messages.length - 1]?.content).toBe("hi");
  });

  it("世界书 warnings 透传", () => {
    const result = assemblePrompt(
      baseInput({
        worldInfo: {
          books: [wiBook([wiEntry({ id: "an-top", constant: true, position: "anTop" })])],
          settings: { ...defaultWiSettings },
        },
      }),
    );
    expect(result.warnings.some((w) => w.startsWith("feature_unsupported:position"))).toBe(true);
  });

  it("stats.worldInfo 按输入书序映射 bookId", () => {
    const result = assemblePrompt(
      baseInput({
        worldInfo: {
          books: [
            wiBook([wiEntry({ id: "a", constant: true, content: "abc" })], {
              id: "b1",
              tokenBudget: 2,
            }),
            wiBook([wiEntry({ id: "b", constant: true, content: "abc" })], { id: "b2" }),
          ],
          settings: { ...defaultWiSettings },
        },
      }),
    );
    expect(result.stats.worldInfo.map((w) => w.bookId)).toEqual(["b1", "b2"]);
    expect(result.stats.worldInfo[0]?.droppedEntries).toEqual(["a"]);
  });
});
