import { assertSafeMutation, cleanId, getApiActor, noStoreJson, requestedSpaceId, routeError } from "../../../../lib/api";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = getApiActor(request);
    const { revokeShare } = await import("../../../../lib/family-store");
    assertSafeMutation(request);
    const { id } = await context.params;
    const share = await revokeShare(actor, cleanId(id), requestedSpaceId(request));
    return noStoreJson({ share });
  } catch (error) {
    return routeError(error);
  }
}
