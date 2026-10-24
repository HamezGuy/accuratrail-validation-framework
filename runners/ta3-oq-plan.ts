import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { isRecord, strictObject } from './evidence-capture';
import type { Ta3Account } from '../config/ta3-oq-cases';

// The TA3 OQ plan (TA3 plan VAL-1, spec P20 VD-5 and 3.3). A ta3-oq-plan/1 names
// the designated armed study the OQ suites 13 to 18 run against (a dedicated
// duplicate of the release, never the study the O-7 benchmark scores), its OQ
// site, the synthetic named accounts by the environment variables that hold
// their credentials, the rules and fixtures the cases exercise, and the bounds
// of the waits. VAL-1/validation-run step 0 writes it, every member read back
// from the stack. The plan holds no secret: every account member names an
// environment variable, and any other member has a fixed form, so an unknown
// member refuses the file. A retained package copies it to inputs/ta3-oq-plan.json.
// Contract: contracts/ta3-oq-plan-v1.schema.json.

export const TA3_OQ_PLAN_CONTRACT = 'ta3-oq-plan/1';
/** Required members of the plan and of its objects; the contract test compares them with the schema. */
export const TA3_OQ_PLAN_REQUIRED = [
  'contract', 'synthetic', 'runLabel', 'study', 'accounts', 'saveRule', 'absenceRule', 'followUpTask', 'applicability', 'sweep', 'escalation',
] as const;
export const TA3_OQ_PLAN_MEMBERS = {
  study: { required: ['studyId', 'siteStudyId', 'expectedSpecHash'], optional: ['expectedCslReleaseId', 'duplicateOf'] },
  accounts: { required: ['reviewer', 'thirdPerson', 'blinded', 'monitor'], optional: ['operator'] },
  account: { required: ['username', 'password'], optional: [] },
  saveRule: { required: ['ruleId', 'eventDefinitionId', 'crfVersionId', 'itemId', 'violatingValue', 'compliantValue', 'visitDate'], optional: [] },
  absenceRule: { required: ['ruleId', 'kind', 'eventDefinitionId', 'anchorDate'], optional: [] },
  followUpTask: { required: ['studyTaskId'], optional: [] },
  applicability: { required: ['versions', 'versionedRuleId', 'earlyEnrollmentDate', 'lateEnrollmentDate'], optional: [] },
  version: { required: ['protocolVersion', 'effectiveFrom'], optional: ['ethicsApprovalDate'] },
  sweep: { required: [], optional: ['maxWaitMinutes'] },
  escalation: { required: ['recipientRole', 'recipientUsername'], optional: ['maxWaitMinutes'] },
} as const;

/** The operator's credentials default to the variables every runner reads (runners/auth.ts). */
export const DEFAULT_OPERATOR = { username: 'OQ_USERNAME', password: 'OQ_PASSWORD' } as const;
export const ABSENCE_RULE_KINDS = ['missed_visit', 'visit_window', 'visit_after_disposition'] as const;
/** The roles an O-2 policy row may name as recipient (spec P09 5.2.2). */
export const RECIPIENT_ROLES = ['investigator', 'data_manager', 'monitor', 'coordinator'] as const;
export const SWEEP_WAIT_DEFAULT_MINUTES = 5;
export const ESCALATION_WAIT_DEFAULT_MINUTES = 0;

export interface Ta3AccountVariables { username: string; password: string }
export interface Ta3ProtocolVersion { protocolVersion: string; effectiveFrom: string; ethicsApprovalDate?: string }

export interface Ta3OqPlan {
  contract: typeof TA3_OQ_PLAN_CONTRACT;
  synthetic: true;
  /** A short label of the run; owned records are labelled OQ-TA3-<runLabel>-<run id>-<n>. */
  runLabel: string;
  study: { studyId: number; siteStudyId: number; expectedSpecHash: string; expectedCslReleaseId?: string; duplicateOf?: number };
  accounts: Partial<Record<'operator', Ta3AccountVariables>> & Record<Exclude<Ta3Account, 'operator'>, Ta3AccountVariables>;
  saveRule: { ruleId: string; eventDefinitionId: number; crfVersionId: number; itemId: number; violatingValue: string; compliantValue: string; visitDate: string };
  absenceRule: { ruleId: string; kind: typeof ABSENCE_RULE_KINDS[number]; eventDefinitionId: number; anchorDate: string };
  followUpTask: { studyTaskId: number } | null;
  applicability: { versions: [Ta3ProtocolVersion, Ta3ProtocolVersion]; versionedRuleId: string; earlyEnrollmentDate: string; lateEnrollmentDate: string } | null;
  sweep: { maxWaitMinutes?: number };
  escalation: { maxWaitMinutes?: number; recipientRole: typeof RECIPIENT_ROLES[number]; recipientUsername: string };
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
const RUN_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
/** A deviation spec rule id (the EDC stores them as text; the engine's own pattern is wider than any id seen). */
const RULE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/;
/** The EDC's PROTOCOL_VERSION_PATTERN (libreclinicaapi src/services/deviation-engine/protocol-applicability.ts). */
const PROTOCOL_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const PLAN_BYTE_LIMIT = 1024 * 1024;

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function positiveId(value: unknown, at: string): number {
  check(Number.isSafeInteger(value) && Number(value) > 0, `${at} must be a positive integer`);
  return Number(value);
}
function calendarDay(value: unknown, at: string): string {
  check(typeof value === 'string' && ISO_DAY.test(value), `${at} must be a calendar date written YYYY-MM-DD`);
  const parsed = Date.parse(`${value}T00:00:00Z`);
  check(Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value, `${at} is not a calendar date`);
  return value;
}
function pattern(value: unknown, at: string, expected: RegExp, what: string): string {
  check(typeof value === 'string' && expected.test(value), `${at} must be ${what}`);
  return value;
}
function formValue(value: unknown, at: string): string {
  check(typeof value === 'string' && value.length > 0 && value.length <= 500 && !/[\x00-\x1f\x7f]/.test(value), `${at} must be a form value of 1 to 500 printable characters`);
  return value;
}
function minutes(value: unknown, at: string, max: number): void {
  check(value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max), `${at} must be a whole number of minutes from 0 to ${max}`);
}
function member<K extends keyof typeof TA3_OQ_PLAN_MEMBERS>(value: unknown, at: string, key: K): Record<string, unknown> {
  const { required, optional } = TA3_OQ_PLAN_MEMBERS[key];
  return strictObject(value, at, required, optional);
}

