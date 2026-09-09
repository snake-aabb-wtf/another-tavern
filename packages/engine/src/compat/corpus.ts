/**
 * M7 兼容性语料：程序化合成的 ST 格式样例集合。
 *
 * 来源声明：以下样例为按 SillyTavern 真实格式（基于对该应用公开文档与
 * release 分支行为的一手分析）**程序化生成**的合成数据，非从任何仓库
 * 下载的文件；结构覆盖社区卡片/世界书/预设的常见与边界形态。
 * 每个样例声明预期结果（ok + 断言要点 / fail + 错误码）。
 */

export interface CorpusCase<T> {
  id: string;
  /** 预期：ok=成功导入；fail=结构级失败（错误码）。 */
  expect: "ok" | "fail";
  errorCode?: string;
  payload: T | string;
  /** 成功时的断言要点（由测试逐条实现，此处仅作文档）。 */
  note?: string;
}

// ============ 角色卡（12 份） ============

function v2Card(data: Record<string, unknown>): Record<string, unknown> {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "X",
      description: "",
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      extensions: {},
      ...data,
    },
  };
}

export const CARD_CASES: CorpusCase<unknown>[] = [
  {
    id: "card-01-v2-complete",
    expect: "ok",
    payload: v2Card({
      name: "Full",
      first_mes: "hi",
      alternate_greetings: ["a", "b"],
      tags: ["t"],
      character_version: "1.0",
      creator: "c",
      creator_notes: "n",
    }),
    note: "全字段 V2",
  },
  {
    id: "card-02-v2-unknown-top",
    expect: "ok",
    payload: v2Card({ shop: { gold: 1 } }),
    note: "顶层未知字段保留",
  },
  {
    id: "card-03-v2-unknown-ext",
    expect: "ok",
    payload: v2Card({ extensions: { st_note: "keep", probability: 50 } }),
    note: "extensions 保留",
  },
  {
    id: "card-04-v2-type-mismatch",
    expect: "ok",
    payload: v2Card({ first_mes: 42 }),
    note: "类型不符 → 补默认 + 警告",
  },
  {
    id: "card-05-v2-alt-string",
    expect: "ok",
    payload: v2Card({ alternate_greetings: "单个" }),
    note: "字符串包装为数组",
  },
  {
    id: "card-06-v2-book",
    expect: "ok",
    payload: v2Card({
      character_book: {
        name: "b",
        extensions: {},
        entries: [{ keys: ["k"], content: "c", extensions: {} }],
      },
    }),
    note: "内嵌书映射",
  },
  {
    id: "card-07-v2-book-ext-position",
    expect: "ok",
    payload: v2Card({
      character_book: {
        extensions: {},
        entries: [
          {
            keys: ["k"],
            content: "c",
            position: "before_char",
            extensions: { position: 4, depth: 2 },
          },
        ],
      },
    }),
    note: "extensions.position 数字覆盖",
  },
  {
    id: "card-08-bare-v2",
    expect: "ok",
    payload: {
      data: {
        name: "Bare",
        description: "",
        personality: "",
        scenario: "",
        first_mes: "",
        mes_example: "",
        extensions: {},
      },
    },
    note: "无 spec 的裸 data 形态",
  },
  {
    id: "card-09-v1-flat",
    expect: "ok",
    payload: {
      name: "Old",
      description: "d",
      personality: "p",
      scenario: "s",
      first_mes: "f",
      mes_example: "",
    },
    note: "V1 平铺升级",
  },
  { id: "card-10-v1-minimal", expect: "ok", payload: { name: "Tiny" }, note: "V1 缺字段补默认" },
  {
    id: "card-11-v3-rejected",
    expect: "fail",
    errorCode: "spec_unsupported",
    payload: { spec: "chara_card_v3", spec_version: "3.0", data: { name: "V3" } },
    note: "V3 显式拒绝",
  },
  {
    id: "card-12-not-object",
    expect: "fail",
    errorCode: "json_not_object",
    payload: 42,
    note: "非对象根",
  },
];

/** PNG 卡样例：返回 base64 载荷（测试内合成 tEXt chunk）。 */
export function pngCardPayload(cardJson: string): string {
  return Buffer.from(cardJson, "utf8").toString("base64");
}

export const CARD_PNG_CASES: CorpusCase<string>[] = [
  {
    id: "png-01-chara-lower",
    expect: "ok",
    payload: pngCardPayload(JSON.stringify(v2Card({ name: "Lower" }))),
    note: "keyword chara",
  },
  {
    id: "png-02-chara-mixed",
    expect: "ok",
    payload: pngCardPayload(JSON.stringify(v2Card({ name: "Mixed" }))),
    note: "keyword Chara 大小写宽容",
  },
  {
    id: "png-03-v1-in-png",
    expect: "ok",
    payload: pngCardPayload(
      JSON.stringify({
        name: "V1",
        description: "",
        personality: "",
        scenario: "",
        first_mes: "",
        mes_example: "",
      }),
    ),
    note: "V1 藏于 PNG",
  },
  {
    id: "png-04-bad-base64",
    expect: "fail",
    errorCode: "base64_decode_failed",
    payload: "!!!not base64!!!",
    note: "非法 base64",
  },
];

// ============ 世界书（12 份） ============

