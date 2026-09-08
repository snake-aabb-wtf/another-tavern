/** 世界书 API（M4 CRUD + 导入 + 角色挂载）。 */
import { api } from "./client.js";

export interface LorebookSummary {
  id: string;
  name: string;
  description: string;
  isGlobal: boolean;
  tokenBudget: number | null;
  scanDepth: number | null;
  recursiveScanning: boolean | null;
  createdAt: string;
}

export interface LorebookEntryData {
  id: string;
  comment: string;
  keys: string[];
  secondaryKeys: string[];
  selective: boolean;
  logic: "andAny" | "andAll" | "notAny" | "notAll";
  content: string;
  enabled: boolean;
  constant: boolean;
  insertionOrder: number;
  position: string;
  depth: number | null;
  role: "system" | "user" | "assistant" | null;
  scanDepth: number | null;
  caseSensitive: boolean | null;
  matchWholeWords: boolean | null;
  preventRecursion: boolean;
  excludeRecursion: boolean;
  extensions: Record<string, unknown>;
}

export interface LorebookDetail extends LorebookSummary {
  entries: LorebookEntryData[];
}

export function listLorebooks(): Promise<LorebookSummary[]> {
  return api.get("/api/lorebooks") as Promise<LorebookSummary[]>;
}

export function getLorebook(id: string): Promise<LorebookDetail> {
  return api.get(`/api/lorebooks/${id}`) as Promise<LorebookDetail>;
}

export function createLorebook(body: {
  name: string;
  description?: string;
  isGlobal?: boolean;
}): Promise<LorebookSummary> {
  return api.post("/api/lorebooks", body) as Promise<LorebookSummary>;
}

export function updateLorebook(
  id: string,
  body: {
    name?: string;
    description?: string;
    isGlobal?: boolean;
    tokenBudget?: number | null;
    scanDepth?: number | null;
    recursiveScanning?: boolean | null;
  },
): Promise<LorebookSummary> {
  return api.put(`/api/lorebooks/${id}`, body) as Promise<LorebookSummary>;
}

export function deleteLorebook(id: string): Promise<null> {
  return api.del(`/api/lorebooks/${id}`) as Promise<null>;
}

export interface WorldInfoImportResult {
  id: string;
  name: string;
  entryCount: number;
  warnings: Array<{ code: string; message: string }>;
}

/** ST 世界书 JSON 导入（isGlobal 经查询串传递，导入响应即解析摘要）。 */
export async function importWorldInfo(
  file: File,
  isGlobal: boolean,
): Promise<WorldInfoImportResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/lorebooks/import?isGlobal=${isGlobal ? "1" : "0"}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as WorldInfoImportResult;
}

export function createEntry(
  bookId: string,
  entry: Partial<LorebookEntryData>,
): Promise<{ uid: string; entry: LorebookEntryData }> {
  return api.post(`/api/lorebooks/${bookId}/entries`, entry) as Promise<{
    uid: string;
    entry: LorebookEntryData;
  }>;
}

export function updateEntry(
  bookId: string,
  uid: string,
  entry: Partial<LorebookEntryData>,
): Promise<{ uid: string; entry: LorebookEntryData }> {
  return api.put(`/api/lorebooks/${bookId}/entries/${uid}`, entry) as Promise<{
    uid: string;
    entry: LorebookEntryData;
  }>;
}

export function deleteEntry(bookId: string, uid: string): Promise<null> {
  return api.del(`/api/lorebooks/${bookId}/entries/${uid}`) as Promise<null>;
}

export function getCharacterLorebookLinks(characterId: string): Promise<{ bookIds: string[] }> {
  return api.get(`/api/characters/${characterId}/lorebooks`) as Promise<{ bookIds: string[] }>;
}

export function setCharacterLorebookLinks(
  characterId: string,
  bookIds: string[],
): Promise<{ bookIds: string[] }> {
  return api.put(`/api/characters/${characterId}/lorebooks`, { bookIds }) as Promise<{
    bookIds: string[];
  }>;
}
