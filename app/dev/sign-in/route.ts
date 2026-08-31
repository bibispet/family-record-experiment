// Build-time guard: import.meta.env.DEV is replaced with false in production
// builds, making every dev-only branch dead code that the minifier removes.
// The route handlers still exist (the router discovers them by file path) but
// they return 404 — the sign-in form HTML, cookie logic, and identity imports
// are eliminated from the production bundle entirely.
//
// Deny-by-default: when import.meta.env is not substituted (tsx, direct
// imports, SSR paths, a different bundler), the expression evaluates to
// false. Vite replaces import.meta.env with a JSON object so DEV is false
// in production and true in dev. The process.env fallback lets tests opt
// in explicitly using the same flag that gates the local identity adapter
// (FAMILY_RECORD_ALLOW_LOCAL_IDENTITY) — one flag per boundary, not a
// generic DEV_MODE that an unrelated environment could trip. In production,
// import.meta.env.DEV is false (not nullish) so ?? short-circuits and the
// fallback is dead code.
const isDev = import.meta.env?.DEV ?? (process.env?.FAMILY_RECORD_ALLOW_LOCAL_IDENTITY === "1");
import { assertSafeMutation, routeError } from "../../lib/api";
import {
  assertLocalIdentityDevelopmentOnly,
  safeLocalIdentityReturnTo,
  serializeLocalIdentityCookie,
} from "../../lib/identity";

type SignInValues = {
  subjectId: string;
  email: string;
  displayName: string;
  returnTo: string;
};

const EMPTY_VALUES: SignInValues = {
  subjectId: "",
  email: "",
  displayName: "",
  returnTo: "/family",
};

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function guardedMethodNotAllowed(): Response {
  assertLocalIdentityDevelopmentOnly();
  return new Response("Method not allowed.", {
    status: 405,
    headers: {
      Allow: "GET, HEAD, OPTIONS, POST",
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function renderSignIn(values: SignInValues, error: string | null = null): string {
  const errorMarkup = error
    ? `<p role="alert" class="error">${escapeHtml(error)}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Development sign in · Family Record Experiment</title>
    <style>
      :root { color-scheme: light; font-family: system-ui, sans-serif; background: #f7f3ea; color: #20322c; }
      body { margin: 0; padding: 32px 20px; }
      main { width: min(100%, 520px); margin: 8vh auto 0; padding: 28px; border: 1px solid #ded8cc; border-radius: 18px; background: #fffdf8; box-shadow: 0 20px 50px rgb(32 50 44 / 10%); }
      h1 { margin: 0 0 10px; font: 500 2rem Georgia, serif; }
      p { line-height: 1.55; }
      .notice { color: #66736d; }
      form { display: grid; gap: 14px; margin-top: 24px; }
      label { display: grid; gap: 6px; font-weight: 650; }
      input { min-height: 44px; padding: 0 12px; border: 1px solid #aaa99f; border-radius: 9px; font: inherit; }
      button { min-height: 46px; padding: 0 20px; border: 0; border-radius: 999px; background: #234f43; color: white; font: 650 1rem system-ui, sans-serif; cursor: pointer; }
      .error { padding: 11px 13px; border-radius: 9px; background: #f8dfda; color: #7f2929; }
      .sign-out { margin-top: 26px; padding-top: 20px; border-top: 1px solid #ded8cc; }
      .sign-out form { margin-top: 0; }
      .sign-out button { background: transparent; color: #234f43; border: 1px solid #234f43; }
    </style>
  </head>
  <body>
    <main>
      <p class="notice">Local development only</p>
      <h1>Sign in to your local family record</h1>
      <p class="notice">Use a synthetic developer identity. This cookie is available only while the guarded local identity provider is enabled.</p>
      ${errorMarkup}
      <form method="post" action="/dev/sign-in">
        <input type="hidden" name="return_to" value="${escapeHtml(values.returnTo)}">
        <label>Subject ID
          <input name="subject_id" value="${escapeHtml(values.subjectId)}" maxlength="200" required autofocus autocomplete="off">
        </label>
        <label>Email
          <input type="email" name="email" value="${escapeHtml(values.email)}" maxlength="254" required autocomplete="email">
        </label>
        <label>Display name <span class="notice">(optional)</span>
          <input name="display_name" value="${escapeHtml(values.displayName)}" maxlength="200" autocomplete="name">
        </label>
        <button type="submit">Sign in locally</button>
      </form>
      <div class="sign-out">
        <form method="post" action="/dev/sign-out">
          <input type="hidden" name="return_to" value="/">
          <button type="submit">Clear local sign-in cookie</button>
        </form>
      </div>
    </main>
  </body>
</html>`;
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function GET(request: Request): Response {
  if (!isDev) return new Response("Not Found", { status: 404 });
  assertLocalIdentityDevelopmentOnly();
  const requestedReturnTo = new URL(request.url).searchParams.get("return_to") ?? "/family";
  const values = { ...EMPTY_VALUES, returnTo: safeLocalIdentityReturnTo(requestedReturnTo) };
  return htmlResponse(renderSignIn(values));
}

export function HEAD(): Response {
  if (!isDev) return new Response(null, { status: 404 });
  assertLocalIdentityDevelopmentOnly();
  return new Response(null, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export function OPTIONS(): Response {
  if (!isDev) return new Response(null, { status: 404 });
  assertLocalIdentityDevelopmentOnly();
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, HEAD, OPTIONS, POST",
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return htmlResponse(renderSignIn(EMPTY_VALUES, "The sign-in form could not be read."), 400);
  }

  const requestedReturnTo = formText(form, "return_to") || "/family";
  const values: SignInValues = {
    subjectId: formText(form, "subject_id"),
    email: formText(form, "email").toLowerCase(),
    displayName: formText(form, "display_name"),
    returnTo: safeLocalIdentityReturnTo(requestedReturnTo),
  };

  let validationError: string | null = null;
  if (!values.subjectId || values.subjectId.length > 200) {
    validationError = "Subject ID is required and must be at most 200 characters.";
  } else if (!values.email || values.email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(values.email)) {
    validationError = "Enter a valid email address of at most 254 characters.";
  } else if (values.displayName.length > 200) {
    validationError = "Display name must be at most 200 characters.";
  }
  if (validationError) return htmlResponse(renderSignIn(values, validationError), 400);

  const cookie = serializeLocalIdentityCookie({
    subjectId: values.subjectId,
    email: values.email,
    displayName: values.displayName || null,
  });
  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "private, no-store",
      Location: values.returnTo,
      "Set-Cookie": cookie,
    },
  });
}

export function PUT(): Response {
  if (!isDev) return new Response("Not Found", { status: 404 });
  return guardedMethodNotAllowed();
}

export function PATCH(): Response {
  if (!isDev) return new Response("Not Found", { status: 404 });
  return guardedMethodNotAllowed();
}

export function DELETE(): Response {
  if (!isDev) return new Response("Not Found", { status: 404 });
  return guardedMethodNotAllowed();
}
