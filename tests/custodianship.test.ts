import assert from "node:assert/strict";
import test from "node:test";

// A URL-based dynamic import lets Node's built-in type stripping execute this
// test without requiring the application to add a TypeScript test dependency.
const moduleUrl = new URL("../app/lib/custodianship.ts", import.meta.url);
const {
  UnresolvedLeapDayRuleError,
  addCalendarYears,
  calculateEighteenthBirthday,
  evaluateCustodianshipState,
  isLeapYear,
  parseIsoCivilDate,
} = await import(moduleUrl.href);

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    dateOfBirth: { status: "verified", value: "2000-01-01" },
    asOfCivilDate: "2017-12-31",
    ageBoundaryPolicy: {
      timeZone: "Pacific/Auckland",
      leapDayRule: null,
      version: "test-age-policy-v1",
    },
    subjectClaimStatus: "verified",
    activeCustodianCount: 1,
    multipleCustodianPolicyVersion: null,
    hasOpenCustodianshipDispute: false,
    ...overrides,
  };
}

function issueCodes(result: { issues: readonly { code: string }[] }) {
  return result.issues.map(({ code }) => code);
}

test("uses strict civil dates and calendar leap-year rules", () => {
  assert.deepEqual(parseIsoCivilDate("2008-02-29"), {
    year: 2008,
    month: 2,
    day: 29,
  });
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(1900), false);
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2026), false);

  assert.throws(() => parseIsoCivilDate("2026-02-29"), RangeError);
  assert.throws(() => parseIsoCivilDate("08/14/2008"), RangeError);
  assert.throws(() => addCalendarYears("2000-01-01", -1, null), RangeError);
});

test("adds 18 calendar years for an ordinary birthday", () => {
  assert.equal(
    calculateEighteenthBirthday("2000-01-01", null),
    "2018-01-01",
  );
});

test("requires an explicit rule for a February 29 boundary", () => {
  assert.throws(
    () => calculateEighteenthBirthday("2024-02-29", null),
    UnresolvedLeapDayRuleError,
  );
  assert.equal(
    calculateEighteenthBirthday("2024-02-29", "february-28"),
    "2042-02-28",
  );
  assert.equal(
    calculateEighteenthBirthday("2024-02-29", "march-1"),
    "2042-03-01",
  );
});

test("classifies the date before the boundary without changing authority", () => {
  const result = evaluateCustodianshipState(validInput());

  assert.equal(result.phase, "minor-managed");
  assert.equal(result.boundary, "before");
  assert.equal(result.outcome, "no-change");
  assert.equal(result.authorityAction, "none");
  assert.equal(result.eligibilityCivilDate, "2018-01-01");
  assert.deepEqual(result.issues, []);
});

test("blocks at the exact boundary even when a subject claim is verified", () => {
  const result = evaluateCustodianshipState(
    validInput({ asOfCivilDate: "2018-01-01" }),
  );

  assert.equal(result.phase, "transfer-due");
  assert.equal(result.boundary, "at");
  assert.equal(result.outcome, "policy-blocked");
  assert.equal(result.authorityAction, "none");
  assert.deepEqual(issueCodes(result), [
    "TRANSFER_EFFECTS_POLICY_UNRESOLVED",
  ]);
});

test("remains policy blocked after the boundary and never auto-transfers", () => {
  const result = evaluateCustodianshipState(
    validInput({ asOfCivilDate: "2018-01-02" }),
  );

  assert.equal(result.phase, "transfer-due");
  assert.equal(result.boundary, "after");
  assert.equal(result.outcome, "policy-blocked");
  assert.equal(result.authorityAction, "none");
});

test("surfaces the unresolved no-account branch at majority", () => {
  const result = evaluateCustodianshipState(
    validInput({
      asOfCivilDate: "2018-01-01",
      subjectClaimStatus: "pending",
    }),
  );

  assert.deepEqual(issueCodes(result), [
    "SUBJECT_ACCOUNT_UNVERIFIED_AT_MAJORITY",
    "NO_ACCOUNT_AT_MAJORITY_POLICY_UNRESOLVED",
    "TRANSFER_EFFECTS_POLICY_UNRESOLVED",
  ]);
});

