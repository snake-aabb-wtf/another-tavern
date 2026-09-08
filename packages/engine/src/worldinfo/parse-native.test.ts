import { describe, expect, it } from "vitest";

import { parseSillyTavernWorldInfo, WorldInfoParseError } from "./parse-native.js";

/**
 * 社区格式样例：ST 原生 World Info JSON（entries 为 uid→条目字典；
 * key 为字符串数组；position 为数字编码；disable 为 enabled 的反义）。
 */
const SAMPLE_BOOK = {
  name: "My Lorebook",
  entries: {
    "0": {
      uid: 0,
      key: ["dragon", "wyrm"],
      keysecondary: ["fire"],
      comment: "Dragons",
      content: "Dragons hoard gold.",
      constant: false,
      selective: true,
      selectiveLogic: 0,
      order: 100,
      position: 0,
      disable: false,
      excludeRecursion: false,
      preventRecursion: false,
      scanDepth: 3,
      caseSensitive: null,
      matchWholeWords: true,
      probability: 100,
      useProbability: true,
      group: "",
      sticky: null,
      automationId: "",
    },
    "1": {
      uid: 1,
      key: "tavern, inn",
      keysecondary: [],
      comment: "The inn",
      content: "The inn has no electricity.",
      constant: true,
      selective: false,
      order: 50,
      position: 4,
      depth: 2,
      role: 1,
      disable: true,
      excludeRecursion: true,
      preventRecursion: false,
      someFutureField: { keep: true },
    },
  },
};

describe("parseSillyTavernWorldInfo", () => {
  it("样例世界书 → 引擎条目（键/逻辑/位置/递归/三态）", () => {
    const { book, warnings } = parseSillyTavernWorldInfo(SAMPLE_BOOK, "lb1");

    expect(warnings).toEqual([]);
    expect(book.id).toBe("lb1");
    expect(book.name).toBe("My Lorebook");
    expect(book.entries).toHaveLength(2);

    const dragon = book.entries[0];
    expect(dragon?.id).toBe("0");
    expect(dragon?.keys).toEqual(["dragon", "wyrm"]);
    expect(dragon?.secondaryKeys).toEqual(["fire"]);
    expect(dragon?.selective).toBe(true);
    expect(dragon?.logic).toBe("andAny");
    expect(dragon?.position).toBe("beforeChar");
    expect(dragon?.scanDepth).toBe(3);
    expect(dragon?.matchWholeWords).toBe(true);
    expect(dragon?.caseSensitive).toBeNull();
    expect(dragon?.enabled).toBe(true);

    const inn = book.entries[1];
    // key 字符串（逗号分隔）→ 数组
    expect(inn?.keys).toEqual(["tavern", "inn"]);
    // disable: true → enabled: false
    expect(inn?.enabled).toBe(false);
    // position 4 = atDepth；depth=2；role 1 = user
    expect(inn?.position).toBe("atDepth");
    expect(inn?.depth).toBe(2);
    expect(inn?.role).toBe("user");
    expect(inn?.constant).toBe(true);
    expect(inn?.excludeRecursion).toBe(true);
    expect(inn?.insertionOrder).toBe(50);
  });

  it("未实现特性与未知字段原样保留进 extensions", () => {
    const { book } = parseSillyTavernWorldInfo(SAMPLE_BOOK, "lb1");

    const dragon = book.entries[0];
    // probability/useProbability/sticky/automationId：不映射但保留
    expect(dragon?.extensions.probability).toBe(100);
    expect(dragon?.extensions.useProbability).toBe(true);
    expect(dragon?.extensions.sticky).toBeNull();
    expect(dragon?.extensions.automationId).toBe("");

    const inn = book.entries[1];
    expect(inn?.extensions.someFutureField).toEqual({ keep: true });
  });

  it("非法 position/selectiveLogic → 回退默认 + 告警；uid 缺失 → 生成稳定 id", () => {
    const sample = {
      entries: [
        { key: ["k"], content: "c", position: 99, selectiveLogic: 42 },
        { key: ["k2"], content: "c2" },
      ],
    };
    const { book, warnings } = parseSillyTavernWorldInfo(sample, "lb2");

    const first = book.entries[0];
    expect(first?.position).toBe("afterChar");
    expect(first?.logic).toBe("andAny");
    expect(warnings.some((w) => w.code === "entry_position_invalid")).toBe(true);
    expect(warnings.some((w) => w.code === "entry_selective_logic_invalid")).toBe(true);
    // entries 为数组形态（无 uid）→ 按 index 生成 id
    expect(first?.id).toBe("lb2:0");
    expect(book.entries[1]?.id).toBe("lb2:1");
  });

  it("非 JSON 字符串 / 非对象 / entries 缺失 → 结构级错误", () => {
    try {
      parseSillyTavernWorldInfo("{ bad");
      expect.unreachable();
    } catch (e) {
      expect((e as WorldInfoParseError).code).toBe("worldinfo_parse_failed");
    }
    try {
      parseSillyTavernWorldInfo(42);
      expect.unreachable();
    } catch (e) {
      expect((e as WorldInfoParseError).code).toBe("worldinfo_not_object");
    }
    try {
      parseSillyTavernWorldInfo({ name: "no entries here" });
      expect.unreachable();
    } catch (e) {
      expect((e as WorldInfoParseError).code).toBe("worldinfo_entries_invalid");
    }
  });
});
