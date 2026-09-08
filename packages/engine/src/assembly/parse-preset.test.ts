import { describe, expect, it } from "vitest";

import { parseOpenAiPreset, PresetParseError } from "./parse-preset.js";

/**
 * 社区格式样例：ST Chat Completion 预设（结构依据 ST release PromptManager.js
 * 默认 preset：prompts + prompt_order，含 sampler 参数与自定义 prompt）。
 */
const SAMPLE_PRESET = {
  temperature: 0.8,
  top_p: 0.95,
  openai_max_context: 8192,
  name: "My Preset",
  prompts: [
    {
      identifier: "main",
      name: "Main Prompt",
      role: "system",
      content: "自定义 main 文本",
      system_prompt: true,
      marker: false,
    },
    {
      identifier: "worldInfoBefore",
      name: "World Info (before)",
      system_prompt: true,
      marker: true,
    },
    {
      identifier: "personaDescription",
      name: "Persona Description",
      system_prompt: true,
      marker: true,
    },
    { identifier: "charDescription", name: "Char Description", system_prompt: true, marker: true },
    { identifier: "charPersonality", name: "Char Personality", system_prompt: true, marker: true },
    { identifier: "scenario", name: "Scenario", system_prompt: true, marker: true },
    {
      identifier: "enhanceDefinitions",
      name: "Enhance Definitions",
      role: "system",
      content: "增强文本",
      system_prompt: true,
      marker: false,
    },
    {
      identifier: "nsfw",
      name: "NSFW",
      role: "system",
      content: "",
      system_prompt: true,
      marker: false,
    },
    { identifier: "worldInfoAfter", name: "World Info (after)", system_prompt: true, marker: true },
    { identifier: "dialogueExamples", name: "Chat Examples", system_prompt: true, marker: true },
    { identifier: "chatHistory", name: "Chat History", system_prompt: true, marker: true },
    {
      identifier: "jailbreak",
      name: "Post-History Instructions",
      role: "system",
      content: "JAILBREAK-TEXT",
      system_prompt: true,
      marker: false,
    },
  ],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        { identifier: "main", enabled: true },
        { identifier: "worldInfoBefore", enabled: false },
        { identifier: "personaDescription", enabled: true },
        { identifier: "charDescription", enabled: true },
        { identifier: "charPersonality", enabled: true },
        { identifier: "scenario", enabled: true },
        { identifier: "enhanceDefinitions", enabled: true },
        { identifier: "nsfw", enabled: true },
        { identifier: "worldInfoAfter", enabled: true },
        { identifier: "dialogueExamples", enabled: true },
        { identifier: "chatHistory", enabled: true },
        { identifier: "jailbreak", enabled: false },
      ],
    },
  ],
};

describe("parseOpenAiPreset", () => {
  it("样例预设 → 槽位顺序/启停符合 prompt_order", () => {
    const { plan, warnings } = parseOpenAiPreset(SAMPLE_PRESET, "p1");

    const planWarnings = warnings.filter((w) => w.startsWith("plan_"));
    expect(planWarnings).toEqual([]);

    expect(plan.id).toBe("p1");
    expect(plan.name).toBe("My Preset");

    const byId = new Map(plan.systemSlots.map((s) => [s.id, s]));
    expect(byId.get("main")?.enabled).toBe(true);
    expect(byId.get("wiBefore")?.enabled).toBe(false);
    expect(byId.get("persona")?.enabled).toBe(true);

    expect(byId.get("main")?.order).toBe(10);
    expect(byId.get("persona")?.order).toBe(30);
    expect(byId.get("description")?.order).toBe(40);
    expect(byId.get("personality")?.order).toBe(50);
    expect(byId.get("scenario")?.order).toBe(60);
    expect(byId.get("wiAfter")?.order).toBe(90);
    expect(byId.get("examples")?.order).toBe(100);

    expect(plan.postHistory).toEqual({ enabled: false, position: "historyAfter" });
  });

  it("order 外的已知槽位 = 不发送（enabled=false）", () => {
    const preset = {
      prompts: [{ identifier: "main", marker: false }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
    };
    const { plan } = parseOpenAiPreset(preset);

    const byId = new Map(plan.systemSlots.map((s) => [s.id, s]));
    expect(byId.get("main")?.enabled).toBe(true);
    expect(byId.get("persona")?.enabled).toBe(false);
    expect(byId.get("examples")?.enabled).toBe(false);
    expect(plan.postHistory.enabled).toBe(false);
  });

  it("未知顶层字段（sampler 等）进 unknownFields；未映射 prompt 原样保留", () => {
    const { plan, warnings } = parseOpenAiPreset(SAMPLE_PRESET);

    expect(plan.unknownFields.temperature).toBe(0.8);
    expect(plan.unknownFields.top_p).toBe(0.95);
    expect(plan.unknownFields.openai_max_context).toBe(8192);

    const unmapped = plan.extensions.unmappedPrompts as Array<{ identifier: string }>;
    expect(unmapped.map((p) => p.identifier).sort()).toEqual(["enhanceDefinitions", "nsfw"]);
    expect(warnings).toContain("feature_unsupported:prompt:enhanceDefinitions");
    expect(warnings).toContain("feature_unsupported:prompt:nsfw");
  });

  it("已映射槽位与 jailbreak 的自定义 content：保留进 extensions 并告警", () => {
    const { plan, warnings } = parseOpenAiPreset(SAMPLE_PRESET);

    expect(plan.extensions.customPromptTexts).toEqual({
      main: "自定义 main 文本",
      jailbreak: "JAILBREAK-TEXT",
    });
    expect(warnings).toContain("feature_unsupported:prompt_content:main");
    expect(warnings).toContain("feature_unsupported:prompt_content:jailbreak");
  });

  it("接受 JSON 字符串；非对象 → preset_not_object；坏 JSON → preset_parse_failed", () => {
    expect(parseOpenAiPreset(JSON.stringify(SAMPLE_PRESET)).plan.name).toBe("My Preset");
    try {
      parseOpenAiPreset(42);
      expect.unreachable();
    } catch (e) {
      expect((e as PresetParseError).code).toBe("preset_not_object");
    }
    try {
      parseOpenAiPreset("{ bad");
      expect.unreachable();
    } catch (e) {
      expect((e as PresetParseError).code).toBe("preset_parse_failed");
    }
  });
});