export const WORLD_CASES: CorpusCase<unknown>[] = [
  {
    id: "wi-01-dict-complete",
    expect: "ok",
    payload: {
      name: "W",
      entries: {
        "0": {
          uid: 0,
          key: ["a", "b"],
          keysecondary: [],
          comment: "",
          content: "c",
          constant: false,
          selective: false,
          order: 100,
          position: 0,
          disable: false,
        },
      },
    },
    note: "entries 字典完整条目",
  },
  {
    id: "wi-02-array-form",
    expect: "ok",
    payload: { entries: [{ uid: 1, key: ["k"], content: "c" }] },
    note: "entries 数组形态",
  },
  {
    id: "wi-03-key-comma-string",
    expect: "ok",
    payload: { entries: { "0": { uid: 0, key: "a, b , c", content: "c" } } },
    note: "key 逗号分隔字符串",
  },
  {
    id: "wi-04-position-at-depth",
    expect: "ok",
    payload: {
      entries: { "0": { uid: 0, key: ["k"], content: "c", position: 4, depth: 6, role: 1 } },
    },
    note: "atDepth + role 数字",
  },
  {
    id: "wi-05-disable-flag",
    expect: "ok",
    payload: { entries: { "0": { uid: 0, key: ["k"], content: "c", disable: true } } },
    note: "disable 反义映射",
  },
  {
    id: "wi-06-constant",
    expect: "ok",
    payload: { entries: { "0": { uid: 0, key: [], content: "c", constant: true } } },
    note: "constant 常驻",
  },
  {
    id: "wi-07-unknown-fields",
    expect: "ok",
    payload: {
      entries: {
        "0": { uid: 0, key: ["k"], content: "c", probability: 50, sticky: 3, someFuture: 1 },
      },
    },
    note: "未实现特性保留",
  },
  { id: "wi-08-empty-entries", expect: "ok", payload: { entries: {} }, note: "空书" },
  {
    id: "wi-09-selective-logic",
    expect: "ok",
    payload: {
      entries: {
        "0": {
          uid: 0,
          key: ["k"],
          keysecondary: ["s"],
          selective: true,
          selectiveLogic: 2,
          content: "c",
        },
      },
    },
    note: "selectiveLogic 枚举",
  },
  {
    id: "wi-10-recursive-flags",
    expect: "ok",
    payload: {
      entries: {
        "0": { uid: 0, key: ["k"], content: "c", excludeRecursion: true, preventRecursion: false },
      },
    },
    note: "递归控制",
  },
  {
    id: "wi-11-bad-position",
    expect: "ok",
    payload: { entries: { "0": { uid: 0, key: ["k"], content: "c", position: 99 } } },
    note: "非法 position → 回退 + 警告",
  },
  {
    id: "wi-12-entries-missing",
    expect: "fail",
    errorCode: "worldinfo_entries_invalid",
    payload: { name: "no entries" },
    note: "缺 entries 结构级失败",
  },
];

// ============ 预设（12 份） ============

function preset(
  prompts: unknown[],
  order: unknown[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { prompts, prompt_order: [{ character_id: 100001, order }], ...extra };
}

const P = (identifier: string, extra: Record<string, unknown> = {}): unknown => ({
  identifier,
  ...extra,
});

export const PRESET_CASES: CorpusCase<unknown>[] = [
  {
    id: "preset-01-default-shape",
    expect: "ok",
    payload: preset(
      [P("main", { marker: false }), P("chatHistory", { marker: true })],
      [
        { identifier: "main", enabled: true },
        { identifier: "chatHistory", enabled: true },
      ],
    ),
    note: "ST 默认形状",
  },
  {
    id: "preset-02-partial-order",
    expect: "ok",
    payload: preset([P("main", { marker: false })], [{ identifier: "main", enabled: true }]),
    note: "order 外槽位禁用",
  },
  {
    id: "preset-03-no-order",
    expect: "ok",
    payload: { prompts: [P("main", { marker: false })] },
    note: "缺 prompt_order → 全部禁用",
  },
  { id: "preset-04-empty-prompts", expect: "ok", payload: preset([], []), note: "空预设" },
  {
    id: "preset-05-unknown-identifier",
    expect: "ok",
    payload: preset(
      [P("customThing", { content: "x" })],
      [{ identifier: "customThing", enabled: true }],
    ),
    note: "未知 prompt 保留",
  },
  {
    id: "preset-06-sampler-fields",
    expect: "ok",
    payload: preset([], [], { temperature: 0.7, top_p: 0.9 }),
    note: "sampler 进 unknownFields",
  },
  {
    id: "preset-07-jailbreak-disabled",
    expect: "ok",
    payload: preset(
      [P("jailbreak", { marker: false })],
      [{ identifier: "jailbreak", enabled: false }],
    ),
    note: "PHI 启停映射",
  },
  {
    id: "preset-08-order-disabled-entry",
    expect: "ok",
    payload: preset([P("main", { marker: false })], [{ identifier: "main", enabled: false }]),
    note: "order 内 enabled=false",
  },
  {
    id: "preset-09-string-payload",
    expect: "ok",
    payload: JSON.stringify(
      preset([P("main", { marker: false })], [{ identifier: "main", enabled: true }]),
    ),
    note: "JSON 字符串输入",
  },
  {
    id: "preset-10-not-object",
    expect: "fail",
    errorCode: "preset_not_object",
    payload: 42,
    note: "非对象根",
  },
  {
    id: "preset-11-bad-json",
    expect: "fail",
    errorCode: "preset_parse_failed",
    payload: "{ broken",
    note: "非法 JSON",
  },
  {
    id: "preset-12-unmatched-order",
    expect: "ok",
    payload: preset([], [{ identifier: "ghost", enabled: true }]),
    note: "order 引用不存在 prompt → 忽略",
  },
];
