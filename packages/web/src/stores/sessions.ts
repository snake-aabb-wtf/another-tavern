/**
 * 会话 store：列表 / 当前会话 / 流式发送 / 编辑 / swipe / 重新生成。
 * 当前会话 id 持久化到 localStorage（刷新后保持）。
 */
import { create } from "zustand";

import { streamChat } from "../api/chat.js";
import {
  createGroupSession as createGroupSessionApi,
  createSession,
  deleteSession,
  getLastPrompt,
  getSessionDetail,
  listSessions,
  replaceSessionMembers,
  setSessionPlan,
  updateMessage,
  updateGroupSettings,
  type ChatMessageRow,
  type GroupSettings,
  type PromptMessages,
  type SessionMember,
  type SessionMemberPatch,
  type SessionSummary,
} from "../api/sessions.js";
import { getCharacterLorebookLinks } from "../api/lorebooks.js";

const CURRENT_SESSION_KEY = "at.currentSession";

interface StreamingState {
  text: string;
}

interface SessionsState {
  sessions: SessionSummary[];
  currentId: string | null;
  currentCharacterId: string | null;
  messages: ChatMessageRow[];
  currentMembers: SessionMember[];
  currentGroupSettings: GroupSettings | null;
  currentSpeakerId: string | null;
  forceSpeaker: boolean;
  /** M6：当前角色挂载的世界书 id。 */
  linkedBookIds: string[];
  /** M6：最近一次组装的最终 prompt（null = 未拉取）。 */
  lastPrompt: PromptMessages | null;
  streaming: StreamingState | null;
  loading: boolean;
  error: string | null;

