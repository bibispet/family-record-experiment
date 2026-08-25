import { HttpError, ServerConfigurationError, type ApiActor } from "./api";

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

const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const LOCAL_PROVIDER_CONFIGURATION_ERROR =
  "The local identity provider is available only from the Vite development server and cannot initialise in a production build.";

function safeRelativeReturnPath(value: string, reservedPaths: ReadonlySet<string>): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local" || reservedPaths.has(url.pathname)) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function createHeaderIdentityProvider(): IdentityProvider {
  const signInPath = "/signin-with-chatgpt";
  const reservedPaths = new Set([signInPath, "/signout-with-chatgpt", "/callback"]);

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
      }
      return { subjectId, email, displayName };
    },
    signInPath(returnTo: string): string {
      const safe = safeRelativeReturnPath(returnTo, reservedPaths);
      return `${signInPath}?return_to=${encodeURIComponent(safe)}`;
    },
  };
}

function assertLocalIdentityDevelopmentServer(): void {
  if (globalThis.__LOCAL_IDENTITY_DEV_SERVER__ !== true) {
    throw new ServerConfigurationError(LOCAL_PROVIDER_CONFIGURATION_ERROR);
  }
}

function createLocalIdentityProvider(): IdentityProvider {
  assertLocalIdentityDevelopmentServer();
  const signInPath = "/dev/sign-in";
  const reservedPaths = new Set([signInPath]);

  return {
    name: "local",
    resolveViewer(headers: Headers): Viewer | null {
      assertLocalIdentityDevelopmentServer();
      const subjectId = headers.get("x-local-subject-id")?.trim();
      const emailRaw = headers.get("x-local-email")?.trim();
      const email = emailRaw?.toLowerCase();
      if (!subjectId || !email) return null;

      const displayName = headers.get("x-local-display-name")?.trim() || null;
      return { subjectId, email, displayName };
    },
    signInPath(returnTo: string): string {
      assertLocalIdentityDevelopmentServer();
      const safe = safeRelativeReturnPath(returnTo, reservedPaths);
      return `${signInPath}?return_to=${encodeURIComponent(safe)}`;
    },
  };
}

const headerIdentityProvider = createHeaderIdentityProvider();

const denyIdentityProvider: IdentityProvider = {
  name: "deny",
  resolveViewer(): Viewer | null {
    return null;
  },
  signInPath(): string {
    return "/";
  },
};

function configuredProviderName(): string {
  return (
    (typeof process !== "undefined" ? (process.env.IDENTITY_PROVIDER || process.env.AUTH_PROVIDER) : "") || ""
  )
    .toString()
    .toLowerCase()
    .trim();
}

export function getIdentityProvider(): IdentityProvider {
  const configured = configuredProviderName();
  if (
    configured === "header" ||
    configured === "oai" ||
    configured === "chatgpt" ||
    configured === "trusted-header" ||
    configured === "trusted_header"
  ) {
    return headerIdentityProvider;
  }
  if (
    configured === "local" ||
    configured === "dev" ||
    configured === "development" ||
    configured === "local-dev" ||
    configured === "local_dev"
  ) {
    return createLocalIdentityProvider();
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
  const requestHeaders = await headers();
  return getIdentityProvider().resolveViewer(requestHeaders as unknown as Headers);
}

export async function requireRscViewer(returnTo: string): Promise<Viewer> {
  const viewer = await getRscViewer();
  if (viewer) return viewer;
  const { redirect } = await import("next/navigation");
  redirect(getIdentityProvider().signInPath(returnTo));
  throw new Error("Redirected");
}
