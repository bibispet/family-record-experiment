import type { ApiActor } from "./api";
import { HttpError } from "./api";
import { canonicalizeRelationshipEndpoints, type RelationshipEvidenceMode, type RelationshipType } from "./domain";
import { ensureSchema, getBindings, reconcileStaleMedia } from "../../db/runtime";

type DbUser = { id: string; email_display: string | null };
type DbSpace = { id: string; name: string };
type DbPerson = { id: string; space_id: string; display_name: string; created_at: number };

const USER_MEDIA_BYTE_QUOTA = 512 * 1024 * 1024;
const USER_MEDIA_ITEM_QUOTA = 500;
const USER_DAILY_UPLOAD_QUOTA = 100;

export type StoreContext = {
  database: D1Database;
  media: R2Bucket;
  user: DbUser;
  space: DbSpace;
  actor: ApiActor;
};

const accessiblePeopleCte = `
  WITH eligible_people AS (
    SELECT pa.person_id
    FROM person_authorities pa
    WHERE pa.space_id = ?1 AND pa.user_id = ?2
      AND pa.starts_at <= ?3 AND (pa.ends_at IS NULL OR pa.ends_at > ?3)
    UNION
    SELECT c.person_id
    FROM custodianships c
    WHERE c.space_id = ?1 AND c.custodian_user_id = ?2
      AND c.status = 'active' AND c.verification_status = 'verified'
      AND c.valid_from IS NOT NULL AND c.valid_from <= ?3
      AND (c.valid_until IS NULL OR c.valid_until > ?3)
    UNION
    SELECT ssp.person_id
    FROM share_grants sg
    JOIN share_sets ss ON ss.id = sg.share_set_id AND ss.space_id = sg.space_id
    JOIN share_set_people ssp ON ssp.share_set_id = ss.id AND ssp.space_id = ss.space_id
    WHERE sg.space_id = ?1 AND sg.grantee_user_id = ?2 AND sg.permission = 'view'
      AND sg.created_at <= ?3 AND (sg.revoked_at IS NULL OR sg.revoked_at > ?3)
      AND ss.created_at <= ?3 AND (ss.revoked_at IS NULL OR ss.revoked_at > ?3)
      AND ssp.added_at <= ?3 AND (ssp.removed_at IS NULL OR ssp.removed_at > ?3)
  )`;

export async function getContext(actor: ApiActor, requestedSpaceId?: string): Promise<StoreContext> {
  const { DB, MEDIA } = getBindings();
  await ensureSchema(DB);
  await reconcileStaleMedia(DB, MEDIA);
  const user = await ensureUser(DB, actor);
  await ensurePersonalSpace(DB, user, actor.displayName);
  const space = await chooseSpace(DB, user.id, requestedSpaceId);
  if (!space) throw new HttpError(404, "Family space not found.", "not_found");
  return { database: DB, media: MEDIA, user, space, actor };
}

async function ensureUser(database: D1Database, actor: ApiActor): Promise<DbUser> {
  let user = await database
    .prepare("SELECT id, email_display FROM users WHERE auth_subject = ?")
    .bind(actor.authSubject)
    .first<DbUser>();
  if (!user) {
    const candidateId = crypto.randomUUID();
    await database
      .prepare("INSERT OR IGNORE INTO users (id, auth_subject, email_display, created_at) VALUES (?, ?, ?, ?)")
      .bind(candidateId, actor.authSubject, actor.email, Date.now())
      .run();
    user = await database
      .prepare("SELECT id, email_display FROM users WHERE auth_subject = ?")
      .bind(actor.authSubject)
      .first<DbUser>();
  }
  if (!user) throw new Error("Authenticated user could not be initialized.");
  if (user.email_display !== actor.email) {
    await database.prepare("UPDATE users SET email_display = ? WHERE id = ?").bind(actor.email, user.id).run();
    user.email_display = actor.email;
  }
  return user;
}

async function ensurePersonalSpace(database: D1Database, user: DbUser, displayName: string) {
  const existing = await database
    .prepare("SELECT 1 AS found FROM space_memberships WHERE user_id = ? AND role = 'steward' AND status = 'active' LIMIT 1")
    .bind(user.id)
    .first();
  if (existing) return;
  const now = Date.now();
  const firstName = displayName.includes("@") ? "My" : `${displayName.split(/\s+/)[0]}'s`;
  await database.batch([
    database.prepare("INSERT OR IGNORE INTO family_spaces (id, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?)").bind(user.id, `${firstName} family`, user.id, now),
    database.prepare("INSERT OR IGNORE INTO space_memberships (space_id, user_id, role, status, joined_at) VALUES (?, ?, 'steward', 'active', ?)").bind(user.id, user.id, now),
  ]);
}

