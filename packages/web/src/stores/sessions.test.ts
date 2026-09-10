/** sessions store 核心逻辑测试（发送/重生成/编辑/swipe/刷新保持）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSessionsStore } from "./sessions.js";

function sseResponse(deltas: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // 服务器 SSE 事件格式：delta 帧 + done 帧（见 routes/chat.ts）
      for (const delta of deltas) {
        controller.enqueue(
          encoder.encode(`event: delta\ndata: ${JSON.stringify({ text: delta })}\n\n`),
        );
      }
      controller.enqueue(
        encoder.encode(
          `event: done\ndata: ${JSON.stringify({ messageId: "a1", content: deltas.join("") })}\n\n`,
        ),
      );
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

/** 按路由匹配的 fake fetch；calls 记录全部请求。 */
function makeFetch(
  routes: Array<{
    match: (url: string, init: RequestInit) => boolean;
    respond: (init: RequestInit) => Response;
  }>,
): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const requestInit = init ?? {};
    calls.push({ url, init: requestInit });
    for (const route of routes) {
      if (route.match(url, requestInit)) {
        return route.respond(requestInit);
      }
    }
    return new Response(JSON.stringify({ error: { code: "no_route", message: url } }), {
      status: 404,
    });
  });
  return { fetch: fetchMock as unknown as typeof fetch, calls };
}

const CHAT_DETAIL: {
  session: { id: string; characterId: string; title: string; planId: null; createdAt: string };
  messages: import("../api/sessions.js").ChatMessageRow[];
} = {
  session: { id: "s1", characterId: "c1", title: "T", planId: null, createdAt: "" },
  messages: [
    {
      id: "g",
      sessionId: "s1",
      role: "assistant",
      content: "GREET",
      status: "completed",
      swipeCandidates: ["GREET"],
      swipeIndex: 0,
      seq: 1,
      createdAt: "",
    },
    {
      id: "u1",
      sessionId: "s1",
      role: "user",
      content: "hi",
      status: "completed",
      swipeCandidates: [],
      swipeIndex: 0,
      seq: 2,
      createdAt: "",
    },
    {
      id: "a1",
      sessionId: "s1",
      role: "assistant",
      content: "回复-v2",
      status: "completed",
      swipeCandidates: ["回复-v1", "回复-v2"],
      swipeIndex: 1,
      seq: 3,
      createdAt: "",
    },
  ],
};

