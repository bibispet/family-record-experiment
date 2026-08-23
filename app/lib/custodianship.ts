/**
 * Policy-safe custodianship calculations.
 *
 * This module deliberately cannot transfer authority. It classifies the
 * current civil-date boundary and reports every policy decision that prevents
 * a caller from proceeding. Callers must supply the civil date for a resolved
 * legal timezone; this module never guesses from the server or client clock.
 */

export const MAJORITY_AGE_YEARS = 18 as const;

export type IsoCivilDate = string;
export type LeapDayRule = "february-28" | "march-1";

export type DateOfBirthState =
  | Readonly<{ status: "unknown" }>
  | Readonly<{
      status: "asserted" | "verified" | "disputed";
      value: IsoCivilDate;
    }>;

export type SubjectClaimStatus =
  | "not-started"
  | "pending"
  | "verified"
  | "rejected"
  | "expired"
  | "contested";

export interface AgeBoundaryPolicy {
  /** IANA timezone selected by an approved product/legal policy. */
  readonly timeZone: string | null;
  /** Required only when the date of birth is February 29. */
  readonly leapDayRule: LeapDayRule | null;
  /** Version of the approved rule set used to derive the civil date. */
  readonly version: string | null;
}

export interface CustodianshipEvaluationInput {
  readonly dateOfBirth: DateOfBirthState;
  /**
   * The server-authoritative civil date in ageBoundaryPolicy.timeZone.
   * It is an input so this pure function cannot silently select a clock or
   * timezone.
   */
  readonly asOfCivilDate: IsoCivilDate;
  readonly ageBoundaryPolicy: AgeBoundaryPolicy;
  readonly subjectClaimStatus: SubjectClaimStatus;
  readonly activeCustodianCount: number;
  /**
   * Version of a human-approved rule for sensitive decisions when more than
   * one custodian is active. Null means there is intentionally no default.
   */
  readonly multipleCustodianPolicyVersion: string | null;
  readonly hasOpenCustodianshipDispute: boolean;
}

export type CustodianshipPhase =
  | "undetermined"
  | "minor-managed"
  | "minor-unmanaged"
  | "transfer-due";

export type BoundaryRelation = "unknown" | "before" | "at" | "after";
export type EvaluationOutcome = "no-change" | "policy-blocked";

export type PolicyIssueCode =
  | "DATE_OF_BIRTH_UNKNOWN"
  | "DATE_OF_BIRTH_NOT_VERIFIED"
  | "DATE_OF_BIRTH_DISPUTED"
  | "LEGAL_TIME_ZONE_UNRESOLVED"
  | "AGE_BOUNDARY_POLICY_VERSION_UNRESOLVED"
  | "LEAP_DAY_RULE_UNRESOLVED"
  | "NO_ACTIVE_CUSTODIAN_RECOVERY_POLICY_UNRESOLVED"
  | "MULTIPLE_CUSTODIAN_DECISION_RULE_UNRESOLVED"
  | "CUSTODIANSHIP_DISPUTED"
  | "SUBJECT_ACCOUNT_UNVERIFIED_AT_MAJORITY"
  | "SUBJECT_CLAIM_CONTESTED"
  | "NO_ACCOUNT_AT_MAJORITY_POLICY_UNRESOLVED"
  | "TRANSFER_EFFECTS_POLICY_UNRESOLVED";

export type PolicyIssueScope =
  | "eligibility"
  | "minor-management"
  | "sensitive-custodian-actions"
  | "claim"
  | "transfer";

export interface PolicyIssue {
  readonly code: PolicyIssueCode;
  readonly scope: PolicyIssueScope;
}

export interface CustodianshipEvaluation {
  readonly phase: CustodianshipPhase;
  readonly boundary: BoundaryRelation;
  readonly outcome: EvaluationOutcome;
  /** Always none: this module reports readiness but never changes authority. */
  readonly authorityAction: "none";
  readonly asOfCivilDate: IsoCivilDate;
  readonly eligibilityCivilDate: IsoCivilDate | null;
  readonly policyTimeZone: string | null;
  readonly policyVersion: string | null;
  readonly subjectClaimStatus: SubjectClaimStatus;
  readonly issues: readonly PolicyIssue[];
}

