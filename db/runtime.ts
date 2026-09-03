import { env } from "cloudflare:workers";
import initialMigration from "../drizzle/0000_romantic_agent_zero.sql?raw";

const initialized = new WeakMap<object, Promise<void>>();
const lastMediaReconciliation = new WeakMap<object, number>();
const MEDIA_RECONCILE_INTERVAL_MS = 10 * 60 * 1000;
const STALE_MEDIA_AGE_MS = 60 * 60 * 1000;

export type FamilyRecordBindings = { DB: D1Database; MEDIA: R2Bucket };

export function getBindings(): FamilyRecordBindings {
  if (!env.DB || !env.MEDIA) {
    throw new Error("Required private database or media binding is unavailable.");
  }
  return { DB: env.DB, MEDIA: env.MEDIA };
}

export async function ensureSchema(database: D1Database): Promise<void> {
  let pending = initialized.get(database as object);
  if (!pending) {
    pending = initialize(database).catch((error) => {
      initialized.delete(database as object);
      throw error;
    });
    initialized.set(database as object, pending);
  }
  await pending;
}

export async function reconcileStaleMedia(database: D1Database, media: R2Bucket): Promise<void> {
  const now = Date.now();
  const databaseKey = database as object;
  const lastRun = lastMediaReconciliation.get(databaseKey) ?? 0;
  if (now - lastRun < MEDIA_RECONCILE_INTERVAL_MS) return;
  lastMediaReconciliation.set(databaseKey, now);

  let candidates: D1Result<{ id: string; r2_key: string; status: "pending" | "failed"; created_at: number }>;
  try {
    candidates = await database.prepare(`
      SELECT id, r2_key, status, created_at
      FROM media_assets
      WHERE status IN ('pending', 'failed') AND ready_at IS NULL AND created_at <= ?
      ORDER BY created_at
      LIMIT 12
    `).bind(now - STALE_MEDIA_AGE_MS).all();
  } catch {
    return;
  }

  for (const candidate of candidates.results) {
    if (candidate.status === "pending") {
      const claimed = await database.prepare(`
        UPDATE media_assets SET status = 'failed'
        WHERE id = ? AND status = 'pending' AND ready_at IS NULL AND created_at <= ?
        RETURNING id
      `).bind(candidate.id, now - STALE_MEDIA_AGE_MS).first<{ id: string }>().catch(() => null);
      if (!claimed) continue;
    }

    await media.delete(candidate.r2_key).catch(() => undefined);
  }
}

async function initialize(database: D1Database) {
  await database.prepare("PRAGMA foreign_keys = ON").run();

  const existing = await database.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'index' AND name = 'users_auth_subject_uq'").first();
  if (existing) return;

  const statements = initialMigration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map(makeIdempotent)
    .map((statement) => database.prepare(statement));

  // Every prepared entry is exactly one statement. The generated migration is
  // checked in and remains the reproducible deployment source of truth.
  await database.batch(statements);
  await database.prepare("PRAGMA optimize").run();
}

function makeIdempotent(statement: string) {
  return statement
    .replace(/^CREATE TABLE\s+/i, "CREATE TABLE IF NOT EXISTS ")
    .replace(/^CREATE UNIQUE INDEX\s+/i, "CREATE UNIQUE INDEX IF NOT EXISTS ")
    .replace(/^CREATE INDEX\s+/i, "CREATE INDEX IF NOT EXISTS ");
}
