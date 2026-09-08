/**
 * 数据访问层（决策：node:sqlite 内置模块 + 原生 SQL + 手写行映射）。
 *
 * 说明：drizzle-orm 的 sqlite-proxy 适配层在本组合下 select 结果映射异常
 * （mapResultRow 收到空 fields，is()/orderSelectedFields 链路排查未果），
 * 故查询走原生 SQL；drizzle-orm + drizzle-kit 仍负责 schema 定义与迁移生成
 * （见 db/schema.ts 与 drizzle/ 迁移产物）。
 */

import { DatabaseSync } from "node:sqlite";

import { ensureMigrated } from "./migrate.js";

export interface CharacterRow {
  id: string;
  name: string;
  /** 解析后的卡模型 JSON 全文。 */
  data: string;
  createdAt: string;
}

export interface SessionRow {
  id: string;
  characterId: string;
  title: string;
  /** M4：会话组装计划 id；null = 引擎默认计划。 */
  planId: string | null;
  createdAt: string;
}

export interface MessageRow {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** swipe_candidates 列已从 JSON 还原。 */
  swipeCandidates: string[];
  swipeIndex: number;
  seq: number;
  createdAt: string;
}

export interface SettingsRow {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** M4：采样参数（temperature 等），白名单透传上游。 */
  sampling: Record<string, unknown>;
}

export interface PlanRow {
  id: string;
  name: string;
  /** 引擎 AssemblyPlan JSON 全文。 */
  data: string;
  createdAt: string;
  updatedAt: string;
}

export interface LorebookRow {
  id: string;
  name: string;
  description: string;
  isGlobal: boolean;
  createdAt: string;
}

export interface EntryRow {
  id: string;
  bookId: string;
  uid: string;
  /** 引擎 WorldInfoEntry JSON 全文。 */
  data: string;
  createdAt: string;
}

export interface AppDatabase {
  sqlite: DatabaseSync;
  repo: Repo;
}

