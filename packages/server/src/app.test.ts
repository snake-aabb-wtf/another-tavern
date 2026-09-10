import chunkText from "png-chunk-text";
import encodePng from "png-chunks-encode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppDeps } from "./app.js";
import { createApp } from "./app.js";
import { openDatabase } from "./db/client.js";
import { maskApiKey } from "./routes/settings.js";
import { resolve } from "node:path";

const MIGRATIONS_DIR = resolve("drizzle");

function buildCardPng(cardJson: string): Uint8Array {
  const ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const base64 = Buffer.from(cardJson, "utf8").toString("base64");
  return encodePng([
    { name: "IHDR", data: ihdr },
    chunkText.encode("chara", base64),
    { name: "IDAT", data: new Uint8Array([1]) },
    { name: "IEND", data: new Uint8Array(0) },
  ]);
}

const SAMPLE_CARD = JSON.stringify({
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Aria",
    description: "月光旅店管理员。",
    personality: "",
    scenario: "",
    first_mes: "欢迎光临。",
    mes_example: "",
    system_prompt: "",
    post_history_instructions: "",
    alternate_greetings: [],
    tags: [],
    creator: "",
    character_version: "",
    extensions: {},
    character_book: {
      name: "inn",
      description: null,
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
          content: "旅店只有烛光。",
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

function namedSampleCard(name: string): string {
  if (name === "Aria") {
    return SAMPLE_CARD;
  }
  const card = JSON.parse(SAMPLE_CARD) as {
    data: { name: string; first_mes: string };
  };
  card.data.name = name;
  card.data.first_mes = `${name} 欢迎光临。`;
  return JSON.stringify(card);
}

interface RecordedFetch {
  url: string;
  init: RequestInit | undefined;
  signal: AbortSignal | null;
}

/** 产出一个 fake 上游 fetch：按 chunks 顺序吐 SSE delta 帧。 */
function fakeUpstream(chunks: string[], record?: RecordedFetch) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (record) {
      record.url = String(url);
      record.init = init;
      record.signal = init?.signal ?? null;
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

async function readSse(
  response: Response,
): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((frame) => frame.trim() !== "")
    .map((frame) => {
      const event = /event: (.*)/.exec(frame)?.[1] ?? "";
      const data = /data: (.*)/.exec(frame)?.[1] ?? "{}";
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

describe("server API（内存 SQLite + fake 上游）", () => {
  let deps: AppDeps;

  beforeEach(() => {
    deps = { db: openDatabase(":memory:", MIGRATIONS_DIR) };
  });

  afterEach(() => {
    deps.db.sqlite.close();
  });

  it("GET /api/health", async () => {
    const res = await createApp(deps).request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  describe("settings", () => {
    it("PUT 后 GET 打码 apiKey，不泄露原文", async () => {
      const app = createApp(deps);
      const put = await app.request("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: "http://fake.local/v1",
          apiKey: "sk-secret-12345678",
          model: "test-model",
        }),
      });
      expect(put.status).toBe(200);

      const get = await app.request("/api/settings");
      const body = (await get.json()) as {
        apiKey: string;
        hasApiKey: boolean;
        baseUrl: string;
        model: string;
      };
      expect(body.baseUrl).toBe("http://fake.local/v1");
      expect(body.model).toBe("test-model");
      expect(body.apiKey).toBe(maskApiKey("sk-secret-12345678"));
      expect(body.apiKey).not.toContain("secret");
      expect(body.hasApiKey).toBe(true);
    });

    it("初始 GET 返回空配置", async () => {
      const res = await createApp(deps).request("/api/settings");
      expect(await res.json()).toEqual({
        baseUrl: "",
        model: "",
        apiKey: "",
        hasApiKey: false,
        sampling: {},
        defaultPlanId: null,
      });
    });
  });

  describe("characters", () => {
    it("multipart 上传 PNG 卡 → 201 入库；列表与详情可读", async () => {
      const app = createApp(deps);
      const form = new FormData();
      form.append("file", new File([buildCardPng(SAMPLE_CARD)], "card.png", { type: "image/png" }));
      const imported = await app.request("/api/characters/import", { method: "POST", body: form });
      expect(imported.status).toBe(201);
      const { id, name } = (await imported.json()) as { id: string; name: string };
      expect(name).toBe("Aria");

      const list = (await (await app.request("/api/characters")).json()) as Array<{ id: string }>;
      expect(list.map((c) => c.id)).toContain(id);

      const detail = (await (await app.request(`/api/characters/${id}`)).json()) as {
        card: { name: string; characterBook: { entries: unknown[] } | null };
      };
      expect(detail.card.name).toBe("Aria");
      expect(detail.card.characterBook?.entries).toHaveLength(1);
    });

    it("JSON 卡可导入；非法 JSON 返回 400 + 可读错误码", async () => {
      const app = createApp(deps);
      const ok = await app.request("/api/characters/import", {
        method: "POST",
        body: (() => {
          const form = new FormData();
          form.append("file", new File([SAMPLE_CARD], "card.json", { type: "application/json" }));
          return form;
        })(),
      });
      expect(ok.status).toBe(201);

      const bad = await app.request("/api/characters/import", {
        method: "POST",
        body: (() => {
          const form = new FormData();
          form.append("file", new File(["{ nope"], "bad.json", { type: "application/json" }));
          return form;
        })(),
      });
      expect(bad.status).toBe(400);
      const body = (await bad.json()) as { error: { code: string } };
      expect(body.error.code).toBe("json_parse_failed");
    });

    it("缺 file 字段 → 400", async () => {
      const res = await createApp(deps).request("/api/characters/import", {
        method: "POST",
        body: new FormData(),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("sessions / messages", () => {
    async function importCard(name = "Aria"): Promise<string> {
      const form = new FormData();
      form.append(
        "file",
        new File([namedSampleCard(name)], `${name}.json`, { type: "application/json" }),
      );
      const res = await createApp(deps).request("/api/characters/import", {
        method: "POST",
        body: form,
      });
      return ((await res.json()) as { id: string }).id;
    }

    it("创建会话自动落库 greeting（assistant + swipe 候选）", async () => {
      const app = createApp(deps);
      const characterId = await importCard();
      const created = await app.request("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ characterId }),
      });
      expect(created.status).toBe(201);
      const session = (await created.json()) as { id: string };

      const detail = (await (await app.request(`/api/sessions/${session.id}`)).json()) as {
        members: Array<{
          characterId: string;
          characterName: string;
          position: number;
          muted: boolean;
        }>;
        messages: Array<{ role: string; content: string; swipeCandidates: string[]; seq: number }>;
      };
      expect(detail.members).toEqual([
        expect.objectContaining({
          characterId,
          characterName: "Aria",
          position: 0,
          muted: false,
        }),
      ]);
      expect(detail.messages).toHaveLength(1);
      expect(detail.messages[0]?.role).toBe("assistant");
      expect(detail.messages[0]?.content).toBe("欢迎光临。");
      expect(detail.messages[0]?.swipeCandidates).toEqual(["欢迎光临。"]);
      expect(detail.messages[0]).toMatchObject({
        speakerCharacterId: characterId,
        speakerName: "Aria",
      });
      expect(detail.messages[0]?.seq).toBe(1);
    });

    it("消息追加/删除与会话删除（级联）", async () => {
      const app = createApp(deps);
      const characterId = await importCard();
      const session = (await (
        await app.request("/api/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ characterId }),
        })
      ).json()) as { id: string };

      const added = await app.request(`/api/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "user", content: "你好" }),
      });
      expect(added.status).toBe(201);
      const message = (await added.json()) as { id: string; seq: number };
      expect(message.seq).toBe(2);

      const del = await app.request(`/api/sessions/${session.id}/messages/${message.id}`, {
        method: "DELETE",
      });
      expect(del.status).toBe(204);

      const delSession = await app.request(`/api/sessions/${session.id}`, { method: "DELETE" });
      expect(delSession.status).toBe(204);
      const gone = await app.request(`/api/sessions/${session.id}`);
      expect(gone.status).toBe(404);
    });

    it("创建群聊并支持成员排序、静音与群聊设置", async () => {
      const app = createApp(deps);
      const ariaId = await importCard("Aria");
      const lisaId = await importCard("Lisa");
      const created = await app.request("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "group",
          title: "旅行者小队",
          characterIds: [ariaId, lisaId],
        }),
      });
      expect(created.status).toBe(201);
      const session = (await created.json()) as {
        id: string;
        kind: string;
        groupSettings: Record<string, unknown>;
      };
      expect(session.kind).toBe("group");
      expect(session.groupSettings).toMatchObject({
        replyStrategy: "manual",
        generationMode: "swap",
      });

      const replace = await app.request(`/api/sessions/${session.id}/members`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            { characterId: lisaId, muted: true, talkativeness: 20 },
            { characterId: ariaId, muted: false, talkativeness: 80 },
          ],
        }),
      });
      expect(replace.status).toBe(200);
      expect(await replace.json()).toMatchObject({
        members: [
          { characterId: lisaId, position: 0, muted: true, talkativeness: 20 },
          { characterId: ariaId, position: 1, muted: false, talkativeness: 80 },
        ],
      });

      const settings = await app.request(`/api/sessions/${session.id}/group-settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ replyStrategy: "list", scenarioOverride: "调查神殿" }),
      });
      expect(settings.status).toBe(200);
      expect(await settings.json()).toMatchObject({
        groupSettings: { replyStrategy: "list", scenarioOverride: "调查神殿" },
      });
    });

    it("群聊创建拒绝重复角色和不存在角色", async () => {
      const app = createApp(deps);
      const ariaId = await importCard("Aria");
      const duplicate = await app.request("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "group", characterIds: [ariaId, ariaId] }),
      });
      expect(duplicate.status).toBe(400);
      expect(((await duplicate.json()) as { error: { code: string } }).error.code).toBe(
        "duplicate_character",
      );

      const missing = await app.request("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "group", characterIds: [ariaId, "missing"] }),
      });
      expect(missing.status).toBe(404);
    });

    it("不存在的角色卡 → 404；缺 characterId → 400", async () => {
      const app = createApp(deps);
      const missing = await app.request("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ characterId: "nope" }),
      });
      expect(missing.status).toBe(404);
      const empty = await app.request("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(empty.status).toBe(400);
    });
  });

  describe("chat/stream（SSE）", () => {
    async function setup(): Promise<{ app: ReturnType<typeof createApp>; sessionId: string }> {
      const app = createApp(deps);
      const form = new FormData();
      form.append("file", new File([SAMPLE_CARD], "card.png", { type: "image/png" }));
      const characterId = (
        (await (
          await app.request("/api/characters/import", { method: "POST", body: form })
        ).json()) as { id: string }
      ).id;
      await app.request("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: "http://fake.local/v1",
          apiKey: "sk-test",
          model: "test-model",
        }),
      });
      const sessionId = (
        (await (
          await app.request("/api/sessions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ characterId }),
          })
        ).json()) as { id: string }
      ).id;
      return { app, sessionId };
    }

    async function setupGroup(): Promise<{
      app: ReturnType<typeof createApp>;
      sessionId: string;
      ariaId: string;
      lisaId: string;
    }> {
      const app = createApp(deps);
      const importNamed = async (name: string): Promise<string> => {
        const form = new FormData();
        form.append(
          "file",
          new File([namedSampleCard(name)], `${name}.json`, { type: "application/json" }),
        );
        const response = await app.request("/api/characters/import", {
          method: "POST",
          body: form,
        });
        return ((await response.json()) as { id: string }).id;
      };
      const ariaId = await importNamed("Aria");
      const lisaId = await importNamed("Lisa");
      await app.request("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: "http://fake.local/v1",
          apiKey: "sk-test",
          model: "test-model",
        }),
      });
      const created = await app.request("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "group", title: "小队", characterIds: [ariaId, lisaId] }),
      });
      const sessionId = ((await created.json()) as { id: string }).id;
      return { app, sessionId, ariaId, lisaId };
    }

    async function setGroupMembers(
      app: ReturnType<typeof createApp>,
      sessionId: string,
      members: Array<{ characterId: string; muted?: boolean }>,
    ): Promise<void> {
      const response = await app.request(`/api/sessions/${sessionId}/members`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ members }),
      });
      expect(response.status).toBe(200);
    }

    async function setGroupStrategy(
      app: ReturnType<typeof createApp>,
      sessionId: string,
      replyStrategy: "manual" | "list",
    ): Promise<void> {
      const response = await app.request(`/api/sessions/${sessionId}/group-settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ replyStrategy }),
      });
      expect(response.status).toBe(200);
    }

    it("流式转发 delta 并在结束后落库 assistant 消息", async () => {
      const record: RecordedFetch = { url: "", init: undefined, signal: null };
      deps.upstreamFetch = fakeUpstream(["你好", "，", "旅人"], record);
      const { app, sessionId } = await setup();

      const res = await app.request("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, content: "你好 Aria" }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const events = await readSse(res);
      expect(events[0]?.event).toBe("meta");
      expect(events.map((e) => e.event)).toEqual(["meta", "delta", "delta", "delta", "done"]);
      expect(events[4]?.data).toEqual({ messageId: expect.any(String), content: "你好，旅人" });

      // 落库断言
      const detail = (await (await app.request(`/api/sessions/${sessionId}`)).json()) as {
        messages: Array<{
          role: string;
          content: string;
          status: string;
          swipeCandidates: string[];
        }>;
      };
      const user = detail.messages.at(-2);
      const assistant = detail.messages.at(-1);
      expect(user?.status).toBe("completed");
      expect(assistant?.role).toBe("assistant");
      expect(assistant?.status).toBe("completed");
      expect(assistant?.content).toBe("你好，旅人");
      expect(assistant?.swipeCandidates).toEqual(["你好，旅人"]);

      // 上游请求体为组装后的 messages（system 在前 + 历史）
      const upstreamBody = JSON.parse(String(record.init?.body)) as {
        messages: Array<{ role: string }>;
      };
      expect(upstreamBody.messages[0]?.role).toBe("system");
      expect(upstreamBody.messages.at(-1)?.role).toBe("user");
    });

    it("群聊手动选择注入当前身份，并把 speaker 写入 SSE 与消息", async () => {
      const record: RecordedFetch = { url: "", init: undefined, signal: null };
      deps.upstreamFetch = fakeUpstream(["Lisa 的回复"], record);
      const { app, sessionId, lisaId } = await setupGroup();

      const res = await app.request("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, content: "你们好", speakerId: lisaId }),
      });
      expect(res.status).toBe(200);
      const events = await readSse(res);
      expect(events[0]?.data).toMatchObject({ speakerId: lisaId, speakerName: "Lisa" });

      const upstreamBody = JSON.parse(String(record.init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(upstreamBody.messages[0]?.content).toContain("You are currently speaking as Lisa.");
      expect(upstreamBody.messages.some((message) => message.content === "Aria: 欢迎光临。")).toBe(
        true,
      );

      const detail = (await (await app.request(`/api/sessions/${sessionId}`)).json()) as {
        messages: Array<{
          role: string;
          content: string;
          speakerCharacterId: string | null;
          speakerName: string | null;
        }>;
      };
      expect(detail.messages.at(-1)).toMatchObject({
        role: "assistant",
        content: "Lisa 的回复",
        speakerCharacterId: lisaId,
        speakerName: "Lisa",
      });
    });

    it("群聊 E2E 验收：创建详情 → 成员设置 → 发言 → 刷新恢复", async () => {
      const record: RecordedFetch = { url: "", init: undefined, signal: null };
      deps.upstreamFetch = fakeUpstream(["Lisa 的", "完整回复"], record);
      const { app, sessionId, ariaId, lisaId } = await setupGroup();

      const initial = (await (await app.request(`/api/sessions/${sessionId}`)).json()) as {
        session: { kind: string; title: string };
        members: Array<{ characterId: string; position: number; muted: boolean }>;
        messages: Array<{ role: string; speakerCharacterId: string | null }>;
      };
      expect(initial.session).toMatchObject({ kind: "group", title: "小队" });
      expect(initial.members).toEqual([
        expect.objectContaining({ characterId: ariaId, position: 0, muted: false }),
        expect.objectContaining({ characterId: lisaId, position: 1, muted: false }),
      ]);
      expect(initial.messages[0]).toMatchObject({
        role: "assistant",
        speakerCharacterId: ariaId,
      });

      const members = await app.request(`/api/sessions/${sessionId}/members`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          members: [
            { characterId: lisaId, muted: false, talkativeness: 70 },
            { characterId: ariaId, muted: false, talkativeness: 30 },
          ],
        }),
      });
      expect(members.status).toBe(200);

      const settings = await app.request(`/api/sessions/${sessionId}/group-settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ replyStrategy: "manual", scenarioOverride: "打烊后的旅店" }),
      });
      expect(settings.status).toBe(200);

      const stream = await app.request("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, content: "请完整介绍这里。", speakerId: lisaId }),
      });
      expect(stream.status).toBe(200);
      const events = await readSse(stream);
      expect(events.map((event) => event.event)).toEqual(["meta", "delta", "delta", "done"]);
      expect(events[0]?.data).toMatchObject({ speakerId: lisaId, speakerName: "Lisa" });

      const refreshed = (await (await app.request(`/api/sessions/${sessionId}`)).json()) as {
        session: { groupSettings: Record<string, unknown> };
        members: Array<{ characterId: string; position: number; talkativeness: number }>;
        messages: Array<{
          role: string;
          content: string;
          status: string;
          speakerCharacterId: string | null;
          speakerName: string | null;
        }>;
      };
      expect(refreshed.session.groupSettings).toMatchObject({
        replyStrategy: "manual",
        scenarioOverride: "打烊后的旅店",
      });
      expect(refreshed.members).toEqual([
        expect.objectContaining({ characterId: lisaId, position: 0, talkativeness: 70 }),
        expect.objectContaining({ characterId: ariaId, position: 1, talkativeness: 30 }),
      ]);
      expect(refreshed.messages.filter((message) => message.role === "user")).toHaveLength(1);
      expect(refreshed.messages.at(-1)).toMatchObject({
        role: "assistant",
        content: "Lisa 的完整回复",
        status: "completed",
        speakerCharacterId: lisaId,
        speakerName: "Lisa",
      });
    });

    it("群聊静音角色需要 force 才能发言", async () => {
      const { app, sessionId, ariaId, lisaId } = await setupGroup();
      await setGroupMembers(app, sessionId, [
        { characterId: ariaId, muted: false },
        { characterId: lisaId, muted: true },
      ]);

      const rejected = await app.request("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, content: "请回答", speakerId: lisaId }),
      });
      expect(rejected.status).toBe(400);
      expect(((await rejected.json()) as { error: { code: string } }).error.code).toBe(
        "speaker_muted",
      );

      deps.upstreamFetch = fakeUpstream(["强制回复"]);
      const forced = await app.request("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, content: "请强制回答", speakerId: lisaId, force: true }),
      });
      expect(forced.status).toBe(200);
      expect((await readSse(forced)).at(-1)?.event).toBe("done");
    });

    it("群聊 list 策略按成员顺序轮换发言者", async () => {
      const { app, sessionId, ariaId, lisaId } = await setupGroup();
      await setGroupStrategy(app, sessionId, "list");

      deps.upstreamFetch = fakeUpstream(["Lisa 回复"]);
      const first = await app.request("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, content: "第一问" }),
      });
      const firstEvents = await readSse(first);
      expect(firstEvents[0]?.data).toMatchObject({ speakerId: lisaId });

      deps.upstreamFetch = fakeUpstream(["Aria 回复"]);
      const second = await app.request("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, content: "第二问" }),
      });
      const secondEvents = await readSse(second);
      expect(secondEvents[0]?.data).toMatchObject({ speakerId: ariaId });
    });

    it("群聊失败后按 speakerId 重试，复用原用户消息", async () => {
      deps.upstreamFetch = vi.fn(
        async () => new Response("boom", { status: 500 }),
      ) as unknown as typeof fetch;
      const { app, sessionId, lisaId } = await setupGroup();

      const failedResponse = await app.request("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, content: "请回答", speakerId: lisaId }),
      });
      await readSse(failedResponse);
      const failedDetail = (await (await app.request(`/api/sessions/${sessionId}`)).json()) as {
        messages: Array<{ id: string; role: string; status: string; content: string }>;
      };
      const failedUser = failedDetail.messages.at(-1);
      expect(failedUser).toMatchObject({ role: "user", content: "请回答", status: "failed" });

      const record: RecordedFetch = { url: "", init: undefined, signal: null };
      deps.upstreamFetch = fakeUpstream(["重试成功"], record);
      const retryResponse = await app.request("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          messageId: failedUser?.id,
          speakerId: lisaId,
        }),
      });
      const retryEvents = await readSse(retryResponse);
      expect(retryEvents.at(-1)?.event).toBe("done");

      const upstreamBody = JSON.parse(String(record.init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(
        upstreamBody.messages.filter((message) => message.content.includes("请回答")),
      ).toHaveLength(1);
      const completedDetail = (await (await app.request(`/api/sessions/${sessionId}`)).json()) as {
        messages: Array<{
          id: string;
          role: string;
          status: string;
          speakerCharacterId: string | null;
          speakerName: string | null;
        }>;
      };
      expect(completedDetail.messages.filter((message) => message.role === "user")).toHaveLength(1);
      expect(completedDetail.messages.at(-1)).toMatchObject({
        role: "assistant",
        status: "completed",
        speakerCharacterId: lisaId,
        speakerName: "Lisa",
      });
    });

    it("群聊重新生成沿用原 speaker 并追加 swipe 候选", async () => {
      deps.upstreamFetch = fakeUpstream(["第一次回复"]);
      const { app, sessionId, lisaId } = await setupGroup();
      await readSse(
        await app.request("/api/chat/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, content: "问题", speakerId: lisaId }),
        }),
      );

      deps.upstreamFetch = fakeUpstream(["第二次回复"]);
      const regenerated = await app.request("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, regenerate: true }),
      });
      const events = await readSse(regenerated);
      expect(events[0]?.data).toMatchObject({ speakerId: lisaId, speakerName: "Lisa" });
      expect(events.at(-1)?.event).toBe("done");

      const detail = (await (await app.request(`/api/sessions/${sessionId}`)).json()) as {
        messages: Array<{
          role: string;
          content: string;
          swipeCandidates: string[];
          speakerCharacterId: string | null;
        }>;
      };
      expect(detail.messages.filter((message) => message.role === "user")).toHaveLength(1);
      const assistant = detail.messages.at(-1);
      expect(assistant).toMatchObject({
        role: "assistant",
        content: "第二次回复",
        speakerCharacterId: lisaId,
      });
      expect(assistant?.swipeCandidates).toEqual(["第一次回复", "第二次回复"]);
    });

    it("同一会话并发生成返回 generation_in_progress", async () => {
      deps.upstreamFetch = fakeUpstream(["回复"]);
      const { app, sessionId, ariaId } = await setupGroup();

      const first = await app.request("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, content: "第一条", speakerId: ariaId }),
      });
      expect(first.status).toBe(200);

      const second = await app.request("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, content: "第二条", speakerId: ariaId }),
      });
      expect(second.status).toBe(409);
      expect(((await second.json()) as { error: { code: string } }).error.code).toBe(
        "generation_in_progress",
      );
      await readSse(first);
    });

    it("sampling 白名单内的 seed → 上游请求体带 seed", async () => {
      const record: RecordedFetch = { url: "", init: undefined, signal: null };
      deps.upstreamFetch = fakeUpstream(["嘿"], record);
      const { app, sessionId } = await setup();
      await app.request("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: "http://fake.local/v1",
          apiKey: "sk-test",
          model: "test-model",
          sampling: { temperature: 0.7, seed: 42 },
        }),
      });

      const res = await app.request("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, content: "hi" }),
      });
      expect(res.status).toBe(200);
      await readSse(res); // 排空 SSE，确保上游请求已发出

      const upstreamBody = JSON.parse(String(record.init?.body)) as {
        seed?: unknown;
        temperature?: unknown;
      };
      expect(upstreamBody.seed).toBe(42);
      expect(upstreamBody.temperature).toBe(0.7);
    });

    it("sampling 白名单外的 top_k → 上游请求体不含 top_k", async () => {
      const record: RecordedFetch = { url: "", init: undefined, signal: null };
      deps.upstreamFetch = fakeUpstream(["嘿"], record);
      const { app, sessionId } = await setup();
      await app.request("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: "http://fake.local/v1",
          apiKey: "sk-test",
          model: "test-model",
          sampling: { temperature: 0.5, top_k: 40 },
        }),
      });

      const res = await app.request("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, content: "hi" }),
      });
      expect(res.status).toBe(200);
      await readSse(res); // 排空 SSE，确保上游请求已发出

      const upstreamBody = JSON.parse(String(record.init?.body)) as {
        top_k?: unknown;
        temperature?: unknown;
      };
      expect(upstreamBody.top_k).toBeUndefined();
      expect(upstreamBody.temperature).toBe(0.5);
    });

    it("未配置 settings → 400 settings_missing", async () => {
      const app = createApp(deps);
      const form = new FormData();
      form.append("file", new File([SAMPLE_CARD], "card.png", { type: "image/png" }));
      const characterId = (
        (await (
          await app.request("/api/characters/import", { method: "POST", body: form })
        ).json()) as { id: string }
      ).id;
      const sessionId = (
        (await (
          await app.request("/api/sessions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ characterId }),
          })
        ).json()) as { id: string }
      ).id;

      const res = await app.request("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, content: "hi" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("settings_missing");
    });

    it("上游 500 → SSE error，并将用户消息标为 failed", async () => {
      deps.upstreamFetch = vi.fn(
        async () => new Response("boom", { status: 500 }),
      ) as unknown as typeof fetch;
      const { app, sessionId } = await setup();

      const res = await app.request("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, content: "hi" }),
      });
      const events = await readSse(res);
      expect(events.at(-1)?.event).toBe("error");
      expect((events.at(-1)?.data as { code: string }).code).toBe("upstream_failed");
      const detail = (await (await app.request(`/api/sessions/${sessionId}`)).json()) as {
        messages: Array<{ id: string; role: string; content: string; status: string }>;
      };
      expect(detail.messages.at(-1)).toMatchObject({
        role: "user",
        content: "hi",
        status: "failed",
      });
    });

    it("重试失败消息 → 复用同一用户消息并在成功后标为 completed", async () => {
      deps.upstreamFetch = vi.fn(
        async () => new Response("boom", { status: 500 }),
      ) as unknown as typeof fetch;
      const { app, sessionId } = await setup();
      await readSse(
        await app.request("/api/chat/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, content: "只发一次" }),
        }),
      );
      const failed = (await (await app.request(`/api/sessions/${sessionId}`)).json()) as {
        messages: Array<{ id: string; role: string; content: string; status: string }>;
      };
      const user = failed.messages.at(-1);
      expect(user).toMatchObject({ role: "user", content: "只发一次", status: "failed" });

      deps.upstreamFetch = fakeUpstream(["成功"]);
      const retryEvents = await readSse(
        await app.request("/api/chat/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, messageId: user?.id }),
        }),
      );
      expect(retryEvents.at(-1)?.event).toBe("done");
      const completed = (await (await app.request(`/api/sessions/${sessionId}`)).json()) as {
        messages: Array<{ id: string; role: string; content: string; status: string }>;
      };
      expect(completed.messages.filter((message) => message.role === "user")).toHaveLength(1);
      expect(completed.messages.find((message) => message.id === user?.id)?.status).toBe(
        "completed",
      );
    });

    it("客户端断开 → abort 上游请求", async () => {
      const record: RecordedFetch = { url: "", init: undefined, signal: null };
      deps.upstreamFetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        record.url = String(_url);
        record.init = init;
        record.signal = init?.signal ?? null;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }) as unknown as typeof fetch;
      const { app, sessionId } = await setup();

      // 真实 HTTP server：客户端 TCP 断开 → 服务端感知 abort（@hono/node-server）
      const { serve } = await import("@hono/node-server");
      const server = serve({ fetch: app.fetch, port: 0 });
      await vi.waitFor(() => expect(server.address()).not.toBeNull());
      const address = server.address();
      expect(address && typeof address === "object").toBe(true);
      const port = (address as { port: number }).port;

      try {
        const controller = new AbortController();
        const response = await fetch(`http://127.0.0.1:${port}/api/chat/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, content: "hi" }),
          signal: controller.signal,
        });
        const reader = response.body?.getReader();
        await reader?.read(); // 读到 meta 帧，确保服务端已启动上游请求

        controller.abort(); // 客户端断开
        await vi.waitFor(() => expect(record.signal?.aborted).toBe(true));
        await vi.waitFor(() =>
          expect(deps.db.repo.listMessages(sessionId).at(-1)?.status).toBe("cancelled"),
        );
      } finally {
        server.close();
      }
    });

    it("群聊客户端断开 → 保持 speaker 并将用户消息标为 cancelled", async () => {
      const record: RecordedFetch = { url: "", init: undefined, signal: null };
      deps.upstreamFetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        record.url = String(_url);
        record.init = init;
        record.signal = init?.signal ?? null;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }) as unknown as typeof fetch;
      const { app, sessionId, lisaId } = await setupGroup();

      const { serve } = await import("@hono/node-server");
      const server = serve({ fetch: app.fetch, port: 0 });
      await vi.waitFor(() => expect(server.address()).not.toBeNull());
      const address = server.address();
      expect(address && typeof address === "object").toBe(true);
      const port = (address as { port: number }).port;

      try {
        const controller = new AbortController();
        const response = await fetch(`http://127.0.0.1:${port}/api/chat/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, content: "中断测试", speakerId: lisaId }),
          signal: controller.signal,
        });
        const reader = response.body?.getReader();
        await reader?.read();

        controller.abort();
        await vi.waitFor(() => expect(record.signal?.aborted).toBe(true));
        await vi.waitFor(() => {
          const last = deps.db.repo.listMessages(sessionId).at(-1);
          expect(last?.status).toBe("cancelled");
          expect(last?.role).toBe("user");
        });
      } finally {
        server.close();
      }
    });
  });
});