  loadSessions: () => Promise<void>;
  openSession: (id: string) => Promise<void>;
  createSession: (characterId: string, title?: string) => Promise<void>;
  createGroupSession: (characterIds: string[], title?: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  setCurrentSpeaker: (characterId: string | null) => void;
  setForceSpeaker: (force: boolean) => void;
  saveGroupMembers: (members: SessionMemberPatch[]) => Promise<void>;
  saveGroupSettings: (patch: Partial<GroupSettings>) => Promise<void>;
  send: (content: string, options?: { force?: boolean }) => Promise<void>;
  /** 重试同一条失败/取消的用户消息，不新增消息行。 */
  retryMessage: (messageId: string) => Promise<void>;
  regenerate: () => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  swipeTo: (messageId: string, index: number) => Promise<void>;
  /** M6：切换会话组装计划（null = 回落全局默认）。 */
  setPlan: (planId: string | null) => Promise<void>;
  /** M6：拉取最近一次组装的最终 prompt。 */
  fetchLastPrompt: () => Promise<void>;
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
  currentCharacterId: null,
  linkedBookIds: [],
  messages: [],
  currentMembers: [],
  currentGroupSettings: null,
  currentSpeakerId: null,
  forceSpeaker: false,
  lastPrompt: null,
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
      set({
        currentId: id,
        currentCharacterId: detail.session.characterId,
        messages: detail.messages,
        currentMembers: detail.members,
        currentGroupSettings:
          detail.session.kind === "group"
            ? (detail.session.groupSettings as GroupSettings | null)
            : null,
        currentSpeakerId:
          detail.session.kind === "group"
            ? (detail.members.find((member) => !member.muted)?.characterId ??
              detail.members[0]?.characterId ??
              null)
            : null,
        forceSpeaker: false,
        streaming: null,
        loading: false,
      });
      // M6：拉取当前角色的世界书挂载（用于聊天页来源展示）
      try {
        const { bookIds } = await getCharacterLorebookLinks(detail.session.characterId);
        set({ linkedBookIds: bookIds });
      } catch {
        set({ linkedBookIds: [] });
      }
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  /** M6：切换当前会话的组装计划（null = 回落全局默认）。 */
  setPlan: async (planId: string | null) => {
    const currentId = get().currentId;
    if (currentId === null) {
      return;
    }
    await setSessionPlan(currentId, planId);
    set({
      sessions: get().sessions.map((s) => (s.id === currentId ? { ...s, planId } : s)),
    });
  },

  /** M6：拉取最近一次组装的最终 prompt。 */
  fetchLastPrompt: async () => {
    const currentId = get().currentId;
    if (currentId === null) {
      return;
    }
    try {
      const last = await getLastPrompt(currentId);
      set({ lastPrompt: last });
    } catch {
      set({ lastPrompt: null });
    }
  },

  createSession: async (characterId: string, title?: string) => {
    const session = await createSession(characterId, title);
    await get().loadSessions();
    await get().openSession(session.id);
  },

  createGroupSession: async (characterIds: string[], title?: string) => {
    const session = await createGroupSessionApi(characterIds, title);
    await get().loadSessions();
    await get().openSession(session.id);
  },

  setCurrentSpeaker: (characterId: string | null) => {
    set({ currentSpeakerId: characterId });
  },

  setForceSpeaker: (force: boolean) => {
    set({ forceSpeaker: force });
  },

  saveGroupMembers: async (members: SessionMemberPatch[]) => {
    const currentId = get().currentId;
    if (currentId === null) {
      return;
    }
    const result = await replaceSessionMembers(currentId, members);
    const currentSpeakerId = get().currentSpeakerId;
    const nextSpeaker = result.members.some((member) => member.characterId === currentSpeakerId)
      ? currentSpeakerId
      : (result.members.find((member) => !member.muted)?.characterId ??
        result.members[0]?.characterId ??
        null);
    set({ currentMembers: result.members, currentSpeakerId: nextSpeaker });
  },

  saveGroupSettings: async (patch: Partial<GroupSettings>) => {
    const currentId = get().currentId;
    if (currentId === null) {
      return;
    }
    const result = await updateGroupSettings(currentId, patch);
    set({
      currentGroupSettings: result.groupSettings,
      sessions: get().sessions.map((session) =>
        session.id === currentId ? { ...session, groupSettings: result.groupSettings } : session,
      ),
    });
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

  send: async (content: string, options?: { force?: boolean }) => {
    const currentId = get().currentId;
    if (currentId === null || content.trim() === "" || get().streaming !== null) {
      return;
    }
    const session = get().sessions.find((item) => item.id === currentId);
    const isGroup = session?.kind === "group";
    const settings = get().currentGroupSettings ?? session?.groupSettings;
    const speakerId = get().currentSpeakerId;
    const force = options?.force ?? get().forceSpeaker;
    if (isGroup && settings?.replyStrategy === "manual" && speakerId === null) {
      set({ error: "请先选择发言角色。" });
      return;
    }
    set({ streaming: { text: "" }, error: null });
    try {
      const { content: full } = await streamChat(
        {
          sessionId: currentId,
          content,
          ...(isGroup && settings?.replyStrategy === "manual" && speakerId !== null
            ? { speakerId, force }
            : {}),
        },
        {
          onDelta: (text) => {
            const streaming = get().streaming;
            set({ streaming: { text: (streaming?.text ?? "") + text } });
          },
          onError: (message) => {
            set({ error: message });
          },
          onMeta: (data) => {
            if (typeof data.speakerId === "string") {
              set({ currentSpeakerId: data.speakerId });
            }
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
      try {
        const detail = await getSessionDetail(currentId);
        if (get().currentId === currentId) {
          set({ messages: detail.messages });
        }
      } catch {
        // 原错误优先；刷新失败不覆盖它
      }
    }
  },

  retryMessage: async (messageId: string) => {
    const currentId = get().currentId;
    if (currentId === null || get().streaming !== null) {
      return;
    }
    set({ streaming: { text: "" }, error: null });
    try {
      const session = get().sessions.find((item) => item.id === currentId);
      const isGroup = session?.kind === "group";
      const retryTarget = get().messages.find((message) => message.id === messageId);
      const speakerId = retryTarget?.speakerCharacterId ?? get().currentSpeakerId;
      const { content: full } = await streamChat(
        {
          sessionId: currentId,
          messageId,
          ...(isGroup && speakerId !== null ? { speakerId, force: get().forceSpeaker } : {}),
        },
        {
          onDelta: (text) => {
            const streaming = get().streaming;
            set({ streaming: { text: (streaming?.text ?? "") + text } });
          },
          onError: (message) => {
            set({ error: message });
          },
          onMeta: (data) => {
            if (typeof data.speakerId === "string") {
              set({ currentSpeakerId: data.speakerId });
            }
          },
        },
      );
      const detail = await getSessionDetail(currentId);
      set({ messages: detail.messages, streaming: null });
      if (full === "") {
        set({ error: "上游返回空回复。" });
      }
    } catch (error) {
      set({ streaming: null, error: error instanceof Error ? error.message : String(error) });
      try {
        const detail = await getSessionDetail(currentId);
        if (get().currentId === currentId) {
          set({ messages: detail.messages });
        }
      } catch {
        // 原错误优先；刷新失败不覆盖它
      }
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
          onMeta: (data) => {
            if (typeof data.speakerId === "string") {
              set({ currentSpeakerId: data.speakerId });
            }
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
