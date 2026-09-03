import { readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  EXAMPLE_SEED_PLAN,
  SEED_PURGE_TABLE_ORDER,
  seedFamily,
  seedIdentity,
  seedProvenance,
  validateSeedPlan,
  type SeedProvenance,
  type SeedPurgeTable,
  type SeedResult,
} from "../db/seed";
import { applyIdempotentMigration, d1Adapter } from "../db/node-sqlite-d1";

// This runner is deliberately local-only. It opens SQLite files with
// node:sqlite; there is no wrangler/remote-D1 execution path and none will
// be added. Keeping it unable to reach a deployed database is a feature.

const REPO_ROOT = process.cwd();
const LOCAL_STATE_ROOT = resolve(REPO_ROOT, ".wrangler");

/** Locate the Miniflare local D1 sqlite file the dev server uses. */
function findLocalD1(): string {
  const stateDir = join(LOCAL_STATE_ROOT, "state", "v3", "d1", "miniflare-D1DatabaseObject");
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

/** Refuse any target that is not a real file under the local .wrangler dir. */
function assertLocalTarget(d1Path: string, force: boolean): void {
  if (!resolve(d1Path).startsWith(LOCAL_STATE_ROOT + sep)) {
    if (!force) {
      throw new Error(
        `seed: refusing target outside the local .wrangler state dir (${d1Path}). This tool is local-only by design; pass --force to use an arbitrary sqlite file for throwaway experiments.`,
      );
    }
    return;
  }
  if (!statSync(d1Path, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`seed: target is not a file: ${d1Path}`);
  }
}

function countLabel(result: SeedResult): string {
  return `${result.people} people, ${result.relationships} relationships, ${result.stories} stories, ${result.media} media`;
}

type PurgeCounts = Record<SeedPurgeTable, number>;

function countMarkedRows(database: DatabaseSync, provenance: SeedProvenance, table: SeedPurgeTable): number {
  if (table === "space_memberships") {
    return provenance.memberships.reduce((count, membership) => {
      const row = database
        .prepare("SELECT COUNT(*) AS n FROM space_memberships WHERE space_id = ? AND user_id = ?")
        .get(membership.spaceId, membership.userId) as { n: number };
      return count + Number(row.n);
    }, 0);
  }

  const ids = provenance.rowIds[table];
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  const row = database.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE id IN (${placeholders})`).get(...ids) as {
    n: number;
  };
  return Number(row.n);
}

function deleteMarkedRows(database: DatabaseSync, provenance: SeedProvenance, table: SeedPurgeTable): number {
  if (table === "space_memberships") {
    return provenance.memberships.reduce((count, membership) => {
      const result = database
        .prepare("DELETE FROM space_memberships WHERE space_id = ? AND user_id = ?")
        .run(membership.spaceId, membership.userId);
      return count + Number(result.changes);
    }, 0);
  }

  const ids = provenance.rowIds[table];
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  return Number(database.prepare(`DELETE FROM ${table} WHERE id IN (${placeholders})`).run(...ids).changes);
}

function inspectPurge(database: DatabaseSync, provenance: SeedProvenance): PurgeCounts {
  return Object.fromEntries(
    SEED_PURGE_TABLE_ORDER.map((table) => [table, countMarkedRows(database, provenance, table)]),
  ) as PurgeCounts;
}

function printPurgeCounts(d1Path: string, counts: PurgeCounts, dryRun: boolean): void {
  console.log(`${dryRun ? "Seed purge dry run" : "Seed purge execution"} for ${d1Path}:`);
  for (const table of SEED_PURGE_TABLE_ORDER) {
    console.log(`  ${table}: ${counts[table]}`);
  }
}

/** Preview by default; delete only exact seed-provenance rows with --execute. */
function purgeSeed(database: DatabaseSync, d1Path: string, execute: boolean): PurgeCounts {
  const identity = seedIdentity(EXAMPLE_SEED_PLAN);
  const provenance = seedProvenance(EXAMPLE_SEED_PLAN, identity);

  if (!execute) {
    const counts = inspectPurge(database, provenance);
    printPurgeCounts(d1Path, counts, true);
    console.log("No rows deleted. Run `npm run db:purge-seed -- --execute` to delete exactly these marked rows.");
    return counts;
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    const counts = inspectPurge(database, provenance);
    printPurgeCounts(d1Path, counts, false);
    for (const table of SEED_PURGE_TABLE_ORDER) {
      const deleted = deleteMarkedRows(database, provenance, table);
      if (deleted !== counts[table]) {
        throw new Error(`seed: ${table} changed during purge (expected ${counts[table]}, deleted ${deleted})`);
      }
    }
    database.exec("COMMIT");
    console.log(`Deleted the marked seed rows from ${d1Path}.`);
    console.log(`Seed identity (space ${identity.spaceId}, user ${identity.stewardUserId}) is now reusable.`);
    return counts;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

async function main(): Promise<void> {
  validateSeedPlan(EXAMPLE_SEED_PLAN);
  const force = process.argv.includes("--force");
  const purge = process.argv.includes("--purge");
  const executePurge = process.argv.includes("--execute");
  const explicit = process.argv.find((arg) => arg.startsWith("--db="));
  const d1Path = explicit ? explicit.slice("--db=".length) : findLocalD1();

  if (executePurge && !purge) {
    throw new Error("seed: --execute is only valid together with --purge");
  }

  if (purge) {
    assertLocalTarget(d1Path, force);
    const database = new DatabaseSync(d1Path);
    applyIdempotentMigration(database);
    purgeSeed(database, d1Path, executePurge);
    database.close();
    return;
  }

  assertLocalTarget(d1Path, force);
  const database = new DatabaseSync(d1Path);
  applyIdempotentMigration(database);

  const identity = seedIdentity(EXAMPLE_SEED_PLAN);
  const reusedSpace = database
    .prepare("SELECT id FROM family_spaces WHERE id = ?")
    .get(identity.spaceId) as { id: string } | undefined;
  if (reusedSpace) {
    database.close();
    throw new Error(
      "seed: the example family already exists in this database (deterministic seed space id). " +
        "Run `npm run db:purge-seed` to preview cleanup, then add `-- --execute` to perform it.",
    );
  }

  const existingPeople = database.prepare("SELECT COUNT(*) AS n FROM people").get() as { n: number };
  if (existingPeople.n > 0 && !force) {
    database.close();
    throw new Error(
      `seed: the local D1 already has ${existingPeople.n} people. Refusing to overwrite; run \`npm run db:purge-seed\` to preview seed cleanup, or pass --force for a throwaway database.`,
    );
  }

  const result = await seedFamily(d1Adapter(database), identity.spaceId, identity.stewardUserId, EXAMPLE_SEED_PLAN);
  database.close();
  console.log(`Seeded "${EXAMPLE_SEED_PLAN.spaceName}" into local D1 (${d1Path}).`);
  console.log(`Seed identity: space ${identity.spaceId}, user ${identity.stewardUserId}.`);
  console.log(`Inserted ${countLabel(result)}.`);
  console.log(`Sign in at /dev/sign-in with subject "${EXAMPLE_SEED_PLAN.stewardSubject}" and email "${EXAMPLE_SEED_PLAN.stewardEmail}" to browse it.`);
  console.log("Preview removal any time with: npm run db:purge-seed");
  console.log("Delete the marked rows only with: npm run db:purge-seed -- --execute");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
