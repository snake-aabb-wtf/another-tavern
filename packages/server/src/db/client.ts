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
}

export interface AppDatabase {
  sqlite: DatabaseSync;
  repo: Repo;
}

export class Repo {
  constructor(private readonly sqlite: DatabaseSync) {}

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

  insertSession(id: string, characterId: string, title: string): SessionRow {
    this.sqlite
      .prepare("INSERT INTO chat_sessions (id, character_id, title) VALUES (?, ?, ?)")
      .run(id, characterId, title);
    return this.getSession(id) as SessionRow;
  }

  listSessions(): SessionRow[] {
    return this.sqlite
      .prepare("SELECT id, character_id, title, created_at FROM chat_sessions ORDER BY created_at")
      .all()
      .map((row) => mapSession(row as Record<string, unknown>));
  }

  getSession(id: string): SessionRow | undefined {
    const row = this.sqlite
      .prepare("SELECT id, character_id, title, created_at FROM chat_sessions WHERE id = ?")
      .get(id);
    return row === undefined ? undefined : mapSession(row as Record<string, unknown>);
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
      .prepare("SELECT base_url, api_key, model FROM settings WHERE id = 1")
      .get() as Record<string, unknown> | undefined;
    if (row === undefined) {
      return { baseUrl: "", apiKey: "", model: "" };
    }
    return {
      baseUrl: String(row.base_url ?? ""),
      apiKey: String(row.api_key ?? ""),
      model: String(row.model ?? ""),
    };
  }

  putSettings(input: SettingsRow): SettingsRow {
    this.sqlite
      .prepare(
        `INSERT INTO settings (id, base_url, api_key, model, updated_at) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET base_url = excluded.base_url, api_key = excluded.api_key, model = excluded.model, updated_at = excluded.updated_at`,
      )
      .run(input.baseUrl, input.apiKey, input.model, new Date().toISOString());
    return this.getSettings();
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
