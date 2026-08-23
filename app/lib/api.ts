export type ApiActor = {
  authSubject: string;
  email: string;
  displayName: string;
};

const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "request_failed",
  ) {
    super(message);
  }
}

export function getApiActor(request: Request): ApiActor {
  const authSubject = request.headers.get(USER_ID_HEADER)?.trim();
  const email = request.headers.get(USER_EMAIL_HEADER)?.trim().toLowerCase();
  if (!authSubject || !email) {
    throw new HttpError(401, "Sign in to continue.", "authentication_required");
  }

  const encodedName = request.headers.get(USER_FULL_NAME_HEADER);
  const encoding = request.headers.get(USER_FULL_NAME_ENCODING_HEADER);
  let fullName: string | null = null;
  if (encodedName && encoding === "percent-encoded-utf-8") {
    try {
      fullName = decodeURIComponent(encodedName).trim() || null;
    } catch {
      fullName = null;
    }
  }

  return { authSubject, email, displayName: fullName ?? email };
}

export function assertSafeMutation(request: Request, expectedContentType?: "json" | "multipart") {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new HttpError(403, "This request did not come from this site.", "invalid_origin");
  }

  if (!expectedContentType) return;
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const valid = expectedContentType === "json"
    ? contentType.startsWith("application/json")
    : contentType.startsWith("multipart/form-data");
  if (!valid) {
    throw new HttpError(415, `Expected ${expectedContentType === "json" ? "JSON" : "a file upload"}.`, "unsupported_media_type");
  }
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "The request body is not valid JSON.", "invalid_json");
  }
}

export function cleanText(value: unknown, field: string, options: { min?: number; max: number; optional?: boolean }): string | null {
  if ((value === undefined || value === null || value === "") && options.optional) return null;
  if (typeof value !== "string") throw new HttpError(400, `${field} must be text.`, "validation_failed");
  const clean = value.trim();
  const min = options.min ?? 1;
  if (clean.length < min || clean.length > options.max) {
    throw new HttpError(400, `${field} must be between ${min} and ${options.max} characters.`, "validation_failed");
  }
  return clean;
}

export function cleanId(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new HttpError(400, `${field} is invalid.`, "validation_failed");
  }
  return value;
}

export function requestedSpaceId(request: Request): string | undefined {
  const value = request.headers.get("x-family-space-id");
  return value ? cleanId(value, "Family space") : undefined;
}

export function cleanDate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, "Date of birth must use YYYY-MM-DD.", "validation_failed");
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new HttpError(400, "Date of birth is not a real calendar date.", "validation_failed");
  }
  if (year < 1850 || parsed.getTime() > Date.now()) {
    throw new HttpError(400, "Date of birth is outside the supported range.", "validation_failed");
  }
  return value;
}

export function noStoreJson(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { ...init, headers });
}

export function routeError(error: unknown): Response {
  if (error instanceof HttpError) {
    return noStoreJson({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error("Family record request failed without sensitive payload data.");
  return noStoreJson({ error: "Something went wrong. Please try again.", code: "internal_error" }, { status: 500 });
}
