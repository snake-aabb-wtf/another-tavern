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
  kind: SessionKind;
  groupSettings: Record<string, unknown> | null;
  /** M4：会话组装计划 id；null = 引擎默认计划。 */
  planId: string | null;
  createdAt: string;
}

export type SessionKind = "single" | "group";

export interface SessionMemberRow {
  sessionId: string;
  characterId: string;
  characterName: string;
  position: number;
  muted: boolean;
  talkativeness: number;
  createdAt: string;
}

export interface SessionMemberInput {
  characterId: string;
  position: number;
  muted?: boolean;
  talkativeness?: number;
}

export interface MessageRow {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** assistant 消息实际对应的角色；user/system 为 null。 */
  speakerCharacterId: string | null;
  /** 发言者名称快照；用于历史显示和群聊 Prompt 身份标注。 */
  speakerName: string | null;
  /** 一次发送/生成生命周期；历史数据与手动消息均为 completed。 */
  status: MessageStatus;
  /** swipe_candidates 列已从 JSON 还原。 */
  swipeCandidates: string[];
  swipeIndex: number;
  seq: number;
  createdAt: string;
}

export type MessageStatus = "pending" | "completed" | "failed" | "cancelled";

export interface SettingsRow {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** M4：采样参数（temperature 等），白名单透传上游。 */
  sampling: Record<string, unknown>;
  /** M8：全局正则脚本 JSON 数组。 */
  regexScripts: unknown[];
  /** M6：全局默认组装计划 id；null = 引擎内置默认。 */
  defaultPlanId: string | null;
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
  /** M6：书级 token 预算；null = 全局百分比。 */
  tokenBudget: number | null;
  /** M6：书级扫描深度；null = 全局默认。 */
  scanDepth: number | null;
  /** M6：书级递归开关；null = 全局默认。 */
  recursiveScanning: boolean | null;
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

  /** M5：更新角色卡（data 全文与显示名）。 */
  updateCharacter(id: string, name: string, data: string): boolean {
    return (
      this.sqlite
        .prepare("UPDATE characters SET name = ?, data = ? WHERE id = ?")
        .run(name, data, id).changes > 0
    );
  }

  // —— sessions ——

  insertSession(id: string, characterId: string, title: string, planId: string | null): SessionRow {
    this.sqlite
      .prepare("INSERT INTO chat_sessions (id, character_id, title, plan_id) VALUES (?, ?, ?, ?)")
      .run(id, characterId, title, planId);
    this.insertSessionMember(id, characterId, 0);
    return this.getSession(id) as SessionRow;
  }

