import { describe, expect, it } from "vitest";

import type { CharacterCard } from "../cards/model.js";
import type { Tokenizer } from "../tokenizer/tokenizer.js";
import { assemblePrompt, type AssemblyInput } from "./assemble.js";
import { defaultAssemblyPlan, normalizePlan } from "./plan.js";

const tokenizer: Tokenizer = { id: "test:char", estimated: false, count: (t) => t.length };

function card(): CharacterCard {
  return {
    sourceSpec: "chara_card_v2",
    specVersion: "2.0",
    name: "Aria",
    description: "DESC",
    personality: "PERS",
    scenario: "SCEN",
    firstMes: "GREET",
    mesExample: "",
    creatorNotes: "",
    systemPrompt: "",
    postHistoryInstructions: "PHI",
    alternateGreetings: [],
    tags: [],
    creator: "",
    characterVersion: "",
    characterBook: null,
    extensions: {},
    unknownFields: {},
  };
}

function baseInput(over: Partial<AssemblyInput> = {}): AssemblyInput {
  return {
    card: card(),
    persona: { name: "Kai", description: "PERSONA" },
    history: [],
    greeting: "GREET",
    globalPrompts: { main: "MAIN", postHistory: "GLOBAL-PHI" },
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
    budget: { contextSize: 100000, reserveCompletion: 0 },
    tokenizer,
    ...over,
  };
}

describe("AssemblyPlan：零行为变化（缺省 = docs §2.1 固定序）", () => {
  it("不传 plan 与显式默认计划的输出逐位相同", () => {
    const without = assemblePrompt(baseInput());
    const withDefault = assemblePrompt(baseInput({ plan: defaultAssemblyPlan() }));

    expect(withDefault.messages).toEqual(without.messages);
    expect(withDefault.stats.tokensBySection).toEqual(without.stats.tokensBySection);
  });

  it("normalizePlan(默认计划) 往返稳定", () => {
    const normalized = normalizePlan(defaultAssemblyPlan());

    expect(normalized.warnings).toEqual([]);
    expect(normalized.plan.systemSlots.map((s) => s.id)).toEqual([
      "main",
      "wiBefore",
      "persona",
      "description",
      "personality",
      "scenario",
      "wiAfter",
      "examples",
    ]);
  });
});

describe("AssemblyPlan：顺序与启停", () => {
  it("自定义顺序：scenario 提到最前、persona 移到最后", () => {
    const plan = defaultAssemblyPlan();
    const scenario = plan.systemSlots.find((s) => s.id === "scenario");
    const persona = plan.systemSlots.find((s) => s.id === "persona");
    if (scenario === undefined || persona === undefined) {
      expect.unreachable();
    }
    scenario.order = 5;
    persona.order = 95;

    const result = assemblePrompt(baseInput({ plan }));
    const sections = (result.messages[0]?.content ?? "").split("\n\n");
    expect(sections[0]).toBe("SCEN");
    expect(sections.at(-1)).toBe("PERSONA");
  });

  it("禁用槽位：内容不注入、统计不计数", () => {
    const plan = defaultAssemblyPlan();
    const persona = plan.systemSlots.find((s) => s.id === "persona");
    if (persona === undefined) {
      expect.unreachable();
    }
    persona.enabled = false;

    const result = assemblePrompt(baseInput({ plan }));
    expect(result.messages[0]?.content).not.toContain("PERSONA");
    expect(result.stats.tokensBySection.persona).toBeUndefined();
  });

  it("postHistory.enabled=false：PHI 不注入", () => {
    const plan = {
      ...defaultAssemblyPlan(),
      postHistory: { enabled: false, position: "historyAfter" as const },
    };
    const result = assemblePrompt(baseInput({ plan }));

    const last = result.messages.at(-1);
    expect(last?.role).toBe("assistant");
    expect(result.messages.some((m) => m.content.includes("PHI"))).toBe(false);
    expect(result.stats.tokensBySection.phi).toBeUndefined();
  });

  it("默认计划下 PHI 保持历史后注入（对照行为不变）", () => {
    const result = assemblePrompt(baseInput({ plan: defaultAssemblyPlan() }));
    const last = result.messages.at(-1);
    expect(last).toEqual({ role: "system", content: "PHI" });
  });
});