async function chooseSpace(database: D1Database, userId: string, requestedSpaceId?: string): Promise<DbSpace | null> {
  const now = Date.now();
  if (requestedSpaceId) {
    return database.prepare(`
      SELECT fs.id, fs.name FROM family_spaces fs
      JOIN space_memberships sm ON sm.space_id = fs.id
      WHERE fs.id = ? AND sm.user_id = ? AND sm.status = 'active' AND (
        sm.role = 'steward'
        OR EXISTS (SELECT 1 FROM person_authorities pa WHERE pa.space_id = fs.id AND pa.user_id = ? AND pa.starts_at <= ? AND (pa.ends_at IS NULL OR pa.ends_at > ?))
        OR EXISTS (SELECT 1 FROM custodianships c WHERE c.space_id = fs.id AND c.custodian_user_id = ? AND c.status = 'active' AND c.verification_status = 'verified' AND c.valid_from <= ? AND (c.valid_until IS NULL OR c.valid_until > ?))
        OR EXISTS (SELECT 1 FROM share_grants sg WHERE sg.space_id = fs.id AND sg.grantee_user_id = ? AND sg.created_at <= ? AND (sg.revoked_at IS NULL OR sg.revoked_at > ?))
      )
    `).bind(requestedSpaceId, userId, userId, now, now, userId, now, now, userId, now, now).first<DbSpace>();
  }
  return database.prepare(`
    SELECT fs.id, fs.name
    FROM family_spaces fs
    JOIN space_memberships sm ON sm.space_id = fs.id AND sm.user_id = ? AND sm.status = 'active'
    WHERE sm.role = 'steward'
      OR EXISTS (SELECT 1 FROM person_authorities pa WHERE pa.space_id = fs.id AND pa.user_id = ? AND pa.starts_at <= ? AND (pa.ends_at IS NULL OR pa.ends_at > ?))
      OR EXISTS (SELECT 1 FROM custodianships c WHERE c.space_id = fs.id AND c.custodian_user_id = ? AND c.status = 'active' AND c.verification_status = 'verified' AND c.valid_from <= ? AND (c.valid_until IS NULL OR c.valid_until > ?))
      OR EXISTS (SELECT 1 FROM share_grants sg WHERE sg.space_id = fs.id AND sg.grantee_user_id = ? AND sg.created_at <= ? AND (sg.revoked_at IS NULL OR sg.revoked_at > ?))
    ORDER BY CASE
      WHEN EXISTS (SELECT 1 FROM person_authorities pa WHERE pa.space_id = fs.id AND pa.user_id = ? AND pa.starts_at <= ? AND (pa.ends_at IS NULL OR pa.ends_at > ?)) THEN 0
      WHEN EXISTS (SELECT 1 FROM share_grants sg WHERE sg.space_id = fs.id AND sg.grantee_user_id = ? AND sg.created_at <= ? AND (sg.revoked_at IS NULL OR sg.revoked_at > ?)) THEN 1
      ELSE 2 END,
      fs.created_at
    LIMIT 1
  `).bind(userId, userId, now, now, userId, now, now, userId, now, now, userId, now, now, userId, now, now).first<DbSpace>();
}

