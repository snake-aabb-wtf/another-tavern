import { describe, expect, it } from "vitest";

import type { ResolveWorldInfoInput, ResolveWorldInfoResult } from "./resolve.js";
import { resolveWorldInfo } from "./resolve.js";
import type { WorldInfoBook, WorldInfoEntry } from "./model.js";

function entry(over: Partial<WorldInfoEntry> = {}): WorldInfoEntry {
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
    id: "b",
    name: "test",
    description: null,
    scanDepth: null,
    tokenBudget: null,
    recursiveScanning: null,
    entries,
    extensions: {},
    ...over,
  };
}

function msg(content: string, over: { name?: string; role?: "user" | "assistant" } = {}) {
  return { role: over.role ?? ("user" as const), name: over.name ?? "Kai", content };
}

function input(over: Partial<ResolveWorldInfoInput>): ResolveWorldInfoInput {
  return {
    books: [],
    chatHistory: [],
    authorNote: null,
    settings: {
      scanDepth: 2,
      includeNames: true,
      caseSensitive: false,
      matchWholeWords: false,
      recursiveScanning: false,
      maxRecursionSteps: 0,
      contextSize: 10000,
      wiBudgetPercent: 25,
    },
    // 长度计数，预算测试直观
    countTokens: (text: string) => text.length,
    ...over,
  };
}

function flat(result: ResolveWorldInfoResult): string[] {
  return [
    ...result.byPosition.beforeChar.map((i) => i.entryId),
    ...result.byPosition.afterChar.map((i) => i.entryId),
    ...result.byPosition.atDepth.map((i) => i.entryId),
  ];
}

describe("resolveWorldInfo: 基础激活", () => {
  it("主关键词任一命中即激活；无命中不激活", () => {
    const result = resolveWorldInfo(
      input({
        books: [
          book([entry({ id: "hit", keys: ["猫", "狗"] }), entry({ id: "miss", keys: ["龙"] })]),
        ],
        chatHistory: [msg("我养了一只猫")],
      }),
    );

    expect(flat(result)).toEqual(["hit"]);
    expect(result.byPosition.afterChar[0]?.activation).toBe("keyword");
  });

  it("enabled=false 完全不参与", () => {
    const result = resolveWorldInfo(
      input({
        books: [book([entry({ id: "off", keys: ["猫"], enabled: false })])],
        chatHistory: [msg("猫")],
      }),
    );

    expect(flat(result)).toEqual([]);
  });

  it("constant 常驻：无历史也激活", () => {
    const result = resolveWorldInfo(
      input({ books: [book([entry({ id: "always", constant: true, content: "x" })])] }),
    );

    expect(flat(result)).toEqual(["always"]);
    expect(result.byPosition.afterChar[0]?.activation).toBe("constant");
  });

  it("空 keys 且非 constant → 永不激活", () => {
    const result = resolveWorldInfo(
      input({ books: [book([entry({ id: "nokey", keys: [] })])], chatHistory: [msg("anything")] }),
    );

    expect(flat(result)).toEqual([]);
  });

  it("空 content 条目：激活但注入跳过并告警", () => {
    const result = resolveWorldInfo(
      input({ books: [book([entry({ id: "empty", constant: true, content: "" })])] }),
    );

    expect(flat(result)).toEqual([]);
    expect(result.warnings).toContain("empty_content_skipped:empty");
  });
});

