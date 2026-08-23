import { assertSafeMutation, cleanId, cleanText, getApiActor, HttpError, noStoreJson, requestedSpaceId, routeError } from "../../../../lib/api";
import { validateMedia } from "../../../../lib/media-validation";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = getApiActor(request);
    const { beginMedia, completeMedia, getManagedPersonContext } = await import("../../../../lib/family-store");
    assertSafeMutation(request, "multipart");
    const { id } = await context.params;
    const personId = cleanId(id);
    // Resolve authority before consuming multipart bytes.
    const managedContext = await getManagedPersonContext(actor, personId, requestedSpaceId(request));
    const form = await request.formData();
    const file = form.get("file");
    const requestedKind = form.get("kind");
    if (!(file instanceof File)) throw new HttpError(400, "Choose a file to upload.", "validation_failed");
    if (requestedKind !== "photo" && requestedKind !== "voice_note") {
      throw new HttpError(400, "Choose photo or voice note.", "validation_failed");
    }
    const validated = await validateMedia(file, requestedKind === "photo" ? "photo" : "voice");
    const caption = cleanText(form.get("caption"), "Caption", { max: 300, optional: true }) ?? "";
    const pending = await beginMedia(managedContext, {
      personId,
      kind: requestedKind,
      contentType: validated.contentType,
      byteSize: validated.size,
      caption,
      extension: validated.extension,
    });
    const media = await completeMedia(pending, validated.bytes);
    return noStoreJson({ media }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
