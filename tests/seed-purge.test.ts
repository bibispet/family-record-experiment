import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { EXAMPLE_SEED_PLAN, SEED_PURGE_TABLE_ORDER, seedIdentity } from "../db/seed";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/seed.ts", import.meta.url));
const REPO_ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

function runSeed(d1Path: string, ...args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ["--import", "tsx", SCRIPT_PATH, `--db=${d1Path}`, "--force", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

function assertSuccess(result: SpawnSyncReturns<string>): void {
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

function countRows(d1Path: string, table: string): number {
  const database = new DatabaseSync(d1Path, { readOnly: true });
  try {
    return Number((database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
  } finally {
    database.close();
  }
}

test("seed purge is a per-table dry run until --execute is also present", { timeout: 30_000 }, () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "family-record-purge-"));
  const d1Path = join(temporaryDirectory, "local.sqlite");

  try {
    assertSuccess(runSeed(d1Path));
    const seededPeople = countRows(d1Path, "people");
    assert.equal(seededPeople, EXAMPLE_SEED_PLAN.people.length);

    const dryRun = runSeed(d1Path, "--purge");
    assertSuccess(dryRun);
    assert.match(dryRun.stdout, /Seed purge dry run/);
    assert.match(dryRun.stdout, /No rows deleted/);
    for (const table of SEED_PURGE_TABLE_ORDER) {
      assert.match(dryRun.stdout, new RegExp(`  ${table}: \\d+`));
    }
    assert.equal(countRows(d1Path, "people"), seededPeople);

    const execution = runSeed(d1Path, "--purge", "--execute");
    assertSuccess(execution);
    assert.match(execution.stdout, /Seed purge execution/);
    for (const table of SEED_PURGE_TABLE_ORDER) {
      assert.equal(countRows(d1Path, table), 0, `${table} should contain no marked seed rows`);
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("an unmarked story in the seed space is excluded and makes purge roll back", { timeout: 30_000 }, () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "family-record-purge-"));
  const d1Path = join(temporaryDirectory, "local.sqlite");

  try {
    assertSuccess(runSeed(d1Path));
    const identity = seedIdentity(EXAMPLE_SEED_PLAN);
    const database = new DatabaseSync(d1Path);
    try {
      database.exec("PRAGMA foreign_keys = ON");
      const person = database.prepare("SELECT id FROM people ORDER BY id LIMIT 1").get() as { id: string };
      const now = Date.now();
      database
        .prepare(
          "INSERT INTO stories (id, space_id, person_id, body, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(randomUUID(), identity.spaceId, person.id, "A real story entered after seeding.", identity.stewardUserId, now, now);
    } finally {
      database.close();
    }

    const dryRun = runSeed(d1Path, "--purge");
    assertSuccess(dryRun);
    assert.match(dryRun.stdout, new RegExp(`  stories: ${EXAMPLE_SEED_PLAN.stories.length}(?:\\r?\\n|$)`));
    assert.equal(countRows(d1Path, "stories"), EXAMPLE_SEED_PLAN.stories.length + 1);

    const execution = runSeed(d1Path, "--purge", "--execute");
    assert.notEqual(execution.status, 0);
    assert.match(`${execution.stdout}\n${execution.stderr}`, /FOREIGN KEY constraint failed/);
    assert.equal(countRows(d1Path, "stories"), EXAMPLE_SEED_PLAN.stories.length + 1);
    assert.equal(countRows(d1Path, "people"), EXAMPLE_SEED_PLAN.people.length);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
