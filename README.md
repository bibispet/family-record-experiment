# Family Record Experiment

A provisional, private-by-default web application for one family's people,
relationships, photos, voice notes, and short stories. "Family Record
Experiment" is a descriptive release label, not a final product name.

This prototype deliberately has no feed, likes, follower counts, public
discovery, analytics, advertising, wallet, or bespoke encryption layer.

## Project status

This is an experimental, AI-assisted **source-only** release. It is published
for inspection, learning, and controlled experimentation. It is not a hosted
service and is not presented as production-ready or maintained software.

Implementation and test code was produced through model-assisted workflows
across multiple AI assistants, under human product direction. The project
owner can verify selected observable behaviours but cannot
independently audit the implementation line by line. The code has not received
an independent security review, and there is
no guaranteed vulnerability-response or remediation capability.

Do not deploy this project in production or use it with real personal, family,
authentication, cryptographic, or otherwise sensitive data. Passing tests are
evidence for the behaviours they cover; they are not proof of implementation
correctness or security. See [SECURITY.md](SECURITY.md) and
[PROVENANCE.md](PROVENANCE.md).

## Maintenance expectations

Issues and pull requests may be read, but investigation and remediation cannot
be guaranteed. There is no service level, roadmap commitment, or promise that
a defect will be fixed.

On a credible severe report, the owner will take any owner-controlled public
instance offline and publish a warning as soon as reasonably practicable, even
when a code fix is unavailable. Copies already downloaded cannot be recalled.
This is a commitment to containment, not repair.

## Identity boundary

Authentication is selected through the provider-agnostic boundary in
`app/lib/identity.ts`. The default provider denies every inbound identity
header. A deployment behind the OpenAI Sites dispatcher may explicitly select
`IDENTITY_PROVIDER=header`; accepting those headers from an untrusted proxy
would permit impersonation.

Local development may select `IDENTITY_PROVIDER=local`. That adapter is
enabled by a compile-time capability emitted only by Vite's development
server. Production builds hard-code the capability off and fail if `local` is
selected. This is not a password or general-purpose session system.

Opening `/family` while authenticated is not read-only: the application stores
the platform subject and email in D1 and, when no steward membership exists,
creates a personal family space and steward membership. Its name is derived
from the supplied display name. Use only synthetic identities in experimental
deployments.

## Stack

- Vinext / React on a Cloudflare Worker-compatible runtime
- Cloudflare D1 (SQLite) for people, permissions, stories, audit metadata, and
  custodianship planning
- Private Cloudflare R2 binding for media bytes
- Provider-selected server-side identity boundary
- Drizzle schema and checked-in SQLite migration
- Node test runner, TSX, TypeScript, and ESLint

Logical bindings are declared in `.openai/hosting.json` as `DB` and `MEDIA`.
The app has not been deployed.

## Local setup

Node 22.13 or newer is required.

```sh
npm ci
npm run dev
```

The welcome page is anonymous. For local API-only development, start the Vite
development server with `IDENTITY_PROVIDER=local` and send synthetic values
for `x-local-subject-id`, `x-local-email`, and optional
`x-local-display-name`. The adapter cannot initialise in a production build.

For a Sites deployment, explicitly select `IDENTITY_PROVIDER=header`; only the
trusted dispatcher may supply the `oai-authenticated-user-*` headers.
Authentication identifies a user; every route still makes its own server-side
authorization decision.

## Data and permission model

- A space membership permits entry to a family space but reveals no person.
- A person is readable through an active direct authority, an active verified
  custodianship, or an active view-only share containing that exact person.
- A relationship never grants access or custodianship.
- Relationships are returned only when both endpoints are readable.
- A record manager or verified active custodian can mutate a person record.
  A view-only recipient cannot edit, upload, link, unlink, or re-share.
- Person and branch shares are materialized reviewed sets. Graph edits and
  future people do not silently expand an existing grant.
- Stories and media inherit their single owning person's visibility.
- R2 object keys are never returned to the client. Media is streamed only
  through `/api/media/:id` after a fresh D1 authorization check.
- People have no deletion route. `/api/relationships/:id/unlink` end-dates a
  relationship and retains both people and its audit history.

The schema supports multiple custodians, person-account claims, effective
authority intervals, blocked/draft transfer cases, and append-only audit
events. Automatic age-18 transfer is intentionally disabled pending the human
decisions in
[docs/CUSTODIANSHIP_DECISIONS.md](docs/CUSTODIANSHIP_DECISIONS.md).

## Routes

- `GET /api/family`
- `POST /api/people`
- `PATCH /api/people/:id`
- `POST /api/relationships`
- `POST /api/relationships/:id/unlink`
- `POST /api/people/:id/stories`
- `POST /api/people/:id/media`
- `GET /api/media/:id`
- `POST /api/shares`
- `POST /api/shares/:id/revoke`

All protected API responses use `Cache-Control: private, no-store`. Authenticated
but inaccessible record IDs receive a non-disclosing `404`.

## Validation

```sh
npm run typecheck
npm run lint
npm test
```

`npm test` builds the deployable worker, runs the authorization,
custodianship, API, and upload suites, then directly exercises every protected
route without a session to verify denial.

The current suite contains 42 unit tests and 14 rendered/access-control tests.
They are evidence only for the properties they exercise. Nobody independent
selected which properties to test, so the suite cannot establish that omitted
properties are safe.

The implementation record and bounded assumptions are in [PLAN.md](PLAN.md).

## Contributing

Evidence-backed contributions are welcome under the conditions in
[CONTRIBUTING.md](CONTRIBUTING.md). Do not submit real personal or family data
in issues, tests, reports, or examples.

## Licence

Source code in this repository is offered under the Apache License 2.0. See
[LICENSE](LICENSE). This licence applies only to rights the contributors are
legally able to grant; it does not clear third-party rights or resolve questions
about copyrightability of model-assisted material.

A production build generated from this source includes Geist and Lora font
subsets under the SIL Open Font License 1.1. Their copyright notices and
licence travel with the build as
[`/THIRD_PARTY_NOTICES.txt`](public/THIRD_PARTY_NOTICES.txt).

## Name

"Family Record Experiment" is a provisional, descriptive release label. It is
not presented as a final brand, and no trademark is claimed in it.