describe("normalizePlan：宽容规范化", () => {
  it("未知槽 id 告警并忽略；缺失槽位按默认序补齐并启用", () => {
    const { plan, warnings } = normalizePlan({
      id: "p1",
      name: "test",
      systemSlots: [
        { id: "main", enabled: false, order: 10 },
        { id: "unknownSlot", enabled: true, order: 20 },
        { id: "scenario", enabled: true, order: 30 },
      ],
      postHistory: { enabled: true, position: "historyAfter" },
      extensions: {},
    });

    expect(warnings).toContain("plan_unknown_slot:unknownSlot");
    const byId = new Map(plan.systemSlots.map((s) => [s.id, s]));
    expect(byId.get("main")?.enabled).toBe(false);
    expect(byId.get("scenario")?.order).toBe(30);
    expect(byId.get("wiBefore")?.enabled).toBe(true); // 缺失补默认
    expect(plan.systemSlots).toHaveLength(8);
  });

  it("重复槽位告警去重；非法 root 回退默认计划", () => {
    const dup = normalizePlan({
      systemSlots: [
        { id: "main", enabled: true, order: 10 },
        { id: "main", enabled: false, order: 20 },
      ],
    });
    expect(dup.warnings).toContain("plan_duplicate_slot:main");
    expect(dup.plan.systemSlots.filter((s) => s.id === "main")).toHaveLength(1);

    const bad = normalizePlan(42);
    expect(bad.warnings).toContain("plan_invalid:root");
    expect(bad.plan.systemSlots).toHaveLength(8);
  });

  it("未知 postHistory.position 告警并回退 historyAfter", () => {
    const { plan, warnings } = normalizePlan({
      postHistory: { enabled: true, position: "inChat" },
    });

    expect(warnings.some((w) => w.startsWith("plan_unknown_post_history_position"))).toBe(true);
    expect(plan.postHistory.position).toBe("historyAfter");
  });

  it("未知顶层字段进 unknownFields", () => {
    const { plan } = normalizePlan({
      name: "x",
      sampler: { temperature: 0.7 },
      systemSlots: [],
      postHistory: { enabled: true, position: "historyAfter" },
      extensions: {},
    });

    expect(plan.unknownFields.sampler).toEqual({ temperature: 0.7 });
  });

  it("M6：槽位 source/content 规范化——缺省补 default，非法 source 回退", () => {
    const { plan } = normalizePlan({
      systemSlots: [
        { id: "main", enabled: true, order: 10, source: "custom", content: "自定义 {{char}}" },
        { id: "scenario", enabled: true, order: 20, source: "weird", content: "被忽略" },
      ],
    });

    const byId = new Map(plan.systemSlots.map((s) => [s.id, s]));
    expect(byId.get("main")?.source).toBe("custom");
    expect(byId.get("main")?.content).toBe("自定义 {{char}}");
    expect(byId.get("scenario")?.source).toBe("default");
    expect(byId.get("scenario")?.content).toBe("");
  });
});

describe("AssemblyPlan：自定义槽位内容来源（M6）", () => {
  it("source=custom 的槽注入计划文本并做宏替换", () => {
    const plan = defaultAssemblyPlan();
    const scenario = plan.systemSlots.find((s) => s.id === "scenario");
    if (scenario === undefined) {
      expect.unreachable();
    }
    scenario.source = "custom";
    scenario.content = "场景：{{user}} 到达。";

    const result = assemblePrompt(baseInput({ plan }));
    const content = result.messages[0]?.content ?? "";
    expect(content).toContain("场景：Kai 到达。");
    expect(content).not.toContain("SCEN");
  });

  it("source=default 的槽保持固定来源（行为不变）", () => {
    const result = assemblePrompt(baseInput({ plan: defaultAssemblyPlan() }));
    expect(result.messages[0]?.content).toContain("SCEN");
  });

  it("custom 空文本 = 段为空（跳过）", () => {
    const plan = defaultAssemblyPlan();
    const personality = plan.systemSlots.find((s) => s.id === "personality");
    if (personality === undefined) {
      expect.unreachable();
    }
    personality.source = "custom";
    personality.content = "";

    const result = assemblePrompt(baseInput({ plan }));
    const sections = (result.messages[0]?.content ?? "").split("\n\n");
    expect(sections).not.toContain("PERS"); // personality 段为空被跳过
    expect(sections).toContain("PERSONA"); // persona 段不受影响
    expect(result.stats.tokensBySection.personality).toBeUndefined();
  });
});
