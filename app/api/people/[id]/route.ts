import { assertSafeMutation, cleanId, cleanText, getApiActor, noStoreJson, readJsonObject, requestedSpaceId, routeError } from "../../../lib/api";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = getApiActor(request);
    const { updatePerson } = await import("../../../lib/family-store");
    assertSafeMutation(request, "json");
    const { id } = await context.params;
    const body = await readJsonObject(request);
    const displayName = cleanText(body.displayName, "Name", { max: 120 });
    const person = await updatePerson(actor, cleanId(id), displayName!, requestedSpaceId(request));
    return noStoreJson({ person });
  } catch (error) {
    return routeError(error);
  }
}
