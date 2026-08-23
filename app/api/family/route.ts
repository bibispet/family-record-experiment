import { getApiActor, noStoreJson, routeError } from "../../lib/api";

export async function GET(request: Request) {
  try {
    const actor = getApiActor(request);
    const { getFamilySnapshot } = await import("../../lib/family-store");
    const spaceId = new URL(request.url).searchParams.get("space") ?? undefined;
    return noStoreJson(await getFamilySnapshot(actor, spaceId));
  } catch (error) {
    return routeError(error);
  }
}
