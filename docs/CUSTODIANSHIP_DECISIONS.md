# Custodianship decision boundary

Status: **policy blocked for production authority transfer**

This document records the boundary implemented in
`app/lib/custodianship.ts`. It is an engineering proposal, not a legal
determination. The launch jurisdiction and the handling of children's data
need review by an appropriately authorized product owner and counsel.

## Fixed requirements

- A minor's record is managed by a parent or guardian.
- More than one custodian must be representable.
- Control transfers to the subject at 18.
- Family relationships and custodial authority are separate facts. A parent,
  guardian, verified, or oral relationship never grants authority by itself.
- Unlinking a relationship does not delete either person and does not silently
  alter custodianship.
- Every protected operation is authorized on the server.

The meaning of "control" is not yet fixed. Profile fields, sharing rules,
relationships, attached media, third-party-authored stories, export, and
deletion may require different rights.

## What is implemented

The library is deliberately pure and has no database, clock, scheduler,
notification, account, or authorization side effects. It:

1. Validates exact ISO civil dates.
2. Adds 18 calendar years rather than approximating with a number of days.
3. Requires an explicit February 29 rule when the target year is not a leap
   year.
4. Requires the caller to supply the server-authoritative civil date for an
   explicitly selected IANA timezone.
5. Classifies the boundary as before, at, or after the eighteenth birthday.
6. Surfaces unresolved DOB, timezone, multi-custodian, claim, dispute, and
   transfer decisions as named policy issues.
7. Always returns `authorityAction: "none"`.
8. Always returns `policy-blocked` at or after the transfer boundary. There is
   no automatic transfer or implicit fallback.

The evaluator can return these phases:

| Phase | Meaning |
| --- | --- |
| `undetermined` | A trusted age boundary cannot be calculated. |
| `minor-managed` | The trusted boundary is in the future and at least one active custodian exists. |
| `minor-unmanaged` | The trusted boundary is in the future but no active custodian exists. Recovery policy is unresolved. |
| `transfer-due` | The trusted boundary has been reached, but authority remains policy blocked. |

It intentionally cannot return `adult-controlled`. A future, separately
approved application service must perform an atomic and audited authority
transition.

## Age and timezone rule

Date of birth is a calendar date, not a timestamp. The evaluator does not call
`Date.now()` or accept a client-derived age. The caller supplies an
`asOfCivilDate` derived on the server under the approved timezone policy.

Production still needs explicit answers for:

- Which jurisdiction and timezone govern the boundary. Birth timezone must not
  be assumed.
- Whether a February 29 birthday reaches the boundary on February 28 or March
  1 in a non-leap year.
- Missing, approximate, asserted, disputed, or corrected birth dates.
- Relocation and changes to timezone rules.
- Corrections that would move the boundary into the past.
- Exceptional cases such as emancipation or continuing adult guardianship, if
  the product will support them.

A production boundary should retain the source inputs, selected rule version,
local civil date, computed UTC instant, and calculation audit event. Access
checks must enforce effective authority timestamps directly; a delayed
scheduler must not leave expired custodial access active.

## Proposed authority state machine

The application model should keep authority phase, claim state, and holds as
separate dimensions.

```text
MINOR_MANAGED
  |-- verified preclaim ----------------------> MINOR_PRECLAIM_VERIFIED
  |-- no active custodian --------------------> MINOR_UNMANAGED / recovery hold
  |-- eighteenth-birthday boundary ----------> TRANSFER_DUE / policy blocked

MINOR_PRECLAIM_VERIFIED
  |-- eighteenth-birthday boundary ----------> TRANSFER_DUE / policy blocked

TRANSFER_DUE
  |-- approved policy + verified subject ----> ADULT_CONTROLLED
  |-- no verified subject account -----------> unresolved human decision
  |-- conflicting claim or dispute ----------> scoped hold; nobody wins

ADULT_CONTROLLED
  |-- approved recovery ----------------------> atomic account replacement
  |-- DOB correction -------------------------> review case; never auto-revert
```

Reaching the boundary is not permission to mutate authority. The future
transition service needs compare-and-swap/idempotency protection, a unique
completion event, current authorization checks, and an audit event committed
in the same transaction as the grant changes.

## The unavoidable no-account decision

The product must select what happens when a subject turns 18 without a
verified account. Candidate policies include:

- **Adult-unclaimed lock:** custodial control expires and no account has
  operational control until the subject completes an approved claim.
- **Provisional stewardship:** custodians retain a narrow set of powers until
  claim. This may conflict with the firm transfer requirement.
- **Required preclaim:** transfer requires a verified account to be prepared
  before the boundary. This needs a policy for unreachable subjects and for
  pre-18 accounts and consent.

There is no default. The current evaluator reports
`NO_ACCOUNT_AT_MAJORITY_POLICY_UNRESOLVED` and takes no action.

