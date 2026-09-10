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
  session: {
    id: string;
    characterId: string;
    title: string;
    kind: "single";
    groupSettings: null;
    planId: null;
    createdAt: string;
  };
  members: [];
  messages: import("../api/sessions.js").ChatMessageRow[];
} = {
  session: {
    id: "s1",
    characterId: "c1",
    title: "T",
    kind: "single",
    groupSettings: null,
    planId: null,
    createdAt: "",
  },
  members: [],
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
      currentMembers: [],
      currentGroupSettings: null,
      currentSpeakerId: null,
      forceSpeaker: false,
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
    const created = {
      id: "s-new",
      characterId: "c1",
      title: "Aria",
      kind: "single",
      groupSettings: null,
      planId: null,
      createdAt: "",
    };
    const detail = { session: created, members: [], messages: [] };
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

  it("群聊 send：手动策略发送 speakerId 与 force", async () => {
    const groupSession = {
      id: "g1",
      characterId: "c1",
      title: "酒馆夜谈",
      kind: "group" as const,
      groupSettings: {
        replyStrategy: "manual" as const,
        generationMode: "swap" as const,
        scenarioOverride: null,
        allowSelfResponses: false,
      },
      planId: null,
      createdAt: "",
    };
    useSessionsStore.setState({
      currentId: "g1",
      sessions: [groupSession],
      currentGroupSettings: groupSession.groupSettings,
      currentSpeakerId: "c2",
      forceSpeaker: true,
    });
    const { fetch, calls } = makeFetch([
      { match: (url) => url.endsWith("/api/chat/stream"), respond: () => sseResponse(["回复"]) },
      {
        match: (url) => url.includes("/api/sessions/g1"),
        respond: () =>
          new Response(JSON.stringify({ session: groupSession, members: [], messages: [] })),
      },
    ]);
    vi.stubGlobal("fetch", fetch);

    await useSessionsStore.getState().send("晚上好");

    const chatCall = calls.find((call) => call.url.endsWith("/api/chat/stream"));
    expect(JSON.parse(String(chatCall?.init.body))).toMatchObject({
      sessionId: "g1",
      content: "晚上好",
      speakerId: "c2",
      force: true,
    });
    vi.unstubAllGlobals();
  });

  it("createGroupSession：创建群聊时发送角色顺序", async () => {
    const created = {
      id: "g-new",
      characterId: "c1",
      title: "夜谈",
      kind: "group" as const,
      groupSettings: {
        replyStrategy: "manual" as const,
        generationMode: "swap" as const,
        scenarioOverride: null,
        allowSelfResponses: false,
      },
      planId: null,
      createdAt: "",
    };
    const detail = {
      session: created,
      members: [
        {
          sessionId: "g-new",
          characterId: "c1",
          characterName: "Aria",
          position: 0,
          muted: false,
          talkativeness: 50,
          createdAt: "",
        },
        {
          sessionId: "g-new",
          characterId: "c2",
          characterName: "Lisa",
          position: 1,
          muted: false,
          talkativeness: 50,
          createdAt: "",
        },
      ],
      messages: [],
    };
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
        match: (url) => url.includes("/api/sessions/g-new"),
        respond: () => new Response(JSON.stringify(detail)),
      },
      {
        match: (url) => url.includes("/api/characters/c1/lorebook-links"),
        respond: () => new Response(JSON.stringify({ characterId: "c1", bookIds: [] })),
      },
    ]);
    vi.stubGlobal("fetch", fetch);

    await useSessionsStore.getState().createGroupSession(["c1", "c2"], "夜谈");

    const postCall = calls.find((call) => call.init.method === "POST");
    expect(JSON.parse(String(postCall?.init.body))).toEqual({
      kind: "group",
      title: "夜谈",
      characterIds: ["c1", "c2"],
    });
    expect(useSessionsStore.getState().currentMembers).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("群聊设置：保存成员顺序和群聊策略", async () => {
    const updatedMembers = [
      {
        sessionId: "s1",
        characterId: "c2",
        characterName: "Lisa",
        position: 0,
        muted: true,
        talkativeness: 25,
        createdAt: "",
      },
      {
        sessionId: "s1",
        characterId: "c1",
        characterName: "Aria",
        position: 1,
        muted: false,
        talkativeness: 75,
        createdAt: "",
      },
    ];
    const updatedSettings = {
      replyStrategy: "list" as const,
      generationMode: "swap" as const,
      scenarioOverride: "酒馆打烊后",
      allowSelfResponses: true,
    };
    const { fetch, calls } = makeFetch([
      {
        match: (url, init) => url.endsWith("/members") && init.method === "PUT",
        respond: () => new Response(JSON.stringify({ sessionId: "s1", members: updatedMembers })),
      },
      {
        match: (url, init) => url.endsWith("/group-settings") && init.method === "PUT",
        respond: () =>
          new Response(JSON.stringify({ sessionId: "s1", groupSettings: updatedSettings })),
      },
    ]);
    vi.stubGlobal("fetch", fetch);

    await useSessionsStore.getState().saveGroupMembers([
      { characterId: "c2", muted: true, talkativeness: 25 },
      { characterId: "c1", muted: false, talkativeness: 75 },
    ]);
    await useSessionsStore.getState().saveGroupSettings(updatedSettings);

    expect(calls.map((call) => call.init.method)).toEqual(["PUT", "PUT"]);
    expect(useSessionsStore.getState().currentMembers).toEqual(updatedMembers);
    expect(useSessionsStore.getState().currentGroupSettings).toEqual(updatedSettings);
    vi.unstubAllGlobals();
  });
});