describe("resolveWorldInfo: 扫描深度", () => {
  const history = [msg("第一 mention-A"), msg("第二 mention-B"), msg("第三 mention-C")];

  it("scanDepth=1 只扫最后一条", () => {
    const result = resolveWorldInfo(
      input({
        books: [
          book([entry({ id: "a", keys: ["mention-A"] }), entry({ id: "c", keys: ["mention-C"] })]),
        ],
        chatHistory: history,
        settings: { ...input({}).settings, scanDepth: 1 },
      }),
    );

    expect(flat(result)).toEqual(["c"]);
  });

  it("scanDepth=2 扫最后两条", () => {
    const result = resolveWorldInfo(
      input({
        books: [book([entry({ id: "b", keys: ["mention-B"] })])],
        chatHistory: history,
      }),
    );

    expect(flat(result)).toEqual(["b"]);
  });

  it("scanDepth=0 不扫聊天但作者注参与", () => {
    const result = resolveWorldInfo(
      input({
        books: [
          book([
            entry({ id: "from-an", keys: ["提醒"] }),
            entry({ id: "from-chat", keys: ["mention-C"] }),
          ]),
        ],
        chatHistory: history,
        authorNote: "写作提醒",
        settings: { ...input({}).settings, scanDepth: 0 },
      }),
    );

    expect(flat(result)).toEqual(["from-an"]);
  });

  it("条目级 scanDepth 覆盖书级、书级覆盖全局", () => {
    const result = resolveWorldInfo(
      input({
        books: [
          book(
            [
              entry({ id: "deep", keys: ["mention-A"], scanDepth: 3 }),
              entry({ id: "bookdefault", keys: ["mention-B"] }),
            ],
            { scanDepth: 2 },
          ),
        ],
        chatHistory: history,
        settings: { ...input({}).settings, scanDepth: 1 },
      }),
    );

    expect(flat(result)).toEqual(["bookdefault", "deep"]);
  });
});

describe("resolveWorldInfo: 匹配规则", () => {
  it("大小写不敏感为默认；caseSensitive 覆盖后敏感", () => {
    const base = {
      books: [book([entry({ id: "ci", keys: ["rose"] })])],
      chatHistory: [msg("I see a Rose")],
    };
    expect(flat(resolveWorldInfo(input(base)))).toEqual(["ci"]);

    const sensitive = resolveWorldInfo(
      input({
        ...base,
        books: [book([entry({ id: "cs", keys: ["rose"], caseSensitive: true })])],
      }),
    );
    expect(flat(sensitive)).toEqual([]);
  });

  it("整词匹配开启时 king 不命中 liking，关闭时命中", () => {
    const base = {
      books: [book([entry({ id: "w", keys: ["king"] })])],
      chatHistory: [msg("to my liking")],
    };
    const off = resolveWorldInfo(input(base));
    expect(flat(off)).toEqual(["w"]);

    const on = resolveWorldInfo(
      input({
        ...base,
        settings: { ...input({}).settings, matchWholeWords: true },
      }),
    );
    expect(flat(on)).toEqual([]);
  });

  it("含空格的 key 无视整词开关", () => {
    const on = resolveWorldInfo(
      input({
        books: [book([entry({ id: "p", keys: ["long live"] })])],
        chatHistory: [msg("the man said long live queen")],
        settings: { ...input({}).settings, matchWholeWords: true },
      }),
    );
    expect(flat(on)).toEqual(["p"]);
  });

  it("includeNames 前缀参与匹配（角色名做关键词）", () => {
    const on = resolveWorldInfo(
      input({
        books: [book([entry({ id: "name", keys: ["Aria"] })])],
        chatHistory: [msg("你好", { name: "Aria", role: "assistant" })],
      }),
    );
    expect(flat(on)).toEqual(["name"]);

    const off = resolveWorldInfo(
      input({
        ...{
          books: [book([entry({ id: "name", keys: ["Aria"] })])],
          chatHistory: [msg("你好", { name: "Aria" })],
        },
        settings: { ...input({}).settings, includeNames: false },
      }),
    );
    expect(flat(off)).toEqual([]);
  });

  it("正则 key 按字面处理并告警", () => {
    const result = resolveWorldInfo(
      input({
        books: [book([entry({ id: "rx", keys: ["/cat|dog/"] })])],
        chatHistory: [msg("斜杠字面 /cat|dog/ 出现在这里")],
      }),
    );

    expect(flat(result)).toEqual(["rx"]);
    expect(result.warnings.some((w) => w.startsWith("regex_key_not_supported"))).toBe(true);
  });
});

