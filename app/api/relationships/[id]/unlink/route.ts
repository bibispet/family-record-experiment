import { assertSafeMutation, cleanId, noStoreJson, requestedSpaceId, routeError } from "../../../../lib/api";
import { getApiActorFromRequest } from "../../../../lib/identity";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = getApiActorFromRequest(request);
    const { unlinkRelationship } = await import("../../../../lib/family-store");
    assertSafeMutation(request);
    const { id } = await context.params;
    const relationship = await unlinkRelationship(actor, cleanId(id), requestedSpaceId(request));
    return noStoreJson({ relationship });
  } catch (error) {
    return routeError(error);
  }
}
