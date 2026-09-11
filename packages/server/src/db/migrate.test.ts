import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { Repo } from "./client.js";
import { ensureMigrated } from "./migrate.js";

const MIGRATIONS_DIR = resolve("drizzle");
const LEGACY_TAGS = [
  "0000_tranquil_wildside",
  "0001_bent_machine_man",
  "0002_dark_maverick",
  "0003_cool_rachel_grey",
  "0004_mysterious_vance_astro",
] as const;

function applyLegacySchema(sqlite: DatabaseSync): void {
  for (const tag of LEGACY_TAGS) {
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, `${tag}.sql`), "utf8"));
  }
  sqlite.exec("CREATE TABLE schema_migrations (hash TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const insert = sqlite.prepare("INSERT INTO schema_migrations (hash, applied_at) VALUES (?, ?)");
  for (const tag of LEGACY_TAGS) {
    insert.run(tag, new Date(0).toISOString());
  }
}

describe("database migration 0005（群聊基础与旧单聊回填）", () => {
  let sqlite: DatabaseSync | undefined;

  afterEach(() => {
    sqlite?.close();
    sqlite = undefined;
  });

  it("旧单聊会话补齐成员，并回填 assistant 发言者身份", () => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    applyLegacySchema(sqlite);
    sqlite
      .prepare("INSERT INTO characters (id, name, data) VALUES (?, ?, ?)")
      .run("c1", "Aria", "{}");
    sqlite
      .prepare("INSERT INTO chat_sessions (id, character_id, title) VALUES (?, ?, ?)")
      .run("s1", "c1", "旧会话");
    sqlite
      .prepare(
        `INSERT INTO messages
          (id, session_id, role, content, status, swipe_candidates, swipe_index, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("m1", "s1", "assistant", "欢迎。", "completed", '["欢迎。"]', 0, 1);
    sqlite
      .prepare(
        `INSERT INTO messages
          (id, session_id, role, content, status, swipe_candidates, swipe_index, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("m2", "s1", "user", "你好。", "completed", "[]", 0, 2);

    ensureMigrated(sqlite, MIGRATIONS_DIR);
    const repo = new Repo(sqlite);

    expect(repo.getSession("s1")).toMatchObject({
      kind: "single",
      groupSettings: null,
    });
    expect(repo.listSessionMembers("s1")).toEqual([
      expect.objectContaining({
        sessionId: "s1",
        characterId: "c1",
        characterName: "Aria",
        position: 0,
        muted: false,
        talkativeness: 50,
      }),
    ]);
    expect(repo.listMessages("s1")).toEqual([
      expect.objectContaining({
        id: "m1",
        speakerCharacterId: "c1",
        speakerName: "Aria",
      }),
      expect.objectContaining({
        id: "m2",
        speakerCharacterId: null,
        speakerName: null,
      }),
    ]);
    expect(repo.getSettings().regexScripts).toEqual([]);
  });
});