describe("resolveWorldInfo: 副关键词逻辑", () => {
  const hist = (text: string) => [msg(text)];

  function selective(logic: "andAny" | "andAll" | "notAny" | "notAll") {
    return book([
      entry({ id: "s", keys: ["猫"], secondaryKeys: ["黑", "白"], selective: true, logic }),
    ]);
  }

  it("andAny：主命中 + 任一副命中", () => {
    expect(
      flat(resolveWorldInfo(input({ books: [selective("andAny")], chatHistory: hist("黑猫") })))
        .length,
    ).toBe(1);
    expect(
      flat(resolveWorldInfo(input({ books: [selective("andAny")], chatHistory: hist("猫") })))
        .length,
    ).toBe(0);
  });

  it("andAll：全部副命中才激活", () => {
    expect(
      flat(resolveWorldInfo(input({ books: [selective("andAll")], chatHistory: hist("黑白猫") })))
        .length,
    ).toBe(1);
    expect(
      flat(resolveWorldInfo(input({ books: [selective("andAll")], chatHistory: hist("黑猫") })))
        .length,
    ).toBe(0);
  });

  it("notAny：任一副命中则否决", () => {
    expect(
      flat(resolveWorldInfo(input({ books: [selective("notAny")], chatHistory: hist("黑猫") })))
        .length,
    ).toBe(0);
    expect(
      flat(resolveWorldInfo(input({ books: [selective("notAny")], chatHistory: hist("猫") })))
        .length,
    ).toBe(1);
  });

  it("notAll：副全部命中反而否决", () => {
    expect(
      flat(resolveWorldInfo(input({ books: [selective("notAll")], chatHistory: hist("黑白猫") })))
        .length,
    ).toBe(0);
    expect(
      flat(resolveWorldInfo(input({ books: [selective("notAll")], chatHistory: hist("黑猫") })))
        .length,
    ).toBe(1);
  });

  it("selective=false 忽略副关键词", () => {
    const result = resolveWorldInfo(
      input({
        books: [book([entry({ id: "s", keys: ["猫"], secondaryKeys: ["黑"], selective: false })])],
        chatHistory: hist("猫"),
      }),
    );
    expect(flat(result)).toEqual(["s"]);
  });

  it("selective=true 但副为空 → 无副过滤", () => {
    const result = resolveWorldInfo(
      input({
        books: [book([entry({ id: "s", keys: ["猫"], secondaryKeys: [], selective: true })])],
        chatHistory: hist("猫"),
      }),
    );
    expect(flat(result)).toEqual(["s"]);
  });
});

