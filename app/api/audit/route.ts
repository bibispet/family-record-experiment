import { noStoreJson, requestedSpaceId, routeError } from "../../lib/api";
import { getApiActorFromRequest } from "../../lib/identity";

export async function GET(request: Request) {
  try {
    const actor = getApiActorFromRequest(request);
    const { getAuditLog } = await import("../../lib/family-store");
    const events = await getAuditLog(actor, requestedSpaceId(request));
    return noStoreJson({ events });
  } catch (error) {
    return routeError(error);
  }
}
