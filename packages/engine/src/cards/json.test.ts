import { describe, expect, it } from "vitest";

import { CardParseError, parseCharacterCardJson } from "./json.js";

/** 构造一张字段完整的 V2 data。 */
function fullData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Aria",
    description: "旅店管理员。",
    personality: "冷静。",
    scenario: "雨夜。",
    first_mes: "欢迎光临。",
    mes_example: "<START>\n{{user}}: 你好",
    creator_notes: "notes",
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: ["备选开场"],
    tags: ["fantasy"],
    creator: "dev",
    character_version: "1.0",
    extensions: {},
    ...overrides,
  };
}

function v2(doc: Record<string, unknown> = {}): Record<string, unknown> {
  return { spec: "chara_card_v2", spec_version: "2.0", data: fullData(doc) };
}

describe("parseCharacterCardJson: V2 基线", () => {
  it("解析字段完整的 V2 卡，无警告", () => {
    const { card, warnings } = parseCharacterCardJson(v2());

    expect(warnings).toEqual([]);
    expect(card.sourceSpec).toBe("chara_card_v2");
    expect(card.name).toBe("Aria");
    expect(card.firstMes).toBe("欢迎光临。");
    expect(card.alternateGreetings).toEqual(["备选开场"]);
    expect(card.tags).toEqual(["fantasy"]);
    expect(card.characterBook).toBeNull();
  });

  it("接受 JSON 字符串输入", () => {
    const { card } = parseCharacterCardJson(JSON.stringify(v2()));

    expect(card.name).toBe("Aria");
  });

  it("无 spec 的裸 data 形态 → 按 V2 处理并告警 spec_missing", () => {
    const { card, warnings } = parseCharacterCardJson({ data: fullData() });

    expect(card.name).toBe("Aria");
    expect(warnings.map((w) => w.code)).toContain("spec_missing");
  });

  it("spec_version 非 2.0 但 spec 为 v2 → 宽容处理 + 告警", () => {
    const doc = { spec: "chara_card_v2", spec_version: "2.1", data: fullData() };
    const { card, warnings } = parseCharacterCardJson(doc);

    expect(card.name).toBe("Aria");
    expect(warnings.map((w) => w.code)).toContain("spec_version_unexpected");
  });

  it("spec 为 chara_card_v3 → 硬错误 spec_unsupported", () => {
    const doc = { spec: "chara_card_v3", spec_version: "3.0", data: fullData() };

    expect(() => parseCharacterCardJson(doc)).toThrowError(CardParseError);
    try {
      parseCharacterCardJson(doc);
    } catch (e) {
      expect((e as CardParseError).code).toBe("spec_unsupported");
    }
  });

  it("v2 但 data 非对象 → 硬错误 card_data_invalid", () => {
    expect(() => parseCharacterCardJson({ spec: "chara_card_v2", data: "x" })).toThrowError(
      CardParseError,
    );
  });
});

describe("parseCharacterCardJson: 宽容导入", () => {
  it("缺失字符串字段 → 补空串 + field_missing 告警", () => {
    const { card, warnings } = parseCharacterCardJson({ name: "OnlyName" });

    expect(card.description).toBe("");
    expect(card.personality).toBe("");
    const missing = warnings.filter((w) => w.code === "field_missing");
    expect(missing.some((w) => w.path === "description")).toBe(true);
    expect(missing.some((w) => w.path === "first_mes")).toBe(true);
  });

  it("字段类型不符 → 回退默认 + field_type_mismatch 告警", () => {
    const { card, warnings } = parseCharacterCardJson(v2({ first_mes: 42 }));

    expect(card.firstMes).toBe("");
    const w = warnings.find((x) => x.path === "first_mes");
    expect(w?.code).toBe("field_type_mismatch");
  });

  it("alternate_greetings 为字符串 → 包装为单项数组 + 告警", () => {
    const { card, warnings } = parseCharacterCardJson(v2({ alternate_greetings: "单个开场" }));

    expect(card.alternateGreetings).toEqual(["单个开场"]);
    expect(warnings.map((w) => w.code)).toContain("alternate_greetings_normalized");
  });

  it("alternate_greetings 数组含非字符串项 → 过滤 + 告警", () => {
    const { card, warnings } = parseCharacterCardJson(v2({ alternate_greetings: [1, "ok"] }));

    expect(card.alternateGreetings).toEqual(["ok"]);
    expect(warnings.some((w) => w.code === "alternate_greetings_normalized")).toBe(true);
  });

  it("非对象输入 → 硬错误 json_not_object", () => {
    try {
      parseCharacterCardJson(42);
      expect.unreachable();
    } catch (e) {
      expect((e as CardParseError).code).toBe("json_not_object");
    }
  });

  it("非法 JSON 字符串 → json_parse_failed", () => {
    try {
      parseCharacterCardJson("{ not json");
      expect.unreachable();
    } catch (e) {
      expect((e as CardParseError).code).toBe("json_parse_failed");
    }
  });
});

