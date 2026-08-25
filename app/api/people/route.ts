import { assertSafeMutation, cleanDate, cleanText, noStoreJson, readJsonObject, requestedSpaceId, routeError } from "../../lib/api";
import { getApiActorFromRequest } from "../../lib/identity";

export async function POST(request: Request) {
  try {
    const actor = getApiActorFromRequest(request);
    const { createPerson } = await import("../../lib/family-store");
    assertSafeMutation(request, "json");
    const body = await readJsonObject(request);
    const displayName = cleanText(body.displayName, "Name", { max: 120 });
    const birthDate = cleanDate(body.birthDate);
    const person = await createPerson(actor, { displayName: displayName!, birthDate }, requestedSpaceId(request));
    return noStoreJson({ person }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