describe("resolveWorldInfo: 递归激活", () => {
  const b1 = () => entry({ id: "A", keys: ["Bessie"], content: "Bessie 是牛，朋友是 Rufus。" });
  const b2 = () => entry({ id: "B", keys: ["Rufus"], content: "Rufus 是狗。" });

  it("开关关闭时递归内容不触发其它条目", () => {
    const result = resolveWorldInfo(
      input({
        books: [book([b1(), b2()], { recursiveScanning: false })],
        chatHistory: [msg("提到 Bessie")],
      }),
    );
    expect(flat(result)).toEqual(["A"]);
  });

  it("开关开启：A 的 content 激活 B（activation=recursive）", () => {
    const result = resolveWorldInfo(
      input({
        books: [book([b1(), b2()], { recursiveScanning: true })],
        chatHistory: [msg("提到 Bessie")],
      }),
    );
    const ids = flat(result);
    expect(ids).toEqual(expect.arrayContaining(["A", "B"]));
    expect(result.byPosition.afterChar.find((i) => i.entryId === "B")?.activation).toBe(
      "recursive",
    );
  });

  it("excludeRecursion 条目不被递归激活", () => {
    const result = resolveWorldInfo(
      input({
        books: [
          book([b1(), entry({ id: "B", keys: ["Rufus"], excludeRecursion: true })], {
            recursiveScanning: true,
          }),
        ],
        chatHistory: [msg("提到 Bessie")],
      }),
    );
    expect(flat(result)).toEqual(["A"]);
  });

  it("preventRecursion 条目的 content 不触发下一轮", () => {
    const result = resolveWorldInfo(
      input({
        books: [
          book([entry({ ...b1(), preventRecursion: true }), b2()], { recursiveScanning: true }),
        ],
        chatHistory: [msg("提到 Bessie")],
      }),
    );
    expect(flat(result)).toEqual(["A"]);
  });

  it("maxRecursionSteps=1 等价禁用递归", () => {
    const result = resolveWorldInfo(
      input({
        books: [book([b1(), b2()], { recursiveScanning: true })],
        chatHistory: [msg("提到 Bessie")],
        settings: { ...input({}).settings, maxRecursionSteps: 1 },
      }),
    );
    expect(flat(result)).toEqual(["A"]);
  });

  it("两级链 A→B→C：steps=0 全激活；steps=2 只到 B", () => {
    const c3 = () => entry({ id: "C", keys: ["Mimi"], content: "猫" });
    const bB = () => entry({ id: "B", keys: ["Rufus"], content: "Rufus 喜欢 Mimi" });
    const mk = (steps: number) =>
      resolveWorldInfo(
        input({
          books: [book([b1(), bB(), c3()], { recursiveScanning: true })],
          chatHistory: [msg("Bessie")],
          settings: { ...input({}).settings, maxRecursionSteps: steps },
        }),
      );

    expect(flat(mk(0))).toEqual(expect.arrayContaining(["A", "B", "C"]));
    const limited = flat(mk(2));
    expect(limited).toEqual(expect.arrayContaining(["A", "B"]));
    expect(limited).not.toContain("C");
  });
});

describe("resolveWorldInfo: 位置分组与插入排序", () => {
  it("按 position 分组；组内 insertionOrder 升序，同序按 id", () => {
    const result = resolveWorldInfo(
      input({
        books: [
          book([
            entry({ id: "a1", constant: true, position: "beforeChar", insertionOrder: 20 }),
            entry({ id: "a2", constant: true, position: "beforeChar", insertionOrder: 10 }),
            entry({ id: "z", constant: true, position: "beforeChar", insertionOrder: 10 }),
            entry({ id: "d", constant: true, position: "afterChar" }),
          ]),
        ],
      }),
    );

    expect(result.byPosition.beforeChar.map((i) => i.entryId)).toEqual(["a2", "z", "a1"]);
    expect(result.byPosition.afterChar.map((i) => i.entryId)).toEqual(["d"]);
  });

  it("atDepth 透传 depth/role；缺省 4/system", () => {
    const result = resolveWorldInfo(
      input({
        books: [
          book([
            entry({ id: "d0", constant: true, position: "atDepth", depth: 0, role: "user" }),
            entry({ id: "dX", constant: true, position: "atDepth" }),
          ]),
        ],
      }),
    );

    const d0 = result.byPosition.atDepth.find((i) => i.entryId === "d0");
    const dx = result.byPosition.atDepth.find((i) => i.entryId === "dX");
    expect(d0?.depth).toBe(0);
    expect(d0?.role).toBe("user");
    expect(dx?.depth).toBe(4);
    expect(dx?.role).toBe("system");
  });

  it("不支持位置：不注入 + 告警 + droppedEntries", () => {
    const result = resolveWorldInfo(
      input({ books: [book([entry({ id: "an", constant: true, position: "anTop" })])] }),
    );

    expect(flat(result)).toEqual([]);
    expect(result.budget[0]?.droppedEntries).toContain("an");
    expect(result.warnings.some((w) => w.startsWith("feature_unsupported:position"))).toBe(true);
  });
});

