import { HttpError, type ApiActor } from "./api";

// Viewer is the provider-agnostic identity derived from what getContext() actually
// consumes (ApiActor), not from any single header adapter's shape.
export type Viewer = {
  subjectId: string;
  email: string;
  displayName: string | null;
};

export interface IdentityProvider {
  readonly name: string;
  resolveViewer(headers: Headers): Viewer | null;
  // Where unauthenticated visitors should be sent, or null when this
  // configuration offers no sign-in destination at all. Vendor-specific
  // URLs are known only to their own adapters.
  signInPath(returnTo: string): string | null;
}

const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";

// Set to "1" to allow the local development adapter. See
// assertLocalIdentityDevelopmentOnly for why this alone is not sufficient.
const LOCAL_IDENTITY_FLAG = "FAMILY_RECORD_ALLOW_LOCAL_IDENTITY";

function readEnv(name: string): string {
  if (typeof process === "undefined") return "";
  const value = process.env[name];
  return value === undefined || value === null ? "" : String(value);
}

// The local adapter trusts ordinary request headers that any visitor can
// forge, so selecting it is a total authentication bypass. It is therefore
// structurally confined to development: it refuses to initialise unless the
// runtime identifies as development/test AND an explicit opt-in flag is set,
// and it fails loudly (throws) rather than silently falling back. A deployed
// Worker has neither, and unknown NODE_ENV values are treated as hostile.
function assertLocalIdentityDevelopmentOnly(): void {
  const nodeEnv = readEnv("NODE_ENV").toLowerCase().trim();
  if (nodeEnv !== "development" && nodeEnv !== "test") {
    throw new Error(
      `identity: refusing to initialise the local identity provider outside development (NODE_ENV=${JSON.stringify(nodeEnv)}; expected "development" or "test")`,
    );
  }
  if (readEnv(LOCAL_IDENTITY_FLAG) !== "1") {
    throw new Error(
      `identity: refusing to initialise the local identity provider without ${LOCAL_IDENTITY_FLAG}=1`,
    );
  }
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

// Shared return_to sanitizer. Each adapter supplies the auth paths that must
// never be used as a return target (open-redirect/loop protection), so no
// adapter needs to know another adapter's routes.
function safeRelativeReturnTo(value: string, reservedPaths: readonly string[]): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (reservedPaths.includes(url.pathname)) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

function createHeaderIdentityProvider(): IdentityProvider {
  const SIGN_IN_PATH = "/signin-with-chatgpt";
  const SIGN_OUT_PATH = "/signout-with-chatgpt";
  const CALLBACK_PATH = "/callback";
  const reservedPaths = [SIGN_IN_PATH, SIGN_OUT_PATH, CALLBACK_PATH];

  return {
    name: "header",
    resolveViewer(headers: Headers): Viewer | null {
      const subjectId = headers.get("oai-authenticated-user-id")?.trim();
      const emailRaw = headers.get("oai-authenticated-user-email")?.trim();
      const email = emailRaw?.toLowerCase();
      if (!subjectId || !email) return null;

      const encodedName = headers.get("oai-authenticated-user-full-name");
      const encoding = headers.get("oai-authenticated-user-full-name-encoding");
      let displayName: string | null = null;
      if (encodedName && encoding === PERCENT_ENCODED_UTF8) {
        displayName = safeDecodeURIComponent(encodedName)?.trim() || null;
        if (displayName === "") displayName = null;
      }
      return { subjectId, email, displayName };
    },
    signInPath(returnTo: string): string | null {
      const safe = safeRelativeReturnTo(returnTo, reservedPaths);
      return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safe)}`;
    },
  };
}

function createLocalIdentityProvider(): IdentityProvider {
  // Refuse to initialise outside development, loudly. This runs both when the
  // adapter is constructed and again on every resolution, so holding a
  // reference to it cannot outlive the safety conditions.
  assertLocalIdentityDevelopmentOnly();
  const DEV_SIGN_IN_PATH = "/dev/sign-in";
  const DEV_SIGN_OUT_PATH = "/dev/sign-out";
  const reservedPaths = [DEV_SIGN_IN_PATH, DEV_SIGN_OUT_PATH];

  return {
    name: "local",
    resolveViewer(headers: Headers): Viewer | null {
      assertLocalIdentityDevelopmentOnly();
      const subjectId =
        headers.get("x-local-subject")?.trim() ||
        headers.get("x-local-subject-id")?.trim() ||
        headers.get("x-dev-user-id")?.trim() ||
        "";
      const emailRaw =
        headers.get("x-local-email")?.trim() ||
        headers.get("x-dev-user-email")?.trim() ||
        "";
      const email = emailRaw.toLowerCase();
      if (!subjectId || !email) return null;

      const rawDisplay =
        headers.get("x-local-display-name")?.trim() ||
        headers.get("x-local-name")?.trim() ||
        headers.get("x-dev-user-name")?.trim() ||
        "";
      const displayName = rawDisplay ? rawDisplay : null;
      return { subjectId, email, displayName };
    },
    signInPath(returnTo: string): string | null {
      assertLocalIdentityDevelopmentOnly();
      const safe = safeRelativeReturnTo(returnTo, reservedPaths);
      return `${DEV_SIGN_IN_PATH}?return_to=${encodeURIComponent(safe)}`;
    },
  };
}

// Deny provider — default. Refuses to trust any inbound identity headers and
// knows no sign-in URL of any kind: with no provider selected there is no
// place to send unauthenticated visitors, so callers handle null explicitly.
function createDenyIdentityProvider(): IdentityProvider {
  return {
    name: "deny",
    resolveViewer(): Viewer | null {
      return null;
    },
    signInPath(): string | null {
      return null;
    },
  };
}

// Single choke point. Adapters are intentionally not exported: every identity
// decision must go through the configured selection below.
export function getIdentityProvider(): IdentityProvider {
  const raw = (readEnv("IDENTITY_PROVIDER") || readEnv("AUTH_PROVIDER")).toLowerCase().trim();
  if (raw === "header" || raw === "oai" || raw === "chatgpt" || raw === "trusted-header" || raw === "trusted_header") {
    return createHeaderIdentityProvider();
  }
  if (raw === "local" || raw === "dev" || raw === "development" || raw === "local-dev" || raw === "local_dev") {
    return createLocalIdentityProvider();
  }
  return createDenyIdentityProvider();
}

export function viewerToApiActor(viewer: Viewer): ApiActor {
  return {
    authSubject: viewer.subjectId,
    email: viewer.email.toLowerCase(),
    displayName: viewer.displayName ?? viewer.email,
  };
}

// Provider-aware helpers used by API routes and RSC pages.
export function getViewer(request: Request): Viewer | null {
  return getIdentityProvider().resolveViewer(request.headers);
}

export function getApiActorFromRequest(request: Request): ApiActor {
  const viewer = getViewer(request);
  if (!viewer) throw new HttpError(401, "Sign in to continue.", "authentication_required");
  return viewerToApiActor(viewer);
}

export function getSignInPath(returnTo: string): string | null {
  return getIdentityProvider().signInPath(returnTo);
}

export async function getRscViewer(): Promise<Viewer | null> {
  const { headers } = await import("next/headers");
  const h = await headers();
  return getIdentityProvider().resolveViewer(h as unknown as Headers);
}

export async function requireRscViewer(returnTo: string): Promise<Viewer> {
  const viewer = await getRscViewer();
  if (viewer) return viewer;
  const destination = getIdentityProvider().signInPath(returnTo);
  if (destination === null) {
    // No configured provider means no sign-in destination exists anywhere;
    // fail closed rather than guessing some vendor's URL.
    throw new HttpError(401, "Sign in to continue.", "authentication_required");
  }
  const { redirect } = await import("next/navigation");
  redirect(destination);
  throw new Error("Redirected");
}
