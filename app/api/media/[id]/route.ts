import { cleanId, getApiActor, routeError } from "../../../lib/api";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = getApiActor(request);
    const { getReadableMedia } = await import("../../../lib/family-store");
    const { id } = await context.params;
    const spaceId = new URL(request.url).searchParams.get("space") ?? undefined;
    const media = await getReadableMedia(actor, cleanId(id), spaceId ? cleanId(spaceId, "Family space") : undefined);
    const object = await media.context.media.get(media.row.r2_key);
    if (!object) return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    const extension = media.row.kind === "photo" ? media.row.canonical_mime.split("/")[1] : "audio";
    return new Response(object.body, {
      headers: {
        "Content-Type": media.row.canonical_mime,
        "Content-Disposition": `inline; filename="family-memory.${extension.replace(/[^a-z0-9]/gi, "")}"`,
        "Content-Length": String(object.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