export async function getFamilySnapshot(actor: ApiActor, requestedSpaceId?: string) {
  const context = await getContext(actor, requestedSpaceId);
  const { database, user, space } = context;
  const now = Date.now();
  const binds = [space.id, user.id, now] as const;

  const [peopleResult, relationshipResult, storyResult, mediaResult, shareResult, spacesResult] = await Promise.all([
    database.prepare(`${accessiblePeopleCte}
      SELECT p.id, p.display_name, p.birth_date, p.birth_date_accuracy FROM people p
      JOIN eligible_people ep ON ep.person_id = p.id
      WHERE p.space_id = ?1 ORDER BY p.created_at, p.display_name
    `).bind(...binds).all<{ id: string; display_name: string; birth_date: string | null; birth_date_accuracy: "unknown" | "exact" | "approximate" }>(),
    database.prepare(`${accessiblePeopleCte}
      SELECT r.id, r.source_person_id, r.target_person_id, r.relationship_type, r.evidence_mode, r.created_at, r.ended_at
      FROM relationships r
      JOIN eligible_people source_access ON source_access.person_id = r.source_person_id
      JOIN eligible_people target_access ON target_access.person_id = r.target_person_id
      WHERE r.space_id = ?1 ORDER BY r.created_at DESC
    `).bind(...binds).all<Record<string, string | number | null>>(),
    database.prepare(`${accessiblePeopleCte}
      SELECT s.id, s.person_id, s.body, s.created_at, s.updated_at
      FROM stories s JOIN eligible_people ep ON ep.person_id = s.person_id
      WHERE s.space_id = ?1 ORDER BY s.created_at DESC
    `).bind(...binds).all<Record<string, string | number>>(),
    database.prepare(`${accessiblePeopleCte}
      SELECT m.id, m.person_id, m.kind, m.caption, m.status, m.created_at
      FROM media_assets m JOIN eligible_people ep ON ep.person_id = m.person_id
      WHERE m.space_id = ?1 AND m.status = 'ready' ORDER BY m.created_at DESC
    `).bind(...binds).all<Record<string, string | number>>(),
    database.prepare(`
      SELECT ss.id, ss.kind, ss.created_at, ss.revoked_at, u.email_display,
        group_concat(CASE WHEN ssp.removed_at IS NULL THEN ssp.person_id END) AS person_ids
      FROM share_sets ss
      JOIN share_grants sg ON sg.share_set_id = ss.id AND sg.space_id = ss.space_id
      JOIN users u ON u.id = sg.grantee_user_id
      LEFT JOIN share_set_people ssp ON ssp.share_set_id = ss.id AND ssp.space_id = ss.space_id
      WHERE ss.space_id = ? AND ss.created_by_user_id = ?
      GROUP BY ss.id, ss.kind, ss.created_at, ss.revoked_at, u.email_display
      ORDER BY ss.created_at DESC
    `).bind(space.id, user.id).all<Record<string, string | number | null>>(),
    database.prepare(`
      SELECT fs.id, fs.name
      FROM family_spaces fs
      JOIN space_memberships sm ON sm.space_id = fs.id
      WHERE sm.user_id = ? AND sm.status = 'active' AND (
        sm.role = 'steward'
        OR EXISTS (SELECT 1 FROM person_authorities pa WHERE pa.space_id = fs.id AND pa.user_id = ? AND pa.starts_at <= ? AND (pa.ends_at IS NULL OR pa.ends_at > ?))
        OR EXISTS (SELECT 1 FROM custodianships c WHERE c.space_id = fs.id AND c.custodian_user_id = ? AND c.status = 'active' AND c.verification_status = 'verified' AND c.valid_from <= ? AND (c.valid_until IS NULL OR c.valid_until > ?))
        OR EXISTS (SELECT 1 FROM share_grants sg WHERE sg.space_id = fs.id AND sg.grantee_user_id = ? AND sg.created_at <= ? AND (sg.revoked_at IS NULL OR sg.revoked_at > ?))
      )
      ORDER BY fs.created_at, fs.name
    `).bind(user.id, user.id, now, now, user.id, now, now, user.id, now, now).all<{ id: string; name: string }>(),
  ]);
  const managed = await managedPeople(context, peopleResult.results.map((person) => person.id));
  const steward = await database.prepare("SELECT 1 AS found FROM space_memberships WHERE space_id = ? AND user_id = ? AND role = 'steward' AND status = 'active'")
    .bind(space.id, user.id).first();

  return {
    viewer: { id: user.id, displayName: actor.displayName, email: actor.email },
    data: {
      familyId: space.id,
      familyName: space.name,
      spaces: spacesResult.results,
      access: { canCreatePeople: Boolean(steward), managedPersonIds: managed.map((person) => person.id) },
      people: peopleResult.results.map((row) => ({ id: row.id, displayName: row.display_name, birthDate: row.birth_date, birthDateAccuracy: row.birth_date_accuracy })),
      relationships: relationshipResult.results.map((row) => ({
        id: String(row.id), sourcePersonId: String(row.source_person_id), targetPersonId: String(row.target_person_id),
        relationshipType: row.relationship_type, evidenceMode: row.evidence_mode,
        createdAt: iso(Number(row.created_at)), endedAt: row.ended_at === null ? null : iso(Number(row.ended_at)),
      })),
      stories: storyResult.results.map((row) => ({
        id: String(row.id), personId: String(row.person_id), body: String(row.body), createdAt: iso(Number(row.created_at)),
      })),
      media: mediaResult.results.map((row) => ({
        id: String(row.id), personId: String(row.person_id), kind: row.kind,
        fileName: row.kind === "photo" ? "Private photo" : "Private voice note",
        caption: String(row.caption ?? ""), status: "ready", accessUrl: `/api/media/${row.id}?space=${encodeURIComponent(space.id)}`, createdAt: iso(Number(row.created_at)),
      })),
      shares: shareResult.results.map((row) => ({
        id: String(row.id), recipientEmail: String(row.email_display ?? "Signed-in family member"), permission: "view",
        personIds: typeof row.person_ids === "string" && row.person_ids ? row.person_ids.split(",") : [],
        createdAt: iso(Number(row.created_at)), revokedAt: row.revoked_at === null ? null : iso(Number(row.revoked_at)),
      })),
    },
  };
}

export async function getAuditLog(actor: ApiActor, requestedSpaceId?: string) {
  const context = await getContext(actor, requestedSpaceId);
  const rows = await context.database.prepare(`
    SELECT ae.id, ae.action, ae.resource_type, ae.resource_id, ae.occurred_at, ae.dedupe_key, u.email_display
    FROM audit_events ae
    LEFT JOIN users u ON u.id = ae.actor_user_id
    WHERE ae.space_id = ?
    ORDER BY ae.occurred_at DESC
    LIMIT 200
  `).bind(context.space.id).all<{ id: string; action: string; resource_type: string; resource_id: string; occurred_at: number; dedupe_key: string | null; email_display: string | null }>();
  return rows.results.map((row) => ({
    id: row.id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    occurredAt: iso(row.occurred_at),
    actorEmail: row.email_display,
  }));
}

