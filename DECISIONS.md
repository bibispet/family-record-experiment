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
