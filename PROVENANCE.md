# Development provenance

## Release origin

This release tree is derived from the local baseline identified by these Git
SHA-1 object names:

    commit: 143f99d2b7df7675b756892cf88a8787f305f177
    tree:   975648ed46372e77f4c686b5a85b044a9113ae9a

It is not byte-identical to that baseline. Every category of change made
during release preparation is listed here, so the difference is documented
rather than discovered:

1. The retired working label was removed from the interface, from an internal
   type name, and from a test environment variable. Affected:
   app/layout.tsx, app/page.tsx, worker/index.ts, db/runtime.ts,
   tests/rendered-html.test.mjs, tests/live-http-smoke.mjs.

2. Test fixtures were de-personalised. A human-sounding fixture name and a
   date of birth plausible for a living minor were replaced with obviously
   synthetic values. Affected: tests/api.test.ts, tests/custodianship.test.ts.

3. Dependencies were updated. Direct dependencies including React, Vite,
   Wrangler, the Cloudflare Vite plugin and the vinext framework moved
   forward, @cloudflare/workers-types moved from a caret-ranged 4.x to a
   pinned 5.x. In package-lock.json, 127 packages changed version, 3 were
   added and 34 were removed, and the tree shrank from 708 packages to 677.
   The package name and an Apache-2.0 licence field were also set.

4. Line endings in app/chatgpt-auth.ts were normalised from CRLF to LF. Its
   content is otherwise unchanged.

5. .gitignore, PLAN.md and README.md were revised, and documentation not
   present in the baseline was added: this file, LICENSE, SECURITY.md,
   CONTRIBUTING.md, and public/THIRD_PARTY_NOTICES.txt.

Authentication, API routes, the database schema, migrations, sharing logic,
storage logic and the custodianship implementation are unchanged from the
baseline.

The public release begins with a new, neutral root commit rather than
publishing the local development identity or the retired working label in the
original commit metadata.

The baseline tree hash covers the exact paths, file modes, and bytes of its 53
tracked files, without author, email, timestamp, or commit-message metadata.
It can be recomputed by anyone holding that exact baseline tree. It does not by
itself authenticate the tree, and it will not equal this release's tree hash,
for the reasons listed above.

## Development method

Implementation and test code was produced through model-assisted workflows
across multiple AI assistants, under human product direction. The assistants
believed to have contributed are ChatGPT/Codex (OpenAI), Claude (Anthropic),
Kimi (Moonshot) and Grok (xAI).

Per-file attribution is not recoverable. No record was kept at the time
distinguishing which assistant produced which code, and nothing in the
repository identifies this. This is stated as a limitation of the record
rather than left as an implication.

Accounts: unknown whether any employer-, organisation- or school-issued account
was used. The owner recalled personal email addresses but could not confirm the
account type used for every service. Specific addresses are deliberately not
recorded here.

Models: unknown.

Dates: unknown. The implementation and test code in the baseline existed by its
2026-08-17 commit. Release-preparation documentation was created afterward and
is not included in that date bound.

The project owner selected goals, reviewed observable behaviour, and directed
iterative testing, but cannot independently audit the implementation line by
line.

## Verification boundary

The source archive must be rescanned and all checks rerun after release
preparation. Results apply only to the exact release commit and archive named in
the final release record.
