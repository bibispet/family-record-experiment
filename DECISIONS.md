# Decisions and artifact receipts

## 2026-08-24 — PLAIN_LANGUAGE.md adopted into docs/

- Source: `%USERPROFILE%\Downloads\PLAIN_LANGUAGE.md` (created outside this
  workspace by an assistant-assisted editing session)
- Action: copied verbatim to `docs/PLAIN_LANGUAGE.md`; README intentionally
  NOT linked; decision made by opencode session after owner gave no directive
  ("experience is not binary"), under standing rule of preserving verified
  work reversibly. Reversible by deleting the single file.
- Verification, as recorded at the time: all ten behavioural claims checked
  against code (`app/lib/authz.ts`, route table, test suite).
- Correction, 2026-08-25: that check was not sound. Two claims were false and
  were not caught. "No activity tracking" contradicted the `audit_events`
  table in `db/schema.ts`. "Nothing can be deleted" contradicted the
  `space_memberships` deletion in `app/lib/family-store.ts` and the R2 object
  cleanup in `db/runtime.ts`. Both were corrected in the document. The
  original claim is kept here rather than removed: a record of a check that
  missed something is more useful than a clean one.
- SHA-256 (measured, both files byte-identical):
  `E93136E19D39887629A26A09662119B525B814B079AE55FFDAEAE13E028A05CF`
- Size: 2703 bytes

## Context notes

- The two archives referenced in conversation — `ATTACH-lore-worktree.zip`
  (claimed SHA-256 beginning `EFEE6F42…`, ending `…6349`) and
  `FALLBACK-ONLY-lore-worktree.tgz.txt` (beginning `704DAEA8…`, ending
  `…8072`) — were never received in this workspace. Only truncated labels
  exist; full values remain unrecorded because they were never supplied or
  measurable here. Do not treat those truncations as verification.
## 2026-08-29 — Copy reconciliation: single canonical repo

- Outcome: This repository (WSL `~/family-record-experiment` ↔ GitHub
  `bibispet/family-record-experiment`) is the sole canonical copy. It is
  git-versioned, pushed to `origin`, builds clean, and passes the full suite
  (75 unit + 19 rendered = 94). `dev-signin-a` is the active working branch;
  `main` holds merged PRs; `audit-b` and `codex` are pushed feature branches.
- Context (standing brief described three divergent copies: `frx` clean
  snapshot, `frx-codex` git-initialized, `frx-onedrive` runnable): only two
  copies were found on this machine. This repo is both the source-of-truth
  and the runnable one. The Windows working tree at
  `…\OneDrive\Documents\Default Project` was a separate, unconnected git
  repo checked out on its own `audit-b` — three orphan commits
  (`4d562de`, `6d5facf`, `fd0ebbd`) unknown to this history, no remote, and
  missing six canonical files (`app/api/audit/route.ts`,
  `app/api/relationships/[id]/route.ts`, `app/api/stories/[id]/route.ts`,
  `app/dev/sign-in/route.ts`, `app/dev/sign-out/route.ts`,
  `app/preview/page.tsx`). No `frx` clean-snapshot directory was found.
- Action: no salvage needed. Nothing substantive existed only in the Windows
  copy; its stray working-tree edits (media route, dashboard, graph dir) all
  exist here in merged, tested form on `dev-signin-a`. Do not develop in the
  Windows copy.
- Consequence: a future contributor should treat this repo as canonical and
  ignore the OneDrive working tree as a stranded snapshot.
- Verification: `[VERIFY]` assumptions in the brief checked against code —
  identity boundary (`app/lib/identity.ts`) holds all provider-header
  references; all 13 API routes resolve identity via boundary helpers, none
  import internals; deny-provider default and exact-adapter isolation are
  test-proven (`tests/identity.test.ts`, `tests/api.test.ts`,
  `tests/authz.test.ts`, `tests/rendered-html.test.mjs`). Stack claims
  (Drizzle `db/schema.ts`, `vite.config.ts`, `worker/index.ts`) confirmed.
