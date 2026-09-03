import { readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EXAMPLE_SEED_PLAN, seedFamily, seedIdentity, validateSeedPlan, type SeedResult } from "../db/seed";
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

type PurgeCounts = Record<string, number>;

/** Delete every example row for the seed identity, children before parents. */
function purgeSeed(database: DatabaseSync, d1Path: string): PurgeCounts {
  const identity = seedIdentity(EXAMPLE_SEED_PLAN);
  const spaceId = identity.spaceId;
  const tables = ["media_assets", "relationships", "stories", "person_authorities", "people", "space_memberships"];
  const counts: PurgeCounts = {};
  database.exec("BEGIN");
  try {
    for (const table of tables) {
      const result = database.prepare(`DELETE FROM ${table} WHERE space_id = ?`).run(spaceId);
      counts[table] = Number(result.changes);
    }
    const spaceResult = database.prepare("DELETE FROM family_spaces WHERE id = ?").run(spaceId);
    counts.family_spaces = Number(spaceResult.changes);
    const userResult = database.prepare("DELETE FROM users WHERE id = ?").run(identity.stewardUserId);
    counts.users = Number(userResult.changes);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  console.log(`Purged seed data from ${d1Path}: ${JSON.stringify(counts)}.`);
  console.log(`Seed identity (space ${identity.spaceId}, user ${identity.stewardUserId}) is now reusable.`);
  return counts;
}

async function main(): Promise<void> {
  validateSeedPlan(EXAMPLE_SEED_PLAN);
  const force = process.argv.includes("--force");
  const purge = process.argv.includes("--purge");
  const explicit = process.argv.find((arg) => arg.startsWith("--db="));
  const d1Path = explicit ? explicit.slice("--db=".length) : findLocalD1();

  if (purge) {
    assertLocalTarget(d1Path, force);
    const database = new DatabaseSync(d1Path);
    applyIdempotentMigration(database);
    purgeSeed(database, d1Path);
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
        "Run `npm run db:seed -- --purge` to remove it first.",
    );
  }

  const existingPeople = database.prepare("SELECT COUNT(*) AS n FROM people").get() as { n: number };
  if (existingPeople.n > 0 && !force) {
    database.close();
    throw new Error(
      `seed: the local D1 already has ${existingPeople.n} people. Refusing to overwrite; run \`npm run db:seed -- --purge\` to clear the example family, or pass --force for a throwaway database.`,
    );
  }

  const result = await seedFamily(d1Adapter(database), identity.spaceId, identity.stewardUserId, EXAMPLE_SEED_PLAN);
  database.close();
  console.log(`Seeded "${EXAMPLE_SEED_PLAN.spaceName}" into local D1 (${d1Path}).`);
  console.log(`Seed identity: space ${identity.spaceId}, user ${identity.stewardUserId}.`);
  console.log(`Inserted ${countLabel(result)}.`);
  console.log(`Sign in at /dev/sign-in with subject "${EXAMPLE_SEED_PLAN.stewardSubject}" and email "${EXAMPLE_SEED_PLAN.stewardEmail}" to browse it.`);
  console.log("Remove it any time with: npm run db:seed -- --purge");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});