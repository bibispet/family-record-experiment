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
  signInPath(returnTo: string): string;
}

const SIGN_IN_PATH = "/signin-with-chatgpt";
const SIGN_OUT_PATH = "/signout-with-chatgpt";
const CALLBACK_PATH = "/callback";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return pathname === SIGN_IN_PATH || pathname === SIGN_OUT_PATH || pathname === CALLBACK_PATH;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

// Header adapter — reimplements the existing OpenAI Sites header reader.
// Behaviour is unchanged when this adapter is selected.
export const headerIdentityProvider: IdentityProvider = {
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
  signInPath(returnTo: string): string {
    const safe = safeRelativeReturnPath(returnTo);
    return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safe)}`;
  },
};

// Local development provider — no external dependency, no network calls.
// Reads from x-local-* headers, which are distinct from the trusted oai-*
// headers so that selecting this provider proves the boundary is real.
export const localIdentityProvider: IdentityProvider = {
  name: "local",
  resolveViewer(headers: Headers): Viewer | null {
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
  signInPath(returnTo: string): string {
    const safe = safeRelativeReturnPath(returnTo);
    return `/dev/sign-in?return_to=${encodeURIComponent(safe)}`;
  },
};

// Deny provider — default. Refuses to trust any inbound identity headers.
// This is the secure default: without explicit opt-in, no header is trusted.
export const denyIdentityProvider: IdentityProvider = {
  name: "deny",
  resolveViewer(): Viewer | null {
    return null;
  },
  signInPath(returnTo: string): string {
    const safe = safeRelativeReturnPath(returnTo);
    return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safe)}`;
  },
};

export function getIdentityProvider(): IdentityProvider {
  const raw = (
    (typeof process !== "undefined" ? (process.env.IDENTITY_PROVIDER || process.env.AUTH_PROVIDER) : "") || ""
  )
    .toString()
    .toLowerCase()
    .trim();
  if (raw === "header" || raw === "oai" || raw === "chatgpt" || raw === "trusted-header" || raw === "trusted_header") {
    return headerIdentityProvider;
  }
  if (raw === "local" || raw === "dev" || raw === "development" || raw === "local-dev" || raw === "local_dev") {
    return localIdentityProvider;
  }
  return denyIdentityProvider;
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

export function getSignInPath(returnTo: string): string {
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
  const { redirect } = await import("next/navigation");
  redirect(getIdentityProvider().signInPath(returnTo));
  throw new Error("Redirected");
}