describe("resolveWorldInfo: 预算竞争", () => {
  function budgetCase(limit: number) {
    return resolveWorldInfo(
      input({
        books: [
          book(
            [
              entry({ id: "const", constant: true, content: "12345" }),
              entry({ id: "kw10", keys: ["k"], insertionOrder: 10, content: "12345" }),
              entry({ id: "kw20", keys: ["k"], insertionOrder: 20, content: "12345" }),
            ],
            { tokenBudget: limit },
          ),
        ],
        chatHistory: [msg("k")],
      }),
    );
  }

  it("constant 优先占预算；同层 order 大者优先", () => {
    // 预算 10：constant(5) + kw20(5)；kw10 被弃
    const r = budgetCase(10);
    expect(r.byPosition.afterChar.map((i) => i.entryId)).toEqual(["kw20", "const"]);
    expect(r.budget[0]?.droppedEntries).toEqual(["kw10"]);
    expect(r.budget[0]?.used).toBe(10);
    expect(r.budget[0]?.limit).toBe(10);
  });

  it("预算耗尽后条目即使命中也丢弃", () => {
    const r = budgetCase(5);
    expect(r.byPosition.afterChar.map((i) => i.entryId)).toEqual(["const"]);
    expect([...(r.budget[0]?.droppedEntries ?? [])].sort()).toEqual(["kw10", "kw20"]);
  });

  it("递归激活优先级最低", () => {
    const result = resolveWorldInfo(
      input({
        books: [
          book(
            [
              entry({ id: "A", keys: ["x"], content: "12345", insertionOrder: 1 }),
              // B 由 A 的 content "12345" 递归激活；order 999 若在 keyword 层会优先占预算
              entry({ id: "B", keys: ["123"], content: "12345", insertionOrder: 999 }),
            ],
            { tokenBudget: 5, recursiveScanning: true },
          ),
        ],
        chatHistory: [msg("x")],
      }),
    );
    expect(result.byPosition.afterChar.map((i) => i.entryId)).toEqual(["A"]);
    expect(result.budget[0]?.droppedEntries).toEqual(["B"]);
  });

  it("书级 tokenBudget 优先于全局百分比", () => {
    const result = resolveWorldInfo(
      input({
        books: [book([entry({ id: "c", constant: true, content: "123" })], { tokenBudget: 2 })],
      }),
    );
    // limit 应为 2（而非 floor(10000*25%)）
    expect(result.budget[0]?.limit).toBe(2);
    expect(result.budget[0]?.droppedEntries).toEqual(["c"]);
  });

  it("无书级预算时 limit = floor(contextSize × wiBudgetPercent / 100)", () => {
    const result = resolveWorldInfo(
      input({
        books: [book([entry({ id: "c", constant: true, content: "" })])],
        settings: { ...input({}).settings, contextSize: 8192, wiBudgetPercent: 25 },
      }),
    );
    expect(result.budget[0]?.limit).toBe(2048);
  });

  it("多本书各自独立预算池", () => {
    const result = resolveWorldInfo(
      input({
        books: [
          book([entry({ id: "p1", constant: true, content: "abc" })], { id: "b1", tokenBudget: 2 }),
          book([entry({ id: "p2", constant: true, content: "abc" })], {
            id: "b2",
            tokenBudget: 10,
          }),
        ],
      }),
    );
    expect(result.budget).toHaveLength(2);
    expect(result.budget[0]?.droppedEntries).toEqual(["p1"]);
    expect(flat(result)).toEqual(["p2"]);
  });
});

describe("resolveWorldInfo: 不实现特性的告警", () => {
  it("probability / group 等扩展键保留并告警，条目照常竞争", () => {
    const result = resolveWorldInfo(
      input({
        books: [
          book([
            entry({
              id: "feat",
              constant: true,
              content: "ab",
              extensions: { probability: 50, useProbability: true, group: "g1", sticky: 2 },
            }),
          ]),
        ],
      }),
    );

    expect(flat(result)).toEqual(["feat"]);
    const joined = result.warnings.join("\n");
    expect(joined).toContain("feature_unsupported:probability");
    expect(joined).toContain("feature_unsupported:inclusion_group");
    expect(joined).toContain("feature_unsupported:timed_effects");
  });
});