export async function createPerson(actor: ApiActor, input: { displayName: string; birthDate: string | null }, requestedSpaceId?: string) {
  const context = await getContext(actor, requestedSpaceId);
  const { database, user, space } = context;
  await requireSteward(context);
  const id = crypto.randomUUID();
  const authorityId = crypto.randomUUID();
  const now = Date.now();
  const accuracy = input.birthDate ? "exact" : "unknown";
  await database.batch([
    database.prepare("INSERT INTO people (id, space_id, display_name, birth_date, birth_date_accuracy, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, space.id, input.displayName, input.birthDate, accuracy, user.id, now, now),
    database.prepare("INSERT INTO person_authorities (id, space_id, person_id, user_id, role, starts_at, ends_at, granted_by_user_id, created_at) VALUES (?, ?, ?, ?, 'record_manager', ?, NULL, ?, ?)")
      .bind(authorityId, space.id, id, user.id, now, user.id, now),
    audit(database, space.id, user.id, "person.created", "person", id, now),
  ]);
  return { id, displayName: input.displayName, birthDate: input.birthDate, birthDateAccuracy: accuracy };
}

export async function updatePerson(actor: ApiActor, personId: string, input: { displayName: string; birthDate?: string | null }, requestedSpaceId?: string) {
  const context = await getManagedPersonContext(actor, personId, requestedSpaceId);
  const accuracy = input.birthDate === undefined ? undefined : input.birthDate ? "exact" : "unknown";
  const now = Date.now();
  const updates: string[] = ["display_name = ?", "updated_at = ?"];
  const binds: (string | number | null)[] = [input.displayName, now];
  if (accuracy !== undefined) {
    updates.push("birth_date = ?", "birth_date_accuracy = ?");
    binds.push(input.birthDate ?? null, accuracy);
  }
  binds.push(personId, context.space.id);
  await context.database.batch([
    context.database.prepare(`UPDATE people SET ${updates.join(", ")} WHERE id = ? AND space_id = ?`)
      .bind(...binds),
    audit(context.database, context.space.id, context.user.id, "person.updated", "person", personId, now),
  ]);
  return { id: personId, displayName: input.displayName, birthDate: input.birthDate ?? null, birthDateAccuracy: accuracy ?? "unknown" };
}

export async function createRelationship(actor: ApiActor, input: {
  sourcePersonId: string; targetPersonId: string; relationshipType: RelationshipType; evidenceMode: RelationshipEvidenceMode;
}, requestedSpaceId?: string) {
  const context = await getContext(actor, requestedSpaceId);
  const endpoints = canonicalizeRelationshipEndpoints(input.relationshipType, input.sourcePersonId, input.targetPersonId);
  const managed = await managedPeople(context, [endpoints.sourcePersonId, endpoints.targetPersonId]);
  if (managed.length !== 2) throw new HttpError(404, "Both people must be records you manage.", "not_found");
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await context.database.batch([
      context.database.prepare("INSERT INTO relationships (id, space_id, source_person_id, target_person_id, relationship_type, evidence_mode, created_by_user_id, created_at, ended_at, ended_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)")
        .bind(id, context.space.id, endpoints.sourcePersonId, endpoints.targetPersonId, input.relationshipType, input.evidenceMode, context.user.id, now),
      audit(context.database, context.space.id, context.user.id, "relationship.created", "relationship", id, now),
    ]);
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new HttpError(409, "That active relationship is already recorded.", "already_exists");
    throw error;
  }
  return { id, ...endpoints, relationshipType: input.relationshipType, evidenceMode: input.evidenceMode, createdAt: iso(now), endedAt: null };
}

export async function unlinkRelationship(actor: ApiActor, relationshipId: string, requestedSpaceId?: string) {
  const context = await getContext(actor, requestedSpaceId);
  const relationship = await context.database.prepare(`
    SELECT id, source_person_id, target_person_id, relationship_type, evidence_mode, created_at, ended_at
    FROM relationships WHERE id = ? AND space_id = ?
  `).bind(relationshipId, context.space.id).first<Record<string, string | number | null>>();
  if (!relationship) throw new HttpError(404, "Relationship not found.", "not_found");
  const managed = await managedPeople(context, [String(relationship.source_person_id), String(relationship.target_person_id)]);
  if (managed.length !== 2) throw new HttpError(404, "Relationship not found.", "not_found");
  if (relationship.ended_at === null) {
    const endedAt = Math.max(Date.now(), Number(relationship.created_at) + 1);
    await context.database.batch([
      context.database.prepare("UPDATE relationships SET ended_at = ?, ended_by_user_id = ? WHERE id = ? AND ended_at IS NULL")
        .bind(endedAt, context.user.id, relationshipId),
      audit(context.database, context.space.id, context.user.id, "relationship.unlinked", "relationship", relationshipId, endedAt, `relationship.unlinked:${relationshipId}`),
    ]);
    const persisted = await context.database.prepare("SELECT ended_at FROM relationships WHERE id = ? AND space_id = ?")
      .bind(relationshipId, context.space.id).first<{ ended_at: number | null }>();
    if (persisted?.ended_at === null || persisted?.ended_at === undefined) {
      throw new Error("Relationship unlink did not persist.");
    }
    relationship.ended_at = persisted.ended_at;
  }
  return {
    id: relationshipId, sourcePersonId: String(relationship.source_person_id), targetPersonId: String(relationship.target_person_id),
    relationshipType: relationship.relationship_type, evidenceMode: relationship.evidence_mode,
    createdAt: iso(Number(relationship.created_at)), endedAt: iso(Number(relationship.ended_at)),
  };
}

