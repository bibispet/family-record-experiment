// Build-time guard: import.meta.env.DEV is replaced with false in production
// builds, making every dev-only branch dead code that the minifier removes.
// The route handlers still exist (the router discovers them by file path) but
// they return 404 — the cookie-clearing logic and identity imports are
// eliminated from the production bundle entirely.
//
// Optional chaining + fallback so tsx (where import.meta.env is undefined)
// doesn't crash; Vite replaces import.meta.env with a JSON object so the
// expression evaluates to false in production and true in dev.
const isDev = import.meta.env?.DEV ?? true;
import { assertSafeMutation, routeError } from "../../lib/api";
import {
  assertLocalIdentityDevelopmentOnly,
  safeLocalIdentityReturnTo,
  serializeClearedLocalIdentityCookie,
} from "../../lib/identity";

function methodNotAllowed(): Response {
  assertLocalIdentityDevelopmentOnly();
  return new Response("Use the sign-out button on /dev/sign-in.", {
    status: 405,
    headers: {
      Allow: "POST",
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export function GET(): Response {
  if (!isDev) return new Response("Not Found", { status: 404 });
  return methodNotAllowed();
}

export function HEAD(): Response {
  if (!isDev) return new Response(null, { status: 404 });
  return methodNotAllowed();
}

export function OPTIONS(): Response {
  if (!isDev) return new Response(null, { status: 404 });
  assertLocalIdentityDevelopmentOnly();
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "OPTIONS, POST",
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!isDev) return new Response("Not Found", { status: 404 });
  assertLocalIdentityDevelopmentOnly();
  try {
    assertSafeMutation(request);
  } catch (error) {
    return routeError(error);
  }

  let requestedReturnTo = "/";
  try {
    const form = await request.formData();
    const value = form.get("return_to");
    if (typeof value === "string" && value.trim()) requestedReturnTo = value.trim();
  } catch {
    // A body is optional for sign-out; the safe default remains the home page.
  }

  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "private, no-store",
      Location: safeLocalIdentityReturnTo(requestedReturnTo),
      "Set-Cookie": serializeClearedLocalIdentityCookie(),
    },
  });
}

export function PUT(): Response {
  if (!isDev) return new Response("Not Found", { status: 404 });
  return methodNotAllowed();
}

export function PATCH(): Response {
  if (!isDev) return new Response("Not Found", { status: 404 });
  return methodNotAllowed();
}

export function DELETE(): Response {
  if (!isDev) return new Response("Not Found", { status: 404 });
  return methodNotAllowed();
}