test("a contested claim does not acquire authority", () => {
  const result = evaluateCustodianshipState(
    validInput({
      asOfCivilDate: "2018-01-01",
      subjectClaimStatus: "contested",
      hasOpenCustodianshipDispute: true,
    }),
  );

  assert.equal(result.authorityAction, "none");
  assert.deepEqual(issueCodes(result), [
    "CUSTODIANSHIP_DISPUTED",
    "SUBJECT_CLAIM_CONTESTED",
    "NO_ACCOUNT_AT_MAJORITY_POLICY_UNRESOLVED",
    "TRANSFER_EFFECTS_POLICY_UNRESOLVED",
  ]);
});

test("does not infer a primary custodian when several are active", () => {
  const result = evaluateCustodianshipState(
    validInput({ activeCustodianCount: 2 }),
  );

  assert.equal(result.phase, "minor-managed");
  assert.equal(result.outcome, "policy-blocked");
  assert.deepEqual(issueCodes(result), [
    "MULTIPLE_CUSTODIAN_DECISION_RULE_UNRESOLVED",
  ]);

  const explicitlyVersioned = evaluateCustodianshipState(
    validInput({
      activeCustodianCount: 2,
      multipleCustodianPolicyVersion: "test-multiple-custodian-policy-v1",
    }),
  );
  assert.equal(explicitlyVersioned.outcome, "no-change");
});

test("reports a minor with no active custodian as recovery-policy blocked", () => {
  const result = evaluateCustodianshipState(
    validInput({ activeCustodianCount: 0 }),
  );

  assert.equal(result.phase, "minor-unmanaged");
  assert.equal(result.outcome, "policy-blocked");
  assert.deepEqual(issueCodes(result), [
    "NO_ACTIVE_CUSTODIAN_RECOVERY_POLICY_UNRESOLVED",
  ]);
});

test("refuses to calculate from an unverified DOB or unresolved timezone", () => {
  const assertedDob = evaluateCustodianshipState(
    validInput({
      dateOfBirth: { status: "asserted", value: "2000-01-01" },
    }),
  );
  assert.equal(assertedDob.phase, "undetermined");
  assert.equal(assertedDob.boundary, "unknown");
  assert.equal(assertedDob.eligibilityCivilDate, null);
  assert.deepEqual(issueCodes(assertedDob), [
    "DATE_OF_BIRTH_NOT_VERIFIED",
  ]);

  const unresolvedTimezone = evaluateCustodianshipState(
    validInput({
      ageBoundaryPolicy: {
        timeZone: null,
        leapDayRule: null,
        version: "test-age-policy-v1",
      },
    }),
  );
  assert.equal(unresolvedTimezone.phase, "undetermined");
  assert.deepEqual(issueCodes(unresolvedTimezone), [
    "LEGAL_TIME_ZONE_UNRESOLVED",
  ]);
});

test("refuses a leap-day calculation until its policy is selected", () => {
  const unresolved = evaluateCustodianshipState(
    validInput({
      dateOfBirth: { status: "verified", value: "2008-02-29" },
      asOfCivilDate: "2026-02-28",
    }),
  );

  assert.equal(unresolved.phase, "undetermined");
  assert.deepEqual(issueCodes(unresolved), ["LEAP_DAY_RULE_UNRESOLVED"]);

  const februaryRule = evaluateCustodianshipState(
    validInput({
      dateOfBirth: { status: "verified", value: "2008-02-29" },
      asOfCivilDate: "2026-02-28",
      ageBoundaryPolicy: {
        timeZone: "Pacific/Auckland",
        leapDayRule: "february-28",
        version: "test-age-policy-v1",
      },
    }),
  );
  assert.equal(februaryRule.boundary, "at");
  assert.equal(februaryRule.phase, "transfer-due");
  assert.equal(februaryRule.authorityAction, "none");
});
