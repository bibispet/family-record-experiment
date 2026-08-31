// Build-time guard: import.meta.env.DEV is replaced with false in production
// builds, making every dev-only branch dead code that the minifier removes.
// The route handlers still exist (the router discovers them by file path) but
// they return 404 — the cookie-clearing logic and identity imports are
// eliminated from the production bundle entirely.
//
// Deny-by-default: when import.meta.env is not substituted (tsx, direct
// imports, SSR paths, a different bundler), the expression evaluates to
// false. Vite replaces import.meta.env with a JSON object so DEV is false
// in production and true in dev. The process.env fallback lets tests opt
// in explicitly using the same flag that gates the local identity adapter
// (FAMILY_RECORD_ALLOW_LOCAL_IDENTITY) — one flag per boundary. In
// production, import.meta.env.DEV is false (not nullish) so ?? short-circuits
// and the fallback is dead code.
const isDev = import.meta.env?.DEV ?? (process.env?.FAMILY_RECORD_ALLOW_LOCAL_IDENTITY === "1");
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
