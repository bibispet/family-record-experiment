import { assertSafeMutation, cleanId, cleanText, getApiActor, HttpError, noStoreJson, readJsonObject, requestedSpaceId, routeError } from "../../lib/api";

export async function POST(request: Request) {
  try {
    const actor = getApiActor(request);
    const { createShare } = await import("../../lib/family-store");
    assertSafeMutation(request, "json");
    const body = await readJsonObject(request);
    const recipientEmail = cleanText(body.recipientEmail, "Recipient email", { max: 254 })!.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      throw new HttpError(400, "Enter a valid recipient email.", "validation_failed");
    }
    if (!Array.isArray(body.personIds) || body.personIds.length === 0 || body.personIds.length > 100) {
      throw new HttpError(400, "Choose between 1 and 100 people.", "validation_failed");
    }
    const personIds = body.personIds.map((value) => cleanId(value, "Selected person"));
    const share = await createShare(actor, { recipientEmail, personIds }, requestedSpaceId(request));
    return noStoreJson({ share }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