/** 数据访问仓库（原生 SQL；无 ORM 查询构建）。 */
export class Repo {
  readonly sqlite: DatabaseSync;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
  }

  // —— characters ——

  insertCharacter(id: string, name: string, data: string): void {
    this.sqlite
      .prepare("INSERT INTO characters (id, name, data) VALUES (?, ?, ?)")
      .run(id, name, data);
  }

  listCharacters(): CharacterRow[] {
    return this.sqlite
      .prepare("SELECT id, name, data, created_at FROM characters ORDER BY created_at")
      .all()
      .map((row) => mapCharacter(row as Record<string, unknown>));
  }

  getCharacter(id: string): CharacterRow | undefined {
    const row = this.sqlite
      .prepare("SELECT id, name, data, created_at FROM characters WHERE id = ?")
      .get(id);
    return row === undefined ? undefined : mapCharacter(row as Record<string, unknown>);
  }

  // —— sessions ——

  insertSession(id: string, characterId: string, title: string, planId: string | null): SessionRow {
    this.sqlite
      .prepare("INSERT INTO chat_sessions (id, character_id, title, plan_id) VALUES (?, ?, ?, ?)")
      .run(id, characterId, title, planId);
    return this.getSession(id) as SessionRow;
  }

  listSessions(): SessionRow[] {
    return this.sqlite
      .prepare(
        "SELECT id, character_id, title, plan_id, created_at FROM chat_sessions ORDER BY created_at",
      )
      .all()
      .map((row) => mapSession(row as Record<string, unknown>));
  }

  getSession(id: string): SessionRow | undefined {
    const row = this.sqlite
      .prepare(
        "SELECT id, character_id, title, plan_id, created_at FROM chat_sessions WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : mapSession(row as Record<string, unknown>);
  }

  /** M4：更新会话的组装计划（null = 回落默认）。 */
  setSessionPlan(id: string, planId: string | null): boolean {
    return (
      this.sqlite.prepare("UPDATE chat_sessions SET plan_id = ? WHERE id = ?").run(planId, id)
        .changes > 0
    );
  }

  /** M4：读取最近一次组装的最终 messages JSON。 */
  getLastMessages(id: string): string | null {
    const row = this.sqlite
      .prepare("SELECT last_messages FROM chat_sessions WHERE id = ?")
      .get(id) as { last_messages: string | null } | undefined;
    return row?.last_messages ?? null;
  }

  /** 删除会话（messages 级联）。返回是否真的删除了。 */
  deleteSession(id: string): boolean {
    return this.sqlite.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id).changes > 0;
  }

  // —— messages ——

  insertMessage(
    sessionId: string,
    input: { role: "user" | "assistant" | "system"; content: string; swipeCandidates: string[] },
  ): MessageRow {
    const id = crypto.randomUUID();
    const seq = this.nextSeq(sessionId);
    this.sqlite
      .prepare(
        "INSERT INTO messages (id, session_id, role, content, swipe_candidates, swipe_index, seq) VALUES (?, ?, ?, ?, ?, 0, ?)",
      )
      .run(id, sessionId, input.role, input.content, JSON.stringify(input.swipeCandidates), seq);
    return this.getMessage(sessionId, id) as MessageRow;
  }

  listMessages(sessionId: string): MessageRow[] {
    return this.sqlite
      .prepare(
        "SELECT id, session_id, role, content, swipe_candidates, swipe_index, seq, created_at FROM messages WHERE session_id = ? ORDER BY seq",
      )
      .all(sessionId)
      .map((row) => mapMessage(row as Record<string, unknown>));
  }

  getMessage(sessionId: string, messageId: string): MessageRow | undefined {
    const row = this.sqlite
      .prepare(
        "SELECT id, session_id, role, content, swipe_candidates, swipe_index, seq, created_at FROM messages WHERE session_id = ? AND id = ?",
      )
      .get(sessionId, messageId);
    return row === undefined ? undefined : mapMessage(row as Record<string, unknown>);
  }

  deleteMessage(sessionId: string, messageId: string): boolean {
    return (
      this.sqlite
        .prepare("DELETE FROM messages WHERE session_id = ? AND id = ?")
        .run(sessionId, messageId).changes > 0
    );
  }

  private nextSeq(sessionId: string): number {
    const row = this.sqlite
      .prepare("SELECT COALESCE(MAX(seq), 0) AS max FROM messages WHERE session_id = ?")
      .get(sessionId) as { max: number } | undefined;
    return (row?.max ?? 0) + 1;
  }

  // —— settings ——

  getSettings(): SettingsRow {
    const row = this.sqlite
      .prepare("SELECT base_url, api_key, model, sampling FROM settings WHERE id = 1")
      .get() as Record<string, unknown> | undefined;
    if (row === undefined) {
      return { baseUrl: "", apiKey: "", model: "", sampling: {} };
    }
    let sampling: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(String(row.sampling ?? "{}"));
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        sampling = parsed as Record<string, unknown>;
      }
    } catch {
      sampling = {};
    }
    return {
      baseUrl: String(row.base_url ?? ""),
      apiKey: String(row.api_key ?? ""),
      model: String(row.model ?? ""),
      sampling,
    };
  }

  putSettings(input: SettingsRow): SettingsRow {
    this.sqlite
      .prepare(
        `INSERT INTO settings (id, base_url, api_key, model, sampling, updated_at) VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET base_url = excluded.base_url, api_key = excluded.api_key, model = excluded.model, sampling = excluded.sampling, updated_at = excluded.updated_at`,
      )
      .run(
        input.baseUrl,
        input.apiKey,
        input.model,
        JSON.stringify(input.sampling ?? {}),
        new Date().toISOString(),
      );
    return this.getSettings();
  }

  // —— M4：组装计划 ——

  insertPlan(id: string, name: string, data: string): PlanRow {
    this.sqlite
      .prepare("INSERT INTO assembly_plans (id, name, data) VALUES (?, ?, ?)")
      .run(id, name, data);
    return this.getPlan(id) as PlanRow;
  }

  listPlans(): PlanRow[] {
    return this.sqlite
      .prepare(
        "SELECT id, name, data, created_at, updated_at FROM assembly_plans ORDER BY created_at",
      )
      .all()
      .map((row) => mapPlan(row as Record<string, unknown>));
  }

  getPlan(id: string): PlanRow | undefined {
    const row = this.sqlite
      .prepare("SELECT id, name, data, created_at, updated_at FROM assembly_plans WHERE id = ?")
      .get(id);
    return row === undefined ? undefined : mapPlan(row as Record<string, unknown>);
  }

  updatePlan(id: string, name: string, data: string): boolean {
    return (
      this.sqlite
        .prepare("UPDATE assembly_plans SET name = ?, data = ?, updated_at = ? WHERE id = ?")
        .run(name, data, new Date().toISOString(), id).changes > 0
    );
  }

  deletePlan(id: string): boolean {
    return this.sqlite.prepare("DELETE FROM assembly_plans WHERE id = ?").run(id).changes > 0;
  }

  // —— M4：世界书 ——

  insertLorebook(id: string, name: string, description: string, isGlobal: boolean): LorebookRow {
    this.sqlite
      .prepare("INSERT INTO lorebooks (id, name, description, is_global) VALUES (?, ?, ?, ?)")
      .run(id, name, description, isGlobal ? 1 : 0);
    return this.getLorebook(id) as LorebookRow;
  }

  listLorebooks(): LorebookRow[] {
    return this.sqlite
      .prepare(
        "SELECT id, name, description, is_global, created_at FROM lorebooks ORDER BY created_at",
      )
      .all()
      .map((row) => mapLorebook(row as Record<string, unknown>));
  }

  getLorebook(id: string): LorebookRow | undefined {
    const row = this.sqlite
      .prepare("SELECT id, name, description, is_global, created_at FROM lorebooks WHERE id = ?")
      .get(id);
    return row === undefined ? undefined : mapLorebook(row as Record<string, unknown>);
  }

  listGlobalLorebooks(): LorebookRow[] {
    return this.sqlite
      .prepare(
        "SELECT id, name, description, is_global, created_at FROM lorebooks WHERE is_global = 1 ORDER BY created_at",
      )
      .all()
      .map((row) => mapLorebook(row as Record<string, unknown>));
  }

  updateLorebook(id: string, name: string, description: string, isGlobal: boolean): boolean {
    return (
      this.sqlite
        .prepare("UPDATE lorebooks SET name = ?, description = ?, is_global = ? WHERE id = ?")
        .run(name, description, isGlobal ? 1 : 0, id).changes > 0
    );
  }

  deleteLorebook(id: string): boolean {
    return this.sqlite.prepare("DELETE FROM lorebooks WHERE id = ?").run(id).changes > 0;
  }

  // —— M4：世界书条目 ——

  insertEntry(id: string, bookId: string, uid: string, data: string): EntryRow {
    this.sqlite
      .prepare("INSERT INTO lorebook_entries (id, book_id, uid, data) VALUES (?, ?, ?, ?)")
      .run(id, bookId, uid, data);
    return this.getEntry(bookId, uid) as EntryRow;
  }

  listEntries(bookId: string): EntryRow[] {
    return this.sqlite
      .prepare(
        "SELECT id, book_id, uid, data, created_at FROM lorebook_entries WHERE book_id = ? ORDER BY created_at",
      )
      .all(bookId)
      .map((row) => mapEntry(row as Record<string, unknown>));
  }

  getEntry(bookId: string, uid: string): EntryRow | undefined {
    const row = this.sqlite
      .prepare(
        "SELECT id, book_id, uid, data, created_at FROM lorebook_entries WHERE book_id = ? AND uid = ?",
      )
      .get(bookId, uid);
    return row === undefined ? undefined : mapEntry(row as Record<string, unknown>);
  }

  updateEntry(bookId: string, uid: string, data: string): boolean {
    return (
      this.sqlite
        .prepare("UPDATE lorebook_entries SET data = ? WHERE book_id = ? AND uid = ?")
        .run(data, bookId, uid).changes > 0
    );
  }

  deleteEntry(bookId: string, uid: string): boolean {
    return (
      this.sqlite
        .prepare("DELETE FROM lorebook_entries WHERE book_id = ? AND uid = ?")
        .run(bookId, uid).changes > 0
    );
  }

  // —— M4：角色卡 ↔ 世界书挂载 ——

  setCharacterLorebooks(characterId: string, bookIds: readonly string[]): void {
    this.sqlite.prepare("DELETE FROM character_lorebooks WHERE character_id = ?").run(characterId);
    const insert = this.sqlite.prepare(
      "INSERT OR IGNORE INTO character_lorebooks (character_id, book_id) VALUES (?, ?)",
    );
    for (const bookId of bookIds) {
      insert.run(characterId, bookId);
    }
  }

  listCharacterLorebookIds(characterId: string): string[] {
    return this.sqlite
      .prepare("SELECT book_id FROM character_lorebooks WHERE character_id = ?")
      .all(characterId)
      .map((row) => String((row as { book_id: string }).book_id));
  }

  // —— M4：最近一次组装记录 ——

  updateLastMessages(sessionId: string, messagesJson: string): boolean {
    return (
      this.sqlite
        .prepare("UPDATE chat_sessions SET last_messages = ? WHERE id = ?")
        .run(messagesJson, sessionId).changes > 0
    );
  }
}

