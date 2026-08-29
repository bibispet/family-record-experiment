import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { EXAMPLE_SEED_PLAN, seedFamily, type SeedResult } from "../db/seed";

const REPO_ROOT = process.cwd();
const MIGRATION_PATH = join(REPO_ROOT, "drizzle", "0000_romantic_agent_zero.sql");

/** Mirrors db/runtime.ts so a fresh local D1 gets the checked-in schema. */
function applyIdempotentMigration(database: DatabaseSync): void {
  const existing = database
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'index' AND name = 'users_auth_subject_uq'")
    .get();
  if (existing) return;

  const sql = readFileSync(MIGRATION_PATH, "utf8");
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
function d1Adapter(database: DatabaseSync): D1Database {
  const prepare = (sql: string): D1PreparedStatement => {
    const statement = database.prepare(sql);
    return {
      bind(...values: unknown[]): D1PreparedStatement {
        const params: SQLInputValue[] = values.map((value) => {
          if (value === undefined || value === null) return null;
          if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
          throw new Error(`seed: adapter cannot bind value of type ${typeof value}`);
        });
        return {
          bind: () => {
            throw new Error("seed: double bind is not supported by the adapter");
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
          // The adapter's statements are fully bound; run them directly.
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

/** Locate the Miniflare local D1 sqlite file the dev server uses. */
function findLocalD1(): string {
  const stateDir = join(REPO_ROOT, ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
  let files: string[];
  try {
    files = readdirSync(stateDir).filter((name) => name.endsWith(".sqlite") && !name.includes("metadata"));
  } catch {
    files = [];
  }
  if (files.length === 0) {
    throw new Error(
      "seed: no local D1 database found. Start the dev server once (npm run dev) so .wrangler state exists, then run this again.",
    );
  }
  if (files.length > 1) {
    throw new Error(`seed: ambiguous local D1 state (found ${files.length} sqlite files). Refusing to guess.`);
  }
  return join(stateDir, files[0]);
}

function countLabel(result: SeedResult): string {
  return `${result.people} people, ${result.relationships} relationships, ${result.stories} stories, ${result.media} media`;
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const explicit = process.argv.find((arg) => arg.startsWith("--db="));
  const d1Path = explicit ? explicit.slice("--db=".length) : findLocalD1();
  const database = new DatabaseSync(d1Path);
  applyIdempotentMigration(database);

  const existingPeople = database.prepare("SELECT COUNT(*) AS n FROM people").get() as { n: number };
  if (existingPeople.n > 0 && !force) {
    throw new Error(
      `seed: the local D1 already has ${existingPeople.n} people. Re-pointing data risklessly requires an empty database; pass --force to append another seed family.`,
    );
  }

  const result = await seedFamily(d1Adapter(database), crypto.randomUUID(), crypto.randomUUID(), EXAMPLE_SEED_PLAN);
  database.close();
  console.log(`Seeded "${EXAMPLE_SEED_PLAN.spaceName}" into local D1 (${d1Path}).`);
  console.log(`Inserted ${countLabel(result)}.`);
  console.log(`Sign in at /dev/sign-in with subject "${EXAMPLE_SEED_PLAN.stewardSubject}" and email "${EXAMPLE_SEED_PLAN.stewardEmail}" to browse it.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});