interface CivilDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export function isLeapYear(year: number): boolean {
  assertCalendarYear(year);
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function parseIsoCivilDate(value: IsoCivilDate): CivilDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new RangeError(`Expected an ISO civil date (YYYY-MM-DD), received: ${value}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  assertCalendarYear(year);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Invalid month in civil date: ${value}`);
  }

  const maximumDay = daysInMonth(year, month);
  if (!Number.isInteger(day) || day < 1 || day > maximumDay) {
    throw new RangeError(`Invalid day in civil date: ${value}`);
  }

  return { year, month, day };
}

/**
 * Adds calendar years without converting through a timestamp. A February 29
 * birthday requires an explicit rule when the target year is not a leap year.
 */
export function addCalendarYears(
  value: IsoCivilDate,
  years: number,
  leapDayRule: LeapDayRule | null,
): IsoCivilDate {
  if (!Number.isInteger(years) || years < 0) {
    throw new RangeError("Calendar years must be a non-negative integer.");
  }

  const source = parseIsoCivilDate(value);
  const targetYear = source.year + years;
  assertCalendarYear(targetYear);

  if (source.month === 2 && source.day === 29 && !isLeapYear(targetYear)) {
    if (leapDayRule === null) {
      throw new UnresolvedLeapDayRuleError();
    }

    return leapDayRule === "february-28"
      ? formatCivilDate({ year: targetYear, month: 2, day: 28 })
      : formatCivilDate({ year: targetYear, month: 3, day: 1 });
  }

  return formatCivilDate({ ...source, year: targetYear });
}

export function calculateEighteenthBirthday(
  dateOfBirth: IsoCivilDate,
  leapDayRule: LeapDayRule | null,
): IsoCivilDate {
  return addCalendarYears(dateOfBirth, MAJORITY_AGE_YEARS, leapDayRule);
}

/**
 * Classifies transfer readiness without mutating authority or choosing a
 * policy. Reaching the boundary always produces a blocked outcome until the
 * transfer-effects policy is supplied by a separately approved implementation.
 */
export function evaluateCustodianshipState(
  input: CustodianshipEvaluationInput,
): CustodianshipEvaluation {
  const asOf = parseIsoCivilDate(input.asOfCivilDate);
  assertActiveCustodianCount(input.activeCustodianCount);

  const issues: PolicyIssue[] = [];
  const policyTimeZone = meaningfulValue(input.ageBoundaryPolicy.timeZone);
  const policyVersion = meaningfulValue(input.ageBoundaryPolicy.version);

  if (policyTimeZone === null) {
    issues.push(issue("LEGAL_TIME_ZONE_UNRESOLVED", "eligibility"));
  }

  if (policyVersion === null) {
    issues.push(
      issue("AGE_BOUNDARY_POLICY_VERSION_UNRESOLVED", "eligibility"),
    );
  }

  if (input.dateOfBirth.status === "unknown") {
    issues.push(issue("DATE_OF_BIRTH_UNKNOWN", "eligibility"));
    return blockedUndetermined(input, issues, policyTimeZone, policyVersion);
  }

  const birthDate = parseIsoCivilDate(input.dateOfBirth.value);
  if (input.dateOfBirth.status === "asserted") {
    issues.push(issue("DATE_OF_BIRTH_NOT_VERIFIED", "eligibility"));
  } else if (input.dateOfBirth.status === "disputed") {
    issues.push(issue("DATE_OF_BIRTH_DISPUTED", "eligibility"));
  }

  const isLeapDayBirth = birthDate.month === 2 && birthDate.day === 29;
  if (isLeapDayBirth && input.ageBoundaryPolicy.leapDayRule === null) {
    issues.push(issue("LEAP_DAY_RULE_UNRESOLVED", "eligibility"));
  }

  if (issues.some(({ scope }) => scope === "eligibility")) {
    return blockedUndetermined(input, issues, policyTimeZone, policyVersion);
  }

  const eligibilityCivilDate = calculateEighteenthBirthday(
    input.dateOfBirth.value,
    input.ageBoundaryPolicy.leapDayRule,
  );
  const eligibility = parseIsoCivilDate(eligibilityCivilDate);
  const comparison = compareCivilDates(asOf, eligibility);
  const boundary: BoundaryRelation =
    comparison < 0 ? "before" : comparison === 0 ? "at" : "after";

  addMinorManagementIssues(input, issues);

  if (boundary === "before") {
    const phase: CustodianshipPhase =
      input.activeCustodianCount === 0 ? "minor-unmanaged" : "minor-managed";

    return {
      phase,
      boundary,
      outcome: issues.length === 0 ? "no-change" : "policy-blocked",
      authorityAction: "none",
      asOfCivilDate: input.asOfCivilDate,
      eligibilityCivilDate,
      policyTimeZone,
      policyVersion,
      subjectClaimStatus: input.subjectClaimStatus,
      issues,
    };
  }

  addTransferIssues(input, issues);

  return {
    phase: "transfer-due",
    boundary,
    outcome: "policy-blocked",
    authorityAction: "none",
    asOfCivilDate: input.asOfCivilDate,
    eligibilityCivilDate,
    policyTimeZone,
    policyVersion,
    subjectClaimStatus: input.subjectClaimStatus,
    issues,
  };
}