/** Strict reading of a ta3-oq-plan/1. A refusal names the member, never a value the file held. */
export function parseTa3OqPlan(value: unknown, at = 'The TA3 OQ plan'): Ta3OqPlan {
  const plan = strictObject(value, at, TA3_OQ_PLAN_REQUIRED);
  check(plan.contract === TA3_OQ_PLAN_CONTRACT, `${at} contract must be ${TA3_OQ_PLAN_CONTRACT}`);
  // The OQ writes owned records into the study it names: only a synthetic study on a test stack (D-22).
  check(plan.synthetic === true, `${at} synthetic must be true: TA3 OQ suites run only against synthetic studies on test stacks`);
  pattern(plan.runLabel, `${at} runLabel`, RUN_LABEL, '1 to 40 letters, digits, dots, underscores or hyphens');

  const study = member(plan.study, `${at} study`, 'study');
  const studyId = positiveId(study.studyId, `${at} study.studyId`);
  positiveId(study.siteStudyId, `${at} study.siteStudyId`);
  pattern(study.expectedSpecHash, `${at} study.expectedSpecHash`, SHA256_HEX, 'the receipts\' spec hash, 64 lower-case hex digits');
  if (study.expectedCslReleaseId !== undefined) {
    check(typeof study.expectedCslReleaseId === 'string' && study.expectedCslReleaseId.trim().length > 0 && study.expectedCslReleaseId.length <= 200
      && !/[\x00-\x1f\x7f]/.test(study.expectedCslReleaseId), `${at} study.expectedCslReleaseId must be printable text of 1 to 200 characters`);
  }
  if (study.duplicateOf !== undefined) {
    check(positiveId(study.duplicateOf, `${at} study.duplicateOf`) !== studyId, `${at} study.duplicateOf names the study itself; the OQ study is a duplicate of another`);
  }

  const accounts = member(plan.accounts, `${at} accounts`, 'accounts');
  const variables: string[] = [];
  for (const role of ['operator', 'reviewer', 'thirdPerson', 'blinded', 'monitor'] as const) {
    if (accounts[role] === undefined) { variables.push(DEFAULT_OPERATOR.username); continue; }
    const account = member(accounts[role], `${at} accounts.${role}`, 'account');
    for (const key of ['username', 'password'] as const) {
      pattern(account[key], `${at} accounts.${role}.${key}`, ENVIRONMENT_NAME, 'the name of the environment variable that holds it (A-Z, digits, underscores)');
    }
    check(account.username !== account.password, `${at} accounts.${role} names one variable for the username and the password`);
    variables.push(String(account.username));
  }
  // Independence cases need five different people; the same username variable twice names one person.
  check(new Set(variables).size === variables.length, `${at} accounts name the same username variable for two accounts; the TA3 cases need five different people`);

  const saveRule = member(plan.saveRule, `${at} saveRule`, 'saveRule');
  pattern(saveRule.ruleId, `${at} saveRule.ruleId`, RULE_ID, 'a deviation spec rule id');
  for (const key of ['eventDefinitionId', 'crfVersionId', 'itemId'] as const) positiveId(saveRule[key], `${at} saveRule.${key}`);
  formValue(saveRule.violatingValue, `${at} saveRule.violatingValue`);
  formValue(saveRule.compliantValue, `${at} saveRule.compliantValue`);
  check(saveRule.violatingValue !== saveRule.compliantValue, `${at} saveRule states the same violating and compliant value`);
  calendarDay(saveRule.visitDate, `${at} saveRule.visitDate`);

  const absenceRule = member(plan.absenceRule, `${at} absenceRule`, 'absenceRule');
  pattern(absenceRule.ruleId, `${at} absenceRule.ruleId`, RULE_ID, 'a deviation spec rule id');
  check((ABSENCE_RULE_KINDS as readonly unknown[]).includes(absenceRule.kind), `${at} absenceRule.kind must be one of ${ABSENCE_RULE_KINDS.join(', ')}`);
  positiveId(absenceRule.eventDefinitionId, `${at} absenceRule.eventDefinitionId`);
  calendarDay(absenceRule.anchorDate, `${at} absenceRule.anchorDate`);

  if (plan.followUpTask !== null) positiveId(member(plan.followUpTask, `${at} followUpTask`, 'followUpTask').studyTaskId, `${at} followUpTask.studyTaskId`);

  if (plan.applicability !== null) {
    const applicability = member(plan.applicability, `${at} applicability`, 'applicability');
    check(Array.isArray(applicability.versions) && applicability.versions.length === 2, `${at} applicability.versions must state exactly two established versions`);
    const versions = applicability.versions.map((item, index) => {
      const version = member(item, `${at} applicability.versions[${index}]`, 'version');
      pattern(version.protocolVersion, `${at} applicability.versions[${index}].protocolVersion`, PROTOCOL_VERSION, 'a protocol version of 1 to 40 letters, digits, dots, underscores or hyphens');
      const effectiveFrom = calendarDay(version.effectiveFrom, `${at} applicability.versions[${index}].effectiveFrom`);
      if (version.ethicsApprovalDate !== undefined) {
        check(calendarDay(version.ethicsApprovalDate, `${at} applicability.versions[${index}].ethicsApprovalDate`) <= effectiveFrom,
          `${at} applicability.versions[${index}] takes effect before its ethics approval`);
      }
      return { protocolVersion: String(version.protocolVersion), effectiveFrom };
    });
    check(versions[0].protocolVersion !== versions[1].protocolVersion && versions[0].effectiveFrom < versions[1].effectiveFrom,
      `${at} applicability.versions must be two different versions, the first taking effect before the second`);
    pattern(applicability.versionedRuleId, `${at} applicability.versionedRuleId`, RULE_ID, 'a deviation spec rule id');
    const early = calendarDay(applicability.earlyEnrollmentDate, `${at} applicability.earlyEnrollmentDate`);
    check(early < calendarDay(applicability.lateEnrollmentDate, `${at} applicability.lateEnrollmentDate`),
      `${at} applicability.earlyEnrollmentDate must precede lateEnrollmentDate`);
  }

  minutes(member(plan.sweep, `${at} sweep`, 'sweep').maxWaitMinutes, `${at} sweep.maxWaitMinutes`, 60);
  const escalation = member(plan.escalation, `${at} escalation`, 'escalation');
  minutes(escalation.maxWaitMinutes, `${at} escalation.maxWaitMinutes`, 240);
  check((RECIPIENT_ROLES as readonly unknown[]).includes(escalation.recipientRole), `${at} escalation.recipientRole must be one of ${RECIPIENT_ROLES.join(', ')}`);
  pattern(escalation.recipientUsername, `${at} escalation.recipientUsername`, USERNAME, 'a username');
  return plan as unknown as Ta3OqPlan;
}

