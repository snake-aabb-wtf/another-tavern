/**
 * 会话 store：列表 / 当前会话 / 流式发送 / 编辑 / swipe / 重新生成。
 * 当前会话 id 持久化到 localStorage（刷新后保持）。
 */
import { create } from "zustand";

import { streamChat } from "../api/chat.js";
import {
  createSession,
  deleteSession,
  getSessionDetail,
  listSessions,
  updateMessage,
  type ChatMessageRow,
  type SessionSummary,
} from "../api/sessions.js";

const CURRENT_SESSION_KEY = "at.currentSession";

interface StreamingState {
  text: string;
}

interface SessionsState {
  sessions: SessionSummary[];
  currentId: string | null;
  messages: ChatMessageRow[];
  streaming: StreamingState | null;
  loading: boolean;
  error: string | null;

  loadSessions: () => Promise<void>;
  openSession: (id: string) => Promise<void>;
  createSession: (characterId: string, title?: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  send: (content: string) => Promise<void>;
  regenerate: () => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  swipeTo: (messageId: string, index: number) => Promise<void>;
}

function storedSessionId(): string | null {
  try {
    return localStorage.getItem(CURRENT_SESSION_KEY);
  } catch {
    return null;
  }
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  currentId: null,
  messages: [],
  streaming: null,
  loading: false,
  error: null,

  loadSessions: async () => {
    set({ loading: true, error: null });
    try {
      const sessions = await listSessions();
      const currentId = get().currentId ?? storedSessionId();
      set({ sessions, loading: false, currentId });
      // 恢复上次打开的会话（刷新后保持）
      if (currentId !== null && get().messages.length === 0) {
        const exists = sessions.some((s) => s.id === currentId);
        if (exists) {
          await get().openSession(currentId);
        } else {
          localStorage.removeItem(CURRENT_SESSION_KEY);
          set({ currentId: null });
        }
      }
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  openSession: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const detail = await getSessionDetail(id);
      try {
        localStorage.setItem(CURRENT_SESSION_KEY, id);
      } catch {
        // localStorage 不可用（隐私模式）：仅内存保持
      }
      set({ currentId: id, messages: detail.messages, streaming: null, loading: false });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  createSession: async (characterId: string, title?: string) => {
    const session = await createSession(characterId, title);
    await get().loadSessions();
    await get().openSession(session.id);
  },

  deleteSession: async (id: string) => {
    await deleteSession(id);
    if (get().currentId === id) {
      set({ currentId: null, messages: [] });
      try {
        localStorage.removeItem(CURRENT_SESSION_KEY);
      } catch {
        // 忽略
      }
    }
    await get().loadSessions();
  },

  send: async (content: string) => {
    const currentId = get().currentId;
    if (currentId === null || content.trim() === "" || get().streaming !== null) {
      return;
    }
    set({ streaming: { text: "" }, error: null });
    try {
      const { content: full } = await streamChat(
        { sessionId: currentId, content },
        {
          onDelta: (text) => {
            const streaming = get().streaming;
            set({ streaming: { text: (streaming?.text ?? "") + text } });
          },
          onError: (message) => {
            set({ error: message });
          },
        },
      );
      // 完成后刷新消息（user 与 assistant 均已由后端落库）
      const detail = await getSessionDetail(currentId);
      set({ messages: detail.messages, streaming: null });
      if (full === "") {
        set({ error: "上游返回空回复。" });
      }
    } catch (error) {
      set({ streaming: null, error: error instanceof Error ? error.message : String(error) });
    }
  },

  regenerate: async () => {
    const currentId = get().currentId;
    if (currentId === null || get().streaming !== null) {
      return;
    }
    set({ streaming: { text: "" }, error: null });
    try {
      await streamChat(
        { sessionId: currentId, regenerate: true },
        {
          onDelta: (text) => {
            const streaming = get().streaming;
            set({ streaming: { text: (streaming?.text ?? "") + text } });
          },
          onError: (message) => {
            set({ error: message });
          },
        },
      );
      const detail = await getSessionDetail(currentId);
      set({ messages: detail.messages, streaming: null });
    } catch (error) {
      set({ streaming: null, error: error instanceof Error ? error.message : String(error) });
    }
  },

  editMessage: async (messageId: string, content: string) => {
    const currentId = get().currentId;
    if (currentId === null) {
      return;
    }
    const updated = await updateMessage(currentId, messageId, { content });
    set({ messages: get().messages.map((m) => (m.id === messageId ? updated : m)) });
  },

  swipeTo: async (messageId: string, index: number) => {
    const currentId = get().currentId;
    if (currentId === null) {
      return;
    }
    const updated = await updateMessage(currentId, messageId, { swipeIndex: index });
    set({ messages: get().messages.map((m) => (m.id === messageId ? updated : m)) });
  },
}));
