Read LORE-AGENT-BRIEF.md first, then its Section 8.

# AGENTS.md

## What this project is

Private-by-default family-records app (people, relationships, stories, media).
Experimental, source-only release built with model-assisted workflows — read
README.md ("Project status") and PROVENANCE.md before making claims about its
security posture.

Hard rule: real personal/family data must never appear in code, tests,
fixtures, or issues. Use obviously synthetic values (`example.test`, fake
names/dates).

## Stack

- **Vinext (beta) on Vite targeting Cloudflare Workers** — Next-style `app/`
  directory with RSC, but *not* the Next.js runtime. `vite.config.ts` is the
  real config; `next.config.ts` is vestigial boilerplate.
- Cloudflare bindings: D1 as `DB`, R2 as `MEDIA`. Binding names live in
  `.openai/hosting.json`; local wiring with placeholder IDs is in
  `vite.config.ts`. Worker entry: `worker/index.ts` (adds security headers).
- Drizzle ORM (`db/schema.ts`); shared route helpers in `app/lib/api.ts`
  (`HttpError`, `assertSafeMutation`, `noStoreJson`), authorization logic in
  `app/lib/authz.ts`, identity boundary in `app/lib/identity.ts`.

## Commands

Node >= 22.13 required.

```sh
npm ci
npm run dev        # vinext dev via Vite/Cloudflare plugin
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # build → unit → rendered-html (always run all three)
```

- `npm test` builds first because `tests/rendered-html.test.mjs` imports
  `dist/server/index.js` — `npm run test:render` alone fails without a fresh
  build. Prefer plain `npm test`.
- Test runner is node:test, not vitest/jest. `test:unit` runs every
  `tests/*.test.ts` — currently six suites. Run one with
  `npx tsx --test tests/authz.test.ts`.
- Live smoke test against a running dev server: `npm run test:live` (URL via
  `FAMILY_RECORD_TEST_URL`, default `http://[::1]:3000`).

## Database and migrations

- The checked-in migration (`drizzle/0000_*.sql`) is applied automatically at
  runtime: `db/runtime.ts` imports it `?raw` and splits statements on
  `--> statement-breakpoint`. No separate migrate step exists.
- Schema changes: edit `db/schema.ts` → `npm run db:generate` → inspect and
  keep the generated SQL checked in. Never hand-edit generated SQL.

## Authentication

- Provider-agnostic boundary: `app/lib/identity.ts` exposes `Viewer`
  `{ subjectId, email, displayName: string | null }` derived from
  `ApiActor` (what `getContext()` consumes), not from any vendor's headers.
  Two adapters implement it: `header` (reads `oai-authenticated-user-*`
  injected by OpenAI Sites) and `local` (reads `x-local-*` headers for
  development only). Adapters are module-private — the only way to reach a
  viewer is `getIdentityProvider()` / `getViewer` / `getApiActorFromRequest` /
  `getRscViewer` / `requireRscViewer`. The old bypasses (`app/chatgpt-auth.ts`,
  the raw `getApiActor` parser in `app/lib/api.ts`) have been deleted.
- Selection via `IDENTITY_PROVIDER` (or `AUTH_PROVIDER`), read from the
  Cloudflare Workers environment (`cloudflare:workers`, primed by the Worker
  entry) with `process.env` as the fallback outside workerd:
  `header` / `oai` / `chatgpt` → header adapter, `local` / `dev` →
  local adapter, **default → `deny` (refuses to trust any inbound identity
  headers)**. Trusting `oai-*` from an untrusted proxy permits
  impersonation; it is explicit opt-in (`IDENTITY_PROVIDER=header`),
  not the default.
- The local adapter is guarded by configuration, not by structure: it refuses to
  initialise (throws) unless `NODE_ENV` is `development` or `test` **and**
  `FAMILY_RECORD_ALLOW_LOCAL_IDENTITY=1`, and re-checks on every resolution.
  Unknown/absent `NODE_ENV` is treated as production. Never enable it where
  visitors can set request headers.
- Under `deny` there is no sign-in destination at all: `signInPath()`
  returns null, API requests get 401, and `/family` fails closed instead of
  redirecting. Vendor URLs (`/signin-with-chatgpt`) live in the header
  adapter alone.
- Multi-space requests target a space two different ways, which is an
  inconsistency worth resolving: `app/lib/api.ts` reads an
  `x-family-space-id` header, while `app/api/family/route.ts` reads a
  `?space=` query parameter.
- Opening `/family` while authenticated writes to D1 (auto-creates a personal
  space + steward membership if none exists). Synthetic identities only.

## Design doctrine

**Automate the commodity, amplify human ingenuity.**

- Automate the repeatable mechanics of preservation: storage, indexing,
  transcription, backups, access checks, format conversion.
- Use that automation to give people more room to preserve, explore,
  interpret, connect, question, and create.
- The system may help people discover possibilities, but it must NOT decide
  what matters, declare what a memory means, choose its audience, or claim
  authorship.

Why inviolable: automation succeeds when it expands human agency — more
memories preserved, more connections explored, more stories told in people's
own voices. Automate the mechanics; keep the meaning human.

## Deliberate design invariants

The suite enforces these; do not "fix" them. Each is a consequence of the
doctrine above:

- Protected responses always set `Cache-Control: private, no-store`.
- Anonymous API requests → 401. Anonymous requests to the rendered `/family`
  page → a sign-in redirect under the header adapter, 401 under `deny`.
  Authenticated-but-unauthorized IDs → non-disclosing 404.
- Cross-origin mutations rejected (`assertSafeMutation`).
- A relationship never grants access or custodianship; relationships are
  returned only when both endpoints are readable.
- Shares are materialized reviewed person sets — graph edits and new people
  never widen an existing grant.
- R2 object keys never reach the client; media streams only through
  `/api/media/:id` after a fresh D1 check.
- Intentionally no people deletion route; unlink end-dates and retains history.
- Automatic age-18 custodianship transfer is disabled pending human decisions
  in `docs/CUSTODIANSHIP_DECISIONS.md`.
- Deliberately absent: feed, likes, follower counts, discovery, analytics,
  ads, wallet, bespoke encryption.

## Conventions

- Disclose substantive generative-AI use in PRs/issues: provider/model, what
  it was used for, what a human verified (CONTRIBUTING.md).
- Contributions need evidence: exact commit, synthetic-data repro steps, test
  output. Keep changes narrowly scoped; auth/deployment/custodianship scope
  changes require explicit owner review.
- Validation order: `typecheck` → `lint` → `test`.

