/**
 * drizzle 迁移应用器（M3 决策：drizzle-kit generate 产物 + 启动时幂等应用）。
 *
 * 记账表 schema_migrations 以迁移 tag 为主键；单次应用包在事务里。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

interface DrizzleJournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface DrizzleJournal {
  version: string;
  dialect: string;
  entries: DrizzleJournalEntry[];
}

/** 应用 migrationsDir 下所有未应用的迁移（幂等，可重复调用）。 */
export function ensureMigrated(sqlite: DatabaseSync, migrationsDir: string): void {
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (hash TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    sqlite
      .prepare("SELECT hash FROM schema_migrations")
      .all()
      .map((row) => String((row as { hash: string }).hash)),
  );

  const journal = JSON.parse(
    readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"),
  ) as DrizzleJournal;

  for (const entry of journal.entries) {
    if (applied.has(entry.tag)) {
      continue;
    }
    const sql = readFileSync(join(migrationsDir, `${entry.tag}.sql`), "utf8");
    sqlite.exec("BEGIN");
    try {
      sqlite.exec(sql);
      sqlite
        .prepare("INSERT INTO schema_migrations (hash, applied_at) VALUES (?, ?)")
        .run(entry.tag, new Date().toISOString());
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}
