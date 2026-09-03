// Shared node:sqlite -> D1 adapter and migration runner.
//
// This is the single source of truth for driving the real, checked-in D1
// schema and D1-shaped statements with Node's built-in SQLite (node:sqlite).
// It is reused by scripts/seed.ts (local seeding) and the integration test
// harness (tests/seed-integration.test.ts) so that tests execute the exact
// SQL the app runs in production — no fake, no new dependency.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

const REPO_ROOT = process.cwd();
const MIGRATION_PATH = join(REPO_ROOT, "drizzle", "0000_romantic_agent_zero.sql");

/** Mirrors db/runtime.ts so a fresh local D1 gets the checked-in schema. */
export function applyIdempotentMigration(database: DatabaseSync, migrationPath: string = MIGRATION_PATH): void {
  const existing = database
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'index' AND name = 'users_auth_subject_uq'")
    .get();
  if (existing) return;

  const sql = readFileSync(migrationPath, "utf8");
  for (const rawStatement of sql.split("--> statement-breakpoint")) {
    const statement = rawStatement.trim();
    if (!statement) continue;
    const idempotent = statement
      .replace(/^CREATE TABLE\s+/i, "CREATE TABLE IF NOT EXISTS ")
      .replace(/^CREATE UNIQUE INDEX\s+/i, "CREATE UNIQUE INDEX IF NOT EXISTS ")
      .replace(/^CREATE INDEX\s+/i, "CREATE INDEX IF NOT EXISTS ");
    database.exec(idempotent);
  }
}

/**
 * Minimal D1 adapter over node:sqlite. D1's prepare/bind/run shape maps to
 * DatabaseSync's prepare/run; batch runs statements in a single transaction.
 */
export function d1Adapter(database: DatabaseSync): D1Database {
  const prepare = (sql: string): D1PreparedStatement => {
    const statement = database.prepare(sql);
    return {
      bind(...values: unknown[]): D1PreparedStatement {
        const params: SQLInputValue[] = values.map((value) => {
          if (value === undefined || value === null) return null;
          if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
          throw new Error(`d1-adapter: cannot bind value of type ${typeof value}`);
        });
        return {
          bind: () => {
            throw new Error("d1-adapter: double bind is not supported by the adapter");
          },
          run: async () => {
            statement.run(...params);
            return { success: true, meta: {}, results: [] };
          },
          first: async () => statement.get(...params),
          all: async () => ({ success: true, meta: {}, results: statement.all(...params) ?? [] }),
        } as unknown as D1PreparedStatement;
      },
      run: async () => {
        statement.run();
        return { success: true, meta: {}, results: [] };
      },
      first: async () => statement.get(),
      all: async () => ({ success: true, meta: {}, results: statement.all() ?? [] }),
    } as unknown as D1PreparedStatement;
  };

  return {
    prepare,
    batch: async (statements: D1PreparedStatement[]) => {
      database.exec("BEGIN");
      try {
        for (const statement of statements) {
          await statement.run();
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      return statements.map(() => ({ success: true, meta: {}, results: [] }));
    },
  } as unknown as D1Database;
}