export async function updateRelationship(actor: ApiActor, relationshipId: string, input: { relationshipType?: RelationshipType; evidenceMode?: RelationshipEvidenceMode }, requestedSpaceId?: string) {
  const context = await getContext(actor, requestedSpaceId);
  const relationship = await context.database.prepare(`
    SELECT id, source_person_id, target_person_id, relationship_type, evidence_mode, created_at, ended_at
    FROM relationships WHERE id = ? AND space_id = ?
  `).bind(relationshipId, context.space.id).first<Record<string, string | number | null>>();
  if (!relationship) throw new HttpError(404, "Relationship not found.", "not_found");
  const managed = await managedPeople(context, [String(relationship.source_person_id), String(relationship.target_person_id)]);
  if (managed.length !== 2) throw new HttpError(404, "Relationship not found.", "not_found");
  if (relationship.ended_at !== null) throw new HttpError(409, "An ended relationship cannot be edited.", "already_exists");
  const newType = input.relationshipType ?? String(relationship.relationship_type);
  const newMode = input.evidenceMode ?? String(relationship.evidence_mode);
  const now = Date.now();
  await context.database.batch([
    context.database.prepare("UPDATE relationships SET relationship_type = ?, evidence_mode = ?, created_at = ? WHERE id = ? AND space_id = ?")
      .bind(newType, newMode, Math.max(now, Number(relationship.created_at) + 1), relationshipId, context.space.id),
    audit(context.database, context.space.id, context.user.id, "relationship.updated", "relationship", relationshipId, now),
  ]);
  return {
    id: relationshipId,
    sourcePersonId: String(relationship.source_person_id),
    targetPersonId: String(relationship.target_person_id),
    relationshipType: newType,
    evidenceMode: newMode,
    createdAt: iso(Math.max(now, Number(relationship.created_at) + 1)),
    endedAt: null,
  };
}

export async function createStory(actor: ApiActor, personId: string, body: string, requestedSpaceId?: string) {
  const context = await getContext(actor, requestedSpaceId);
  if ((await managedPeople(context, [personId])).length !== 1) throw new HttpError(404, "Person not found.", "not_found");
  const id = crypto.randomUUID();
  const now = Date.now();
  await context.database.batch([
    context.database.prepare("INSERT INTO stories (id, space_id, person_id, body, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, context.space.id, personId, body, context.user.id, now, now),
    audit(context.database, context.space.id, context.user.id, "story.created", "story", id, now),
  ]);
  return { id, personId, body, createdAt: iso(now) };
}

export async function getManagedPersonContext(actor: ApiActor, personId: string, requestedSpaceId?: string) {
  const context = await getContext(actor, requestedSpaceId);
  if ((await managedPeople(context, [personId])).length !== 1) {
    throw new HttpError(404, "Person not found.", "not_found");
  }
  return context;
}

export async function beginMedia(context: StoreContext, input: {
  personId: string; kind: "photo" | "voice_note"; contentType: string; byteSize: number; caption: string; extension: string;
}) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const key = `${context.space.id}/${input.personId}/${id}.${input.extension}`;
  const usage = await context.database.prepare(`
    SELECT COUNT(*) AS item_count, COALESCE(SUM(byte_size), 0) AS byte_count,
      COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS recent_count
    FROM media_assets
    WHERE created_by_user_id = ? AND status IN ('pending', 'ready')
  `).bind(now - 24 * 60 * 60 * 1000, context.user.id).first<{
    item_count: number; byte_count: number; recent_count: number;
  }>();
  if (
    Number(usage?.item_count ?? 0) >= USER_MEDIA_ITEM_QUOTA ||
    Number(usage?.byte_count ?? 0) + input.byteSize > USER_MEDIA_BYTE_QUOTA
  ) {
    throw new HttpError(413, "This account has reached its private media storage limit.", "media_quota_reached");
  }
  if (Number(usage?.recent_count ?? 0) >= USER_DAILY_UPLOAD_QUOTA) {
    throw new HttpError(429, "This account has reached its daily upload limit. Try again later.", "upload_rate_limited");
  }
  await context.database.prepare(`
    INSERT INTO media_assets (id, space_id, person_id, story_id, r2_key, kind, canonical_mime, byte_size, caption, status, created_by_user_id, created_at, ready_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)
  `).bind(id, context.space.id, input.personId, key, input.kind, input.contentType, input.byteSize, input.caption, context.user.id, now).run();
  return { context, id, key, createdAt: now, ...input };
}

export async function completeMedia(upload: Awaited<ReturnType<typeof beginMedia>>, bytes: ArrayBuffer) {
  const { context } = upload;
  try {
    await context.media.put(upload.key, bytes, { httpMetadata: { contentType: upload.contentType } });
    if ((await managedPeople(context, [upload.personId])).length !== 1) {
      throw new HttpError(404, "Person not found.", "not_found");
    }
    const readyAt = Math.max(Date.now(), upload.createdAt + 1);
    await context.database.batch([
      context.database.prepare("UPDATE media_assets SET status = 'ready', ready_at = ? WHERE id = ? AND status = 'pending'").bind(readyAt, upload.id),
      context.database.prepare(`
        INSERT OR IGNORE INTO audit_events
          (id, space_id, actor_user_id, action, resource_type, resource_id, occurred_at, dedupe_key)
        SELECT ?, ?, ?, 'media.ready', 'media', ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM media_assets
          WHERE id = ? AND space_id = ? AND status = 'ready' AND ready_at = ?
        )
      `).bind(
        crypto.randomUUID(), context.space.id, context.user.id, upload.id, readyAt, `media.ready:${upload.id}`,
        upload.id, context.space.id, readyAt,
      ),
    ]);
    const persisted = await context.database.prepare("SELECT status, ready_at FROM media_assets WHERE id = ? AND space_id = ?")
      .bind(upload.id, context.space.id).first<{ status: string; ready_at: number | null }>();
    if (persisted?.status !== "ready" || persisted.ready_at !== readyAt) {
      throw new Error("Upload could not be finalized.");
    }
    return {
      id: upload.id, personId: upload.personId, kind: upload.kind, fileName: upload.kind === "photo" ? "Private photo" : "Private voice note",
      caption: upload.caption, status: "ready", accessUrl: `/api/media/${upload.id}?space=${encodeURIComponent(context.space.id)}`, createdAt: iso(upload.createdAt),
    };
  } catch (error) {
    await context.media.delete(upload.key).catch(() => undefined);
    await context.database.prepare("UPDATE media_assets SET status = 'failed', ready_at = NULL WHERE id = ?").bind(upload.id).run().catch(() => undefined);
    throw error;
  }
}

