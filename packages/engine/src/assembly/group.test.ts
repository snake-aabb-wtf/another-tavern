import { describe, expect, it } from "vitest";

import type { CharacterCard } from "../cards/model.js";
import { createEstimateTokenizer } from "../tokenizer/estimate.js";
import { assemblePrompt, type AssemblyInput } from "./assemble.js";

function card(name: string, description: string): CharacterCard {
  return {
    sourceSpec: "chara_card_v2",
    specVersion: "2.0",
    name,
    description,
    personality: `${name} personality`,
    scenario: `${name} scenario`,
    firstMes: `${name} greeting`,
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
  };
}

function input(over: Partial<AssemblyInput> = {}): AssemblyInput {
  const aria = card("Aria", "Aria description");
  const lisa = card("Lisa", "Lisa secret description");
  return {
    card: aria,
    persona: { name: "User", description: "旅人。" },
    history: [
      { id: "u1", role: "user", name: "User", content: "你好。" },
      { id: "a1", role: "assistant", name: "Lisa", speakerId: "lisa", content: "欢迎。" },
    ],
    greeting: "Aria greeting",
    globalPrompts: { main: "", postHistory: "" },
    authorNote: null,
    worldInfo: {
      books: [],
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
    budget: { contextSize: 100000, reserveCompletion: 300 },
    tokenizer: createEstimateTokenizer(),
    group: {
      activeCharacterId: "aria",
      participants: [
        { id: "aria", card: aria, muted: false },
        { id: "lisa", card: lisa, muted: false },
      ],
      generationMode: "swap",
      scenarioOverride: "共同调查一座废弃神殿。",
    },
    ...over,
  };
}

describe("assemblePrompt: group swap mode", () => {
  it("只使用当前角色卡，并注入群聊身份指令与场景覆盖", () => {
    const result = assemblePrompt(input());
    const system = result.messages[0]?.content ?? "";

    expect(system).toContain("You are currently speaking as Aria.");
    expect(system).toContain("This is a group conversation with: Aria, Lisa.");
    expect(system).toContain("共同调查一座废弃神殿。");
    expect(system).toContain("Aria description");
    expect(system).not.toContain("Lisa secret description");
  });

  it("为共享历史加上角色身份前缀，单聊消息格式保持可读", () => {
    const result = assemblePrompt(input());
    expect(result.messages.map((message) => message.content)).toEqual([
      expect.any(String),
      "Aria: Aria greeting",
      "User: 你好。",
      "Lisa: 欢迎。",
    ]);
  });

  it("不传 group 时不改变既有单聊消息内容", () => {
    const singleInput = input();
    delete singleInput.group;
    const result = assemblePrompt(singleInput);
    expect(result.messages.map((message) => message.content)).toEqual([
      expect.any(String),
      "Aria greeting",
      "你好。",
      "欢迎。",
    ]);
  });
});
