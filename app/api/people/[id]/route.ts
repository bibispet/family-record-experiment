import { assertSafeMutation, cleanId, cleanText, noStoreJson, readJsonObject, requestedSpaceId, routeError } from "../../../lib/api";
import { getApiActorFromRequest } from "../../../lib/identity";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = getApiActorFromRequest(request);
    const { updatePerson } = await import("../../../lib/family-store");
    assertSafeMutation(request, "json");
    const { id } = await context.params;
    const body = await readJsonObject(request);
    const displayName = cleanText(body.displayName, "Name", { max: 120 });
    const birthDate = body.birthDate === undefined ? undefined : body.birthDate === null ? null : cleanText(body.birthDate, "Birth date", { max: 40 }) || null;
    const person = await updatePerson(actor, cleanId(id), { displayName: displayName!, birthDate }, requestedSpaceId(request));
    return noStoreJson({ person });
  } catch (error) {
    return routeError(error);
  }
}
