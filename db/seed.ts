import type {
  BirthDateAccuracy,
  MediaKind,
  RelationshipEvidenceMode,
  RelationshipType,
} from "../app/lib/domain";

// D1Database and D1PreparedStatement are ambient from @cloudflare/workers-types.

export type SeedPerson = {
  displayName: string;
  birthDate: string | null;
  birthDateAccuracy: BirthDateAccuracy;
};

export type SeedRelationship = {
  source: string;
  target: string;
  relationshipType: RelationshipType;
  evidenceMode: RelationshipEvidenceMode;
  /** Unix ms when this bond ended, or null if it is still active. */
  endedAt: number | null;
};

export type SeedStory = {
  person: string;
  body: string;
};

export type SeedMedia = {
  person: string;
  kind: MediaKind;
  caption: string;
  byteSize: number;
};

export type SeedPlan = {
  description?: string;
  spaceName: string;
  stewardEmail: string;
  stewardSubject: string;
  people: SeedPerson[];
  relationships: SeedRelationship[];
  stories: SeedStory[];
  media: SeedMedia[];
};

const DAY_MS = 86_400_000;

function yearsAgo(years: number): string {
  return new Date(Date.now() - years * 365 * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Example family that exercises the "families are not trees" invariants:
 * remarriage (a bond that ended), adoption/oral bonds, unknown parentage, and
 * a one-appearance person. All values are synthetic. Never replace these with
 * real identities.
 */
export const EXAMPLE_SEED_PLAN: SeedPlan = {
  description:
    "A three-generation family with remarriage, an oral/adopted parent bond, unknown parentage, and a one-appearance person.",
  spaceName: "Adeyemi Family Archive",
  stewardEmail: "seed-steward@example.test",
  stewardSubject: "seed-steward-subject",
  people: [
    // Generation one
    { displayName: "Amara Adeyemi", birthDate: yearsAgo(54), birthDateAccuracy: "exact" },
    { displayName: "Kofi Adeyemi", birthDate: yearsAgo(57), birthDateAccuracy: "exact" },
    { displayName: "Marcus Bell", birthDate: yearsAgo(61), birthDateAccuracy: "approximate" },
    // Generation two
    { displayName: "Zainab Adeyemi", birthDate: yearsAgo(28), birthDateAccuracy: "exact" },
    { displayName: "Theo Adeyemi", birthDate: yearsAgo(26), birthDateAccuracy: "exact" },
    { displayName: "Lena Owusu", birthDate: yearsAgo(24), birthDateAccuracy: "exact" },
    // Generation three
    { displayName: "Imani Adeyemi", birthDate: yearsAgo(4), birthDateAccuracy: "exact" },
    // Unknown parentage: present with no parent_of bond at all.
    { displayName: "Priya Patel", birthDate: null, birthDateAccuracy: "unknown" },
    // One-appearance person: bound by a single bond, never revisited.
    { displayName: "Sanaa Okafor", birthDate: yearsAgo(33), birthDateAccuracy: "approximate" },
  ],
  relationships: [
    // Remarriage is two spouse_of rows to the same person; the first is ended.
    { source: "Amara Adeyemi", target: "Marcus Bell", relationshipType: "spouse_of", evidenceMode: "verified", endedAt: 20 * 365 * DAY_MS },
    // Current spouse.
    { source: "Amara Adeyemi", target: "Kofi Adeyemi", relationshipType: "spouse_of", evidenceMode: "verified", endedAt: null },
    // Parent bonds: Zainab and Theo are Amara's children; Kofi is their
    // adoptive parent (oral evidence only).
    { source: "Amara Adeyemi", target: "Zainab Adeyemi", relationshipType: "parent_of", evidenceMode: "verified", endedAt: null },
    { source: "Amara Adeyemi", target: "Theo Adeyemi", relationshipType: "parent_of", evidenceMode: "verified", endedAt: null },
    { source: "Kofi Adeyemi", target: "Zainab Adeyemi", relationshipType: "parent_of", evidenceMode: "oral", endedAt: null },
    { source: "Kofi Adeyemi", target: "Theo Adeyemi", relationshipType: "parent_of", evidenceMode: "oral", endedAt: null },
    // Sibling bonds between the same people (symmetric by design).
    { source: "Zainab Adeyemi", target: "Theo Adeyemi", relationshipType: "sibling_of", evidenceMode: "verified", endedAt: null },
    // Adoption outside the direct line: Lena was raised by Zainab, recorded
    // with oral evidence — the schema deliberately has no "adopted" type.
    { source: "Zainab Adeyemi", target: "Lena Owusu", relationshipType: "parent_of", evidenceMode: "oral", endedAt: null },
    // Unknown parentage is an explicit absence: no parent_of row at all.
    { source: "Priya Patel", target: "Amara Adeyemi", relationshipType: "close_family_friend_of", evidenceMode: "oral", endedAt: null },
    // One-appearance person: a single bond and nothing else in the archive.
    { source: "Sanaa Okafor", target: "Amara Adeyemi", relationshipType: "close_family_friend_of", evidenceMode: "verified", endedAt: null },
    // Grandchild through the parent_of chain — not an invented type.
    { source: "Zainab Adeyemi", target: "Imani Adeyemi", relationshipType: "parent_of", evidenceMode: "verified", endedAt: null },
  ],
  stories: [
    { person: "Amara Adeyemi", body: "The bakery opened on Market Street in the spring; Marc and I served the first burnt loaf with pride." },
    { person: "Theo Adeyemi", body: "Kofi taught me to change a bicycle tire in the yard behind the old house. I kept the patch kit for years." },
    { person: "Zainab Adeyemi", body: "Imani said her first full sentence at the kitchen table: 'More rice, please.' We were all there." },
    { person: "Amara Adeyemi", body: "Sanaa stayed one golden autumn, taught Priya to make her mother's pepper soup, and then left before the first frost." },
  ],
  media: [
    { person: "Zainab Adeyemi", kind: "photo", caption: "Imani at the bakery counter", byteSize: 240_000 },
    { person: "Theo Adeyemi", kind: "voice_note", caption: "Theo telling the tire story", byteSize: 160_000 },
    { person: "Amara Adeyemi", kind: "photo", caption: "The first loaf on Market Street", byteSize: 310_000 },
  ],
};

/** Static checks that a plan's relationships/stories/media reference known people. */
export function validateSeedPlan(plan: SeedPlan): void {
  const names = new Set(plan.people.map((person) => person.displayName));
  for (const relationship of plan.relationships) {
    if (!names.has(relationship.source)) {
      throw new Error(`seed: relationship references unknown source "${relationship.source}"`);
    }
    if (!names.has(relationship.target)) {
      throw new Error(`seed: relationship references unknown target "${relationship.target}"`);
    }
    if (relationship.source === relationship.target) {
      throw new Error(`seed: self-relationship on "${relationship.source}"`);
    }
  }
  for (const story of plan.stories) {
    if (!names.has(story.person)) {
      throw new Error(`seed: story references unknown person "${story.person}"`);
    }
  }
  for (const item of plan.media) {
    if (!names.has(item.person)) {
      throw new Error(`seed: media references unknown person "${item.person}"`);
    }
  }
}

export type SeedResult = {
  people: number;
  relationships: number;
  stories: number;
  media: number;
};

/**
 * Inserts a seed plan into a D1 database. Random UUIDs mean re-seeding inserts
 * another copy; the caller is responsible for choosing an empty target or
 * deleting the seed rows first. Composite keys (space_id, id) scope every
 * insert to the given space and steward user.
 */
export async function seedFamily(
  database: D1Database,
  spaceId: string,
  stewardUserId: string,
  plan: SeedPlan,
): Promise<SeedResult> {
  validateSeedPlan(plan);
  const now = Date.now();
  const personIds = new Map<string, string>();
  const statements: D1PreparedStatement[] = [];

  statements.push(
    database
      .prepare("INSERT INTO users (id, auth_subject, email_display, created_at) VALUES (?, ?, ?, ?)")
      .bind(stewardUserId, plan.stewardSubject, plan.stewardEmail, now),
    database
      .prepare("INSERT INTO family_spaces (id, name, created_by_user_id, created_at) VALUES (?, ?, ?, ?)")
      .bind(spaceId, plan.spaceName, stewardUserId, now),
    database
      .prepare("INSERT INTO space_memberships (space_id, user_id, role, status, joined_at) VALUES (?, ?, 'steward', 'active', ?)")
      .bind(spaceId, stewardUserId, now),
  );

  for (const person of plan.people) {
    const id = crypto.randomUUID();
    personIds.set(person.displayName, id);
    statements.push(
      database
        .prepare(
          "INSERT INTO people (id, space_id, display_name, birth_date, birth_date_accuracy, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id, spaceId, person.displayName, person.birthDate, person.birthDateAccuracy, stewardUserId, now, now),
      database
        .prepare(
          "INSERT INTO person_authorities (id, space_id, person_id, user_id, role, starts_at, ends_at, granted_by_user_id, created_at) VALUES (?, ?, ?, ?, 'record_manager', ?, NULL, ?, ?)",
        )
        .bind(crypto.randomUUID(), spaceId, id, stewardUserId, now, stewardUserId, now),
    );
  }

  for (const relationship of plan.relationships) {
    const sourceId = personIds.get(relationship.source);
    const targetId = personIds.get(relationship.target);
    if (!sourceId || !targetId) {
      throw new Error(`seed: missing person for relationship ${relationship.source} \u2192 ${relationship.target}`);
    }
    statements.push(
      database
        .prepare(
          "INSERT INTO relationships (id, space_id, source_person_id, target_person_id, relationship_type, evidence_mode, created_by_user_id, created_at, ended_at, ended_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          crypto.randomUUID(),
          spaceId,
          sourceId,
          targetId,
          relationship.relationshipType,
          relationship.evidenceMode,
          stewardUserId,
          now,
          relationship.endedAt,
          relationship.endedAt === null ? null : stewardUserId,
        ),
    );
  }

  for (const story of plan.stories) {
    const personId = personIds.get(story.person);
    if (!personId) throw new Error(`seed: missing person for story "${story.person}"`);
    statements.push(
      database
        .prepare(
          "INSERT INTO stories (id, space_id, person_id, body, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(crypto.randomUUID(), spaceId, personId, story.body, stewardUserId, now, now),
    );
  }

  for (const item of plan.media) {
    const personId = personIds.get(item.person);
    if (!personId) throw new Error(`seed: missing person for media "${item.person}"`);
    statements.push(
      database
        .prepare(
          "INSERT INTO media_assets (id, space_id, person_id, r2_key, kind, canonical_mime, byte_size, caption, status, created_by_user_id, created_at, ready_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)",
        )
        .bind(
          crypto.randomUUID(),
          spaceId,
          personId,
          `seed/${crypto.randomUUID()}`,
          item.kind,
          item.kind === "photo" ? "image/png" : "audio/mpeg",
          item.byteSize,
          item.caption,
          stewardUserId,
          now,
          now,
        ),
    );
  }

  await database.batch(statements);
  return {
    people: plan.people.length,
    relationships: plan.relationships.length,
    stories: plan.stories.length,
    media: plan.media.length,
  };
}