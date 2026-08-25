import { assertSafeMutation, cleanId, cleanText, noStoreJson, readJsonObject, requestedSpaceId, routeError } from "../../../../lib/api";
import { getApiActorFromRequest } from "../../../../lib/identity";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = getApiActorFromRequest(request);
    const { createStory } = await import("../../../../lib/family-store");
    assertSafeMutation(request, "json");
    const { id } = await context.params;
    const body = await readJsonObject(request);
    const text = cleanText(body.body, "Story", { max: 4000 });
    const story = await createStory(actor, cleanId(id), text!, requestedSpaceId(request));
    return noStoreJson({ story }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