Even with a verified claim, the evaluator reports
`TRANSFER_EFFECTS_POLICY_UNRESOLVED`. Verification alone does not decide which
custodial grants end, whether existing sharing grants continue, or which
content rights move to the subject.

## Multiple custodians

Custodianship must be many-to-many. There is no hidden primary custodian and
no family-relationship-derived authority. When more than one custodian is
active and no approved decision-rule version is supplied, the evaluator
reports `MULTIPLE_CUSTODIAN_DECISION_RULE_UNRESOLVED`.

Human-approved rules are required, per operation, for:

- adding, verifying, suspending, or removing a custodian;
- changing DOB, timezone, jurisdiction, or verification status;
- expanding sharing;
- participating in a subject claim;
- export or deletion requests;
- changing recovery contacts;
- applying or resolving a dispute; and
- changing transfer preparation.

Possible rules include any-one, unanimous, threshold, or review by an
authorized decision-maker. The implementation must not select one merely
because it is convenient. Routine capture edits may eventually use a lighter
rule, but that too needs an explicit product decision.

## Claims, consent, and recovery

A person record may exist without an account. A pending claim grants no access
and must not disclose whether a private record exists. The future claim flow
should use explicitly enabled verification methods; DOB matching alone is not
sufficient. Conflicting claims must become contested rather than selecting the
first or most recent claimant.

Open decisions include:

- acceptable identity-verification methods;
- whether a minor can have a preclaim account;
- whether and how custodians participate in verification;
- notification schedule, recipient verification, and acknowledgement;
- what consent is required and from whom;
- recovery when a custodian is unavailable; and
- adult-account recovery and any role for former custodians.

Notifications do not grant authority. Notification failure must not silently
extend custodial authority. Authentication recovery and custodianship recovery
must remain separate, and a former custodian must not automatically become the
adult's recovery factor.

## Disputes and administrative recovery

Opening a dispute must not grant access or choose a winner. Holds should be
operation-scoped. A conservative proposal is to preserve already-authorized
reads while blocking authority, DOB, sharing, export, deletion, recovery, and
transfer-manipulation operations. Whether routine edits continue is still an
open decision.

The product must decide who can adjudicate, accepted evidence, deadlines,
appeals, emergency safety behavior, and administrative access. Do not
implement a generic administrator ownership bypass. Corrections append audit
events and use compensating actions; they do not rewrite history.

## Audit, export, and deletion

Audit history should append events for custody changes, DOB assertions and
corrections, policy calculations, notices, claims, verification, disputes,
holds, authority transitions, recovery, sharing changes, exports, and deletion
requests. Audit events must not contain raw tokens, identity documents, or
unnecessary child data. Audit visibility and retention remain open decisions.

The following are different operations and must not be collapsed:

- closing an account;
- revoking access;
- deleting an uploaded item;
- redacting or erasing personal fields;
- unlinking a relationship;
- deleting a person entity;
- exporting subject data;
- exporting a family branch or third-party-authored content; and
- retaining audit evidence.

The product rule that people are not deleted does not resolve privacy or
erasure obligations. The data model may eventually keep an opaque/tombstoned
endpoint while removing selected personal fields or media, but that is an
architectural option rather than an approved legal policy.

## Release blockers

Do not enable automatic transfer, self-service claim authority, administrative
reassignment, or automatic export/deletion for real minor data until an
authorized human resolves:

1. Custodian verification and initial authority assignment.
2. Multiple-custodian decision rules by operation.
3. Jurisdiction, timezone, leap-day, DOB verification, and correction rules.
4. Exact no-account-at-18 behavior.
5. The rights included in "control."
6. Claim verification and conflicting-claim adjudication.
7. Pre-18 accounts, contact collection, notification, and consent.
8. Unavailable custodians and mistaken relationships.
9. Dispute, emergency, appeal, and administrative-recovery authority.
10. Existing sharing grants and contributor rights at transfer.
11. Export scope and third-party content.
12. Deletion/erasure behavior, holds, and audit retention.

Safe work before those decisions is limited to policy-ready schema, pure
calculations, immutable audit primitives, denial paths, and tests.

## Required tests for a future transition service

The pure evaluator covers strict dates, calendar-year addition, leap-day
alternatives, and before/at/after classification. The service that eventually
uses it must additionally test:

- exact authorization races across the UTC transition instant;
- idempotent and atomic grant changes;
- two simultaneous transfer workers;
- stale sessions, caches, media URLs, and in-progress uploads;
- competing claims and disputed DOBs;
- multiple custodians attempting conflicting mutations;
- notification failure without permission drift;
- former-custodian denial after transfer;
- export/deletion during a claim, dispute, or hold; and
- recovery without silent reinstatement of custodial authority.
