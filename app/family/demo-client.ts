import type {
  FamilyDashboardData,
  FamilyMedia,
  FamilyPerson,
  FamilyRelationship,
  FamilyShare,
  FamilyStory,
} from "./family-dashboard-state";

function jsonBody(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== "string") return {};
  const value: unknown = JSON.parse(init.body);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function result<T>(value: unknown): T {
  return value as T;
}

/** Simulates mutations in browser memory. This function never calls fetch. */
export async function demoRequest<T>(path: string, init: RequestInit, data: FamilyDashboardData): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const now = new Date().toISOString();

  if (path === "/api/audit" && method === "GET") return result<T>({ events: [] });

  if (path === "/api/family" && method === "PATCH") {
    const body = jsonBody(init);
    return result<T>({ space: { id: data.familyId, name: String(body.name ?? data.familyName) } });
  }

  if (path === "/api/people" && method === "POST") {
    const body = jsonBody(init);
    const person: FamilyPerson = {
      id: crypto.randomUUID(),
      displayName: String(body.displayName ?? "Demo person"),
      birthDate: typeof body.birthDate === "string" && body.birthDate ? body.birthDate : null,
      birthDateAccuracy: typeof body.birthDate === "string" && body.birthDate ? "exact" : "unknown",
    };
    return result<T>({ person });
  }

  const storyCreate = path.match(/^\/api\/people\/([^/]+)\/stories$/);
  if (storyCreate && method === "POST") {
    const body = jsonBody(init);
    const story: FamilyStory = {
      id: crypto.randomUUID(),
      personId: storyCreate[1]!,
      body: String(body.body ?? ""),
      createdAt: now,
    };
    return result<T>({ story });
  }

  const mediaCreate = path.match(/^\/api\/people\/([^/]+)\/media$/);
  if (mediaCreate && method === "POST") {
    const fields = init.body instanceof FormData ? init.body : new FormData();
    const file = fields.get("file");
    const kind = fields.get("kind") === "voice_note" ? "voice_note" : "photo";
    const media: FamilyMedia = {
      id: crypto.randomUUID(),
      personId: mediaCreate[1]!,
      kind,
      fileName: file instanceof File ? file.name : `Demo ${kind === "photo" ? "photo" : "voice note"}`,
      caption: String(fields.get("caption") ?? ""),
      status: "ready",
      accessUrl: null,
      createdAt: now,
    };
    return result<T>({ media });
  }

  const personUpdate = path.match(/^\/api\/people\/([^/]+)$/);
  if (personUpdate && method === "PATCH") {
    const body = jsonBody(init);
    const current = data.people.find((person) => person.id === personUpdate[1]);
    const birthDate = typeof body.birthDate === "string" && body.birthDate ? body.birthDate : null;
    const person: FamilyPerson = {
      ...current,
      id: personUpdate[1]!,
      displayName: String(body.displayName ?? current?.displayName ?? "Demo person"),
      birthDate,
      birthDateAccuracy: birthDate ? "exact" : "unknown",
    };
    return result<T>({ person });
  }

  const storyMutation = path.match(/^\/api\/stories\/([^/]+)$/);
  if (storyMutation && method === "PATCH") {
    const body = jsonBody(init);
    const current = data.stories.find((story) => story.id === storyMutation[1]);
    return result<T>({ story: { ...current, id: storyMutation[1]!, body: String(body.body ?? "") } });
  }
  if (storyMutation && method === "DELETE") return result<T>({ id: storyMutation[1] });

  const mediaMutation = path.match(/^\/api\/media\/([^/]+)$/);
  if (mediaMutation && method === "PATCH") {
    const body = jsonBody(init);
    const current = data.media.find((item) => item.id === mediaMutation[1]);
    return result<T>({ media: { ...current, id: mediaMutation[1]!, caption: String(body.caption ?? "") } });
  }
  if (mediaMutation && method === "DELETE") return result<T>({ id: mediaMutation[1] });

  const relationshipUnlink = path.match(/^\/api\/relationships\/([^/]+)\/unlink$/);
  if (relationshipUnlink && method === "POST") {
    const current = data.relationships.find((relationship) => relationship.id === relationshipUnlink[1]);
    return result<T>({ relationship: { ...current, id: relationshipUnlink[1]!, endedAt: now } });
  }

  const relationshipUpdate = path.match(/^\/api\/relationships\/([^/]+)$/);
  if (relationshipUpdate && method === "PATCH") {
    const body = jsonBody(init);
    const current = data.relationships.find((relationship) => relationship.id === relationshipUpdate[1]);
    return result<T>({
      relationship: {
        ...current,
        id: relationshipUpdate[1]!,
        relationshipType: String(body.relationshipType ?? current?.relationshipType ?? "other"),
        evidenceMode: String(body.evidenceMode ?? current?.evidenceMode ?? "oral"),
      },
    });
  }

  if (path === "/api/relationships" && method === "POST") {
    const body = jsonBody(init);
    if (body.sourcePersonId === body.targetPersonId) throw new Error("Choose two different people.");
    const relationship: FamilyRelationship = {
      id: crypto.randomUUID(),
      sourcePersonId: String(body.sourcePersonId ?? ""),
      targetPersonId: String(body.targetPersonId ?? ""),
      relationshipType: String(body.relationshipType ?? "other"),
      evidenceMode: String(body.evidenceMode ?? "oral"),
      createdAt: now,
      endedAt: null,
    };
    return result<T>({ relationship });
  }

  const shareRevoke = path.match(/^\/api\/shares\/([^/]+)\/revoke$/);
  if (shareRevoke && method === "POST") {
    const current = data.shares.find((share) => share.id === shareRevoke[1]);
    return result<T>({ share: { ...current, id: shareRevoke[1]!, revokedAt: now } });
  }

  if (path === "/api/shares" && method === "POST") {
    const body = jsonBody(init);
    const share: FamilyShare = {
      id: crypto.randomUUID(),
      recipientEmail: String(body.recipientEmail ?? "demo-recipient@example.test"),
      permission: "view",
      revokedAt: null,
    };
    return result<T>({ share });
  }

  throw new Error(`This demo action is unavailable: ${method} ${path}`);
}
