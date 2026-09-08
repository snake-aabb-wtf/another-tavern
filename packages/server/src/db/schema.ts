/**
 * 数据库表结构（M3 任务 §1）。
 * 字段变更走 drizzle-kit generate 生成迁移；运行时由 db/migrate.ts 应用。
 */

import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const chatSessions = sqliteTable("chat_sessions", {
  id: text("id").primaryKey(),
  characterId: text("character_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
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
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});