  /** 创建群聊会话，并按传入顺序写入全部成员。 */
  insertGroupSession(
    id: string,
    characterId: string,
    title: string,
    planId: string | null,
    groupSettings: Record<string, unknown>,
    members: readonly SessionMemberInput[],
  ): SessionRow {
    this.sqlite.exec("BEGIN");
    try {
      this.sqlite
        .prepare(
          "INSERT INTO chat_sessions (id, character_id, title, kind, group_settings, plan_id) VALUES (?, ?, ?, 'group', ?, ?)",
        )
        .run(id, characterId, title, JSON.stringify(groupSettings), planId);
      const insert = this.sqlite.prepare(
        `INSERT INTO session_members
          (session_id, character_id, position, muted, talkativeness)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const member of members) {
        insert.run(
          id,
          member.characterId,
          member.position,
          member.muted === true ? 1 : 0,
          member.talkativeness ?? 50,
        );
      }
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
    return this.getSession(id) as SessionRow;
  }

  listSessions(): SessionRow[] {
    return this.sqlite
      .prepare(
        "SELECT id, character_id, title, kind, group_settings, plan_id, created_at FROM chat_sessions ORDER BY created_at",
      )
      .all()
      .map((row) => mapSession(row as Record<string, unknown>));
  }

  getSession(id: string): SessionRow | undefined {
    const row = this.sqlite
      .prepare(
        "SELECT id, character_id, title, kind, group_settings, plan_id, created_at FROM chat_sessions WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : mapSession(row as Record<string, unknown>);
  }

  /** 返回会话成员，按用户可见顺序排列。 */
  listSessionMembers(sessionId: string): SessionMemberRow[] {
    return this.sqlite
      .prepare(
        `SELECT sm.session_id, sm.character_id, c.name AS character_name,
                sm.position, sm.muted, sm.talkativeness, sm.created_at
           FROM session_members sm
           JOIN characters c ON c.id = sm.character_id
          WHERE sm.session_id = ?
          ORDER BY sm.position, sm.created_at, sm.character_id`,
      )
      .all(sessionId)
      .map((row) => mapSessionMember(row as Record<string, unknown>));
  }

  /** 新增会话成员；position 与设置值由调用方负责校验。 */
  insertSessionMember(
    sessionId: string,
    characterId: string,
    position: number,
    muted = false,
    talkativeness = 50,
  ): SessionMemberRow {
    this.sqlite
      .prepare(
        `INSERT INTO session_members
          (session_id, character_id, position, muted, talkativeness)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sessionId, characterId, position, muted ? 1 : 0, talkativeness);
    const row = this.sqlite
      .prepare(
        `SELECT sm.session_id, sm.character_id, c.name AS character_name,
                sm.position, sm.muted, sm.talkativeness, sm.created_at
           FROM session_members sm
           JOIN characters c ON c.id = sm.character_id
          WHERE sm.session_id = ? AND sm.character_id = ?`,
      )
      .get(sessionId, characterId);
    if (row === undefined) {
      throw new Error("插入会话成员后无法读取成员记录。");
    }
    return mapSessionMember(row as Record<string, unknown>);
  }

  /** 全量替换群聊成员，并把首位成员同步到兼容字段 character_id。 */
  replaceSessionMembers(sessionId: string, members: readonly SessionMemberInput[]): boolean {
    const first = members[0];
    if (first === undefined) {
      return false;
    }
    this.sqlite.exec("BEGIN");
    try {
      this.sqlite.prepare("DELETE FROM session_members WHERE session_id = ?").run(sessionId);
      const insert = this.sqlite.prepare(
        `INSERT INTO session_members
          (session_id, character_id, position, muted, talkativeness)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const member of members) {
        insert.run(
          sessionId,
          member.characterId,
          member.position,
          member.muted === true ? 1 : 0,
          member.talkativeness ?? 50,
        );
      }
      const changed =
        this.sqlite
          .prepare("UPDATE chat_sessions SET character_id = ? WHERE id = ?")
          .run(first.characterId, sessionId).changes > 0;
      this.sqlite.exec("COMMIT");
      return changed;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  /** 更新群聊配置 JSON；未知字段由调用方保留后传入。 */
  setGroupSettings(id: string, settings: Record<string, unknown>): boolean {
    return (
      this.sqlite
        .prepare("UPDATE chat_sessions SET group_settings = ? WHERE id = ?")
        .run(JSON.stringify(settings), id).changes > 0
    );
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
    input: {
      role: "user" | "assistant" | "system";
      content: string;
      swipeCandidates: string[];
      status?: MessageStatus;
      speakerCharacterId?: string | null;
      speakerName?: string | null;
    },
  ): MessageRow {
    const id = crypto.randomUUID();
    const seq = this.nextSeq(sessionId);
    this.sqlite
      .prepare(
        `INSERT INTO messages
          (id, session_id, role, content, speaker_character_id, speaker_name,
           status, swipe_candidates, swipe_index, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        id,
        sessionId,
        input.role,
        input.content,
        input.role === "assistant"
          ? (input.speakerCharacterId ?? this.getSession(sessionId)?.characterId ?? null)
          : null,
        input.role === "assistant"
          ? (input.speakerName ??
              this.getCharacter(
                input.speakerCharacterId ?? this.getSession(sessionId)?.characterId ?? "",
              )?.name ??
              null)
          : null,
        input.status ?? "completed",
        JSON.stringify(input.swipeCandidates),
        seq,
      );
    return this.getMessage(sessionId, id) as MessageRow;
  }

  listMessages(sessionId: string): MessageRow[] {
    return this.sqlite
      .prepare(
        "SELECT id, session_id, role, content, speaker_character_id, speaker_name, status, swipe_candidates, swipe_index, seq, created_at FROM messages WHERE session_id = ? ORDER BY seq",
      )
      .all(sessionId)
      .map((row) => mapMessage(row as Record<string, unknown>));
  }

  getMessage(sessionId: string, messageId: string): MessageRow | undefined {
    const row = this.sqlite
      .prepare(
        "SELECT id, session_id, role, content, speaker_character_id, speaker_name, status, swipe_candidates, swipe_index, seq, created_at FROM messages WHERE session_id = ? AND id = ?",
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

  /** 更新消息生命周期状态；目标不存在时返回 false。 */
  setMessageStatus(sessionId: string, messageId: string, status: MessageStatus): boolean {
    return (
      this.sqlite
        .prepare("UPDATE messages SET status = ? WHERE session_id = ? AND id = ?")
        .run(status, sessionId, messageId).changes > 0
    );
  }

  /**
   * M5：消息更新（编辑内容 / 切换 swipe 候选）。
   * content 与 swipeIndex 都给时，以 swipeIndex 取候选为内容、并把该候选改写为新内容；
   * 只给 content 时更新 content 与当前指向的候选；只给 swipeIndex 时切换并同步 content。
   */
  updateMessage(
    sessionId: string,
    messageId: string,
    patch: { content?: string; swipeIndex?: number },
  ): MessageRow | undefined {
    const current = this.getMessage(sessionId, messageId);
    if (current === undefined) {
      return undefined;
    }
    const candidates = [...current.swipeCandidates];
    let content = current.content;
    let swipeIndex = current.swipeIndex;

    if (patch.swipeIndex !== undefined) {
      if (patch.swipeIndex < 0 || patch.swipeIndex >= candidates.length) {
        return undefined;
      }
      swipeIndex = patch.swipeIndex;
      content = candidates[swipeIndex] ?? content;
    }
    if (patch.content !== undefined) {
      content = patch.content;
      if (candidates.length > 0 && swipeIndex < candidates.length) {
        candidates[swipeIndex] = patch.content;
      }
    }

    this.sqlite
      .prepare(
        "UPDATE messages SET content = ?, swipe_candidates = ?, swipe_index = ? WHERE session_id = ? AND id = ?",
      )
      .run(content, JSON.stringify(candidates), swipeIndex, sessionId, messageId);
    return this.getMessage(sessionId, messageId);
  }

  /** M5：向 assistant 消息追加一个 swipe 候选并指向它（重新生成用）。 */
  appendSwipeCandidate(
    sessionId: string,
    messageId: string,
    content: string,
  ): MessageRow | undefined {
    const current = this.getMessage(sessionId, messageId);
    if (current === undefined) {
      return undefined;
    }
    const candidates = [...current.swipeCandidates, content];
    const swipeIndex = candidates.length - 1;
    this.sqlite
      .prepare(
        "UPDATE messages SET content = ?, swipe_candidates = ?, swipe_index = ? WHERE session_id = ? AND id = ?",
      )
      .run(content, JSON.stringify(candidates), swipeIndex, sessionId, messageId);
    return this.getMessage(sessionId, messageId);
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
      .prepare(
        "SELECT base_url, api_key, model, sampling, regex_scripts, default_plan_id FROM settings WHERE id = 1",
      )
      .get() as Record<string, unknown> | undefined;
    if (row === undefined) {
      return {
        baseUrl: "",
        apiKey: "",
        model: "",
        sampling: {},
        regexScripts: [],
        defaultPlanId: null,
      };
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
    let regexScripts: unknown[] = [];
    try {
      const parsed: unknown = JSON.parse(String(row.regex_scripts ?? "[]"));
      if (Array.isArray(parsed)) {
        regexScripts = parsed;
      }
    } catch {
      regexScripts = [];
    }
    return {
      baseUrl: String(row.base_url ?? ""),
      apiKey: String(row.api_key ?? ""),
      model: String(row.model ?? ""),
      sampling,
      regexScripts,
      defaultPlanId:
        row.default_plan_id === undefined || row.default_plan_id === null
          ? null
          : String(row.default_plan_id),
    };
  }

  putSettings(input: SettingsRow): SettingsRow {
    this.sqlite
      .prepare(
        `INSERT INTO settings (id, base_url, api_key, model, sampling, regex_scripts, default_plan_id, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET base_url = excluded.base_url, api_key = excluded.api_key, model = excluded.model, sampling = excluded.sampling, regex_scripts = excluded.regex_scripts, default_plan_id = excluded.default_plan_id, updated_at = excluded.updated_at`,
      )
      .run(
        input.baseUrl,
        input.apiKey,
        input.model,
        JSON.stringify(input.sampling ?? {}),
        JSON.stringify(input.regexScripts ?? []),
        input.defaultPlanId,
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
        "SELECT id, name, description, is_global, token_budget, scan_depth, recursive_scanning, created_at FROM lorebooks ORDER BY created_at",
      )
      .all()
      .map((row) => mapLorebook(row as Record<string, unknown>));
  }

  getLorebook(id: string): LorebookRow | undefined {
    const row = this.sqlite
      .prepare(
        "SELECT id, name, description, is_global, token_budget, scan_depth, recursive_scanning, created_at FROM lorebooks WHERE id = ?",
      )
      .get(id);
    return row === undefined ? undefined : mapLorebook(row as Record<string, unknown>);
  }

  listGlobalLorebooks(): LorebookRow[] {
    return this.sqlite
      .prepare(
        "SELECT id, name, description, is_global, token_budget, scan_depth, recursive_scanning, created_at FROM lorebooks WHERE is_global = 1 ORDER BY created_at",
      )
      .all()
      .map((row) => mapLorebook(row as Record<string, unknown>));
  }

  /** M6：更新书（支持书级 token 预算 / 扫描深度 / 递归开关）。 */
  updateLorebook(
    id: string,
    patch: {
      name?: string;
      description?: string;
      isGlobal?: boolean;
      tokenBudget?: number | null;
      scanDepth?: number | null;
      recursiveScanning?: boolean | null;
    },
  ): boolean {
    const existing = this.getLorebook(id);
    if (existing === undefined) {
      return false;
    }
    const name = patch.name ?? existing.name;
    const description = patch.description ?? existing.description;
    const isGlobal = patch.isGlobal ?? existing.isGlobal;
    const tokenBudget = patch.tokenBudget !== undefined ? patch.tokenBudget : existing.tokenBudget;
    const scanDepth = patch.scanDepth !== undefined ? patch.scanDepth : existing.scanDepth;
    const recursiveScanning =
      patch.recursiveScanning !== undefined ? patch.recursiveScanning : existing.recursiveScanning;
    return (
      this.sqlite
        .prepare(
          "UPDATE lorebooks SET name = ?, description = ?, is_global = ?, token_budget = ?, scan_depth = ?, recursive_scanning = ? WHERE id = ?",
        )
        .run(
          name,
          description,
          isGlobal ? 1 : 0,
          tokenBudget,
          scanDepth,
          recursiveScanning === null ? null : recursiveScanning ? 1 : 0,
          id,
        ).changes > 0
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
    kind: row.kind === "group" ? "group" : "single",
    groupSettings: parseJsonRecord(row.group_settings),
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
    speakerCharacterId:
      row.speaker_character_id === undefined || row.speaker_character_id === null
        ? null
        : String(row.speaker_character_id),
    speakerName:
      row.speaker_name === undefined || row.speaker_name === null ? null : String(row.speaker_name),
    status: messageStatus(row.status),
    swipeCandidates: candidates,
    swipeIndex: Number(row.swipe_index ?? 0),
    seq: Number(row.seq ?? 0),
    createdAt: String(row.created_at),
  };
}

function mapSessionMember(row: Record<string, unknown>): SessionMemberRow {
  return {
    sessionId: String(row.session_id),
    characterId: String(row.character_id),
    characterName: String(row.character_name),
    position: Number(row.position ?? 0),
    muted: Number(row.muted ?? 0) === 1,
    talkativeness: Number(row.talkativeness ?? 50),
    createdAt: String(row.created_at),
  };
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function messageStatus(value: unknown): MessageStatus {
  if (value === "pending" || value === "failed" || value === "cancelled") {
    return value;
  }
  return "completed";
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
    tokenBudget:
      row.token_budget === undefined || row.token_budget === null ? null : Number(row.token_budget),
    scanDepth:
      row.scan_depth === undefined || row.scan_depth === null ? null : Number(row.scan_depth),
    recursiveScanning:
      row.recursive_scanning === undefined || row.recursive_scanning === null
        ? null
        : Number(row.recursive_scanning) === 1,
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