export async function getReadableMedia(actor: ApiActor, mediaId: string, requestedSpaceId?: string) {
  const context = await getContext(actor, requestedSpaceId);
  const now = Date.now();
  const row = await context.database.prepare(`${accessiblePeopleCte}
    SELECT m.id, m.r2_key, m.canonical_mime, m.kind, m.caption
    FROM media_assets m JOIN eligible_people ep ON ep.person_id = m.person_id
    WHERE m.id = ?4 AND m.space_id = ?1 AND m.status = 'ready'
  `).bind(context.space.id, context.user.id, now, mediaId).first<{ id: string; r2_key: string; canonical_mime: string; kind: string; caption: string }>();
  if (!row) throw new HttpError(404, "Media not found.", "not_found");
  return { context, row };
}

export async function updateStory(actor: ApiActor, storyId: string, body: string, requestedSpaceId?: string) {
  const context = await getContext(actor, requestedSpaceId);
  const row = await context.database.prepare(
    "SELECT id, space_id, person_id, body, created_at FROM stories WHERE id = ? AND space_id = ?"
  ).bind(storyId, context.space.id).first<{ id: string; space_id: string; person_id: string; body: string; created_at: number }>();
  if (!row) throw new HttpError(404, "Story not found.", "not_found");
  const managed = await managedPeople(context, [row.person_id]);
  if (managed.length !== 1) throw new HttpError(404, "Story not found.", "not_found");
  const now = Date.now();
  await context.database.batch([
    context.database.prepare("UPDATE stories SET body = ?, updated_at = ? WHERE id = ? AND space_id = ?")
      .bind(body, now, storyId, context.space.id),
    audit(context.database, context.space.id, context.user.id, "story.updated", "story", storyId, now, `story.updated:${storyId}`),
  ]);
  return { id: storyId, personId: row.person_id, body, createdAt: iso(row.created_at) };
}

export async function deleteStory(actor: ApiActor, storyId: string, requestedSpaceId?: string) {
  const context = await getContext(actor, requestedSpaceId);
  const row = await context.database.prepare(
    "SELECT id, space_id, person_id FROM stories WHERE id = ? AND space_id = ?"
  ).bind(storyId, context.space.id).first<{ id: string; space_id: string; person_id: string }>();
  if (!row) throw new HttpError(404, "Story not found.", "not_found");
  const managed = await managedPeople(context, [row.person_id]);
  if (managed.length !== 1) throw new HttpError(404, "Story not found.", "not_found");
  const now = Date.now();
  await context.database.batch([
    context.database.prepare("DELETE FROM stories WHERE id = ? AND space_id = ?").bind(storyId, context.space.id),
    audit(context.database, context.space.id, context.user.id, "story.deleted", "story", storyId, now, `story.deleted:${storyId}`),
  ]);
  return { id: storyId, personId: row.person_id };
}

export async function updateMediaCaption(actor: ApiActor, mediaId: string, caption: string, requestedSpaceId?: string) {
  const context = await getContext(actor, requestedSpaceId);
  const now = Date.now();
  const row = await context.database.prepare(
    "SELECT id, space_id, person_id, caption, created_at FROM media_assets WHERE id = ? AND space_id = ? AND status = 'ready'"
  ).bind(mediaId, context.space.id).first<{ id: string; space_id: string; person_id: string; caption: string; created_at: number }>();
  if (!row) throw new HttpError(404, "Media not found.", "not_found");
  const managed = await managedPeople(context, [row.person_id]);
  if (managed.length !== 1) throw new HttpError(404, "Media not found.", "not_found");
  await context.database.batch([
    context.database.prepare("UPDATE media_assets SET caption = ?, updated_at = ? WHERE id = ? AND space_id = ?")
      .bind(caption, now, mediaId, context.space.id),
    audit(context.database, context.space.id, context.user.id, "media.caption_updated", "media", mediaId, now, `media.caption_updated:${mediaId}`),
  ]);
  return { id: mediaId, personId: row.person_id, caption, createdAt: iso(row.created_at) };
}

