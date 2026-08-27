import { assertSafeMutation, HttpError, noStoreJson, readJsonObject, requestedSpaceId, routeError } from "../../lib/api";
import { getApiActorFromRequest } from "../../lib/identity";

export async function GET(request: Request) {
  try {
    const actor = getApiActorFromRequest(request);
    const { getFamilySnapshot } = await import("../../lib/family-store");
    const spaceId = new URL(request.url).searchParams.get("space") ?? undefined;
    return noStoreJson(await getFamilySnapshot(actor, spaceId));
  } catch (error) {
    return routeError(error);
  }
}
export async function PATCH(request: Request) {
  try {
    const actor = getApiActorFromRequest(request);
    const { updateFamilyName } = await import("../../lib/family-store");
    assertSafeMutation(request, "json");
    const body = await readJsonObject(request);
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      throw new HttpError(400, "A non-empty family name is required.", "validation_error");
    }
    const space = await updateFamilyName(actor, body.name, requestedSpaceId(request));
    return noStoreJson({ space });
  } catch (error) {
    return routeError(error);
  }
}