export interface LoadedTa3OqPlan {
  /** The absolute path read. */
  file: string;
  /** SHA-256 of the plan's bytes. */
  sha256: string;
  plan: Ta3OqPlan;
}

/** Reads a plan file (at most 1 MiB of JSON) and refuses one that breaks the contract. */
export function loadTa3OqPlan(file: string): LoadedTa3OqPlan {
  const resolved = path.resolve(file);
  let bytes: Buffer;
  try {
    const stat = fs.statSync(resolved);
    check(stat.isFile() && stat.size <= PLAN_BYTE_LIMIT, `The TA3 OQ plan ${resolved} is not a file of at most ${PLAN_BYTE_LIMIT} bytes.`);
    bytes = fs.readFileSync(resolved);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('The TA3 OQ plan ')) throw error;
    throw new Error(`The TA3 OQ plan ${resolved} cannot be read (${(error as NodeJS.ErrnoException).code ?? String(error)}).`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw new Error(`The TA3 OQ plan ${resolved} is not JSON.`); }
  return { file: resolved, sha256: sha256(bytes), plan: parseTa3OqPlan(parsed, `The TA3 OQ plan ${resolved}`) };
}

/** The account variables a plan names, the operator's defaulting to OQ_USERNAME and OQ_PASSWORD. */
export function ta3AccountVariables(plan: Ta3OqPlan): Record<Ta3Account, Ta3AccountVariables> {
  return { operator: plan.accounts.operator ?? DEFAULT_OPERATOR, reviewer: plan.accounts.reviewer, thirdPerson: plan.accounts.thirdPerson,
    blinded: plan.accounts.blinded, monitor: plan.accounts.monitor };
}

export function isTa3OqPlan(value: unknown): value is Ta3OqPlan {
  return isRecord(value) && value.contract === TA3_OQ_PLAN_CONTRACT;
}
