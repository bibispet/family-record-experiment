import { assertSafeMutation, cleanId, cleanText, noStoreJson, readJsonObject, requestedSpaceId, routeError } from "../../../lib/api";
import { getApiActorFromRequest } from "../../../lib/identity";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = getApiActorFromRequest(request);
    const { updateStory } = await import("../../../lib/family-store");
    assertSafeMutation(request, "json");
    const { id } = await context.params;
    const body = await readJsonObject(request);
    const text = cleanText(body.body, "Story", { max: 4000 });
    const story = await updateStory(actor, cleanId(id), text!, requestedSpaceId(request));
    return noStoreJson({ story });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = getApiActorFromRequest(request);
    const { deleteStory } = await import("../../../lib/family-store");
    assertSafeMutation(request);
    const { id } = await context.params;
    const result = await deleteStory(actor, cleanId(id), requestedSpaceId(request));
    return noStoreJson({ deleted: result });
  } catch (error) {
    return routeError(error);
  }
}
