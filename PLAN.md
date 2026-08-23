# Family Record Experiment — implementation trail

## Prioritized slice

1. Establish a Cloudflare-compatible Vinext app with D1 for relational records,
   R2 for private media, and dispatch-owned sign-in.
2. Separate three concerns in the model: family relationships, authority over a
   person record, and read-only sharing.
3. Deliver one real path: sign in, add a private person, connect a verified or
   oral relationship, add a story or validated media, and retrieve it through a
   freshly authorized route.
4. Materialize each person/branch share as an explicit reviewed set of people.
   Graph changes and new people never silently widen an existing share.
5. Represent custodianship and age-transfer planning without enabling an
   irreversible automatic transfer policy.

## Product assumptions made for this slice

- The creator of a person receives record_manager authority. A family-space
  role does not make someone omniscient.
- Read grants never confer edit, re-share, upload, unlink, or custodial rights.
- A branch share is a named snapshot of people explicitly selected by its
  creator. It is not a live recursive graph permission.
- Relationships are directional in storage. Symmetric types are canonicalized.
- Unlinking ends a relationship and retains both people and the historical row.
- Stories are plain text and inherit the owning person's visibility.
- Each media item has one authoritative owning person; R2 object keys remain
  server-only and blobs are served through an authorized route.

## Deliberately blocked decisions

The application does not run a live age-18 cutover. Human product/legal answers
are still required for identity verification, multiple-custodian approval,
governing timezone/jurisdiction and leap-day rules, the exact bundle of control
that transfers, no-account-at-18 behavior, notifications and consent, disputes,
recovery, existing shares, audit visibility/retention, and export/erasure rights.
See docs/CUSTODIANSHIP_DECISIONS.md.

## Baseline validation performed during implementation

These checks describe the local baseline development run. They are not a
release receipt; final verification must be tied to an exact release archive
and public commit.

- [x] schema migration generated and inspected
- [x] successful create/link/story/media/share paths covered
- [x] anonymous, outsider, cross-family, and view-only mutation denials covered
- [x] upload byte signatures and size limits covered
- [x] relationship responses never expose a hidden endpoint
- [x] lint passes
- [x] tests pass
- [x] production build passes
- [x] no analytics, wallet, bespoke encryption, public object URL, or people
      deletion route is present
