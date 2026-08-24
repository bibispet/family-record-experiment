import { noStoreJson, routeError } from "../../lib/api";
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