export async function deleteMedia(actor: ApiActor, mediaId: string, requestedSpaceId?: string) {
  const context = await getContext(actor, requestedSpaceId);
  const row = await context.database.prepare(
    "SELECT id, space_id, person_id, r2_key FROM media_assets WHERE id = ? AND space_id = ?"
  ).bind(mediaId, context.space.id).first<{ id: string; space_id: string; person_id: string; r2_key: string }>();
  if (!row) throw new HttpError(404, "Media not found.", "not_found");
  const managed = await managedPeople(context, [row.person_id]);
  if (managed.length !== 1) throw new HttpError(404, "Media not found.", "not_found");
  await context.media.delete(row.r2_key).catch(() => undefined);
  const now = Date.now();
  await context.database.batch([
    context.database.prepare("DELETE FROM media_assets WHERE id = ? AND space_id = ?").bind(mediaId, context.space.id),
    audit(context.database, context.space.id, context.user.id, "media.deleted", "media", mediaId, now, `media.deleted:${mediaId}`),
  ]);
  return { id: mediaId, personId: row.person_id };
}

export async function createShare(actor: ApiActor, input: { recipientEmail: string; personIds: string[] }, requestedSpaceId?: string) {
  const context = await getContext(actor, requestedSpaceId);
  const uniqueIds = [...new Set(input.personIds)];
  const managed = await managedPeople(context, uniqueIds);
  if (managed.length !== uniqueIds.length) throw new HttpError(404, "One or more selected people are unavailable.", "not_found");
  const recipients = await context.database.prepare("SELECT id, email_display FROM users WHERE lower(email_display) = lower(?)")
    .bind(input.recipientEmail).all<DbUser>();
  if (recipients.results.length !== 1) {
    throw new HttpError(404, "We couldn't share with that account. Ask them to sign in and confirm their email.", "recipient_unavailable");
  }
  const recipient = recipients.results[0];
  if (recipient.id === context.user.id) throw new HttpError(400, "You already manage these records.", "validation_failed");
  const existingMembership = await context.database.prepare("SELECT status FROM space_memberships WHERE space_id = ? AND user_id = ?")
    .bind(context.space.id, recipient.id).first<{ status: string }>();
  if (existingMembership && existingMembership.status !== "active") {
    throw new HttpError(409, "This recipient's family-space access is currently suspended.", "recipient_suspended");
  }
  const id = crypto.randomUUID();
  const grantId = crypto.randomUUID();
  const now = Date.now();
  const kind = uniqueIds.length === 1 ? "person" : "branch";
  const label = uniqueIds.length === 1 ? managed[0].display_name : `${uniqueIds.length}-person branch`;
  const peopleStatements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < uniqueIds.length; offset += 16) {
    const chunk = uniqueIds.slice(offset, offset + 16);
    const values = chunk.map(() => "(?, ?, ?, ?, ?, ?, NULL, NULL)").join(", ");
    const bindings = chunk.flatMap((personId) => [crypto.randomUUID(), context.space.id, id, personId, context.user.id, now]);
    peopleStatements.push(context.database.prepare(`
      INSERT INTO share_set_people
        (id, space_id, share_set_id, person_id, added_by_user_id, added_at, removed_at, removed_by_user_id)
      VALUES ${values}
    `).bind(...bindings));
  }
  const statements = [
    context.database.prepare("INSERT OR IGNORE INTO space_memberships (space_id, user_id, role, status, joined_at) VALUES (?, ?, 'participant', 'active', ?)").bind(context.space.id, recipient.id, now),
    context.database.prepare("INSERT INTO share_sets (id, space_id, kind, label, created_by_user_id, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)").bind(id, context.space.id, kind, label, context.user.id, now),
    ...peopleStatements,
    context.database.prepare("INSERT INTO share_grants (id, space_id, share_set_id, grantee_user_id, permission, granted_by_user_id, created_at, revoked_at, revoked_by_user_id) VALUES (?, ?, ?, ?, 'view', ?, ?, NULL, NULL)").bind(grantId, context.space.id, id, recipient.id, context.user.id, now),
    audit(context.database, context.space.id, context.user.id, "share.created", "share_set", id, now),
  ];
  await context.database.batch(statements);
  return { id, recipientEmail: recipient.email_display ?? input.recipientEmail, permission: "view", personIds: uniqueIds, createdAt: iso(now), revokedAt: null };
}