export class UnresolvedLeapDayRuleError extends Error {
  constructor() {
    super("A February 29 age boundary needs an explicit leap-day rule.");
    this.name = "UnresolvedLeapDayRuleError";
  }
}

function blockedUndetermined(
  input: CustodianshipEvaluationInput,
  issues: readonly PolicyIssue[],
  policyTimeZone: string | null,
  policyVersion: string | null,
): CustodianshipEvaluation {
  return {
    phase: "undetermined",
    boundary: "unknown",
    outcome: "policy-blocked",
    authorityAction: "none",
    asOfCivilDate: input.asOfCivilDate,
    eligibilityCivilDate: null,
    policyTimeZone,
    policyVersion,
    subjectClaimStatus: input.subjectClaimStatus,
    issues,
  };
}

function addMinorManagementIssues(
  input: CustodianshipEvaluationInput,
  issues: PolicyIssue[],
): void {
  if (input.activeCustodianCount === 0) {
    issues.push(
      issue(
        "NO_ACTIVE_CUSTODIAN_RECOVERY_POLICY_UNRESOLVED",
        "minor-management",
      ),
    );
  }

  if (
    input.activeCustodianCount > 1 &&
    meaningfulValue(input.multipleCustodianPolicyVersion) === null
  ) {
    issues.push(
      issue(
        "MULTIPLE_CUSTODIAN_DECISION_RULE_UNRESOLVED",
        "sensitive-custodian-actions",
      ),
    );
  }

  if (input.hasOpenCustodianshipDispute) {
    issues.push(issue("CUSTODIANSHIP_DISPUTED", "minor-management"));
  }
}

function addTransferIssues(
  input: CustodianshipEvaluationInput,
  issues: PolicyIssue[],
): void {
  if (input.subjectClaimStatus === "contested") {
    issues.push(issue("SUBJECT_CLAIM_CONTESTED", "claim"));
  } else if (input.subjectClaimStatus !== "verified") {
    issues.push(
      issue("SUBJECT_ACCOUNT_UNVERIFIED_AT_MAJORITY", "claim"),
    );
  }

  if (input.subjectClaimStatus !== "verified") {
    issues.push(
      issue("NO_ACCOUNT_AT_MAJORITY_POLICY_UNRESOLVED", "transfer"),
    );
  }

  issues.push(issue("TRANSFER_EFFECTS_POLICY_UNRESOLVED", "transfer"));
}

function issue(code: PolicyIssueCode, scope: PolicyIssueScope): PolicyIssue {
  return { code, scope };
}

function compareCivilDates(left: CivilDateParts, right: CivilDateParts): number {
  if (left.year !== right.year) return left.year - right.year;
  if (left.month !== right.month) return left.month - right.month;
  return left.day - right.day;
}

function formatCivilDate(value: CivilDateParts): IsoCivilDate {
  return [
    value.year.toString().padStart(4, "0"),
    value.month.toString().padStart(2, "0"),
    value.day.toString().padStart(2, "0"),
  ].join("-");
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function assertCalendarYear(year: number): void {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new RangeError("Calendar year must be an integer from 1 through 9999.");
  }
}

function assertActiveCustodianCount(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError("Active custodian count must be a non-negative integer.");
  }
}

function meaningfulValue(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}
