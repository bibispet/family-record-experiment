import { assertSafeMutation, cleanId, noStoreJson, readJsonObject, requestedSpaceId, routeError } from "../../../lib/api";
import { getApiActorFromRequest } from "../../../lib/identity";

import type { RelationshipType, RelationshipEvidenceMode } from "../../../lib/domain";

const RELATIONSHIP_TYPES: readonly string[] = ["parent_of", "spouse_of", "sibling_of", "godparent_of", "close_family_friend_of", "other"];
const RELATIONSHIP_EVIDENCE_MODES: readonly string[] = ["verified", "oral"];

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = getApiActorFromRequest(request);
    const { updateRelationship } = await import("../../../lib/family-store");
    assertSafeMutation(request, "json");
    const { id } = await context.params;
    const body = await readJsonObject(request);
    const relationshipType: RelationshipType | undefined =
      typeof body.relationshipType === "string" && RELATIONSHIP_TYPES.includes(body.relationshipType)
        ? body.relationshipType as RelationshipType : undefined;
    const evidenceMode: RelationshipEvidenceMode | undefined =
      typeof body.evidenceMode === "string" && RELATIONSHIP_EVIDENCE_MODES.includes(body.evidenceMode)
        ? body.evidenceMode as RelationshipEvidenceMode : undefined;
    const relationship = await updateRelationship(actor, cleanId(id), { relationshipType, evidenceMode }, requestedSpaceId(request));
    return noStoreJson({ relationship });
  } catch (error) {
    return routeError(error);
  }
}