describe("parseCharacterCardJson: V1 兼容", () => {
  it("V1 平铺六字段 → 升级为 V2 语义 + v1_imported 告警", () => {
    const doc = {
      name: "OldCard",
      description: "d",
      personality: "p",
      scenario: "s",
      first_mes: "f",
      mes_example: "<START>\n",
    };
    const { card, warnings } = parseCharacterCardJson(doc);

    expect(card.sourceSpec).toBe("chara_card_v1");
    expect(card.specVersion).toBe("2.0");
    expect(card.name).toBe("OldCard");
    expect(card.systemPrompt).toBe("");
    expect(card.alternateGreetings).toEqual([]);
    expect(warnings.map((w) => w.code)).toContain("v1_imported");
  });

  it("无任何已知字段的对象 → 按 V1 空卡解析（全默认值）", () => {
    const { card } = parseCharacterCardJson({ some_tool_field: 1 });

    expect(card.name).toBe("");
    expect(card.unknownFields.some_tool_field).toBe(1);
  });
});

describe("parseCharacterCardJson: 未知字段保留（不销毁）", () => {
  it("data 顶层未知字段进 unknownFields；extensions 未知键原样", () => {
    const { card } = parseCharacterCardJson(
      v2({ shop: { price: 5 }, extensions: { my_tool: { keep: true } } }),
    );

    expect(card.unknownFields.shop).toEqual({ price: 5 });
    expect(card.extensions.my_tool).toEqual({ keep: true });
  });
});

