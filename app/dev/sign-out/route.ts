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
  return methodNotAllowed();
}

export function HEAD(): Response {
  return methodNotAllowed();
}

export function OPTIONS(): Response {
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
  return methodNotAllowed();
}

export function PATCH(): Response {
  return methodNotAllowed();
}

export function DELETE(): Response {
  return methodNotAllowed();
}
