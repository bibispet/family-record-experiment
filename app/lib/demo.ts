import { EXAMPLE_SEED_PLAN, seedIdentity, seedProvenance } from "../../db/seed";
import type { FamilyDashboardData, FamilyViewer } from "../family/family-dashboard-state";

const DEMO_TIMESTAMP = "2026-08-27T00:00:00.000Z";

/**
 * The hosted prototype is deliberately a compiled seed-only demo. It never
 * opens D1 while rendering and exposes no capture or mutation controls.
 */
export function getDemoSnapshot(): { viewer: FamilyViewer; data: FamilyDashboardData } {
  const identity = seedIdentity(EXAMPLE_SEED_PLAN);
  const provenance = seedProvenance(EXAMPLE_SEED_PLAN, identity);
  const personIds = new Map(
    EXAMPLE_SEED_PLAN.people.map((person, index) => [person.displayName, provenance.rowIds.people[index]!] as const),
  );

  const people = EXAMPLE_SEED_PLAN.people.map((person, index) => ({
    id: provenance.rowIds.people[index]!,
    displayName: person.displayName,
    birthDate: person.birthDate,
    birthDateAccuracy: person.birthDateAccuracy,
  }));

  return {
    viewer: {
      id: identity.stewardUserId,
      displayName: "Demo visitor",
      email: EXAMPLE_SEED_PLAN.stewardEmail,
    },
    data: {
      familyId: identity.spaceId,
      familyName: EXAMPLE_SEED_PLAN.spaceName,
      spaces: [{ id: identity.spaceId, name: EXAMPLE_SEED_PLAN.spaceName }],
      access: { canCreatePeople: true, managedPersonIds: provenance.rowIds.people.slice() },
      people,
      relationships: EXAMPLE_SEED_PLAN.relationships.map((relationship, index) => ({
        id: provenance.rowIds.relationships[index]!,
        sourcePersonId: personIds.get(relationship.source)!,
        targetPersonId: personIds.get(relationship.target)!,
        relationshipType: relationship.relationshipType,
        evidenceMode: relationship.evidenceMode,
        createdAt: DEMO_TIMESTAMP,
        endedAt: relationship.endedAt === null ? null : new Date(relationship.endedAt).toISOString(),
      })),
      stories: EXAMPLE_SEED_PLAN.stories.map((story, index) => ({
        id: provenance.rowIds.stories[index]!,
        personId: personIds.get(story.person)!,
        body: story.body,
        createdAt: DEMO_TIMESTAMP,
      })),
      media: EXAMPLE_SEED_PLAN.media.map((item, index) => ({
        id: provenance.rowIds.media_assets[index]!,
        personId: personIds.get(item.person)!,
        kind: item.kind,
        fileName: item.kind === "photo" ? "Fictional photo placeholder" : "Fictional voice-note placeholder",
        caption: item.caption,
        status: "ready",
        accessUrl: null,
        createdAt: DEMO_TIMESTAMP,
      })),
      shares: [],
    },
  };
}
