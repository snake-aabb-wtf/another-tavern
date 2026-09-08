/**
 * M4 server 测试：plans / lorebooks CRUD 与导入、世界书挂载、
 * 按计划组装（last-prompt 验证）、采样参数透传。
 */

import type { AppDeps } from "./app.js";
import { createApp } from "./app.js";
import { openDatabase } from "./db/client.js";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MIGRATIONS_DIR = resolve("drizzle");

// 复用 app.test.ts 的样例卡与 fake 上游（跨测试文件共享 helper）
const SAMPLE_CARD_JSON = JSON.stringify({
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Aria",
    description: "月光旅店管理员。",
    personality: "神秘。",
    scenario: "深夜。",
    first_mes: "欢迎光临。",
    mes_example: "<START>\nKai: 你好\nAria: 早安",
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: [],
    tags: [],
    creator: "",
    character_version: "",
    extensions: {},
  },
});

function fakeUpstream(chunks: string[], record?: { body?: string }) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (record !== undefined) {
      record.body = String(init?.body);
    }
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          const payload = JSON.stringify({ choices: [{ delta: { content: chunk } }] });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
}

async function importCard(app: ReturnType<typeof createApp>): Promise<string> {
  const form = new FormData();
  form.append("file", new File([SAMPLE_CARD_JSON], "card.json", { type: "application/json" }));
  const res = await app.request("/api/characters/import", { method: "POST", body: form });
  return ((await res.json()) as { id: string }).id;
}

async function makeSession(
  app: ReturnType<typeof createApp>,
  opts: { characterId: string; planId?: string },
): Promise<string> {
  const res = await app.request("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ characterId: opts.characterId, planId: opts.planId }),
  });
  return ((await res.json()) as { id: string }).id;
}

async function chatOnce(
  app: ReturnType<typeof createApp>,
  sessionId: string,
  deps: AppDeps,
): Promise<void> {
  deps.upstreamFetch = deps.upstreamFetch ?? fakeUpstream(["OK"]);
  const res = await app.request("/api/chat/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, content: "hi" }),
  });
  expect(res.status).toBe(200);
  await res.text();
}

/** 社区格式样例：ST Chat Completion 预设（结构同 ST PromptManager.js 默认 preset）。 */
const SAMPLE_PRESET = {
  temperature: 0.7,
  name: "TestPreset",
  prompts: [
    {
      identifier: "main",
      name: "Main",
      role: "system",
      content: "",
      system_prompt: true,
      marker: false,
    },
    { identifier: "worldInfoBefore", name: "WI B", system_prompt: true, marker: true },
    { identifier: "personaDescription", name: "Persona", system_prompt: true, marker: true },
    { identifier: "charDescription", name: "Desc", system_prompt: true, marker: true },
    { identifier: "charPersonality", name: "Pers", system_prompt: true, marker: true },
    { identifier: "scenario", name: "Scen", system_prompt: true, marker: true },
    { identifier: "worldInfoAfter", name: "WI A", system_prompt: true, marker: true },
    { identifier: "dialogueExamples", name: "Ex", system_prompt: true, marker: true },
    { identifier: "chatHistory", name: "History", system_prompt: true, marker: true },
    {
      identifier: "jailbreak",
      name: "PHI",
      role: "system",
      content: "",
      system_prompt: true,
      marker: false,
    },
  ],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        { identifier: "main", enabled: true },
        { identifier: "worldInfoBefore", enabled: true },
        { identifier: "personaDescription", enabled: true },
        { identifier: "charDescription", enabled: true },
        { identifier: "charPersonality", enabled: true },
        { identifier: "scenario", enabled: true },
        { identifier: "worldInfoAfter", enabled: true },
        { identifier: "dialogueExamples", enabled: false },
        { identifier: "chatHistory", enabled: true },
        { identifier: "jailbreak", enabled: false },
      ],
    },
  ],
};

/** 社区格式样例：ST 原生世界书 JSON。 */
const SAMPLE_WORLD_INFO = {
  name: "GlobalLore",
  entries: {
    "0": {
      uid: 0,
      key: ["旅店"],
      keysecondary: [],
      comment: "inn",
      content: "GLOBAL-INN-LORE",
      constant: true,
      selective: false,
      order: 10,
      position: 0,
      disable: false,
      extensions: {},
    },
  },
};