function mapCharacter(row: Record<string, unknown>): CharacterRow {
  return {
    id: String(row.id),
    name: String(row.name),
    data: String(row.data),
    createdAt: String(row.created_at),
  };
}

function mapSession(row: Record<string, unknown>): SessionRow {
  return {
    id: String(row.id),
    characterId: String(row.character_id),
    title: String(row.title ?? ""),
    planId: row.plan_id === undefined || row.plan_id === null ? null : String(row.plan_id),
    createdAt: String(row.created_at),
  };
}

function mapMessage(row: Record<string, unknown>): MessageRow {
  let candidates: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(row.swipe_candidates));
    if (Array.isArray(parsed)) {
      candidates = parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    candidates = [];
  }
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    role: row.role === "assistant" || row.role === "system" ? row.role : "user",
    content: String(row.content),
    swipeCandidates: candidates,
    swipeIndex: Number(row.swipe_index ?? 0),
    seq: Number(row.seq ?? 0),
    createdAt: String(row.created_at),
  };
}

function mapPlan(row: Record<string, unknown>): PlanRow {
  return {
    id: String(row.id),
    name: String(row.name),
    data: String(row.data),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapLorebook(row: Record<string, unknown>): LorebookRow {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    isGlobal: Number(row.is_global ?? 0) === 1,
    createdAt: String(row.created_at),
  };
}

function mapEntry(row: Record<string, unknown>): EntryRow {
  return {
    id: String(row.id),
    bookId: String(row.book_id),
    uid: String(row.uid),
    data: String(row.data),
    createdAt: String(row.created_at),
  };
}

/** 打开数据库、应用迁移并构造 repo。path 传 ":memory:" 用于测试。 */
export function openDatabase(path: string, migrationsDir: string): AppDatabase {
  const sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") {
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA busy_timeout = 5000");
  }
  ensureMigrated(sqlite, migrationsDir);
  return { sqlite, repo: new Repo(sqlite) };
}
