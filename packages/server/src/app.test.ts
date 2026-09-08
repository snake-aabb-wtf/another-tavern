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
      expect(await res.json()).toEqual({ baseUrl: "", model: "", apiKey: "", hasApiKey: false });
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
    async function importCard(): Promise<string> {
      const form = new FormData();
      form.append("file", new File([SAMPLE_CARD], "card.png", { type: "image/png" }));
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
        messages: Array<{ role: string; content: string; swipeCandidates: string[]; seq: number }>;
      };
      expect(detail.messages).toHaveLength(1);
      expect(detail.messages[0]?.role).toBe("assistant");
      expect(detail.messages[0]?.content).toBe("欢迎光临。");
      expect(detail.messages[0]?.swipeCandidates).toEqual(["欢迎光临。"]);
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
        messages: Array<{ role: string; content: string; swipeCandidates: string[] }>;
      };
      const assistant = detail.messages.at(-1);
      expect(assistant?.role).toBe("assistant");
      expect(assistant?.content).toBe("你好，旅人");
      expect(assistant?.swipeCandidates).toEqual(["你好，旅人"]);

      // 上游请求体为组装后的 messages（system 在前 + 历史）
      const upstreamBody = JSON.parse(String(record.init?.body)) as {
        messages: Array<{ role: string }>;
      };
      expect(upstreamBody.messages[0]?.role).toBe("system");
      expect(upstreamBody.messages.at(-1)?.role).toBe("user");
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

    it("上游 500 → SSE error 事件（upstream_failed）", async () => {
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
    });

    it("客户端断开 → abort 上游请求", async () => {
      const record: RecordedFetch = { url: "", init: undefined, signal: null };
      deps.upstreamFetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        record.url = String(_url);
        record.init = init;
        record.signal = init?.signal ?? null;
        return new Promise<Response>(() => {}); // 永不返回，模拟慢上游
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
      } finally {
        server.close();
      }
    });
  });
});