export async function revokeShare(actor: ApiActor, shareId: string, requestedSpaceId?: string) {
  const context = await getContext(actor, requestedSpaceId);
  const share = await context.database.prepare(`
    SELECT ss.id, ss.created_at, ss.revoked_at, sg.grantee_user_id, u.email_display,
      group_concat(CASE WHEN ssp.removed_at IS NULL THEN ssp.person_id END) AS person_ids
    FROM share_sets ss
    JOIN share_grants sg ON sg.share_set_id = ss.id AND sg.space_id = ss.space_id
    JOIN users u ON u.id = sg.grantee_user_id
    LEFT JOIN share_set_people ssp ON ssp.share_set_id = ss.id AND ssp.space_id = ss.space_id
    WHERE ss.id = ? AND ss.space_id = ? AND ss.created_by_user_id = ?
    GROUP BY ss.id, ss.created_at, ss.revoked_at, sg.grantee_user_id, u.email_display
  `).bind(shareId, context.space.id, context.user.id).first<Record<string, string | number | null>>();
  if (!share) throw new HttpError(404, "Share not found.", "not_found");
  if (share.revoked_at === null) {
    const revokedAt = Math.max(Date.now(), Number(share.created_at) + 1);
    await context.database.batch([
      context.database.prepare("UPDATE share_sets SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(revokedAt, shareId),
      context.database.prepare("UPDATE share_grants SET revoked_at = ?, revoked_by_user_id = ? WHERE share_set_id = ? AND revoked_at IS NULL").bind(revokedAt, context.user.id, shareId),
      context.database.prepare(`
        DELETE FROM space_memberships
        WHERE space_id = ? AND user_id = ? AND role = 'participant'
          AND NOT EXISTS (SELECT 1 FROM share_grants sg WHERE sg.space_id = ? AND sg.grantee_user_id = ? AND (sg.revoked_at IS NULL OR sg.revoked_at > ?))
          AND NOT EXISTS (SELECT 1 FROM person_authorities pa WHERE pa.space_id = ? AND pa.user_id = ? AND pa.starts_at <= ? AND (pa.ends_at IS NULL OR pa.ends_at > ?))
          AND NOT EXISTS (SELECT 1 FROM custodianships c WHERE c.space_id = ? AND c.custodian_user_id = ? AND c.status = 'active' AND c.verification_status = 'verified' AND c.valid_from <= ? AND (c.valid_until IS NULL OR c.valid_until > ?))
      `).bind(
        context.space.id, share.grantee_user_id,
        context.space.id, share.grantee_user_id, revokedAt,
        context.space.id, share.grantee_user_id, revokedAt, revokedAt,
        context.space.id, share.grantee_user_id, revokedAt, revokedAt,
      ),
      audit(context.database, context.space.id, context.user.id, "share.revoked", "share_set", shareId, revokedAt, `share.revoked:${shareId}`),
    ]);
    const persisted = await context.database.prepare("SELECT revoked_at FROM share_sets WHERE id = ? AND space_id = ?")
      .bind(shareId, context.space.id).first<{ revoked_at: number | null }>();
    if (persisted?.revoked_at === null || persisted?.revoked_at === undefined) {
      throw new Error("Share revocation did not persist.");
    }
    share.revoked_at = persisted.revoked_at;
  }
  return {
    id: shareId, recipientEmail: String(share.email_display ?? "Signed-in family member"), permission: "view",
    personIds: typeof share.person_ids === "string" && share.person_ids ? share.person_ids.split(",") : [],
    createdAt: iso(Number(share.created_at)), revokedAt: iso(Number(share.revoked_at)),
  };
}

async function requireSteward(context: StoreContext) {
  const membership = await context.database.prepare("SELECT 1 AS found FROM space_memberships WHERE space_id = ? AND user_id = ? AND role = 'steward' AND status = 'active'")
    .bind(context.space.id, context.user.id).first();
  if (!membership) throw new HttpError(403, "You cannot add people to this family space.", "forbidden");
}

async function managedPeople(context: StoreContext, personIds: string[]): Promise<DbPerson[]> {
  if (personIds.length === 0) return [];
  const requested = new Set(personIds);
  const now = Date.now();
  const result = await context.database.prepare(`
    SELECT DISTINCT p.id, p.space_id, p.display_name, p.created_at
    FROM people p
    JOIN space_memberships sm ON sm.space_id = p.space_id AND sm.user_id = ? AND sm.status = 'active'
    WHERE p.space_id = ? AND (
      EXISTS (SELECT 1 FROM person_authorities pa WHERE pa.person_id = p.id AND pa.space_id = p.space_id AND pa.user_id = ? AND pa.starts_at <= ? AND (pa.ends_at IS NULL OR pa.ends_at > ?))
      OR EXISTS (SELECT 1 FROM custodianships c WHERE c.person_id = p.id AND c.space_id = p.space_id AND c.custodian_user_id = ? AND c.status = 'active' AND c.verification_status = 'verified' AND c.valid_from <= ? AND (c.valid_until IS NULL OR c.valid_until > ?))
    )
  `).bind(context.user.id, context.space.id, context.user.id, now, now, context.user.id, now, now).all<DbPerson>();
  return result.results.filter((person) => requested.has(person.id));
}

function audit(database: D1Database, spaceId: string, userId: string, action: string, resourceType: string, resourceId: string, now: number, dedupeKey: string | null = null) {
  return database.prepare("INSERT OR IGNORE INTO audit_events (id, space_id, actor_user_id, action, resource_type, resource_id, occurred_at, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), spaceId, userId, action, resourceType, resourceId, now, dedupeKey);
}

export async function updateFamilyName(actor: ApiActor, name: string, requestedSpaceId?: string) {
  const context = await getContext(actor, requestedSpaceId);
  if (!name || name.trim().length === 0) throw new HttpError(400, "Family name cannot be blank.", "validation_error");
  const trimmed = name.trim().slice(0, 200);
  const now = Date.now();
  const steward = await context.database.prepare(
    "SELECT 1 AS found FROM space_memberships WHERE space_id = ? AND user_id = ? AND role = 'steward' AND status = 'active'"
  ).bind(context.space.id, context.user.id).first<{ found: number }>();
  if (!steward) throw new HttpError(403, "Only a space steward can rename the family.", "forbidden");
  await context.database.batch([
    context.database.prepare("UPDATE family_spaces SET name = ? WHERE id = ?").bind(trimmed, context.space.id),
    audit(context.database, context.space.id, context.user.id, "family.renamed", "space", context.space.id, now),
  ]);
  return { id: context.space.id, name: trimmed };
}

function iso(timestamp: number) {
  return new Date(timestamp).toISOString();
}
