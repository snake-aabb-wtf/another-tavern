/** api client 核心逻辑测试（JSON 错误解析、multipart、SSE 帧解析）。 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, readSseStream } from "./client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api.request", () => {
  it("GET 成功返回解析后的 JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { ok: true })),
    );
    await expect(api.get("/api/health")).resolves.toEqual({ ok: true });
  });

  it("204 返回 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(api.del("/api/x")).resolves.toBeNull();
  });

  it("错误响应 → ApiError 携带后端 code 与 message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(404, { error: { code: "not_found", message: "会话不存在。" } }),
      ),
    );
    try {
      await api.get("/api/sessions/nope");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.status).toBe(404);
      expect(err.code).toBe("not_found");
      expect(err.message).toContain("会话不存在");
    }
  });

  it("post 序列化 JSON body", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init: RequestInit) => {
      void url;
      void init;
      return jsonResponse(201, { id: "1" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await api.post("/api/sessions", { characterId: "c1" });

    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ characterId: "c1" });
  });
});

describe("readSseStream", () => {
  it("逐帧解析 event/data 并回调", async () => {
    const frames: Array<{ event: string; data: unknown }> = [];
    const framesAll = await readSseStream(
      sseResponse([
        'event: meta\ndata: {"tokensTotal": 10}\n\n',
        'event: delta\ndata: {"text": "你好"}\n\n',
        'event: delta\ndata: {"text": "！"}\n\n',
        'event: done\ndata: {"content": "你好！"}\n\n',
      ]),
      (frame) => frames.push(frame),
    );

    expect(framesAll.map((f) => f.event)).toEqual(["meta", "delta", "delta", "done"]);
    expect(frames[1]?.data).toEqual({ text: "你好" });
  });

  it("跨 chunk 的帧正确拼接（流式边界）", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: delta\ndata: {"te'));
        controller.enqueue(encoder.encode('xt": "断"}\n\n'));
        controller.close();
      },
    });
    const frames: Array<{ event: string; data: unknown }> = [];
    await readSseStream(new Response(body), (frame) => frames.push(frame));

    expect(frames[0]?.data).toEqual({ text: "断" });
  });

  it("错误状态 → ApiError", async () => {
    await expect(
      readSseStream(new Response("boom", { status: 500 }), () => {}),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