describe("M4: plans", () => {
  let deps: AppDeps;
  beforeEach(() => {
    deps = { db: openDatabase(":memory:", MIGRATIONS_DIR) };
  });
  afterEach(() => {
    deps.db.sqlite.close();
  });

  it("CRUD：创建（规范化）→ 详情 → 更新 → 删除", async () => {
    const app = createApp(deps);
    const created = await app.request("/api/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "MyPlan",
        plan: {
          systemSlots: [{ id: "scenario", enabled: true, order: 5 }],
          postHistory: { enabled: false, position: "historyAfter" },
        },
      }),
    });
    expect(created.status).toBe(201);
    const { id, plan } = (await created.json()) as {
      id: string;
      plan: { systemSlots: unknown[]; postHistory: { enabled: boolean } };
    };
    expect(plan.systemSlots).toHaveLength(8); // 缺失槽补默认
    expect(plan.postHistory.enabled).toBe(false);

    const detail = (await (await app.request(`/api/plans/${id}`)).json()) as { name: string };
    expect(detail.name).toBe("MyPlan");

    const updated = await app.request(`/api/plans/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(((await updated.json()) as { name: string }).name).toBe("Renamed");

    const del = await app.request(`/api/plans/${id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect((await app.request(`/api/plans/${id}`)).status).toBe(404);
  });

  it("导入 ST 预设：multipart → 计划入库（examples 禁用、PHI 禁用）", async () => {
    const app = createApp(deps);
    const form = new FormData();
    form.append(
      "file",
      new File([JSON.stringify(SAMPLE_PRESET)], "preset.json", { type: "application/json" }),
    );
    const res = await app.request("/api/plans/import", { method: "POST", body: form });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      plan: {
        systemSlots: Array<{ id: string; enabled: boolean; order: number }>;
        postHistory: { enabled: boolean };
      };
    };

    const byId = new Map(body.plan.systemSlots.map((s) => [s.id, s]));
    expect(byId.get("examples")?.enabled).toBe(false); // preset order 中 enabled=false
    expect(body.plan.postHistory.enabled).toBe(false); // jailbreak enabled=false
    expect(byId.get("main")?.order).toBe(10);
  });
});

describe("M4: lorebooks", () => {
  let deps: AppDeps;
  beforeEach(() => {
    deps = { db: openDatabase(":memory:", MIGRATIONS_DIR) };
  });
  afterEach(() => {
    deps.db.sqlite.close();
  });

  it("导入 ST 世界书 JSON → 书 + 条目入库；详情含条目", async () => {
    const app = createApp(deps);
    const form = new FormData();
    form.append(
      "file",
      new File([JSON.stringify(SAMPLE_WORLD_INFO)], "wi.json", { type: "application/json" }),
    );
    const res = await app.request("/api/lorebooks/import", { method: "POST", body: form });
    expect(res.status).toBe(201);
    const { id, entryCount } = (await res.json()) as { id: string; entryCount: number };
    expect(entryCount).toBe(1);

    const detail = (await (await app.request(`/api/lorebooks/${id}`)).json()) as {
      name: string;
      entries: Array<{ content: string; position: string; enabled: boolean }>;
    };
    expect(detail.name).toBe("GlobalLore");
    expect(detail.entries[0]?.content).toBe("GLOBAL-INN-LORE");
    expect(detail.entries[0]?.position).toBe("beforeChar"); // ST 数字 0
    expect(detail.entries[0]?.enabled).toBe(true);
  });

  it("条目增删改 + 全局标记", async () => {
    const app = createApp(deps);
    const created = (await (
      await app.request("/api/lorebooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "L", isGlobal: true }),
      })
    ).json()) as { id: string };

    const entry = await app.request(`/api/lorebooks/${created.id}/entries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: ["x"], content: "X-LORE", constant: true }),
    });
    expect(entry.status).toBe(201);
    const { uid } = (await entry.json()) as { uid: string };

    const updated = await app.request(`/api/lorebooks/${created.id}/entries/${uid}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keys: ["x"], content: "X-LORE-2", constant: true }),
    });
    expect(updated.status).toBe(200);

    const detail = (await (await app.request(`/api/lorebooks/${created.id}`)).json()) as {
      isGlobal: boolean;
      entries: Array<{ content: string }>;
    };
    expect(detail.isGlobal).toBe(true);
    expect(detail.entries[0]?.content).toBe("X-LORE-2");

    expect(
      (await app.request(`/api/lorebooks/${created.id}/entries/${uid}`, { method: "DELETE" }))
        .status,
    ).toBe(204);
  });
});