describe("parseCharacterCardJson: character_book 映射（world-info-spec §8）", () => {
  const bookEntry = {
    keys: ["Aria"],
    content: "c",
    extensions: {},
    enabled: true,
    insertion_order: 10,
    case_sensitive: false,
    name: "",
    priority: 0,
    id: 1,
    comment: "",
    selective: false,
    secondary_keys: [],
    constant: false,
    position: "before_char" as const,
  };

  it("顶层字段与 entry V2 字段直映", () => {
    const { card, warnings } = parseCharacterCardJson(
      v2({
        character_book: {
          name: "book",
          description: "desc",
          scan_depth: 3,
          token_budget: 512,
          recursive_scanning: true,
          extensions: {},
          entries: [bookEntry],
        },
      }),
    );

    expect(warnings.filter((w) => w.code !== "spec_missing")).toEqual([]);
    expect(card.characterBook?.name).toBe("book");
    expect(card.characterBook?.scanDepth).toBe(3);
    expect(card.characterBook?.tokenBudget).toBe(512);
    expect(card.characterBook?.recursiveScanning).toBe(true);
    const entry = card.characterBook?.entries[0];
    expect(entry?.id).toBe("1");
    expect(entry?.keys).toEqual(["Aria"]);
    expect(entry?.position).toBe("beforeChar");
    expect(entry?.insertionOrder).toBe(10);
    expect(entry?.caseSensitive).toBe(false);
    expect(entry?.selective).toBe(false);
    expect(entry?.depth).toBeNull();
  });

  it("entry 缺省值：enabled=true、order=100、position=afterChar", () => {
    const { card } = parseCharacterCardJson(
      v2({ character_book: { extensions: {}, entries: [{ keys: ["k"], content: "c" }] } }),
    );

    const entry = card.characterBook?.entries[0];
    expect(entry?.enabled).toBe(true);
    expect(entry?.insertionOrder).toBe(100);
    expect(entry?.position).toBe("afterChar");
    expect(entry?.constant).toBe(false);
    expect(entry?.logic).toBe("andAny");
  });

  it("extensions.position 数字覆盖 V2 字符串 position", () => {
    const { card } = parseCharacterCardJson(
      v2({
        character_book: {
          extensions: {},
          entries: [
            { keys: ["k"], content: "c", position: "before_char", extensions: { position: 4 } },
          ],
        },
      }),
    );

    expect(card.characterBook?.entries[0]?.position).toBe("atDepth");
  });

  it("extensions 已知键展开：depth/role/scan_depth/match_whole_words/递归开关", () => {
    const { card } = parseCharacterCardJson(
      v2({
        character_book: {
          extensions: {},
          entries: [
            {
              keys: ["k"],
              content: "c",
              extensions: {
                position: 4,
                depth: 2,
                role: 1,
                scan_depth: 5,
                match_whole_words: true,
                case_sensitive: true,
                prevent_recursion: true,
                exclude_recursion: true,
                selective_logic: 3,
              },
            },
          ],
        },
      }),
    );

    const entry = card.characterBook?.entries[0];
    expect(entry?.depth).toBe(2);
    expect(entry?.role).toBe("user");
    expect(entry?.scanDepth).toBe(5);
    expect(entry?.matchWholeWords).toBe(true);
    expect(entry?.caseSensitive).toBe(true);
    expect(entry?.preventRecursion).toBe(true);
    expect(entry?.excludeRecursion).toBe(true);
    expect(entry?.logic).toBe("andAll");
    // 已消费键仍保留在 extensions 中（不销毁原则）
    expect(entry?.extensions.position).toBe(4);
  });

  it("未支持 ST 扩展键原样留在 extensions，不映射不丢弃", () => {
    const { card } = parseCharacterCardJson(
      v2({
        character_book: {
          extensions: {},
          entries: [
            {
              keys: ["k"],
              content: "c",
              extensions: { probability: 50, sticky: 3, automation_id: "x" },
            },
          ],
        },
      }),
    );

    const entry = card.characterBook?.entries[0];
    expect(entry?.extensions.probability).toBe(50);
    expect(entry?.extensions.sticky).toBe(3);
  });

  it("entries 非数组 → 空数组 + 告警；character_book 非对象 → 进 unknownFields + 告警", () => {
    const bad = parseCharacterCardJson(v2({ character_book: { extensions: {}, entries: "nope" } }));
    expect(bad.card.characterBook?.entries).toEqual([]);
    expect(bad.warnings.some((w) => w.code === "book_entries_invalid")).toBe(true);

    const worse = parseCharacterCardJson(v2({ character_book: "junk" }));
    expect(worse.card.characterBook).toBeNull();
    expect(worse.card.unknownFields.character_book).toBe("junk");
    expect(worse.warnings.some((w) => w.code === "field_type_mismatch")).toBe(true);
  });

  it("非法 role / position / selective_logic 数值 → 回退默认 + 告警", () => {
    const { card, warnings } = parseCharacterCardJson(
      v2({
        character_book: {
          extensions: {},
          entries: [
            {
              keys: ["k"],
              content: "c",
              extensions: { position: 99, role: 42, selective_logic: 7 },
            },
          ],
        },
      }),
    );

    const entry = card.characterBook?.entries[0];
    expect(entry?.position).toBe("afterChar");
    expect(entry?.role).toBeNull();
    expect(entry?.logic).toBe("andAny");
    expect(warnings.filter((w) => w.code.startsWith("entry_")).length).toBeGreaterThanOrEqual(3);
  });
});
