/** 会话与消息 API。 */
import { api } from "./client.js";

export interface SessionSummary {
  id: string;
  characterId: string;
  title: string;
  kind: "single" | "group";
  groupSettings: Record<string, unknown> | null;
  planId: string | null;
  createdAt: string;
}

export interface GroupSettings {
  replyStrategy: "manual" | "list";
  generationMode: "swap";
  scenarioOverride: string | null;
  allowSelfResponses: boolean;
  [key: string]: unknown;
}

export interface SessionMember {
  sessionId: string;
  characterId: string;
  characterName: string;
  position: number;
  muted: boolean;
  talkativeness: number;
  createdAt: string;
}

export interface ChatMessageRow {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  speakerCharacterId?: string | null;
  speakerName?: string | null;
  status: "pending" | "completed" | "failed" | "cancelled";
  swipeCandidates: string[];
  swipeIndex: number;
  seq: number;
  createdAt: string;
}

export interface SessionDetail {
  session: SessionSummary;
  members: SessionMember[];
  messages: ChatMessageRow[];
}

export function listSessions(): Promise<SessionSummary[]> {
  return api.get("/api/sessions") as Promise<SessionSummary[]>;
}

export function getSessionDetail(id: string): Promise<SessionDetail> {
  return api.get(`/api/sessions/${id}`) as Promise<SessionDetail>;
}

export function createSession(characterId: string, title?: string): Promise<SessionSummary> {
  return api.post("/api/sessions", { characterId, title }) as Promise<SessionSummary>;
}

export function createGroupSession(
  characterIds: string[],
  title?: string,
): Promise<SessionSummary> {
  return api.post("/api/sessions", {
    kind: "group",
    title,
    characterIds,
  }) as Promise<SessionSummary>;
}

export function getSessionMembers(
  sessionId: string,
): Promise<{ sessionId: string; members: SessionMember[] }> {
  return api.get(`/api/sessions/${sessionId}/members`) as Promise<{
    sessionId: string;
    members: SessionMember[];
  }>;
}

export interface SessionMemberPatch {
  characterId: string;
  muted: boolean;
  talkativeness: number;
}

export function replaceSessionMembers(
  sessionId: string,
  members: SessionMemberPatch[],
): Promise<{ sessionId: string; members: SessionMember[] }> {
  return api.put(`/api/sessions/${sessionId}/members`, { members }) as Promise<{
    sessionId: string;
    members: SessionMember[];
  }>;
}

export function updateGroupSettings(
  sessionId: string,
  patch: Partial<GroupSettings>,
): Promise<{ sessionId: string; groupSettings: GroupSettings }> {
  return api.put(`/api/sessions/${sessionId}/group-settings`, patch) as Promise<{
    sessionId: string;
    groupSettings: GroupSettings;
  }>;
}

export function deleteSession(id: string): Promise<null> {
  return api.del(`/api/sessions/${id}`) as Promise<null>;
}

export function postMessage(sessionId: string, content: string): Promise<ChatMessageRow> {
  return api.post(`/api/sessions/${sessionId}/messages`, {
    role: "user",
    content,
  }) as Promise<ChatMessageRow>;
}

export interface MessagePatch {
  content?: string;
  swipeIndex?: number;
}

export function updateMessage(
  sessionId: string,
  messageId: string,
  patch: MessagePatch,
): Promise<ChatMessageRow> {
  return api.put(
    `/api/sessions/${sessionId}/messages/${messageId}`,
    patch,
  ) as Promise<ChatMessageRow>;
}

/** M6：切换会话组装计划（null = 回落全局默认）。 */
export function setSessionPlan(
  sessionId: string,
  planId: string | null,
): Promise<{ sessionId: string; planId: string | null }> {
  return api.put(`/api/sessions/${sessionId}/plan`, { planId }) as Promise<{
    sessionId: string;
    planId: string | null;
  }>;
}

export interface PromptMessages {
  sessionId: string;
  /** 最终 messages（role + content）。 */
  messages: Array<{ role: string; content: string }>;
}

/** M6：读取最近一次组装的最终 prompt。 */
export function getLastPrompt(sessionId: string): Promise<PromptMessages> {
  return api.get(`/api/sessions/${sessionId}/last-prompt`) as Promise<PromptMessages>;
}