describe("M4: 按计划组装与世界书注入（验收核心）", () => {
  let deps: AppDeps;
  beforeEach(() => {
    deps = { db: openDatabase(":memory:", MIGRATIONS_DIR) };
  });
  afterEach(() => {
    deps.db.sqlite.close();
  });

  it("默认计划 vs 自定义计划：last-prompt 输出不同且各自符合计划", async () => {
    const app = createApp(deps);
    const characterId = await importCard(app);

    // 自定义计划：examples 段禁用（其余默认）
    const created = await app.request("/api/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "NoExamples",
        plan: {
          systemSlots: [
            { id: "main", enabled: true, order: 10 },
            { id: "wiBefore", enabled: true, order: 20 },
            { id: "persona", enabled: true, order: 30 },
            { id: "description", enabled: true, order: 40 },
            { id: "personality", enabled: true, order: 50 },
            { id: "scenario", enabled: true, order: 60 },
            { id: "wiAfter", enabled: true, order: 70 },
            { id: "examples", enabled: false, order: 80 },
          ],
          postHistory: { enabled: true, position: "historyAfter" },
        },
      }),
    });
    const planId = ((await created.json()) as { id: string }).id;

    const defaultSession = await makeSession(app, { characterId });
    const customSession = await makeSession(app, { characterId, planId });

    await app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "http://fake.local/v1", apiKey: "sk", model: "test-model" }),
    });
    await chatOnce(app, defaultSession, deps);
    await chatOnce(app, customSession, deps);

    const defaultPrompt = (await (
      await app.request(`/api/sessions/${defaultSession}/last-prompt`)
    ).json()) as {
      messages: Array<{ content: string }>;
    };
    const customPrompt = (await (
      await app.request(`/api/sessions/${customSession}/last-prompt`)
    ).json()) as {
      messages: Array<{ content: string }>;
    };

    // 输出确实不同：默认计划含 examples 段，自定义计划不含
    const defaultSystem = defaultPrompt.messages[0]?.content ?? "";
    const customSystem = customPrompt.messages[0]?.content ?? "";
    expect(defaultSystem).toContain("<START>");
    expect(customSystem).not.toContain("<START>");
    expect(defaultPrompt).not.toEqual(customPrompt);

    // 各自符合计划：默认计划 system 含卡描述；两者都含
    expect(defaultSystem).toContain("月光旅店管理员。");
    expect(customSystem).toContain("月光旅店管理员。");
  });

  it("世界书注入：卡内书 + 全局书都进入组装（last-prompt 可见）", async () => {
    const app = createApp(deps);
    // 全局书（ST 格式导入，constant 条目命中任意会话）
    const form = new FormData();
    form.append(
      "file",
      new File([JSON.stringify(SAMPLE_WORLD_INFO)], "wi.json", { type: "application/json" }),
    );
    form.append("isGlobal", "1");
    await app.request("/api/lorebooks/import", { method: "POST", body: form });

    const characterId = await importCard(app);
    const sessionId = await makeSession(app, { characterId });
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "http://fake.local/v1", apiKey: "sk", model: "test-model" }),
    });
    await chatOnce(app, sessionId, deps);

    const last = (await (await app.request(`/api/sessions/${sessionId}/last-prompt`)).json()) as {
      messages: Array<{ content: string }>;
    };
    const system = last.messages[0]?.content ?? "";
    // 全局书 constant 条目应参与组装并注入
    expect(system).toContain("GLOBAL-INN-LORE");
  });

  it("未组装过的会话 → last-prompt 404 no_prompt", async () => {
    const app = createApp(deps);
    const characterId = await importCard(app);
    const sessionId = await makeSession(app, { characterId });
    const res = await app.request(`/api/sessions/${sessionId}/last-prompt`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("no_prompt");
  });

  it("settings.sampling 白名单透传上游", async () => {
    const record: { body?: string } = {};
    // fake 必须在 createApp 之前注入（app 捕获 deps 对象引用）
    deps.upstreamFetch = fakeUpstream(["OK"], record);
    const app = createApp(deps);
    await app.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: "http://fake.local/v1",
        apiKey: "sk",
        model: "test-model",
        sampling: { temperature: 0.5, max_tokens: 100, evil_key: "nope" },
      }),
    });
    const characterId = await importCard(app);
    const sessionId = await makeSession(app, { characterId });
    await chatOnce(app, sessionId, deps);

    const upstreamBody = JSON.parse(record.body ?? "{}") as {
      temperature?: unknown;
      max_tokens?: unknown;
      evil_key?: unknown;
    };
    expect(upstreamBody.temperature).toBe(0.5);
    expect(upstreamBody.max_tokens).toBe(100);
    expect(upstreamBody.evil_key).toBeUndefined();
  });
});
