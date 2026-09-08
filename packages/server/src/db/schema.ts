/**
 * 数据库表结构。
 * 字段变更走 drizzle-kit generate 生成迁移；运行时由 db/migrate.ts 应用。
 */

import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamp = () =>
  text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

/** 角色卡：解析后的卡模型 JSON 全文（含 extensions / unknownFields 保留）。 */
export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  data: text("data").notNull(),
  createdAt: timestamp(),
});

/** 组装计划（M4）：data 为引擎 AssemblyPlan JSON 全文。 */
export const assemblyPlans = sqliteTable("assembly_plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  data: text("data").notNull(),
  createdAt: timestamp(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

/** 世界书（M4）：is_global=1 的书参与所有会话组装。 */
export const lorebooks = sqliteTable("lorebooks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isGlobal: integer("is_global").notNull().default(0),
  /** M6：书级 token 预算；null = 全局百分比。 */
  tokenBudget: integer("token_budget"),
  /** M6：书级扫描深度；null = 全局默认 2。 */
  scanDepth: integer("scan_depth"),
  /** M6：书级递归开关；null = 全局默认 false。 */
  recursiveScanning: integer("recursive_scanning"),
  createdAt: timestamp(),
});

/** 世界书条目（M4）：data 为引擎 WorldInfoEntry JSON 全文。 */
export const lorebookEntries = sqliteTable("lorebook_entries", {
  id: text("id").primaryKey(),
  bookId: text("book_id")
    .notNull()
    .references(() => lorebooks.id, { onDelete: "cascade" }),
  uid: text("uid").notNull(),
  data: text("data").notNull(),
  createdAt: timestamp(),
});

/** 角色卡 ↔ 世界书挂载（M4）：多对多。 */
export const characterLorebooks = sqliteTable(
  "character_lorebooks",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    bookId: text("book_id")
      .notNull()
      .references(() => lorebooks.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.characterId, table.bookId] })],
);

export const chatSessions = sqliteTable("chat_sessions", {
  id: text("id").primaryKey(),
  characterId: text("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  /** M4：会话组装计划；null = 引擎默认计划。删计划回落默认。 */
  planId: text("plan_id").references(() => assemblyPlans.id, { onDelete: "set null" }),
  /** M4：最近一次组装的最终 messages JSON（调试端点用）。 */
  lastMessages: text("last_messages"),
  createdAt: timestamp(),
});

/**
 * 消息：seq 为会话内序号；assistant 消息的 swipe 候选存 JSON 数组，
 * swipeIndex 指向当前展示的候选。
 */
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  swipeCandidates: text("swipe_candidates").notNull(),
  swipeIndex: integer("swipe_index").notNull().default(0),
  seq: integer("seq").notNull(),
  createdAt: timestamp(),
});

/** 连接设置：单行表（id 恒为 1）；apiKey 落库，接口返回时打码。 */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  baseUrl: text("base_url").notNull().default(""),
  apiKey: text("api_key").notNull().default(""),
  model: text("model").notNull().default(""),
  /** M4：采样参数 JSON（temperature 等），白名单透传上游。 */
  sampling: text("sampling").notNull().default("{}"),
  /** M6：全局默认组装计划；null = 引擎内置默认。会话 plan_id 为空时使用。 */
  defaultPlanId: text("default_plan_id").references(() => assemblyPlans.id, {
    onDelete: "set null",
  }),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});
