import { assertSafeMutation, cleanId, getApiActor, HttpError, noStoreJson, readJsonObject, requestedSpaceId, routeError } from "../../lib/api";
import { RELATIONSHIP_EVIDENCE_MODES, RELATIONSHIP_TYPES, type RelationshipEvidenceMode, type RelationshipType } from "../../lib/domain";

export async function POST(request: Request) {
  try {
    const actor = getApiActor(request);
    const { createRelationship } = await import("../../lib/family-store");
    assertSafeMutation(request, "json");
    const body = await readJsonObject(request);
    const relationshipType = body.relationshipType;
    const evidenceMode = body.evidenceMode;
    if (typeof relationshipType !== "string" || !(RELATIONSHIP_TYPES as readonly string[]).includes(relationshipType)) {
      throw new HttpError(400, "Choose a valid relationship type.", "validation_failed");
    }
    if (typeof evidenceMode !== "string" || !(RELATIONSHIP_EVIDENCE_MODES as readonly string[]).includes(evidenceMode)) {
      throw new HttpError(400, "Choose documented or oral family knowledge.", "validation_failed");
    }
    const sourcePersonId = cleanId(body.sourcePersonId, "First person");
    const targetPersonId = cleanId(body.targetPersonId, "Second person");
    if (sourcePersonId === targetPersonId) {
      throw new HttpError(400, "Choose two different people.", "validation_failed");
    }
    const relationship = await createRelationship(actor, {
      sourcePersonId,
      targetPersonId,
      relationshipType: relationshipType as RelationshipType,
      evidenceMode: evidenceMode as RelationshipEvidenceMode,
    }, requestedSpaceId(request));
    return noStoreJson({ relationship }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
