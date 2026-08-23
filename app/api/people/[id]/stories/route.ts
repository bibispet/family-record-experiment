import { assertSafeMutation, cleanId, cleanText, getApiActor, noStoreJson, readJsonObject, requestedSpaceId, routeError } from "../../../../lib/api";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = getApiActor(request);
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