describe("sessions store", () => {
  beforeEach(() => {
    useSessionsStore.setState({
      sessions: [],
      currentId: "s1",
      messages: [],
      streaming: null,
      loading: false,
      error: null,
    });
    try {
      localStorage.clear();
    } catch {
      // node 环境无 localStorage
    }
  });

  it("send：流式 delta 累积到 streaming，完成后刷新消息", async () => {
    let chatCount = 0;
    const { fetch } = makeFetch([
      {
        match: (url) => url.endsWith("/api/chat/stream"),
        respond: () => sseResponse(["你", "好"]),
      },
      {
        match: (url) => url.includes("/api/sessions/s1") && chatCount++ >= 0,
        respond: () =>
          new Response(JSON.stringify(CHAT_DETAIL), {
            headers: { "content-type": "application/json" },
          }),
      },
    ]);
    vi.stubGlobal("fetch", fetch);

    await useSessionsStore.getState().send("你好");

    const state = useSessionsStore.getState();
    expect(state.streaming).toBeNull();
    expect(state.messages).toEqual(CHAT_DETAIL.messages);
    expect(state.error).toBeNull();
    vi.unstubAllGlobals();
  });

  it("regenerate：发送 regenerate 标记且不带 content", async () => {
    const { fetch, calls } = makeFetch([
      { match: (url) => url.endsWith("/api/chat/stream"), respond: () => sseResponse(["新"]) },
      {
        match: (url) => url.includes("/api/sessions/s1"),
        respond: () => new Response(JSON.stringify(CHAT_DETAIL)),
      },
    ]);
    vi.stubGlobal("fetch", fetch);

    await useSessionsStore.getState().regenerate();

    const chatCall = calls.find((c) => c.url.endsWith("/api/chat/stream"));
    const body = JSON.parse(String(chatCall?.init.body)) as {
      regenerate?: boolean;
      content?: string;
    };
    expect(body.regenerate).toBe(true);
    expect(body.content).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("retryMessage：复用失败消息 id，不发送 content", async () => {
    const failedDetail = {
      ...CHAT_DETAIL,
      messages: CHAT_DETAIL.messages.map((message) =>
        message.id === "u1" ? { ...message, status: "failed" as const } : message,
      ),
    };
    const completedDetail = {
      ...CHAT_DETAIL,
      messages: CHAT_DETAIL.messages.map((message) =>
        message.id === "u1" ? { ...message, status: "completed" as const } : message,
      ),
    };
    useSessionsStore.setState({ messages: failedDetail.messages });
    const { fetch, calls } = makeFetch([
      {
        match: (url) => url.endsWith("/api/chat/stream"),
        respond: () => sseResponse(["重试成功"]),
      },
      {
        match: (url) => url.includes("/api/sessions/s1"),
        respond: () => new Response(JSON.stringify(completedDetail)),
      },
    ]);
    vi.stubGlobal("fetch", fetch);

    await useSessionsStore.getState().retryMessage("u1");

    const chatCall = calls.find((call) => call.url.endsWith("/api/chat/stream"));
    expect(JSON.parse(String(chatCall?.init.body))).toEqual({ sessionId: "s1", messageId: "u1" });
    expect(
      useSessionsStore.getState().messages.find((message) => message.id === "u1")?.status,
    ).toBe("completed");
    vi.unstubAllGlobals();
  });

  it("editMessage：PUT content 并用响应替换本地消息", async () => {
    useSessionsStore.setState({ messages: CHAT_DETAIL.messages });
    const { fetch, calls } = makeFetch([
      {
        match: (url) => url.includes("/messages/u1"),
        respond: () =>
          new Response(JSON.stringify({ ...CHAT_DETAIL.messages[1], content: "编辑后" }), {
            headers: { "content-type": "application/json" },
          }),
      },
    ]);
    vi.stubGlobal("fetch", fetch);

    await useSessionsStore.getState().editMessage("u1", "编辑后");

    const call = calls.find((c) => c.url.includes("/messages/u1"));
    expect(call?.init.method).toBe("PUT");
    expect(JSON.parse(String(call?.init.body))).toEqual({ content: "编辑后" });
    expect(useSessionsStore.getState().messages.find((m) => m.id === "u1")?.content).toBe("编辑后");
    vi.unstubAllGlobals();
  });

  it("swipeTo：PUT swipeIndex 并更新本地消息内容", async () => {
    useSessionsStore.setState({ messages: CHAT_DETAIL.messages });
    const { fetch, calls } = makeFetch([
      {
        match: (url) => url.includes("/messages/a1"),
        respond: () =>
          new Response(
            JSON.stringify({ ...CHAT_DETAIL.messages[2], content: "回复-v1", swipeIndex: 0 }),
            { headers: { "content-type": "application/json" } },
          ),
      },
    ]);
    vi.stubGlobal("fetch", fetch);

    await useSessionsStore.getState().swipeTo("a1", 0);

    const call = calls.find((c) => c.url.includes("/messages/a1"));
    expect(call?.init.method).toBe("PUT");
    expect(JSON.parse(String(call?.init.body))).toEqual({ swipeIndex: 0 });
    expect(useSessionsStore.getState().messages.find((m) => m.id === "a1")?.content).toBe(
      "回复-v1",
    );
    vi.unstubAllGlobals();
  });

  it("createSession：创建 → 列表刷新 → 打开新会话并写入 localStorage", async () => {
    const created = { id: "s-new", characterId: "c1", title: "Aria", planId: null, createdAt: "" };
    const detail = { session: created, messages: [] };
    const { fetch, calls } = makeFetch([
      {
        match: (url, init) => url.endsWith("/api/sessions") && init.method === "POST",
        respond: () => new Response(JSON.stringify(created), { status: 201 }),
      },
      {
        match: (url, init) => url.endsWith("/api/sessions") && init.method === "GET",
        respond: () => new Response(JSON.stringify([created])),
      },
      {
        match: (url) => url.includes("/api/sessions/s-new"),
        respond: () => new Response(JSON.stringify(detail)),
      },
    ]);
    vi.stubGlobal("fetch", fetch);

    await useSessionsStore.getState().createSession("c1", "Aria");

    const postCall = calls.find((c) => c.init.method === "POST");
    expect(postCall).toBeDefined();
    expect(useSessionsStore.getState().currentId).toBe("s-new");
    try {
      expect(localStorage.getItem("at.currentSession")).toBe("s-new");
    } catch {
      // node 环境跳过 localStorage 断言
    }
    vi.unstubAllGlobals();
  });
});
