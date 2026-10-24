import { createHash, randomUUID } from 'node:crypto';
import { captureApiCall, isRecord, redactEvidenceSecrets, type EvidenceResult } from './evidence-capture';
import { authHeaders, login, tokenClaims } from './auth';
import { reviewed } from './pq-runner';
import { OQ_SUITES, TA3_OQ_SUITES, oqSuiteCaseIds } from '../config/oq-case-registry';
import { TA3_OQ_CASES, ta3OqCase, ta3RegulatoryRef, type Ta3Account, type Ta3OqCase } from '../config/ta3-oq-cases';
import { FLAT_DEVIATION_TABLES, TA3_INSPECTION_COVERAGE, W1_SEGMENTED_LIMITATION } from '../config/ta3-inspection-coverage';
import { ESCALATION_WAIT_DEFAULT_MINUTES, SWEEP_WAIT_DEFAULT_MINUTES, ta3AccountVariables, type Ta3OqPlan } from './ta3-oq-plan';
import { CONFIGURATION_MISMATCH_CODE, type DeclaredFlags, type TargetConfigurationFlag } from './target-configuration';

export { loadTa3OqPlan, parseTa3OqPlan, TA3_OQ_PLAN_CONTRACT, type Ta3OqPlan } from './ta3-oq-plan';

/**
 * OQ suites 13 to 18 (OQ-206 to OQ-244), the TA3 uses (TA3 plan VAL-1, spec P20
 * VD-5 and 3.4). They run against the designated armed study a ta3-oq-plan/1
 * names, a dedicated duplicate of the release (never the study O-7 scores), and
 * create and own only their own subjects, forms, deviations, applicability rows,
 * policy rows, milestones and documents, each labelled OQ-TA3-<run id>-<n>.
 *
 * Order (F-k): runners/oq-runner.ts calls runTa3Suites after the base suites'
 * owned-fixture cleanup and logout and before the login quota probe, which
 * leaves the caller's login bucket throttled. Each suite logs in the plan
 * accounts it needs and logs each of them out at its end. Before any use after a
 * wait, an account whose token expires within two minutes, or whose session has
 * been idle for more than 25 minutes, logs in again (EDC defaults: a one-hour
 * token, a 30-minute idle timeout); a 401 gets one new login and one retry; a
 * transport error on a write is never resent. Suite 16 (escalation, the longest
 * wait) runs last.
 *
 * Outcomes (VD-5, F-p): a case whose feature is absent at the release or off at
 * the target fails with its code, never passes or skips; a case whose setup
 * cannot be made is recorded not executed (method CONTRACT) with its code. A
 * refusal is classified by status and code together, and each classification is
 * cross-checked against the declared configuration (CONFIGURATION_MISMATCH).
 */

export const TA3_OUTCOME = {
  // Failed: the release or the target answered.
  ENGINE_DISABLED: 'ENGINE_DISABLED',
  FEATURE_DISABLED_AT_TARGET: 'FEATURE_DISABLED_AT_TARGET',
  FEATURE_ABSENT_AT_RELEASE: 'FEATURE_ABSENT_AT_RELEASE',
  CONFIGURATION_MISMATCH: CONFIGURATION_MISMATCH_CODE,
  SWEEP_NOT_OBSERVED: 'SWEEP_NOT_OBSERVED',
  TASK_NOT_OBSERVED: 'TASK_NOT_OBSERVED',
  // Not executed: a setup, selection or exposure gap, never a release result.
  NO_TA3_PLAN: 'NO_TA3_PLAN',
  OQ_SUITE_NOT_SELECTED: 'OQ_SUITE_NOT_SELECTED',
  ACCOUNT_LOGIN_FAILED: 'ACCOUNT_LOGIN_FAILED',
  TRAINING_NOT_CURRENT: 'TRAINING_NOT_CURRENT',
  ESIGNATURE_NOT_ACKNOWLEDGED: 'ESIGNATURE_NOT_ACKNOWLEDGED',
  RECIPIENT_UNAVAILABLE: 'RECIPIENT_UNAVAILABLE',
  ESCALATION_WINDOW_NOT_WAITED: 'ESCALATION_WINDOW_NOT_WAITED',
  VERSION_FIXTURE_ABSENT: 'VERSION_FIXTURE_ABSENT',
  DUE_AT_REFUSED: 'DUE_AT_REFUSED',
  NO_TARGET_CONFIGURATION: 'NO_TARGET_CONFIGURATION',
  SEGMENTED_READ_NOT_EXPOSED: 'SEGMENTED_READ_NOT_EXPOSED',
  SWEEP_RACED: 'SWEEP_RACED',
  FOLLOW_UP_TASK_NOT_CONFIGURED: 'FOLLOW_UP_TASK_NOT_CONFIGURED',
  OPERATOR_NOT_UNBLINDED: 'OPERATOR_NOT_UNBLINDED',
  PREREQUISITE_MISSING: 'PREREQUISITE_MISSING',
} as const;
export type Ta3OutcomeCode = typeof TA3_OUTCOME[keyof typeof TA3_OUTCOME];
const OUTCOME = TA3_OUTCOME;

/** The signature meanings these cases expect, as the EDC defines them
 * (libreclinicaapi src/middleware/part11.middleware.ts); npm run test:cross-repo compares them. */
export const EDC_SIGNATURE_MEANINGS = {
  DEVIATION_ASSESSMENT_MEANING: 'I reviewed this exact protocol deviation record, its source and the protocol requirement it cites, and determine its disposition and importance as stated',
  DEVIATION_CLOSURE_MEANING: 'I reviewed this exact protocol deviation, its current assessment and its corrective-action or not-a-deviation evidence, and authorize its closure as stated',
} as const;

/** The deviation sweep evaluates as the system actor, user 1 (deviation-sweep.service.ts). */
export const SYSTEM_ACTOR_ID = 1;
/** The study-task cron runs every minute; its stages (domain events, sweep, escalations) run once per cycle. */
export const CRON_CYCLE_MS = 60_000;
/** Waits poll every 30 seconds within the plan's bounds. */
export const DEFAULT_POLL_MS = 30_000;
/** A save's evaluation runs after COMMIT (deviation-evaluation-queue.ts); the reads drain it within this bound. */
const SAVE_EVALUATION_WAIT_MS = 120_000;
const RELOGIN_BEFORE_EXPIRY_MS = 2 * 60_000;
const RELOGIN_AFTER_IDLE_MS = 25 * 60_000;
/** The EDC ends a session idle for 30 minutes (SESSION_TIMEOUT_MINUTES, libreclinicaapi src/config/environment.ts). */
const SESSION_IDLE_TIMEOUT_MS = 30 * 60_000;
/** A level-1 assessment escalation needs an hour of wall time (afterHours 1) plus the cron and a margin. */
export const ESCALATION_ASSESSMENT_WAIT_MINUTES = 70;
/** An overdue corrective action escalates within three cycles (afterHoursPastDue 0). */
export const ESCALATION_CORRECTIVE_WAIT_MINUTES = 4;
const DOCUMENT_BYTE_LIMIT = 32 * 1024 * 1024;
const RECEIPT_BYTE_LIMIT = 64 * 1024 * 1024;
const COPY_BYTE_LIMIT = 256 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;
const LONG_REQUEST_TIMEOUT_MS = 600_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const ROUTE_NOT_FOUND = /^Route (GET|POST|PUT|PATCH|DELETE) \S+ not found$/;
/** The flat inspection route's refusal of any member but requestKey and includeTraining (regulatory-export.controller.ts). */
const FLAT_COPY_MEMBER_REFUSAL = 'Supply a UUID requestKey and optional boolean includeTraining';
/** The role names the EDC accepts for each escalation recipient role (libreclinicaapi src/middleware/authorization.middleware.ts ROLE_ALIASES). */
const RECIPIENT_ROLE_NAMES: Record<string, readonly string[]> = {
  investigator: ['investigator', 'site_investigator'],
  data_manager: ['data_manager', 'study_coordinator', 'site_study_coordinator', 'director', 'study_director', 'site_study_director'],
  monitor: ['monitor', 'site_monitor'],
  coordinator: ['coordinator', 'clinical_research_coordinator', 'crc', 'ra', 'ra2', 'data_entry', 'data_entry_person', 'site_data_entry_person', 'site_data_entry_person2', 'user'],
};

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const nativeId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------
// Document checks, pure (also run on retained EDC bytes in the contract tests)
// ---------------------------------------------------------------------------

/** Where a measurement document carries arm-grouped content, which the EDC writes
 * only for the per-study unblinded role (libreclinicaapi milestone-measurement,
 * effort-ledger and latency-measurement services): allocation counts, per-arm
 * target dates, per-arm first dosing, windows ending at per-arm first dosing that
 * are not withheld, and arm-grouped latency. An arm id that only scopes a
 * milestone (an IRB or contract per arm) is no treatment assignment and is not
 * listed. An empty list is a document a blinded reader may hold (D-25). */
export function armGroupedContent(document: unknown): string[] {
  const found: string[] = [];
  const walk = (value: unknown, at: string, parentKey: string) => {
    if (Array.isArray(value)) { value.forEach((item, index) => walk(item, `${at}[${index}]`, parentKey)); return; }
    if (!isRecord(value)) return;
    if (value.metric === 'arm-may-proceed-to-first-dosed' && !['withheld', 'unknown'].includes(String(value.status))) {
      found.push(`${at} (a window ending at per-arm first dosing, status ${String(value.status)})`);
    }
    for (const [key, item] of Object.entries(value)) {
      const where = `${at}.${key}`;
      if (key === 'byArm' || key === 'allocated') found.push(where);
      else if (key === 'arm' && item !== null && item !== undefined) found.push(where);
      else if (key === 'targetReachedAt' && item !== 'withheld') found.push(where);
      else if (key === 'arms' && parentKey === 'firstDosed' && item !== 'withheld') found.push(where);
      walk(item, where, key);
    }
  };
  walk(document, '$', '');
  return found;
}

/** The required top-level members of edc-ta3-ledger/1 (spec P01 3.2). Once M-2 lands,
 * npm run test:cross-repo compares them with the EDC's
 * src/services/data-factory/contracts/edc-ta3-ledger-v1.schema.json. */
export const TA3_LEDGER_CONTRACT = 'edc-ta3-ledger/1';
export const TA3_LEDGER_REQUIRED = [
  'schemaVersion', 'studyId', 'date', 'asOf', 'feedPosition', 'snapshot', 'armGrouping', 'requestKind', 'dataClass', 'installationId',
  'decisions', 'census', 'arms', 'sites', 'milestones', 'intervals', 'ta3Intervals', 'effort', 'pointers', 'bands', 'definitions', 'limitations',
] as const;

/** What OQ-237 finds wrong with a TA3 ledger document: its contract, a missing required
 * member, a snapshot that is not one read-only snapshot, and, for a blinded reader,
 * arm-grouped content. Empty when it conforms. */
export function ta3LedgerProblems(document: unknown, options: { required?: readonly string[]; blinded?: boolean } = {}): string[] {
  if (!isRecord(document)) return ['the ledger is not a JSON object'];
  const problems: string[] = [];
  if (document.schemaVersion !== TA3_LEDGER_CONTRACT) problems.push(`schemaVersion is ${JSON.stringify(document.schemaVersion)}, not ${TA3_LEDGER_CONTRACT}`);
  const missing = (options.required ?? TA3_LEDGER_REQUIRED).filter(key => !Object.prototype.hasOwnProperty.call(document, key));
  if (missing.length) problems.push(`it lacks ${missing.join(', ')}`);
  const snapshot = document.snapshot;
  if (!isRecord(snapshot) || snapshot.isolation !== 'repeatable-read-read-only' || snapshot.single !== true) {
    problems.push('snapshot does not state one repeatable-read read-only snapshot');
  }
  if (!['withheld', 'included'].includes(String(document.armGrouping))) problems.push(`armGrouping is ${JSON.stringify(document.armGrouping)}`);
  if (options.blinded) {
    if (document.armGrouping !== 'withheld') problems.push('a blinded reader received a document whose armGrouping is not withheld');
    const grouped = armGroupedContent(document);
    if (grouped.length) problems.push(`a blinded reader received arm-grouped content at ${grouped.slice(0, 5).join(', ')}`);
  }
  return problems;
}

/** What is wrong with a retained measurement document's exact bytes: not JSON, another
 * contract, or a SHA-256 that differs from the one the EDC stated for them. */
export function retainedDocumentProblems(bytes: Buffer, expected: { schemaVersion: string | readonly string[]; sha256?: readonly (string | undefined)[] }): string[] {
  const problems: string[] = [];
  const digest = sha256(bytes);
  for (const stated of expected.sha256 ?? []) {
    if (stated !== undefined && stated !== digest) problems.push(`the bytes hash to ${digest}, not the stated ${stated}`);
  }
  let document: unknown;
  try { document = JSON.parse(bytes.toString('utf8')); } catch { return [...problems, 'the bytes are not JSON']; }
  const contracts: readonly string[] = typeof expected.schemaVersion === 'string' ? [expected.schemaVersion] : expected.schemaVersion;
  if (!isRecord(document) || !contracts.includes(String(document.schemaVersion))) {
    problems.push(`the document is not ${contracts.join(' or ')} (schemaVersion ${JSON.stringify(isRecord(document) ? document.schemaVersion : undefined)})`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Sessions, exchanges and case records
// ---------------------------------------------------------------------------

export interface Ta3Clock { now(): number; sleep(ms: number): Promise<void> }
export const SYSTEM_CLOCK: Ta3Clock = { now: () => Date.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };

export interface Ta3RunOptions {
  /** The flags of the run's validation-target-configuration/1 declaration (suite 18, CONFIGURATION_MISMATCH notes). */
  declaredFlags?: DeclaredFlags;
  /** Where the plan's credential variables are read; the process environment by default. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Tests only: a controlled clock and a short poll interval. */
  clock?: Ta3Clock;
  pollIntervalMs?: number;
}

class Ta3Stop extends Error {
  constructor(readonly kind: 'failed' | 'not-executed', readonly code: string | undefined, message: string) { super(message); }
}
function fail(message: string, code?: string): never { throw new Ta3Stop('failed', code, message); }
function notExecuted(code: string, message: string): never { throw new Ta3Stop('not-executed', code, message); }
function demand(condition: unknown, message: string, code?: string): asserts condition { if (!condition) fail(message, code); }
function prerequisite(caseId: string, what: string): never {
  return notExecuted(OUTCOME.PREREQUISITE_MISSING, `${what} from ${caseId} is absent: that case failed, did not execute or was not selected.`);
}

interface Reply {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  /** The exact bytes of a digest read, which the evidence keeps only as their count and SHA-256. */
  bytes?: Buffer;
  sha256?: string;
  captureError?: string;
}

interface CallOptions {
  /** Keep the exact response bytes in memory and only their count and SHA-256 in the evidence. */
  digest?: boolean;
  maxBytes?: number;
  /** A clinical write the training gate decides (enrollment, scheduling, a form save). */
  clinical?: boolean;
  /** The request carries a Part 11 signature (password re-entry). */
  signed?: boolean;
  multipart?: { field: string; filename: string; contentType: string; bytes: Buffer };
  timeoutMs?: number;
  /** Hand a write's transport error back to the case, which reconciles it by reading. */
  reconcileWrite?: boolean;
}

const dataOf = (reply: Reply): any => (isRecord(reply.body) ? reply.body.data : undefined);
const messageOf = (reply: Reply): string => (isRecord(reply.body) && typeof reply.body.message === 'string' ? reply.body.message : '');
function codeOf(reply: Reply): string | undefined {
  const body = isRecord(reply.body) ? reply.body : {};
  const code = body.code ?? (isRecord(body.error) ? body.error.code : undefined) ?? (isRecord(body.details) ? body.details.code : undefined);
  return typeof code === 'string' ? code : undefined;
}

/** A 400 that refuses a request member a later item adds: the route's validation names the
 * member as unknown, or the flat inspection route refuses any other member. */
function refusesMember(reply: Reply, member: string): boolean {
  const body = isRecord(reply.body) ? reply.body : {};
  const errors = Array.isArray(body.errors) ? body.errors : [];
  if (errors.some(error => isRecord(error) && error.field === member && /unknown|not allowed/i.test(`${error.type ?? ''} ${error.message ?? ''}`))) return true;
  return member === 'profile' && body.message === FLAT_COPY_MEMBER_REFUSAL;
}

/** VD-5 and F-p: what a refusal says about the release and the target, by status and code
 * together. The engine's own 503 carries no code and names ENABLE_DEVIATION_ENGINE; the O-1,
 * O-2 and W-1 flags answer 503 with their code; an unknown route answers the error handler's
 * 404 `Route <METHOD> <path> not found`; any other 404 or 400 is an ordinary failure. */
export function refusalCode(reply: { status: number; body: unknown }, member?: string): Ta3OutcomeCode | undefined {
  const asReply = { headers: {}, ...reply };
  const code = codeOf(asReply), message = messageOf(asReply);
  if (reply.status === 503 && !code && /ENABLE_DEVIATION_ENGINE/.test(message)) return OUTCOME.ENGINE_DISABLED;
  if (reply.status === 503 && (code === 'DEVIATION_DECISIONS_DISABLED' || code === 'SEGMENTED_INSPECTION_EXPORT_DISABLED')) return OUTCOME.FEATURE_DISABLED_AT_TARGET;
  if (reply.status === 404 && ROUTE_NOT_FOUND.test(message)) return OUTCOME.FEATURE_ABSENT_AT_RELEASE;
  if (reply.status === 400 && member && refusesMember(asReply, member)) return OUTCOME.FEATURE_ABSENT_AT_RELEASE;
  return undefined;
}

/** A training refusal of a clinical write (libreclinicaapi training-duty-readiness.ts):
 * 409 TRAINING_DUTY_INCOMPLETE, or 503 when readiness cannot be verified. */
function trainingRefusal(reply: Reply): string | null {
  const code = codeOf(reply);
  if (reply.status === 409 && (code === 'TRAINING_DUTY_INCOMPLETE' || /training/i.test(messageOf(reply)))) return `HTTP 409 ${code ?? messageOf(reply)}`;
  if (reply.status === 503 && typeof code === 'string' && code.startsWith('TRAINING_READINESS_')) return `HTTP 503 ${code}`;
  return null;
}

class Ta3Session {
  token: string | null = null;
  userId: number | null = null;
  failure: string | null = null;
  trainingRefused: string | null = null;
  lastUsedAt = 0;
  private expiresAt: number | null = null;
  private logins = 0;
  readonly exchanges: EvidenceResult[] = [];
  logoutFailures = 0;
  /** Sessions the EDC had already ended when they were released (expired or idle), so no logout was sent. */
  readonly ended: string[] = [];

  constructor(private readonly ctx: Ta3Context, readonly account: Ta3Account, readonly username: string,
    readonly password: string, private readonly variables: { username: string; password: string }) {}

  async open(reason: string): Promise<boolean> {
    if (!this.username || !this.password) {
      this.failure = `the environment variables ${this.variables.username} and ${this.variables.password} do not both hold a value`;
      return false;
    }
    this.logins++;
    const { evidence, session } = await login(this.ctx.baseUrl, this.username, this.password, `OQ-TA3-${this.account}-LOGIN-${this.logins}`);
    evidence.notes = `${this.account} login (${reason}): ${evidence.notes}`;
    this.exchanges.push(evidence);
    if (!session) {
      this.token = null;
      this.failure = `login answered HTTP ${evidence.responseStatus}${evidence.captureError ? ` (${evidence.captureError})` : ''}`;
      return false;
    }
    const exp = tokenClaims(session.token)?.exp;
    this.token = session.token;
    this.userId = session.userId;
    this.expiresAt = typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
    this.lastUsedAt = this.ctx.clock.now();
    this.failure = null;
    return true;
  }

  /** Before any use: a token that expires within two minutes, or a session idle for more
   * than 25 minutes, logs in again. */
  async ensureFresh(): Promise<void> {
    if (!this.token) notExecuted(OUTCOME.ACCOUNT_LOGIN_FAILED, `The ${this.account} account has no session (${this.failure ?? 'not opened'}).`);
    const now = this.ctx.clock.now();
    if (this.expiresAt !== null && this.expiresAt - now < RELOGIN_BEFORE_EXPIRY_MS) await this.renew('its token expires within two minutes');
    else if (now - this.lastUsedAt > RELOGIN_AFTER_IDLE_MS) await this.renew('its session was idle for more than 25 minutes');
  }

  async renew(reason: string): Promise<void> {
    await this.logout(`before a new login: ${reason}`, false);
    if (!await this.open(reason)) notExecuted(OUTCOME.ACCOUNT_LOGIN_FAILED, `The ${this.account} account could not log in again (${this.failure}).`);
  }

  /** Releases this exact session. At the end of a suite a failed logout fails the suite's session row. A
   * session the EDC has already ended (its token expired, or idle past the 30-minute timeout) is not
   * logged out again: that request could only be refused. */
  async logout(reason: string, counted: boolean): Promise<void> {
    if (!this.token) return;
    const now = this.ctx.clock.now();
    if ((this.expiresAt !== null && this.expiresAt <= now) || now - this.lastUsedAt > SESSION_IDLE_TIMEOUT_MS) {
      this.token = null;
      this.ended.push(reason);
      return;
    }
    const exchange = await captureApiCall({ testCaseId: `OQ-TA3-${this.account}-LOGOUT-${this.logins}`, method: 'POST', url: '/api/auth/logout',
      baseUrl: this.ctx.baseUrl, headers: authHeaders(this.token), timeoutMs: REQUEST_TIMEOUT_MS });
    exchange.requestHeaders = { ...exchange.requestHeaders, Authorization: '[redacted]' };
    exchange.notes = `${this.account} logout (${reason}): HTTP ${exchange.responseStatus}`;
    this.exchanges.push(exchange);
    if (counted && exchange.responseStatus !== 200) this.logoutFailures++;
    this.token = null;
  }
}

class CaseRun {
  readonly exchanges: EvidenceResult[] = [];
  readonly facts: Record<string, unknown> = {};
  readonly remarks: string[] = [];
  constructor(readonly ctx: Ta3Context, readonly caseId: string) {}

  remark(text: string): void { this.remarks.push(text); }

  async call(session: Ta3Session, method: string, path: string, body?: unknown, options: CallOptions = {}): Promise<Reply> {
    if (options.clinical && session.trainingRefused) {
      notExecuted(OUTCOME.TRAINING_NOT_CURRENT, `An earlier clinical write by the ${session.account} account was refused for training (${session.trainingRefused}).`);
    }
    await session.ensureFresh();
    let reply = await this.exchange(session, method, path, body, options);
    if (reply.status === 401 && !reply.captureError) {
      // Refused before processing, so one new login and one retry change nothing twice.
      await session.renew(`HTTP 401 on ${method} ${path}`);
      reply = await this.exchange(session, method, path, body, options);
    }
    if (reply.captureError) {
      if (method !== 'GET') {
        if (options.reconcileWrite) return reply;
        fail(`Transport error on ${method} ${path} (${reply.captureError}); a write is never resent.`);
      }
      reply = await this.exchange(session, method, path, body, options);
      if (reply.captureError) fail(`Transport error on GET ${path}, twice (${reply.captureError}).`);
    }
    session.lastUsedAt = this.ctx.clock.now();
    if (options.clinical) {
      const refusal = trainingRefusal(reply);
      if (refusal) {
        session.trainingRefused = refusal;
        notExecuted(OUTCOME.TRAINING_NOT_CURRENT, `The ${session.account} account's clinical write ${method} ${path} was refused (${refusal}): its training for this duty is not current and independently verified, a setup gap and not a release result.`);
      }
    }
    if (options.signed && reply.status === 403 && codeOf(reply) === 'ESIG_ACKNOWLEDGEMENT_REQUIRED') {
      notExecuted(OUTCOME.ESIGNATURE_NOT_ACKNOWLEDGED, `The ${session.account} account has not acknowledged the electronic signature policy (21 CFR 11.100(c)), so its signed ${method} ${path} was refused before the decision.`);
    }
    return reply;
  }

  private async exchange(session: Ta3Session, method: string, path: string, body: unknown, options: CallOptions): Promise<Reply> {
    const raw = await captureApiCall({
      testCaseId: `${this.caseId}-${this.exchanges.length + 1}`, method, url: path, baseUrl: this.ctx.baseUrl, headers: authHeaders(session.token ?? ''),
      ...(options.multipart ? { multipart: options.multipart } : { body }),
      ...(options.digest ? { responseFormat: 'binary' as const, maxResponseBytes: options.maxBytes ?? DOCUMENT_BYTE_LIMIT } : {}),
      timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    });
    let bytes: Buffer | undefined, parsed: unknown = raw.responseBody;
    if (options.digest && isRecord(raw.responseBody) && raw.responseBody.encoding === 'base64' && typeof raw.responseBody.content === 'string') {
      bytes = Buffer.from(raw.responseBody.content, 'base64');
      const { content: _content, ...digest } = raw.responseBody;
      raw.responseBody = digest;
      try { parsed = JSON.parse(bytes.toString('utf8')); } catch { parsed = undefined; }
    }
    // Retained evidence never holds a credential or a session token.
    raw.requestHeaders = { ...raw.requestHeaders, Authorization: '[redacted]' };
    raw.requestBody = redactEvidenceSecrets(raw.requestBody);
    raw.notes = `${session.account}: ${raw.notes}`;
    this.exchanges.push(raw);
    return { status: raw.responseStatus, body: parsed, headers: raw.responseHeaders ?? {},
      ...(bytes ? { bytes, sha256: sha256(bytes) } : {}), ...(raw.captureError ? { captureError: raw.captureError } : {}) };
  }

  /** The reply has one of the statuses; otherwise the case fails with the code its refusal shows. */
  expect(reply: Reply, statuses: readonly number[], what: string, member?: string): void {
    if (statuses.includes(reply.status) && !(reply.status < 400 && isRecord(reply.body) && reply.body.success === false)) return;
    const message = messageOf(reply);
    fail(`${what}: expected HTTP ${statuses.join(' or ')}, got ${reply.status}${message ? ` (${message.slice(0, 300)})` : ''}.`, refusalCode(reply, member));
  }
}

type Owned = { kind: string; id: string | number; label?: string; caseId: string };
interface Receipt { evaluationId: string; actorId: number | null; specHash: string | null; evaluatedAt: string; outcomes: unknown[] }
interface OwnedVisit { subjectId: number; visitId: number; eventCrfId: number; crfId: number }
interface RetainedRecord { id: number; contentHash: string; armGrouping: string; requestKey: string; sha256: string; document: unknown }

interface Ta3Facts {
  save?: OwnedVisit & { receipt: Receipt; deviationId: number };
  /** Owned manual deviations by purpose. */
  deviations: Record<string, number>;
  manualSubject?: number;
  documents: Partial<Record<'milestone' | 'effort' | 'latency' | 'ledger', RetainedRecord>>;
  copy?: { packageId: string; sha256: string; packet: Record<string, unknown> };
  segmentedPackageId?: string;
  policy?: { rowId: string };
  /** Plan items whose feature this run observed at the target (OQ-241's late tables). */
  observedItems: Set<string>;
  escalations: Array<{ deviationId: number; event: Record<string, any> }>;
}

class Ta3Context {
  readonly runId = randomUUID();
  readonly clock: Ta3Clock;
  readonly pollMs: number;
  readonly results = new Map<string, EvidenceResult>();
  readonly sessions = new Map<Ta3Account, Ta3Session>();
  readonly owned: Owned[] = [];
  readonly facts: Ta3Facts = { deviations: {}, documents: {}, observedItems: new Set(), escalations: [] };
  /** Observed once per run by the first case that needs the engine. */
  engine: 'on' | 'off' | undefined;
  /** What this run observed of O-1: its record fields and decision routes. */
  o1: 'present' | 'absent' | 'disabled' | undefined;
  /** What this run observed of O-2: its policy route and command. */
  o2: 'present' | 'absent' | 'disabled' | undefined;
  private labels = 0;

  constructor(readonly baseUrl: string, readonly plan: Ta3OqPlan, readonly options: Ta3RunOptions) {
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  }

  get site(): number { return this.plan.study.siteStudyId; }
  get root(): number { return this.plan.study.studyId; }

  /** The label of the next owned record: OQ-TA3-<first 8 hex of the run id>-<n>. */
  label(): string { return `OQ-TA3-${this.runId.slice(0, 8)}-${++this.labels}`; }
  own(kind: string, id: string | number, caseId: string, label?: string): void { this.owned.push({ kind, id, caseId, ...(label ? { label } : {}) }); }

  session(account: Ta3Account): Ta3Session {
    const session = this.sessions.get(account);
    if (!session) throw new Error(`No ${account} session was opened for this suite.`);
    return session;
  }

  declared(flag: TargetConfigurationFlag): unknown { return this.options.declaredFlags?.[flag]; }

  /** VD-5: a flag declared on but answered off, or declared off but answered on, is noted. */
  crossCheck(run: CaseRun, flag: TargetConfigurationFlag, observedOn: boolean): void {
    const declared = this.declared(flag);
    if (typeof declared === 'boolean' && declared !== observedOn) {
      run.remark(`${CONFIGURATION_MISMATCH_CODE}: ${flag} is declared ${declared} but the target answered it ${observedOn ? 'on' : 'off'}.`);
    }
  }

  async runCase(id: string, body: (run: CaseRun) => Promise<string>, existing?: CaseRun): Promise<void> {
    const entry = ta3OqCase(id), run = existing ?? new CaseRun(this, id);
    let passed = false, notes: string, code: string | undefined, contract = false;
    try {
      for (const account of entry.accounts) {
        const session = this.sessions.get(account);
        if (!session?.token) {
          notExecuted(OUTCOME.ACCOUNT_LOGIN_FAILED, `The ${account} account did not log in (${session?.failure ?? 'no session was opened'}), so the case cannot act as it.`);
        }
      }
      notes = await body(run);
      passed = true;
    } catch (error) {
      if (error instanceof Ta3Stop) { notes = error.message; code = error.code; contract = error.kind === 'not-executed'; }
      else notes = `Unexpected TA3 case error: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.results.set(id, caseRecord(entry, run, passed, [notes, ...run.remarks].join(' '), code, contract, this.clock));
  }
}

function caseRecord(entry: Ta3OqCase, run: CaseRun, passed: boolean, notes: string, code: string | undefined, contract: boolean, clock: Ta3Clock): EvidenceResult {
  const first = run.exchanges[0];
  const transport = run.exchanges.find(exchange => exchange.captureError)?.captureError;
  return {
    testCaseId: entry.id,
    timestamp: first?.timestamp ?? new Date(clock.now()).toISOString(),
    endpoint: first?.endpoint ?? 'N/A',
    // CONTRACT marks a case not executed; a failed case without an exchange of its own says so.
    method: contract ? 'CONTRACT' : first?.method ?? 'NONE',
    responseStatus: first?.responseStatus ?? 0,
    responseBody: Object.keys(run.facts).length ? redactEvidenceSecrets(run.facts) : null,
    passed,
    notes,
    ...(code ? { outcomeCode: code } : {}),
    ...(!passed && !contract && transport ? { captureError: transport } : {}),
    regulatoryRef: ta3RegulatoryRef(entry),
    testDescription: `${entry.title} (needs: ${entry.needs})`,
    acceptanceCriteria: entry.expectedResult,
    ...(run.exchanges.length ? { relatedEvidence: run.exchanges } : {}),
  };
}

/** A case recorded not executed without any request. */
function contractRecord(entry: Ta3OqCase, code: string, notes: string, clock: Ta3Clock): EvidenceResult {
  return {
    testCaseId: entry.id, timestamp: new Date(clock.now()).toISOString(), endpoint: 'N/A', method: 'CONTRACT', responseStatus: 0,
    responseBody: null, passed: false, notes, outcomeCode: code, regulatoryRef: ta3RegulatoryRef(entry),
    testDescription: `${entry.title} (needs: ${entry.needs})`, acceptanceCriteria: entry.expectedResult,
  };
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/** The order the suites run in: escalation (16), the longest wait, last. */
export const TA3_SUITE_ORDER: readonly number[] = [13, 14, 15, 17, 18, 16];

/** Runs the selected TA3 suites against the study `plan` names and returns one record for every
 * case OQ-206 to OQ-244, plus one session row per suite that ran. Without a plan no request is
 * made: every selected case records NO_TA3_PLAN, every other OQ_SUITE_NOT_SELECTED. */
export async function runTa3Suites(baseUrl: string, plan: Ta3OqPlan | null, selection: readonly number[], options: Ta3RunOptions = {}): Promise<EvidenceResult[]> {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const selected = new Set(selection.filter(suite => TA3_OQ_SUITES.includes(suite)));
  if (!plan) {
    return TA3_OQ_CASES.map(entry => selected.has(entry.suite)
      ? contractRecord(entry, OUTCOME.NO_TA3_PLAN, 'No ta3-oq-plan/1 was given (--ta3-oq-plan), so no designated armed study is named; no request was made.', clock)
      : contractRecord(entry, OUTCOME.OQ_SUITE_NOT_SELECTED, `Suite ${entry.suite} was not selected (--oq-suites); no request was made.`, clock));
  }
  const ctx = new Ta3Context(baseUrl, plan, options);
  const variables = ta3AccountVariables(plan);
  const env = options.env ?? process.env;
  const usernames = new Map<string, Ta3Account>();
  for (const [account, names] of Object.entries(variables) as Array<[Ta3Account, { username: string; password: string }]>) {
    const username = env[names.username] ?? '';
    // Five different people: the independence cases mean nothing when two accounts are one person.
    if (username && usernames.has(username)) {
      throw new Error(`The TA3 plan's ${usernames.get(username)} and ${account} accounts are the same user; the TA3 cases need five different people.`);
    }
    if (username) usernames.set(username, account);
  }
  const rows: EvidenceResult[] = [];
  for (const suite of TA3_SUITE_ORDER) {
    if (!selected.has(suite)) continue;
    const accounts = [...new Set(TA3_OQ_CASES.filter(entry => entry.suite === suite).flatMap(entry => entry.accounts))];
    ctx.sessions.clear();
    for (const account of accounts) {
      const names = variables[account];
      const session = new Ta3Session(ctx, account, env[names.username] ?? '', env[names.password] ?? '', names);
      ctx.sessions.set(account, session);
      await session.open(`suite ${suite}`);
    }
    const ownedBefore = ctx.owned.length;
    try { await SUITES[suite](ctx); }
    catch (error) {
      // A suite never loses its cases: whatever did not record is recorded as not executed below.
      console.error(`  TA3 suite ${suite} stopped: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      for (const session of ctx.sessions.values()) await session.logout('end of suite', true);
    }
    const sessions = [...ctx.sessions.values()];
    const failedLogins = sessions.filter(session => session.failure);
    const failedLogouts = sessions.reduce((count, session) => count + session.logoutFailures, 0);
    const suiteInfo = OQ_SUITES.find(entry => entry.suite === suite)!;
    rows.push({
      testCaseId: `OQ-TA3-SUITE-${suite}`, timestamp: new Date(clock.now()).toISOString(), endpoint: '/api/auth/login', method: 'POST',
      responseStatus: 0, passed: failedLogins.length === 0 && failedLogouts === 0,
      notes: `TA3 suite ${suite} (${suiteInfo.title}) sessions and owned records, run ${ctx.runId} (${plan.runLabel}). `
        + (failedLogins.length ? `Accounts without a session: ${failedLogins.map(session => `${session.account} (${session.failure})`).join('; ')}. ` : 'Every account logged in. ')
        + (failedLogouts ? `${plural(failedLogouts, 'logout')} not answered 200.` : 'Every session was logged out.')
        + sessions.filter(session => session.ended.length).map(session => ` The ${session.account} session had already ended at the EDC (${session.ended.join('; ')}), so no logout was sent.`).join(''),
      responseBody: {
        runId: ctx.runId, runLabel: plan.runLabel, study: plan.study,
        accounts: Object.fromEntries(sessions.map(session => [session.account, { username: session.username || null, userId: session.userId }])),
        owned: ctx.owned.slice(ownedBefore),
      },
      relatedEvidence: sessions.flatMap(session => session.exchanges),
    });
  }
  const records = TA3_OQ_CASES.map(entry => ctx.results.get(entry.id) ?? (selected.has(entry.suite)
    ? contractRecord(entry, OUTCOME.PREREQUISITE_MISSING, `Suite ${entry.suite} stopped before this case recorded a result; see OQ-TA3-SUITE-${entry.suite}.`, clock)
    : contractRecord(entry, OUTCOME.OQ_SUITE_NOT_SELECTED, `Suite ${entry.suite} was not selected (--oq-suites); no request was made.`, clock)));
  return [...records, ...rows];
}

/** The registry IDs of the TA3 suites, for callers that check the census. */
export function ta3CaseIds(): string[] {
  return OQ_SUITES.filter(suite => TA3_OQ_SUITES.includes(suite.suite)).flatMap(oqSuiteCaseIds);
}

// ---------------------------------------------------------------------------
// Shared steps against the EDC routes (libreclinicaapi src/routes)
// ---------------------------------------------------------------------------

/** The engine state (GET /api/deviation-engine/spec): observed once while it is on; while it is off every
 * case reads it again, so each ENGINE_DISABLED failure carries its own refusal. */
async function requireEngine(run: CaseRun, session: Ta3Session): Promise<void> {
  const { ctx } = run;
  if (ctx.engine !== 'on') {
    const reply = await run.call(session, 'GET', `/api/deviation-engine/spec?studyId=${ctx.root}`);
    if (refusalCode(reply) === OUTCOME.ENGINE_DISABLED) ctx.engine = 'off';
    else if (reply.status === 200) ctx.engine = 'on';
  }
  if (ctx.engine === 'off') {
    fail('Every engine route answers HTTP 503 naming ENABLE_DEVIATION_ENGINE: the engine is off at the target.', OUTCOME.ENGINE_DISABLED);
  }
}

async function enrollOwned(run: CaseRun, session: Ta3Session, enrollmentDate: string): Promise<number> {
  const label = run.ctx.label();
  const reply = await run.call(session, 'POST', '/api/subjects', { studyId: run.ctx.site, label, enrollmentDate, enrollmentStatus: 'enrolled',
    autoScheduleVisits: false }, { clinical: true });
  run.expect(reply, [201], `Enrolling the owned subject ${label}`);
  const id = dataOf(reply)?.studySubjectId;
  demand(nativeId(id), `Enrolling ${label} returned no studySubjectId.`);
  run.ctx.own('subject', id, run.caseId, label);
  return id;
}

/** An owned subject with the plan's visit scheduled and its form located. */
async function ownedVisit(run: CaseRun, session: Ta3Session, enrollmentDate: string): Promise<OwnedVisit> {
  const { saveRule } = run.ctx.plan;
  const subjectId = await enrollOwned(run, session, enrollmentDate);
  const scheduled = await run.call(session, 'POST', '/api/events/schedule', { studySubjectId: subjectId, studyEventDefinitionId: saveRule.eventDefinitionId,
    scheduledDate: saveRule.visitDate }, { clinical: true });
  run.expect(scheduled, [201], 'Scheduling the plan\'s visit');
  const visitId = dataOf(scheduled)?.studyEventId;
  demand(nativeId(visitId), 'Scheduling returned no studyEventId.');
  const census = await run.call(session, 'GET', `/api/events/instance/${visitId}/crfs`);
  run.expect(census, [200], 'The visit\'s form census');
  const forms = dataOf(census);
  const matches = Array.isArray(forms) ? forms.filter((form: any) => isRecord(form) && form.crfVersionId === saveRule.crfVersionId) : [];
  demand(matches.length === 1 && nativeId(matches[0].eventCrfId) && nativeId(matches[0].crfId),
    `The visit holds no single form of the plan's version ${saveRule.crfVersionId} with an eventCrfId.`);
  return { subjectId, visitId, eventCrfId: matches[0].eventCrfId, crfId: matches[0].crfId };
}

/** Saves one item on an owned form against its fresh observation snapshot, with a reason. */
async function saveItem(run: CaseRun, session: Ta3Session, visit: OwnedVisit, value: string, reason: string): Promise<void> {
  const { saveRule } = run.ctx.plan;
  const read = await run.call(session, 'GET', `/api/forms/data/${visit.eventCrfId}`);
  run.expect(read, [200], 'Reading the form before the save');
  const snapshot = dataOf(read);
  demand(isRecord(snapshot) && typeof snapshot.observationSnapshotHash === 'string', 'The form read carries no observation snapshot hash.');
  const { expectedExecution, expectedObservations } = reviewed(snapshot);
  const saved = await run.call(session, 'POST', '/api/forms/save', { studyId: run.ctx.site, subjectId: visit.subjectId, studyEventId: visit.visitId,
    eventCrfId: visit.eventCrfId, crfId: visit.crfId, formData: { [`item_${saveRule.itemId}`]: value }, reasonForChange: reason, submitAction: 'draft',
    expectedObservations, ...(expectedExecution ? { expectedExecution } : {}) }, { clinical: true });
  // The engine never blocks a save: a refusal here is a failure of the save path itself.
  run.expect(saved, [200], 'The form save');
}

async function receiptsOf(run: CaseRun, session: Ta3Session, subjectId: number): Promise<Receipt[]> {
  const reply = await run.call(session, 'GET', `/api/deviation-engine/evaluations?studySubjectId=${subjectId}&limit=200`);
  run.expect(reply, [200], 'Reading the subject\'s evaluation receipts');
  const list = dataOf(reply)?.evaluations;
  demand(Array.isArray(list), 'The receipts read holds no evaluations list.');
  return list.filter(isRecord).map(row => ({
    evaluationId: String(row.evaluationId ?? row.evaluation_id ?? ''),
    actorId: Number.isSafeInteger(row.actorId ?? row.actor_id) ? Number(row.actorId ?? row.actor_id) : null,
    specHash: typeof (row.specHash ?? row.spec_hash) === 'string' ? String(row.specHash ?? row.spec_hash) : null,
    evaluatedAt: String(row.evaluatedAt ?? row.evaluated_at ?? ''),
    outcomes: Array.isArray(row.outcomes) ? row.outcomes : [],
  }));
}

function ruleStatus(receipt: Receipt, ruleId: string): string | undefined {
  const outcome = receipt.outcomes.find(item => isRecord(item) && (item.rule_id ?? item.ruleId) === ruleId);
  return isRecord(outcome) && typeof outcome.status === 'string' ? outcome.status : undefined;
}

/** Polls the subject's receipts within the bound until one matches. */
async function awaitReceipt(run: CaseRun, session: Ta3Session, subjectId: number, match: (receipt: Receipt) => boolean, waitMs: number): Promise<Receipt | undefined> {
  const deadline = run.ctx.clock.now() + waitMs;
  for (;;) {
    const found = (await receiptsOf(run, session, subjectId)).find(match);
    if (found) return found;
    if (run.ctx.clock.now() >= deadline) return undefined;
    await run.ctx.clock.sleep(run.ctx.pollMs);
  }
}

async function outcomesOf(run: CaseRun, session: Ta3Session, subjectId: number): Promise<Record<string, any>[]> {
  const reply = await run.call(session, 'GET', `/api/deviation-engine/outcomes?studySubjectId=${subjectId}`);
  run.expect(reply, [200], 'Reading the subject\'s outcomes');
  const outcomes = dataOf(reply)?.outcomes;
  demand(Array.isArray(outcomes), 'The outcomes read holds no outcomes list.');
  return outcomes.filter(isRecord);
}

async function evaluate(run: CaseRun, session: Ta3Session, subjectId: number): Promise<string | undefined> {
  const reply = await run.call(session, 'POST', '/api/deviation-engine/evaluate', { studyId: run.ctx.site, studySubjectId: subjectId },
    { timeoutMs: LONG_REQUEST_TIMEOUT_MS });
  run.expect(reply, [200], 'The on-demand evaluation');
  const id = dataOf(reply)?.evaluationId;
  return typeof id === 'string' ? id : undefined;
}

/** The deviation log rows of a query, page by page (the route caps a page at 100). */
async function deviationRows(run: CaseRun, session: Ta3Session, query: string, member?: string): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const reply = await run.call(session, 'GET', `/api/protocol-deviations?${query}&pageSize=${PAGE_SIZE}&page=${page}`);
    run.expect(reply, [200], 'Reading the deviation log', member);
    const batch = dataOf(reply)?.deviations;
    demand(Array.isArray(batch), 'The deviation log read holds no deviations list.');
    rows.push(...batch.filter(isRecord));
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

async function machineDeviationsOf(run: CaseRun, session: Ta3Session, subjectId: number, ruleId: string): Promise<Record<string, any>[]> {
  return (await deviationRows(run, session, `studyId=${run.ctx.site}&detectionSource=machine`))
    .filter(row => row.studySubjectId === subjectId && row.ruleId === ruleId);
}

async function deviationOf(run: CaseRun, session: Ta3Session, deviationId: number): Promise<Record<string, any>> {
  const reply = await run.call(session, 'GET', `/api/protocol-deviations/${deviationId}`);
  run.expect(reply, [200], `Reading deviation ${deviationId}`);
  const row = dataOf(reply);
  demand(isRecord(row) && row.deviationId === deviationId, `Deviation ${deviationId} did not read back.`);
  return row;
}

/** The corrective-action workspace: revision, source hash, history and, with O-1, the assessment in force. */
async function workspaceOf(run: CaseRun, session: Ta3Session, deviationId: number): Promise<Record<string, any>> {
  const reply = await run.call(session, 'GET', `/api/protocol-deviations/${deviationId}/corrective-action`);
  run.expect(reply, [200], `Reading the corrective-action workspace of deviation ${deviationId}`);
  const data = dataOf(reply);
  demand(isRecord(data) && Number.isSafeInteger(data.revision) && typeof data.sourceHash === 'string' && Array.isArray(data.history),
    `The workspace of deviation ${deviationId} lacks its revision, source hash or history.`);
  return data;
}

/** An owned manual deviation for an owned subject, created once per purpose. */
async function manualDeviation(run: CaseRun, session: Ta3Session, purpose: string, extra: Record<string, unknown> = {}): Promise<number> {
  const { ctx } = run;
  const known = ctx.facts.deviations[purpose];
  if (known) return known;
  const subjectId = ctx.facts.manualSubject ?? ctx.facts.save?.subjectId ?? (ctx.facts.manualSubject = await enrollOwned(run, session, isoDay(ctx.clock.now())));
  const label = ctx.label();
  const reply = await run.call(session, 'POST', '/api/protocol-deviations', { studyId: ctx.site, studySubjectId: subjectId, category: 'other', severity: 'minor',
    description: `${label} synthetic qualification deviation (${purpose}); test stack only`, ...extra });
  run.expect(reply, [201], `Logging the owned deviation ${label}`, Object.keys(extra)[0]);
  const id = dataOf(reply)?.deviationId;
  demand(nativeId(id), `Logging ${label} returned no deviationId.`);
  ctx.own('deviation', id, run.caseId, label);
  ctx.facts.deviations[purpose] = id;
  return id;
}

/** O-1's in-force assessment command: the request key, the workspace version and the stated decision. */
function assessmentCommand(workspace: Record<string, any>, decision: Record<string, unknown>): Record<string, unknown> {
  return { requestKey: randomUUID(), revision: workspace.revision, sourceHash: workspace.sourceHash,
    rationale: 'Synthetic qualification assessment on a test stack; no clinical meaning.', ...decision };
}

/** Password re-entry for a Part 11 signature (21 CFR 11.200); the evidence redacts it. */
const signatureOf = (session: Ta3Session) => ({ signatureUsername: session.username, signaturePassword: session.password });

/** Notes what this run observed of O-1 and cross-checks ENABLE_DEVIATION_DECISIONS. */
function observeDecisions(run: CaseRun, reply: Reply): void {
  const code = refusalCode(reply);
  if (code === OUTCOME.FEATURE_DISABLED_AT_TARGET) { run.ctx.o1 = 'disabled'; run.ctx.crossCheck(run, 'ENABLE_DEVIATION_DECISIONS', false); }
  else if (code === OUTCOME.FEATURE_ABSENT_AT_RELEASE) run.ctx.o1 = 'absent';
  else if (reply.status !== 0) { run.ctx.o1 = 'present'; run.ctx.crossCheck(run, 'ENABLE_DEVIATION_DECISIONS', true); }
}

const SUITES: Record<number, (ctx: Ta3Context) => Promise<void>> = {
  13: suite13, 14: suite14, 15: suite15, 16: suite16, 17: suite17, 18: suite18,
};

// ---------------------------------------------------------------------------
// Suite 13, Deviation Detection on Save and in the Sweep (OQ-206 to OQ-214)
// ---------------------------------------------------------------------------

async function suite13(ctx: Ta3Context): Promise<void> {
  const { plan } = ctx;
  const ruleId = plan.saveRule.ruleId;
  // OQ-206's spec read comes first: it also tells every other case whether the engine is on.
  const engineRun = new CaseRun(ctx, 'OQ-206');
  let specReply: Reply | undefined;
  const operator = ctx.sessions.get('operator');
  if (operator?.token) {
    try {
      specReply = await engineRun.call(operator, 'GET', `/api/deviation-engine/spec?studyId=${ctx.root}`);
      if (refusalCode(specReply) === OUTCOME.ENGINE_DISABLED) ctx.engine = 'off';
      else if (specReply.status === 200) ctx.engine = 'on';
    } catch { /* OQ-206 records the failed read */ }
  }

  await ctx.runCase('OQ-207', async run => {
    const op = ctx.session('operator');
    await requireEngine(run, op);
    demand(nativeId(op.userId), 'The operator login did not identify its user, so the saving user of a receipt cannot be matched.');
    const visit = await ownedVisit(run, op, isoDay(ctx.clock.now()));
    const before = new Set((await receiptsOf(run, op, visit.subjectId)).map(receipt => receipt.evaluationId));
    await saveItem(run, op, visit, plan.saveRule.violatingValue, 'Synthetic qualification entry of the violating value');
    const receipt = await awaitReceipt(run, op, visit.subjectId, entry => !before.has(entry.evaluationId) && entry.actorId === op.userId
      && ruleStatus(entry, ruleId) === 'violated', SAVE_EVALUATION_WAIT_MS);
    demand(receipt, `No new receipt by the saving user (user ${op.userId}) marked ${ruleId} violated within ${SAVE_EVALUATION_WAIT_MS / 1000} seconds of the save.`);
    const deviations = await machineDeviationsOf(run, op, visit.subjectId, ruleId);
    demand(deviations.length === 1, `Expected exactly one machine deviation for subject ${visit.subjectId} and rule ${ruleId}, found ${deviations.length}.`);
    const deviationId = Number(deviations[0].deviationId);
    ctx.facts.save = { ...visit, receipt, deviationId };
    ctx.own('deviation', deviationId, run.caseId);
    Object.assign(run.facts, { subjectId: visit.subjectId, eventCrfId: visit.eventCrfId, evaluationId: receipt.evaluationId, specHash: receipt.specHash, deviationId });
    return `The save of the violating value succeeded; receipt ${receipt.evaluationId} by the saving user marks ${ruleId} violated, and exactly one machine deviation (${deviationId}) was logged for subject ${visit.subjectId}.`;
  });

  await ctx.runCase('OQ-208', async run => {
    const op = ctx.session('operator');
    await requireEngine(run, op);
    const visit = await ownedVisit(run, op, isoDay(ctx.clock.now()));
    const before = new Set((await receiptsOf(run, op, visit.subjectId)).map(receipt => receipt.evaluationId));
    await saveItem(run, op, visit, plan.saveRule.compliantValue, 'Synthetic qualification entry of the compliant value');
    const receipt = await awaitReceipt(run, op, visit.subjectId, entry => !before.has(entry.evaluationId) && entry.actorId === op.userId
      && ruleStatus(entry, ruleId) !== undefined, SAVE_EVALUATION_WAIT_MS);
    demand(receipt, `No new receipt by the saving user evaluated ${ruleId} within ${SAVE_EVALUATION_WAIT_MS / 1000} seconds of the save.`);
    const status = ruleStatus(receipt, ruleId);
    demand(status === 'passed', `Receipt ${receipt.evaluationId} records ${ruleId} ${String(status)}, not passed, for the compliant value.`);
    const deviations = await machineDeviationsOf(run, op, visit.subjectId, ruleId);
    demand(deviations.length === 0, `${plural(deviations.length, 'machine deviation')} were logged for the compliant subject ${visit.subjectId}.`);
    Object.assign(run.facts, { subjectId: visit.subjectId, evaluationId: receipt.evaluationId });
    return `Receipt ${receipt.evaluationId} by the saving user records ${ruleId} passed for the compliant value, and no machine deviation exists for subject ${visit.subjectId}.`;
  });

  await ctx.runCase('OQ-209', async run => {
    const op = ctx.session('operator');
    await requireEngine(run, op);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const subjectId = await enrollOwned(run, op, isoDay(ctx.clock.now()));
      const outcomes = await outcomesOf(run, op, subjectId);
      const receipts = await receiptsOf(run, op, subjectId);
      if (receipts.length) {
        // The sweep evaluates a subject with no outcome row at once, so it may win the race.
        if (attempt === 1) { run.remark(`The sweep evaluated subject ${subjectId} first (${plural(receipts.length, 'receipt')}); retried once with a new subject.`); continue; }
        notExecuted(OUTCOME.SWEEP_RACED, 'The sweep evaluated both owned subjects before their first read, so an unevaluated subject could not be observed.');
      }
      const passed = outcomes.filter(entry => entry.status === 'passed');
      demand(passed.length === 0, `Subject ${subjectId} has no receipt, yet ${plural(passed.length, 'outcome')} read passed: an unevaluated subject was reported clean.`);
      Object.assign(run.facts, { subjectId, outcomes: outcomes.length });
      return `Subject ${subjectId}, read right after enrollment with no receipt, shows ${outcomes.length ? `${plural(outcomes.length, 'outcome')}, none passed` : 'no outcome'}.`;
    }
    return fail('No subject was read.');
  });

  await ctx.runCase('OQ-210', async run => {
    const op = ctx.session('operator');
    await requireEngine(run, op);
    const { absenceRule } = plan;
    const waitMinutes = plan.sweep.maxWaitMinutes ?? SWEEP_WAIT_DEFAULT_MINUTES;
    const subjectId = await enrollOwned(run, op, absenceRule.anchorDate);
    const receipt = await awaitReceipt(run, op, subjectId, entry => entry.actorId === SYSTEM_ACTOR_ID && ruleStatus(entry, absenceRule.ruleId) === 'violated', waitMinutes * 60_000);
    if (!receipt) {
      fail(`No receipt by the system actor (user ${SYSTEM_ACTOR_ID}) marked ${absenceRule.ruleId} violated for subject ${subjectId} within ${waitMinutes} minutes (the sweep runs from cron stage 5 when ENABLE_STUDY_TASK_CRON is on).`,
        OUTCOME.SWEEP_NOT_OBSERVED);
    }
    const deviations = await machineDeviationsOf(run, op, subjectId, absenceRule.ruleId);
    demand(deviations.length === 1, `Expected exactly one machine deviation for subject ${subjectId} and the absence rule ${absenceRule.ruleId}, found ${deviations.length}.`);
    ctx.own('deviation', Number(deviations[0].deviationId), run.caseId);
    Object.assign(run.facts, { subjectId, evaluationId: receipt.evaluationId, deviationId: deviations[0].deviationId, kind: absenceRule.kind });
    return `Receipt ${receipt.evaluationId} by the system actor marks the absence rule ${absenceRule.ruleId} (${absenceRule.kind}) violated for subject ${subjectId}, enrolled at ${absenceRule.anchorDate} with no visit data, and one machine deviation (${String(deviations[0].deviationId)}) was logged.`;
  });

  await ctx.runCase('OQ-211', async run => {
    const op = ctx.session('operator');
    await requireEngine(run, op);
    const save = ctx.facts.save ?? prerequisite('OQ-207', 'The machine deviation of the violating save');
    const before = new Set((await receiptsOf(run, op, save.subjectId)).map(receipt => receipt.evaluationId));
    const evaluationId = await evaluate(run, op, save.subjectId);
    const added = (await receiptsOf(run, op, save.subjectId)).filter(receipt => !before.has(receipt.evaluationId));
    demand(added.length >= 1 && (!evaluationId || added.some(receipt => receipt.evaluationId === evaluationId)),
      `The re-evaluation added no receipt (it returned ${evaluationId ?? 'no evaluationId'}).`);
    const deviations = await machineDeviationsOf(run, op, save.subjectId, ruleId);
    demand(deviations.length === 1 && Number(deviations[0].deviationId) === save.deviationId,
      `After the re-evaluation ${plural(deviations.length, 'machine deviation')} exist for ${ruleId}, not only deviation ${save.deviationId}.`);
    const added0 = evaluationId ?? added[0].evaluationId;
    run.facts.evaluationId = added0;
    return `The re-evaluation added receipt ${added0}, and deviation ${save.deviationId} is still the only machine deviation for ${ruleId}.`;
  });

  await ctx.runCase('OQ-212', async run => {
    const op = ctx.session('operator');
    await requireEngine(run, op);
    const save = ctx.facts.save ?? prerequisite('OQ-207', 'The receipt of the violating save');
    const path = `/api/deviation-engine/evaluations/${save.receipt.evaluationId}?studySubjectId=${save.subjectId}`;
    const read = async (what: string): Promise<string> => {
      const reply = await run.call(op, 'GET', path, undefined, { digest: true, maxBytes: RECEIPT_BYTE_LIMIT });
      run.expect(reply, [200], what);
      return reply.sha256 ?? fail(`${what} kept no bytes.`);
    };
    const before = await read('Reading the receipt before the mutation attempts');
    const answers: string[] = [];
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const reply = await run.call(op, method, path, method === 'DELETE' ? undefined : { outcomes: [] });
      demand([404, 405].includes(reply.status), `${method} on receipt ${save.receipt.evaluationId} answered HTTP ${reply.status}, not 404 or 405.`);
      answers.push(`${method} ${reply.status}`);
    }
    const after = await read('Reading the receipt after the mutation attempts');
    demand(after === before, `The receipt's bytes changed (SHA-256 ${before} before, ${after} after).`);
    run.facts.receiptSha256 = before;
    return `${answers.join(', ')}; the receipt's exact bytes (SHA-256 ${before}) are unchanged. API refusal only; the append-only triggers are native-suite evidence.`;
  });

  await ctx.runCase('OQ-213', async run => {
    const op = ctx.session('operator');
    await requireEngine(run, op);
    const save = ctx.facts.save ?? prerequisite('OQ-207', 'The violating save');
    const before = new Set((await receiptsOf(run, op, save.subjectId)).map(receipt => receipt.evaluationId));
    await saveItem(run, op, save, plan.saveRule.compliantValue, 'Synthetic qualification correction to the compliant value');
    const receipt = await awaitReceipt(run, op, save.subjectId, entry => !before.has(entry.evaluationId) && entry.actorId === op.userId
      && ruleStatus(entry, ruleId) !== undefined && ruleStatus(entry, ruleId) !== 'violated', SAVE_EVALUATION_WAIT_MS);
    demand(receipt, `No new receipt by the saving user recorded ${ruleId} not violated within ${SAVE_EVALUATION_WAIT_MS / 1000} seconds of the correction.`);
    const earlier = (await receiptsOf(run, op, save.subjectId)).find(entry => entry.evaluationId === save.receipt.evaluationId);
    demand(earlier && ruleStatus(earlier, ruleId) === 'violated', `The earlier receipt ${save.receipt.evaluationId} no longer shows ${ruleId} violated in the subject's history.`);
    const row = await deviationOf(run, op, save.deviationId);
    demand(row.status === 'open', `Machine deviation ${save.deviationId} is ${String(row.status)}; a correction must not close it.`);
    run.facts.evaluationId = receipt.evaluationId;
    return `The correction's receipt ${receipt.evaluationId} records ${ruleId} ${String(ruleStatus(receipt, ruleId))}; receipt ${save.receipt.evaluationId} still shows it violated, and deviation ${save.deviationId} stays open.`;
  });

  await ctx.runCase('OQ-214', async run => {
    const op = ctx.session('operator');
    await requireEngine(run, op);
    const followUp = plan.followUpTask;
    if (!followUp) notExecuted(OUTCOME.FOLLOW_UP_TASK_NOT_CONFIGURED, 'The plan names no follow-up study task (followUpTask null).');
    const save = ctx.facts.save ?? prerequisite('OQ-207', 'The machine deviation of the violating save');
    const definition = await run.call(op, 'GET', `/api/study-tasks/${followUp.studyTaskId}`);
    run.expect(definition, [200], `Reading study task ${followUp.studyTaskId}`);
    const task = dataOf(definition) ?? definition.body;
    if (!isRecord(task) || task.triggerType !== 'action' || !isRecord(task.actionTrigger) || task.actionTrigger.eventType !== 'deviation.logged') {
      notExecuted(OUTCOME.FOLLOW_UP_TASK_NOT_CONFIGURED, `Study task ${followUp.studyTaskId} is not an action trigger on deviation.logged.`);
    }
    // A raised task names the deviation it was raised for (fireStudyTask writes the domain event's entity id).
    const raised = async (): Promise<Record<string, any>[]> => {
      const found = new Map<string, Record<string, any>>();
      for (const studyId of [...new Set([ctx.root, ctx.site])]) {
        const reply = await run.call(op, 'GET', `/api/workflows?studyId=${studyId}&limit=2000`);
        run.expect(reply, [200], 'Reading the workflow tasks');
        const items = dataOf(reply);
        for (const item of Array.isArray(items) ? items : []) {
          if (isRecord(item) && isRecord(item.metadata) && item.metadata.sourceStudyTaskId === followUp.studyTaskId
            && isRecord(item.metadata.triggerContext) && item.metadata.triggerContext.entityId === save.deviationId) found.set(String(item.taskId ?? item.id), item);
        }
      }
      return [...found.values()];
    };
    if (ctx.declared('ENABLE_DOMAIN_EVENTS') === false) {
      const present = await raised();
      if (present.length) {
        fail(`${CONFIGURATION_MISMATCH_CODE}: ENABLE_DOMAIN_EVENTS is declared false, yet task ${String(present[0].taskId)} was raised for deviation ${save.deviationId}.`, OUTCOME.CONFIGURATION_MISMATCH);
      }
      fail('ENABLE_DOMAIN_EVENTS is declared false, so the domain-event chain that raises the follow-up task is off at the target; one read found no task.', OUTCOME.FEATURE_DISABLED_AT_TARGET);
    }
    const deadline = ctx.clock.now() + 2 * CRON_CYCLE_MS + 30_000;
    for (;;) {
      const tasks = await raised();
      if (tasks.length) {
        demand(tasks.length === 1, `${plural(tasks.length, 'task')} from study task ${followUp.studyTaskId} name deviation ${save.deviationId}; one is expected.`);
        run.facts.taskId = tasks[0].taskId ?? tasks[0].id;
        return `Workflow task ${String(run.facts.taskId)} from study task ${followUp.studyTaskId} names machine deviation ${save.deviationId}.`;
      }
      if (ctx.clock.now() >= deadline) {
        fail(`No workflow task from study task ${followUp.studyTaskId} named deviation ${save.deviationId} within two cron cycles.`
          + (ctx.declared('ENABLE_DOMAIN_EVENTS') === undefined ? ' ENABLE_DOMAIN_EVENTS is not declared, so a domain-event switch that is off cannot be told apart.' : ''),
        OUTCOME.TASK_NOT_OBSERVED);
      }
      await ctx.clock.sleep(ctx.pollMs);
    }
  });

  await ctx.runCase('OQ-206', async run => {
    if (!specReply) specReply = await run.call(ctx.session('operator'), 'GET', `/api/deviation-engine/spec?studyId=${ctx.root}`);
    if (refusalCode(specReply) === OUTCOME.ENGINE_DISABLED) ctx.crossCheck(run, 'ENABLE_DEVIATION_ENGINE', false);
    run.expect(specReply, [200], 'The deviation engine spec read');
    ctx.crossCheck(run, 'ENABLE_DEVIATION_ENGINE', true);
    const data = dataOf(specReply);
    demand(isRecord(data) && data.hasSpec === true && Number(data.machineCount) > 0,
      `The study has no active spec with a machine rule (hasSpec ${String(isRecord(data) ? data.hasSpec : undefined)}, machineCount ${String(isRecord(data) ? data.machineCount : undefined)}).`);
    Object.assign(run.facts, { specId: data.specId, specVersion: data.specVersion, ruleCount: data.ruleCount, machineCount: data.machineCount });
    const expectedRelease = plan.study.expectedCslReleaseId;
    if (expectedRelease !== undefined) {
      const binding = isRecord(data.sourceManifest) ? data.sourceManifest.releaseBinding : undefined;
      demand(isRecord(binding) && binding.cslReleaseId === expectedRelease,
        `The stored release binding names ${JSON.stringify(isRecord(binding) ? binding.cslReleaseId : null)}, not the plan's ${expectedRelease}.`);
    }
    run.remark(`The engine answers for study ${ctx.root} with active spec ${String(data.specId)} (${String(data.machineCount)} machine rules).`);
    // The spec read exposes no hash, so the first OQ receipt's spec hash is compared.
    const receipt = ctx.facts.save?.receipt ?? prerequisite('OQ-207', 'The first OQ receipt, whose spec hash this case compares,');
    demand(receipt.specHash === plan.study.expectedSpecHash,
      `The first OQ receipt ${receipt.evaluationId} carries spec hash ${String(receipt.specHash)}, not the plan's expectedSpecHash ${plan.study.expectedSpecHash}.`);
    return `Receipt ${receipt.evaluationId} carries the expected spec hash${expectedRelease ? ` and the release binding names ${expectedRelease}` : ''}.`;
  }, engineRun);
}

// ---------------------------------------------------------------------------
// Suite 14, Protocol Version Applicability (OQ-215 to OQ-218)
// ---------------------------------------------------------------------------

async function suite14(ctx: Ta3Context): Promise<void> {
  const tag = ctx.runId.slice(0, 8);
  const statedVersion = `oq-${tag}-stated`, unresolvedVersion = `oq-${tag}-unresolved`;
  // Stated dates in 2099: an evaluation sees only what was documented by its reference date, so none sees this version.
  const stated = { effectiveFrom: '2099-12-31', ethicsApprovalDate: '2099-12-30', documentedOn: '2099-12-31' };
  const record = (run: CaseRun, session: Ta3Session, body: Record<string, unknown>) => run.call(session, 'POST', '/api/deviation-engine/protocol-applicability',
    { studyId: ctx.site, basis: `${ctx.label()} synthetic qualification record; test stack only`, ...body });
  const recordsAt = async (run: CaseRun, session: Ta3Session): Promise<Record<string, any>[]> => {
    const reply = await run.call(session, 'GET', `/api/deviation-engine/protocol-applicability?studyId=${ctx.site}`);
    run.expect(reply, [200], 'Reading the OQ site\'s applicability records');
    const records = dataOf(reply)?.records;
    demand(Array.isArray(records), 'The applicability read holds no records list.');
    return records.filter(isRecord);
  };
  /** Retires an owned version so later evaluations and later runs at the site never see it; never throws. */
  const withdraw = async (run: CaseRun, session: Ta3Session, protocolVersion: string): Promise<boolean> => {
    try {
      const reply = await record(run, session, { protocolVersion, status: 'withdrawn' });
      run.expect(reply, [201], `Withdrawing the owned version ${protocolVersion}`);
      return true;
    } catch (error) {
      run.remark(`The owned version ${protocolVersion} could not be withdrawn (${error instanceof Error ? error.message : String(error)}); withdraw it before the next run at this site.`);
      return false;
    }
  };
  let statedId: number | undefined;

  await ctx.runCase('OQ-215', async run => {
    const op = ctx.session('operator'), monitor = ctx.session('monitor');
    await requireEngine(run, op);
    const body = { protocolVersion: statedVersion, status: 'established', ...stated };
    const refused = await record(run, monitor, body);
    demand(refused.status === 403, `The monitor's applicability record answered HTTP ${refused.status}, not 403.`);
    const accepted = await record(run, op, body);
    run.expect(accepted, [201], 'The operator\'s applicability record');
    const id = dataOf(accepted)?.applicabilityId;
    demand(nativeId(id), 'The applicability record returned no applicabilityId.');
    statedId = id;
    ctx.own('applicability', id, run.caseId, statedVersion);
    run.facts.applicabilityId = id;
    return `The monitor was refused with HTTP 403; the operator recorded the owned version ${statedVersion} (applicability ${id}), whose stated dates lie in 2099.`;
  });

  await ctx.runCase('OQ-216', async run => {
    const op = ctx.session('operator');
    await requireEngine(run, op);
    const id = statedId ?? prerequisite('OQ-215', 'The owned applicability record');
    const row = (await recordsAt(run, op)).find(entry => entry.applicabilityId === id);
    demand(row, `Applicability record ${id} is not listed at the OQ site.`);
    const read = { effectiveFrom: row.effectiveFrom, ethicsApprovalDate: row.ethicsApprovalDate, documentedOn: row.documentedOn };
    demand(JSON.stringify(read) === JSON.stringify(stated), `Record ${id} reads back ${JSON.stringify(read)}, not the stated ${JSON.stringify(stated)}.`);
    demand(await withdraw(run, op, statedVersion), `The owned version ${statedVersion} was not withdrawn.`);
    const current = (await recordsAt(run, op)).filter(entry => entry.protocolVersion === statedVersion && entry.current === true);
    demand(current.length === 0, `The owned version ${statedVersion} is still current after its withdrawal.`);
    return `Record ${id} reads back the stated dates ${JSON.stringify(stated)} (recorded at ${String(row.recordedAt)}); the owned version was then withdrawn and is no longer current.`;
  });

  await ctx.runCase('OQ-217', async run => {
    const op = ctx.session('operator');
    await requireEngine(run, op);
    const fixture = ctx.plan.applicability;
    if (!fixture) notExecuted(OUTCOME.VERSION_FIXTURE_ABSENT, 'The plan states no applicability fixture (applicability null).');
    const records = await recordsAt(run, op);
    for (const version of fixture.versions) {
      const found = records.some(entry => entry.studyId === ctx.site && entry.protocolVersion === version.protocolVersion && entry.status === 'established'
        && entry.current === true && entry.effectiveFrom === version.effectiveFrom);
      if (!found) notExecuted(OUTCOME.VERSION_FIXTURE_ABSENT, `Version ${version.protocolVersion} is not current and established at the OQ site from ${version.effectiveFrom}.`);
    }
    const [first, second] = fixture.versions;
    const observed: Array<{ subjectId: number; enrollmentDate: string; protocolVersion: unknown; targetDate: unknown }> = [];
    for (const enrollmentDate of [fixture.earlyEnrollmentDate, fixture.lateEnrollmentDate]) {
      const subjectId = await enrollOwned(run, op, enrollmentDate);
      await evaluate(run, op, subjectId);
      const outcome = (await outcomesOf(run, op, subjectId)).find(entry => entry.ruleId === fixture.versionedRuleId);
      demand(outcome && isRecord(outcome.applicability), `The outcome of ${fixture.versionedRuleId} for subject ${subjectId} states no applicability.`);
      observed.push({ subjectId, enrollmentDate, protocolVersion: outcome.applicability.protocol_version, targetDate: outcome.applicability.target_date });
    }
    run.facts.observed = observed;
    const [early, late] = observed;
    demand(typeof early.targetDate === 'string' && early.targetDate < second.effectiveFrom && early.protocolVersion === first.protocolVersion,
      `The visit planned for ${String(early.targetDate)} is governed by ${String(early.protocolVersion)}, not ${first.protocolVersion} (in effect before ${second.effectiveFrom}).`);
    demand(typeof late.targetDate === 'string' && late.targetDate >= second.effectiveFrom && late.protocolVersion === second.protocolVersion,
      `The visit planned for ${String(late.targetDate)} is governed by ${String(late.protocolVersion)}, not ${second.protocolVersion} (in effect from ${second.effectiveFrom}).`);
    return `${fixture.versionedRuleId}: the visit planned for ${String(early.targetDate)} is governed by ${first.protocolVersion} and the one planned for ${String(late.targetDate)} by ${second.protocolVersion}.`;
  });

  await ctx.runCase('OQ-218', async run => {
    const op = ctx.session('operator');
    await requireEngine(run, op);
    const subjectId = ctx.facts.save?.subjectId ?? await enrollOwned(run, op, isoDay(ctx.clock.now()));
    const recorded = await record(run, op, { protocolVersion: unresolvedVersion, status: 'unresolved' });
    run.expect(recorded, [201], 'Recording the owned version unresolved');
    const id = dataOf(recorded)?.applicabilityId;
    if (nativeId(id)) ctx.own('applicability', id, run.caseId, unresolvedVersion);
    let result = '';
    try {
      await evaluate(run, op, subjectId);
      const stated = (await outcomesOf(run, op, subjectId)).filter(entry => isRecord(entry.applicability));
      demand(stated.length > 0, `No outcome of subject ${subjectId} states its applicability while ${unresolvedVersion} is recorded unresolved at the site.`);
      const silent = stated.filter(entry => entry.applicability.version_status !== 'unresolved' || entry.applicability.protocol_version !== null);
      demand(silent.length === 0, `${plural(silent.length, 'outcome')} name a governing version (for example ${String(silent[0]?.ruleId)}: ${String(silent[0]?.applicability?.protocol_version)}) while ${unresolvedVersion} is unresolved.`);
      const named = stated.filter(entry => Array.isArray(entry.applicability.candidate_versions) && entry.applicability.candidate_versions.includes(unresolvedVersion));
      demand(named.length > 0, `No outcome lists ${unresolvedVersion} among its candidate versions.`);
      run.facts.unresolvedOutcomes = stated.length;
      result = `${stated.length === 1 ? 'One outcome states' : `${stated.length} outcomes state`} applicability, and each reports version_status unresolved with no governing version; ${named.length} list ${unresolvedVersion} as a candidate.`;
    } finally {
      // Retired whatever the result, so later evaluations and later runs at the site are unaffected.
      run.facts.withdrawn = await withdraw(run, op, unresolvedVersion);
    }
    demand(run.facts.withdrawn === true, `The owned unresolved version ${unresolvedVersion} was not withdrawn.`);
    return `${result} The owned version was then withdrawn.`;
  });
}

// ---------------------------------------------------------------------------
// Suite 15, Deviation Assessment and Reviewer Independence (OQ-219 to OQ-226)
// ---------------------------------------------------------------------------

async function suite15(ctx: Ta3Context): Promise<void> {
  /** POSTs an O-1 assessment and notes what the answer says about O-1 at the release and the target. */
  const assess = async (run: CaseRun, session: Ta3Session, deviationId: number, command: Record<string, unknown>, signed: boolean): Promise<Reply> => {
    const reply = await run.call(session, 'POST', `/api/protocol-deviations/${deviationId}/assessment`, { ...command, ...(signed ? signatureOf(session) : {}) }, { signed });
    observeDecisions(run, reply);
    return reply;
  };
  /** Fails the case when O-1's decision routes are off at the target or absent at the release. */
  const requireDecisions = (reply: Reply): void => {
    const code = refusalCode(reply);
    if (code === OUTCOME.FEATURE_DISABLED_AT_TARGET) fail('The O-1 decision routes answer HTTP 503 DEVIATION_DECISIONS_DISABLED: ENABLE_DEVIATION_DECISIONS is off at the target.', code);
    if (code === OUTCOME.FEATURE_ABSENT_AT_RELEASE) fail(`The release has no O-1 decision route (${messageOf(reply)}).`, code);
  };
  const inForce = (workspace: Record<string, any>): Record<string, any> | null => (isRecord(workspace.assessment) ? workspace.assessment : null);
  const assessEvents = (workspace: Record<string, any>): number => workspace.history.filter((event: any) => isRecord(event) && event.kind === 'assess').length;

  await ctx.runCase('OQ-220', async run => {
    const op = ctx.session('operator');
    const save = ctx.facts.save ?? prerequisite('OQ-207', 'The machine deviation of the violating save');
    const machine = await deviationOf(run, op, save.deviationId);
    // O-1 gives every row after its migration a capture source; a release without O-1 states none.
    if (machine.captureSource === undefined) {
      ctx.o1 = 'absent';
      fail('The deviation rows carry none of O-1\'s record fields (no captureSource): the release has no O-1.', OUTCOME.FEATURE_ABSENT_AT_RELEASE);
    }
    demand(typeof machine.occurredOn === 'string' && machine.occurredOnBasis === 'visit-date',
      `Machine deviation ${save.deviationId} carries occurredOn ${String(machine.occurredOn)} with basis ${String(machine.occurredOnBasis)}, not a visit-date basis.`);
    const occurredOn = isoDay(ctx.clock.now() - 86_400_000);
    const manualId = await manualDeviation(run, op, 'assessed', { occurredOn });
    const manual = await deviationOf(run, op, manualId);
    demand(String(manual.occurredOn ?? '').slice(0, 10) === occurredOn && manual.occurredOnBasis === 'stated',
      `Manual deviation ${manualId} carries occurredOn ${String(manual.occurredOn)} with basis ${String(manual.occurredOnBasis)}, not the stated ${occurredOn}.`);
    Object.assign(run.facts, { machine: { deviationId: save.deviationId, occurredOn: machine.occurredOn, basis: machine.occurredOnBasis },
      manual: { deviationId: manualId, occurredOn: manual.occurredOn, basis: manual.occurredOnBasis } });
    return `Machine deviation ${save.deviationId} occurred on ${String(machine.occurredOn).slice(0, 10)} (basis visit-date); manual deviation ${manualId} carries the stated ${occurredOn} (basis stated).`;
  });

  await ctx.runCase('OQ-221', async run => {
    const op = ctx.session('operator'), reviewer = ctx.session('reviewer');
    const deviationId = await manualDeviation(run, op, 'assessed');
    const before = await workspaceOf(run, op, deviationId);
    const command = assessmentCommand(before, { disposition: 'confirmed', importance: 'not_important' });
    const unsigned = await assess(run, reviewer, deviationId, command, false);
    requireDecisions(unsigned);
    demand(unsigned.status === 403 && codeOf(unsigned) === 'SIGNATURE_REQUIRED',
      `The reviewer's unsigned assessment answered HTTP ${unsigned.status} ${codeOf(unsigned) ?? ''}, not 403 SIGNATURE_REQUIRED.`);
    const self = await assess(run, op, deviationId, { ...command, requestKey: randomUUID() }, true);
    requireDecisions(self);
    demand(self.status === 403, `The signed assessment by the account that logged deviation ${deviationId} answered HTTP ${self.status}, not 403.`);
    const after = await workspaceOf(run, op, deviationId);
    demand(assessEvents(after) === assessEvents(before), 'A refused assessment appended an assessment event.');
    run.facts.deviationId = deviationId;
    return `The unsigned assessment was refused with 403 SIGNATURE_REQUIRED and the logger's own signed assessment with 403 (${messageOf(self).slice(0, 160)}); no assessment was appended to deviation ${deviationId}.`;
  });

  await ctx.runCase('OQ-222', async run => {
    const op = ctx.session('operator'), reviewer = ctx.session('reviewer');
    const deviationId = await manualDeviation(run, op, 'assessed');
    const workspace = await workspaceOf(run, reviewer, deviationId);
    const reply = await assess(run, reviewer, deviationId, assessmentCommand(workspace, { disposition: 'confirmed', importance: 'not_important' }), true);
    requireDecisions(reply);
    run.expect(reply, [201], 'The reviewer\'s signed assessment');
    const assessment = inForce(await workspaceOf(run, reviewer, deviationId));
    demand(assessment, `Deviation ${deviationId} shows no assessment in force after the signed assessment.`);
    const signature = isRecord(assessment.signature) ? assessment.signature : {};
    demand(assessment.disposition === 'confirmed' && assessment.importance === 'not_important', 'The assessment in force does not state the disposition and importance given.');
    demand(isRecord(assessment.assessedBy) && assessment.assessedBy.userId === reviewer.userId && assessment.assessedBy.username === reviewer.username,
      `The assessment in force names ${JSON.stringify(assessment.assessedBy)}, not the reviewer.`);
    demand(Number.isFinite(Date.parse(String(assessment.assessedAt))) && Number.isSafeInteger(assessment.revision), 'The assessment in force lacks its time or revision.');
    demand(signature.meaning === EDC_SIGNATURE_MEANINGS.DEVIATION_ASSESSMENT_MEANING && signature.signerUsername === reviewer.username,
      `The assessment's signature states meaning ${JSON.stringify(signature.meaning)} by ${String(signature.signerUsername)}, not DEVIATION_ASSESSMENT_MEANING by the reviewer.`);
    Object.assign(run.facts, { deviationId, eventId: assessment.eventId, revision: assessment.revision, assessedAt: assessment.assessedAt });
    return `The reviewer's signed assessment of deviation ${deviationId} is in force (revision ${assessment.revision}, ${String(assessment.assessedAt)}), naming the reviewer and the meaning DEVIATION_ASSESSMENT_MEANING.`;
  });

  await ctx.runCase('OQ-223', async run => {
    const op = ctx.session('operator'), reviewer = ctx.session('reviewer');
    const deviationId = await manualDeviation(run, op, 'not-a-deviation');
    const workspace = await workspaceOf(run, reviewer, deviationId);
    const attempts: Array<[Record<string, unknown>, string]> = [
      [{ disposition: 'confirmed' }, 'confirmed without importance'],
      [{ disposition: 'not_a_deviation', importance: 'important' }, 'not a deviation with importance'],
    ];
    for (const [decision, label] of attempts) {
      const reply = await assess(run, reviewer, deviationId, assessmentCommand(workspace, decision), true);
      requireDecisions(reply);
      demand(reply.status === 400, `The signed assessment ${label} answered HTTP ${reply.status}, not 400.`);
    }
    const after = await workspaceOf(run, reviewer, deviationId);
    demand(assessEvents(after) === assessEvents(workspace), 'A refused assessment appended an assessment event.');
    return `Signed assessments of deviation ${deviationId} confirmed without importance and not a deviation with importance were both refused with HTTP 400; nothing was appended.`;
  });

  await ctx.runCase('OQ-224', async run => {
    const op = ctx.session('operator'), reviewer = ctx.session('reviewer'), third = ctx.session('thirdPerson');
    const deviationId = await manualDeviation(run, op, 'not-a-deviation');
    const reply = await assess(run, reviewer, deviationId, assessmentCommand(await workspaceOf(run, reviewer, deviationId), { disposition: 'not_a_deviation' }), true);
    requireDecisions(reply);
    run.expect(reply, [201], 'The reviewer\'s signed not-a-deviation assessment');
    const close = async (session: Ta3Session): Promise<Reply> => {
      const current = await workspaceOf(run, session, deviationId);
      const answer = await run.call(session, 'POST', `/api/protocol-deviations/${deviationId}/close`, {
        reason: 'Synthetic qualification closure as not a deviation; test stack only', revision: current.revision, sourceHash: current.sourceHash,
        closureKind: 'not-a-deviation', ...signatureOf(session) }, { signed: true });
      observeDecisions(run, answer);
      requireDecisions(answer);
      return answer;
    };
    const byAssessor = await close(reviewer);
    demand(byAssessor.status === 403, `The assessor's own not-a-deviation closure answered HTTP ${byAssessor.status}, not 403.`);
    run.expect(await close(third), [200], 'The third person\'s signed not-a-deviation closure');
    const after = await workspaceOf(run, third, deviationId);
    const closed = [...after.history].reverse().find((event: any) => isRecord(event) && event.kind === 'close');
    demand(isRecord(closed) && isRecord(closed.payload) && closed.payload.closureKind === 'not-a-deviation' && Number(closed.actorId) === third.userId,
      'The close event does not record closureKind not-a-deviation by the third person.');
    demand(isRecord(closed.payload.signature) && closed.payload.signature.meaning === EDC_SIGNATURE_MEANINGS.DEVIATION_CLOSURE_MEANING,
      'The close event carries no signature with DEVIATION_CLOSURE_MEANING.');
    const row = await deviationOf(run, third, deviationId);
    demand(row.status === 'closed', `Deviation ${deviationId} is ${String(row.status)} after the closure.`);
    Object.assign(run.facts, { deviationId, closeEventId: closed.eventId });
    return `Deviation ${deviationId}, assessed not a deviation by the reviewer, was refused closure by the assessor (403) and closed under signature by the third person (closureKind not-a-deviation).`;
  });

  await ctx.runCase('OQ-225', async run => {
    const op = ctx.session('operator'), reviewer = ctx.session('reviewer');
    demand(nativeId(op.userId), 'The operator login did not identify its user, so it cannot be named the action owner.');
    const deviationId = await manualDeviation(run, op, 'assessed');
    const original = Buffer.from(`Synthetic retained original for an OQ corrective action, run ${ctx.runId}; test stack only.\n`, 'utf8');
    const fileId = randomUUID();
    const upload = await run.call(op, 'POST', `/api/protocol-deviations/${deviationId}/corrective-action/evidence/${fileId}`, undefined,
      { multipart: { field: 'file', filename: 'oq-ta3-corrective-action.txt', contentType: 'text/plain', bytes: original } });
    run.expect(upload, [200], 'Uploading the corrective action\'s retained original');
    ctx.own('evidence-file', fileId, run.caseId);
    const step = async (session: Ta3Session, input: Record<string, unknown>, signed = false): Promise<Reply> => {
      const workspace = await workspaceOf(run, session, deviationId);
      return run.call(session, 'POST', `/api/protocol-deviations/${deviationId}/corrective-action`, { revision: workspace.revision, sourceHash: workspace.sourceHash,
        reason: 'Synthetic qualification corrective action; test stack only', ...input, ...(signed ? signatureOf(session) : {}) }, { signed });
    };
    const workspace = await workspaceOf(run, op, deviationId);
    const assessment = inForce(workspace);
    // A release without O-1 has no assessment member in the workspace at all.
    const hasO1 = Object.prototype.hasOwnProperty.call(workspace, 'assessment');
    const evidence = { evidenceFileId: fileId, evidenceSha256: sha256(original), manualAssessmentReason: 'Synthetic manual adjudication of an OQ fixture; test stack only' };
    run.expect(await step(op, { kind: 'plan', ownerId: op.userId, dueAt: new Date(ctx.clock.now() + 7 * 86_400_000).toISOString(),
      rootCause: 'Synthetic qualification root cause', action: 'Synthetic qualification corrective action' }), [200], 'Recording the corrective-action plan');
    run.expect(await step(op, { kind: 'complete', ...evidence }), [200], 'Recording the completion as the action owner');
    const review = { kind: 'review', effective: true, ...evidence };
    // Signed when an assessment is in force, so the refusal shown is the independence rule and not a missing signature.
    const own = await step(op, review, Boolean(assessment));
    demand(own.status === 403, `The review by the planner, owner and completer answered HTTP ${own.status}, not 403.`);
    if (!assessment) {
      run.expect(await step(reviewer, review), [200], 'The independent review');
      const independence = 'Review independence holds: the planner, owner and completer was refused 403 and the reviewer was accepted';
      if (hasO1 && ctx.o1 !== 'disabled') prerequisite('OQ-222', `${independence}; the assessment in force that the signature part needs`);
      fail(`${independence}, but the signature part cannot be shown: ${hasO1 ? 'ENABLE_DEVIATION_DECISIONS is off, so no assessment is in force' : 'the release has no O-1 assessment'}.`,
        hasO1 ? OUTCOME.FEATURE_DISABLED_AT_TARGET : OUTCOME.FEATURE_ABSENT_AT_RELEASE);
    }
    const unsigned = await step(reviewer, review);
    demand(unsigned.status === 403, `With an assessment in force, the reviewer's unsigned review answered HTTP ${unsigned.status}, not 403.`);
    run.expect(await step(reviewer, review, true), [200], 'The reviewer\'s signed effectiveness review');
    Object.assign(run.facts, { deviationId, fileId });
    return `On assessed deviation ${deviationId} the planner, owner and completer's signed review was refused 403, the reviewer's unsigned review 403, and the reviewer's signed review was accepted.`;
  });

  await ctx.runCase('OQ-226', async run => {
    const op = ctx.session('operator'), reviewer = ctx.session('reviewer');
    demand(nativeId(op.userId), 'The operator login did not identify its user, so it cannot be named the action owner.');
    const deviationId = await manualDeviation(run, op, 'assessed');
    const before = await workspaceOf(run, op, deviationId);
    const stale = await run.call(op, 'POST', `/api/protocol-deviations/${deviationId}/corrective-action`, { revision: before.revision + 5, sourceHash: before.sourceHash,
      kind: 'plan', reason: 'Synthetic stale qualification request', ownerId: op.userId, dueAt: new Date(ctx.clock.now() + 86_400_000).toISOString(),
      rootCause: 'Synthetic stale root cause', action: 'Synthetic stale action' });
    demand(stale.status === 409, `The corrective-action step with a stale revision answered HTTP ${stale.status}, not 409.`);
    const answers = ['A corrective-action step with a stale revision: 409'];
    if (ctx.o1 !== 'absent' && ctx.o1 !== 'disabled') {
      const reply = await assess(run, reviewer, deviationId, { ...assessmentCommand(before, { disposition: 'confirmed', importance: 'not_important' }), sourceHash: '0'.repeat(64) }, true);
      const code = refusalCode(reply);
      if (code) answers.push(`a stale assessment was not tried (${code})`);
      else {
        demand(reply.status === 409, `The signed assessment with a stale source hash answered HTTP ${reply.status}, not 409.`);
        answers.push('a signed assessment with a stale source hash: 409');
      }
    }
    const after = await workspaceOf(run, op, deviationId);
    demand(after.history.length === before.history.length && after.revision === before.revision, 'A stale request appended to the deviation\'s history.');
    return `${answers.join('; ')}; the history of deviation ${deviationId} is unchanged at revision ${before.revision}.`;
  });

  await ctx.runCase('OQ-219', async run => {
    const op = ctx.session('operator');
    const owned = [...new Set([ctx.facts.save?.deviationId, ...Object.values(ctx.facts.deviations)].filter(nativeId))];
    if (!owned.length) prerequisite('OQ-207 or OQ-220', 'An owned deviation at the OQ site');
    const rows = await deviationRows(run, op, `studyId=${ctx.root}&includeSites=true`, 'includeSites');
    const listed = new Map(rows.map(row => [Number(row.deviationId), row]));
    const ownRows = owned.map(id => listed.get(id)).filter((row): row is Record<string, any> => isRecord(row));
    // Unknown query members are allowed (validation.middleware.ts), so a release without O-1 ignores includeSites and states no O-1 field.
    if (ownRows.some(row => row.captureSource === undefined) || (rows.length > 0 && rows.every(row => row.captureSource === undefined))) {
      ctx.o1 = ctx.o1 ?? 'absent';
      fail('The platform read returns no O-1 record fields (no captureSource), so the release ignores includeSites: the release has no O-1.', OUTCOME.FEATURE_ABSENT_AT_RELEASE);
    }
    const missing = owned.filter(id => !listed.has(id));
    if (missing.length && (await deviationOf(run, op, missing[0])).captureSource === undefined) {
      // The rows themselves carry no O-1 field, so the omission is the release's: it predates includeSites.
      ctx.o1 = ctx.o1 ?? 'absent';
      fail(`The platform read omits the OQ site's deviations ${missing.join(', ')}, and deviation ${missing[0]} carries no O-1 record field (no captureSource): the release has no O-1.`,
        OUTCOME.FEATURE_ABSENT_AT_RELEASE);
    }
    demand(missing.length === 0, `The platform read of study ${ctx.root} with includeSites=true omits the OQ site's deviations ${missing.join(', ')}.`);
    Object.assign(run.facts, { listed: rows.length, owned });
    return `The platform read of study ${ctx.root} with includeSites=true lists every owned deviation of the OQ site (${owned.join(', ')}) among ${plural(rows.length, 'row')}.`;
  });
}

// ---------------------------------------------------------------------------
// Suite 16, Deviation Escalation Timing (OQ-227 to OQ-231), run last
// ---------------------------------------------------------------------------

/** O-2's policy workspace (spec P09 5.2.5): its revision, source hash, the policy in force and the pending proposal. */
async function policyWorkspace(run: CaseRun, session: Ta3Session): Promise<Record<string, any>> {
  const { ctx } = run;
  const reply = await run.call(session, 'GET', `/api/protocol-deviations/escalation-policy?studyId=${ctx.root}`);
  // Without O-2 the path is read as a deviation id, whose integer validation answers 400.
  const readAsDeviation = reply.status === 400 && isRecord(reply.body) && Array.isArray(reply.body.errors)
    && reply.body.errors.some((error: unknown) => isRecord(error) && error.field === 'deviationId');
  if (readAsDeviation || refusalCode(reply) === OUTCOME.FEATURE_ABSENT_AT_RELEASE) {
    ctx.o2 = 'absent';
    fail('The release has no O-2 escalation policy route: GET /api/protocol-deviations/escalation-policy is not one.', OUTCOME.FEATURE_ABSENT_AT_RELEASE);
  }
  run.expect(reply, [200], 'Reading the escalation policy workspace');
  const data = dataOf(reply);
  demand(isRecord(data) && Number.isSafeInteger(data.revision) && typeof data.sourceHash === 'string', 'The policy workspace lacks its revision or source hash.');
  ctx.facts.observedItems.add('O-2');
  return data;
}

/** The row ids of the policy in force in a workspace. */
function inForceRowIds(workspace: Record<string, any>): string[] {
  const policy = workspace.inForce ?? workspace.policyInForce ?? null;
  const rows = isRecord(policy) ? (isRecord(policy.policy) ? policy.policy.rows : policy.rows) : undefined;
  return Array.isArray(rows) ? rows.filter(isRecord).map(row => String(row.id)) : [];
}

/** The OQ policy (edc-deviation-escalation-policy/1, spec P09 5.2.2): one row for the OQ site, level 1 of the assessment
 * clock after one hour and of the corrective-action clock at its due date, to the plan's recipient role; no closure rule. */
function escalationPolicy(ctx: Ta3Context, rowId: string): Record<string, unknown> {
  const recipientRole = ctx.plan.escalation.recipientRole;
  return {
    profile: 'edc-deviation-escalation-policy/1', effectiveAt: new Date(ctx.clock.now() - 60_000).toISOString(),
    protocolReference: `${rowId} synthetic qualification policy; test stack only`, closure: null,
    rows: [{ id: rowId, match: { ruleCategory: '*', severity: '*', importance: '*', scope: { siteStudyId: ctx.site } },
      assessment: { levels: [{ afterHours: 1, recipientRole }] }, correctiveAction: { levels: [{ afterHoursPastDue: 0, recipientRole }] },
      irbReport: null, dsmbNotify: null }],
  };
}

/** Whether the plan's recipient holds the recipient role at the OQ site (its staff list); a holder only at the parent is not listed. */
async function recipientHoldsRole(run: CaseRun, session: Ta3Session): Promise<boolean> {
  const { recipientRole, recipientUsername } = run.ctx.plan.escalation;
  const names = RECIPIENT_ROLE_NAMES[recipientRole] ?? [recipientRole];
  const reply = await run.call(session, 'GET', `/api/sites/${run.ctx.site}/staff`);
  const staff = dataOf(reply);
  if (reply.status !== 200 || !Array.isArray(staff)) {
    run.remark(`The OQ site's staff list could not be read (HTTP ${reply.status}), so the recipient's role is unconfirmed.`);
    return false;
  }
  const holds = staff.some((entry: unknown) => isRecord(entry) && entry.username === recipientUsername && names.includes(String(entry.role ?? '').toLowerCase()));
  if (!holds) run.remark(`${recipientUsername} holds no ${recipientRole} role in the OQ site's staff list (a holder at the parent study is not listed there).`);
  return holds;
}

async function escalateEvents(run: CaseRun, session: Ta3Session, deviationId: number): Promise<Record<string, any>[]> {
  return (await workspaceOf(run, session, deviationId)).history.filter((event: unknown): event is Record<string, any> => isRecord(event) && event.kind === 'escalate');
}

/** The workflow tasks O-2 raised for a deviation (type deviation_escalation, entity the deviation). */
async function escalationTasks(run: CaseRun, session: Ta3Session, deviationId: number): Promise<Record<string, any>[]> {
  const found = new Map<string, Record<string, any>>();
  for (const studyId of [...new Set([run.ctx.root, run.ctx.site])]) {
    const reply = await run.call(session, 'GET', `/api/workflows?studyId=${studyId}&limit=2000`);
    run.expect(reply, [200], 'Reading the workflow tasks');
    const items = dataOf(reply);
    for (const item of Array.isArray(items) ? items : []) {
      if (isRecord(item) && (item.taskType ?? item.type) === 'deviation_escalation' && Number(item.entityId) === deviationId) found.set(String(item.taskId ?? item.id), item);
    }
  }
  return [...found.values()];
}

/** Member names that would carry a treatment arm (D-25). */
function armMembers(value: unknown, at = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => armMembers(item, `${at}[${index}]`));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, item]) => [
    ...(/^(arm|arms|armid|armids|armname|treatment|treatmentarm|studygroup|studygroupid|studygroupids)$/i.test(key.replace(/[-_]/g, '')) ? [`${at}.${key}`] : []),
    ...armMembers(item, `${at}.${key}`),
  ]);
}

async function suite16(ctx: Ta3Context): Promise<void> {
  const { escalation } = ctx.plan;
  const wait = escalation.maxWaitMinutes ?? ESCALATION_WAIT_DEFAULT_MINUTES;
  /** O-2 present with the OQ policy in force. Absent or off, each case reads the policy route itself,
   * so its failure carries its own answer. */
  const requirePolicy = async (run: CaseRun, session: Ta3Session): Promise<void> => {
    if (ctx.o2 === 'absent') await policyWorkspace(run, session);
    if (ctx.o2 === 'disabled') {
      await policyWorkspace(run, session);
      fail('O-2 escalation is off at the target: its policy command answers 503 DEVIATION_DECISIONS_DISABLED (OQ-227).', OUTCOME.FEATURE_DISABLED_AT_TARGET);
    }
    if (!ctx.facts.policy) prerequisite('OQ-227', 'The OQ escalation policy in force');
  };
  const notWaited = (needed: number): never => notExecuted(OUTCOME.ESCALATION_WINDOW_NOT_WAITED,
    `The plan allows ${wait} minutes of escalation wait (escalation.maxWaitMinutes); this case needs at least ${needed}.`);
  const unobserved = (recipient: boolean, what: string): never => (recipient
    ? fail(what)
    : notExecuted(OUTCOME.RECIPIENT_UNAVAILABLE, `${what} ${escalation.recipientUsername} is not confirmed to hold ${escalation.recipientRole} at the OQ site; O-2 records a held attempt and creates no task when nobody holds the role, a setup gap and not a release result.`));

  await ctx.runCase('OQ-227', async run => {
    const op = ctx.session('operator'), reviewer = ctx.session('reviewer');
    const rowId = `oq-ta3-${ctx.runId.slice(0, 8)}`;
    const decide = async (session: Ta3Session, workspace: Record<string, any>, input: Record<string, unknown>): Promise<Reply> => {
      const reply = await run.call(session, 'POST', '/api/protocol-deviations/escalation-policy', { studyId: ctx.root, requestKey: randomUUID(),
        revision: workspace.revision, sourceHash: workspace.sourceHash, reason: `${rowId} synthetic qualification policy decision; test stack only`,
        ...input, ...signatureOf(session) }, { signed: true });
      const code = refusalCode(reply);
      if (code === OUTCOME.FEATURE_DISABLED_AT_TARGET) {
        ctx.o2 = 'disabled';
        ctx.crossCheck(run, 'ENABLE_DEVIATION_DECISIONS', false);
        fail('The O-2 policy command answers HTTP 503 DEVIATION_DECISIONS_DISABLED: ENABLE_DEVIATION_DECISIONS is off at the target.', code);
      }
      if (code) { ctx.o2 = 'absent'; fail(`The release has no O-2 policy command (${messageOf(reply)}).`, code); }
      return reply;
    };
    const proposed = await decide(op, await policyWorkspace(run, op), { kind: 'propose', policy: escalationPolicy(ctx, rowId) });
    run.expect(proposed, [201], 'The operator\'s signed policy proposal');
    const proposal = dataOf(proposed);
    const proposeEventId = isRecord(proposal) ? (isRecord(proposal.event) ? proposal.event.eventId : proposal.eventId) : undefined;
    demand(nativeId(proposeEventId), 'The policy proposal returned no event id.');
    ctx.own('escalation-policy-proposal', proposeEventId, run.caseId, rowId);
    const pending = await policyWorkspace(run, op);
    demand(!inForceRowIds(pending).includes(rowId), 'The proposal is in force before any review.');
    const byProposer = await decide(op, pending, { kind: 'review', proposeEventId, accepted: true });
    demand(byProposer.status === 403, `The proposer's own review answered HTTP ${byProposer.status}, not 403.`);
    const stillPending = await policyWorkspace(run, op);
    demand(!inForceRowIds(stillPending).includes(rowId), 'The proposer\'s refused review put the policy in force.');
    run.expect(await decide(reviewer, stillPending, { kind: 'review', proposeEventId, accepted: true }), [201], 'The reviewer\'s signed acceptance');
    demand(inForceRowIds(await policyWorkspace(run, op)).includes(rowId), 'The accepted policy is not in force.');
    ctx.o2 = 'present';
    ctx.crossCheck(run, 'ENABLE_DEVIATION_DECISIONS', true);
    ctx.facts.policy = { rowId };
    Object.assign(run.facts, { rowId, proposeEventId });
    return `Policy ${rowId} (proposal ${proposeEventId}) was refused review by its proposer (403) and is in force only after the reviewer's signed acceptance.`;
  });

  // The overdue corrective action needs minutes, the unassessed deviation an hour: the short case runs first.
  await ctx.runCase('OQ-230', async run => {
    const op = ctx.session('operator');
    await requirePolicy(run, op);
    if (wait < ESCALATION_CORRECTIVE_WAIT_MINUTES) notWaited(ESCALATION_CORRECTIVE_WAIT_MINUTES);
    demand(nativeId(op.userId), 'The operator login did not identify its user, so it cannot be named the action owner.');
    const recipient = await recipientHoldsRole(run, op);
    const deviationId = await manualDeviation(run, op, 'overdue');
    const workspace = await workspaceOf(run, op, deviationId);
    const planned = await run.call(op, 'POST', `/api/protocol-deviations/${deviationId}/corrective-action`, { revision: workspace.revision, sourceHash: workspace.sourceHash,
      kind: 'plan', reason: 'Synthetic qualification plan already past its due date; test stack only', ownerId: op.userId,
      dueAt: new Date(ctx.clock.now() - 60_000).toISOString(), rootCause: 'Synthetic qualification root cause', action: 'Synthetic qualification corrective action' });
    if ([400, 409].includes(planned.status) && /due/i.test(messageOf(planned))) {
      notExecuted(OUTCOME.DUE_AT_REFUSED, `The EDC refused a corrective-action plan whose dueAt has passed (HTTP ${planned.status}: ${messageOf(planned)}).`);
    }
    run.expect(planned, [200], 'Recording the overdue corrective-action plan');
    const deadline = ctx.clock.now() + 3 * CRON_CYCLE_MS + 30_000;
    let events: Record<string, any>[] = [];
    for (;;) {
      events = (await escalateEvents(run, op, deviationId)).filter(event => String(event.payload?.clockKey ?? '').startsWith('corrective-action'));
      if (events.length || ctx.clock.now() >= deadline) break;
      await ctx.clock.sleep(ctx.pollMs);
    }
    if (!events.length) unobserved(recipient, `No corrective-action escalate event for deviation ${deviationId} within three cron cycles of its passed due date.`);
    demand(events.length === 1, `${plural(events.length, 'corrective-action escalate event')} exist for deviation ${deviationId}; one is expected.`);
    ctx.facts.escalations.push({ deviationId, event: events[0] });
    Object.assign(run.facts, { deviationId, eventId: events[0].eventId, clockKey: events[0].payload?.clockKey, taskId: events[0].payload?.taskId });
    return `The overdue corrective action of deviation ${deviationId} escalated once (event ${String(events[0].eventId)}, clock ${String(events[0].payload?.clockKey)}).`;
  });

  await ctx.runCase('OQ-228', async run => {
    const op = ctx.session('operator');
    await requirePolicy(run, op);
    if (wait < ESCALATION_ASSESSMENT_WAIT_MINUTES) notWaited(ESCALATION_ASSESSMENT_WAIT_MINUTES);
    const recipient = await recipientHoldsRole(run, op);
    const deviationId = await manualDeviation(run, op, 'escalation');
    const createdAt = Date.parse(String((await deviationOf(run, op, deviationId)).dateCreated));
    const started = ctx.clock.now(), deadline = started + wait * 60_000;
    const level1 = async () => (await escalateEvents(run, op, deviationId)).filter(event => event.payload?.clockKey === 'assessment' && Number(event.payload?.level) === 1);
    // Nothing escalates before the hour: one read at 58 minutes shows none, then the poll every 30 seconds.
    await ctx.clock.sleep(58 * 60_000);
    const early = await level1();
    demand(early.length === 0, `Deviation ${deviationId} escalated before its hour (event ${String(early[0]?.eventId)}).`);
    let events: Record<string, any>[] = [];
    for (;;) {
      events = await level1();
      if (events.length || ctx.clock.now() >= deadline) break;
      await ctx.clock.sleep(ctx.pollMs);
    }
    if (!events.length) unobserved(recipient, `No level-1 assessment escalation of the unassessed deviation ${deviationId} within ${wait} minutes.`);
    demand(events.length === 1, `${plural(events.length, 'level-1 escalate event')} exist for deviation ${deviationId}; one is expected.`);
    const event = events[0];
    const elapsedMinutes = Number.isFinite(createdAt) ? (Date.parse(String(event.createdAt)) - createdAt) / 60_000 : NaN;
    demand(!Number.isFinite(elapsedMinutes) || elapsedMinutes >= 59, `The escalation came ${elapsedMinutes.toFixed(1)} minutes after the deviation was logged, before its hour.`);
    const tasks = await escalationTasks(run, op, deviationId);
    demand(tasks.length === 1 && String(tasks[0].taskId ?? tasks[0].id) === String(event.payload?.taskId),
      `The escalation names task ${String(event.payload?.taskId)}, and ${plural(tasks.length, 'escalation task')} exist for deviation ${deviationId}.`);
    ctx.facts.escalations.push({ deviationId, event });
    Object.assign(run.facts, { deviationId, eventId: event.eventId, taskId: event.payload?.taskId, elapsedMinutes: Number.isFinite(elapsedMinutes) ? Math.round(elapsedMinutes * 10) / 10 : null });
    return `The unassessed deviation ${deviationId} escalated once at level 1 (event ${String(event.eventId)}, task ${String(event.payload?.taskId)} for ${escalation.recipientRole}).`;
  });

  await ctx.runCase('OQ-229', async run => {
    const op = ctx.session('operator');
    await requirePolicy(run, op);
    const first = ctx.facts.escalations.find(entry => entry.event.payload?.clockKey === 'assessment')
      ?? (wait < ESCALATION_ASSESSMENT_WAIT_MINUTES ? notWaited(ESCALATION_ASSESSMENT_WAIT_MINUTES) : prerequisite('OQ-228', 'The level-1 escalation'));
    await ctx.clock.sleep(2 * CRON_CYCLE_MS + 15_000);
    const events = (await escalateEvents(run, op, first.deviationId)).filter(event => event.payload?.clockKey === 'assessment' && Number(event.payload?.level) === 1);
    demand(events.length === 1, `Two cron cycles later ${plural(events.length, 'level-1 escalate event')} exist for deviation ${first.deviationId}.`);
    const tasks = await escalationTasks(run, op, first.deviationId);
    demand(tasks.length === 1, `Two cron cycles later ${plural(tasks.length, 'escalation task')} exist for deviation ${first.deviationId}.`);
    return `Two cron cycles after the escalation, deviation ${first.deviationId} still has one level-1 escalate event and one task.`;
  });

  await ctx.runCase('OQ-231', async run => {
    const op = ctx.session('operator');
    await requirePolicy(run, op);
    if (!ctx.facts.escalations.length) {
      if (wait < ESCALATION_CORRECTIVE_WAIT_MINUTES) notWaited(ESCALATION_CORRECTIVE_WAIT_MINUTES);
      prerequisite('OQ-228 or OQ-230', 'An observed escalation');
    }
    const problems: string[] = [];
    let checked = 0;
    for (const deviationId of [...new Set(ctx.facts.escalations.map(entry => entry.deviationId))]) {
      const description = String((await deviationOf(run, op, deviationId)).description ?? '');
      const tasks = await escalationTasks(run, op, deviationId);
      for (const event of await escalateEvents(run, op, deviationId)) {
        checked++;
        problems.push(...armMembers(event.payload).map(member => `event ${String(event.eventId)} payload carries ${member}`));
        if (description && JSON.stringify(event.payload ?? {}).includes(description)) problems.push(`event ${String(event.eventId)} repeats the deviation description`);
        const task = tasks.find(item => String(item.taskId ?? item.id) === String(event.payload?.taskId));
        if (!task) { problems.push(`event ${String(event.eventId)} names task ${String(event.payload?.taskId)}, which is not listed`); continue; }
        for (const field of ['title', 'description']) {
          if (description && String(task[field] ?? '').includes(description)) problems.push(`task ${String(task.taskId)} ${field} repeats the deviation description`);
        }
        problems.push(...armMembers(task.metadata).map(member => `task ${String(task.taskId)} metadata carries ${member}`));
      }
    }
    demand(problems.length === 0, `Escalation records carry free text or arm members: ${problems.join('; ')}.`);
    run.facts.escalations = checked;
    return `${plural(checked, 'escalate event')} and their tasks carry codes only: no deviation description and no arm member.`;
  });
}

// ---------------------------------------------------------------------------
// Suite 17, TA3 Metrics Ledger Records (OQ-232 to OQ-238)
// ---------------------------------------------------------------------------

type DocumentKind = 'milestone' | 'effort' | 'latency' | 'ledger';
const DOCUMENT_CONTRACTS: Record<DocumentKind, readonly string[]> = {
  milestone: ['edc-milestone-measurement/1'],
  effort: ['edc-effort-ledger/1'],
  latency: ['edc-latency-measurement/1', 'edc-latency-measurement/2'],
  ledger: [TA3_LEDGER_CONTRACT],
};

async function suite17(ctx: Ta3Context): Promise<void> {
  const tag = ctx.runId.slice(0, 8);
  const route: Record<DocumentKind, string> = {
    milestone: `/api/sites/study/${ctx.root}/milestone-measurements`, effort: `/api/sites/study/${ctx.root}/effort-ledger`,
    latency: '/api/data-cuts/latency-measurements', ledger: `/api/sites/study/${ctx.root}/ta3-ledgers`,
  };
  const request = (run: CaseRun, session: Ta3Session, kind: DocumentKind, requestKey: string, extra: Record<string, unknown> = {}) =>
    run.call(session, 'POST', route[kind], { ...(kind === 'latency' ? { studyId: ctx.root } : {}), requestKey, ...extra }, { timeoutMs: LONG_REQUEST_TIMEOUT_MS });
  // The record each route returns beside the document (site.routes.ts, data-cut.controller.ts; M-2 per spec P01 3.2).
  const recordOf = (kind: DocumentKind, reply: Reply): Record<string, any> | undefined => {
    const data = dataOf(reply);
    const record = kind === 'effort' ? data?.ledger : kind === 'ledger' ? data?.ledger ?? data?.record ?? data?.measurement : data?.measurement;
    return isRecord(record) ? record : undefined;
  };
  const idOf = (kind: DocumentKind, record: unknown): unknown => (isRecord(record) ? (kind === 'latency' ? record.measurementId : record.documentId) : undefined);
  const readExact = (run: CaseRun, session: Ta3Session, kind: DocumentKind, id: unknown) =>
    run.call(session, 'GET', `${route[kind]}/${String(id)}`, undefined, { digest: true, maxBytes: DOCUMENT_BYTE_LIMIT });
  const listed = async (run: CaseRun, session: Ta3Session, kind: DocumentKind): Promise<unknown[]> => {
    const reply = await run.call(session, 'GET', kind === 'latency' ? `${route.latency}?studyId=${ctx.root}` : route[kind]);
    run.expect(reply, [200], `Listing the ${kind} documents`);
    const data = dataOf(reply);
    return Array.isArray(data) ? data : Array.isArray(data?.documents) ? data.documents : [];
  };
  const parsed = (reply: Reply): unknown => { try { return reply.bytes ? JSON.parse(reply.bytes.toString('utf8')) : undefined; } catch { return undefined; } };

  /** OQ-233 to OQ-235: record, read by id as exact bytes, find in the list, and replay the request key. */
  const exactBytes = async (run: CaseRun, kind: 'milestone' | 'effort' | 'latency'): Promise<string> => {
    const op = ctx.session('operator');
    const requestKey = `oq-ta3-${tag}-${kind}`;
    const first = await request(run, op, kind, requestKey);
    run.expect(first, [201], `Recording the ${kind} document`);
    const record = recordOf(kind, first), id = idOf(kind, record);
    demand(record && nativeId(id) && typeof record.contentHash === 'string', `The ${kind} request returned no record id and content hash.`);
    const read = await readExact(run, op, kind, id);
    run.expect(read, [200], `Reading ${kind} document ${id} as exact bytes`);
    const problems = retainedDocumentProblems(read.bytes ?? Buffer.alloc(0), { schemaVersion: DOCUMENT_CONTRACTS[kind],
      sha256: [first.headers['x-content-sha256'], record.contentHash, read.headers['x-content-sha256']] });
    demand(problems.length === 0, `${kind} document ${id}: ${problems.join('; ')}.`);
    const entry = (await listed(run, op, kind)).find(item => idOf(kind, item) === id);
    demand(isRecord(entry) && entry.contentHash === read.sha256, `The ${kind} list does not show document ${id} with content hash ${String(read.sha256)}.`);
    const replay = await request(run, op, kind, requestKey);
    run.expect(replay, [200], `Repeating the ${kind} request key`);
    const again = recordOf(kind, replay);
    demand(idOf(kind, again) === id && again?.contentHash === record.contentHash, `The repeated request key returned ${String(idOf(kind, again))}, not ${id} with the same hash.`);
    const document = parsed(read);
    const armGrouping = String(record.armGrouping ?? (isRecord(document) ? document.armGrouping : ''));
    ctx.facts.documents[kind] = { id, contentHash: record.contentHash, armGrouping, requestKey, sha256: read.sha256!, document };
    ctx.own(`${kind}-document`, id, run.caseId, requestKey);
    Object.assign(run.facts, { id, requestKey, sha256: read.sha256, armGrouping });
    return `The ${kind} document ${id} (${armGrouping}) is retained as exact bytes: SHA-256 ${read.sha256} equals X-Content-SHA256 and the list's contentHash, and its request key replays the same document.`;
  };

  await ctx.runCase('OQ-232', async run => {
    const op = ctx.session('operator'), reviewer = ctx.session('reviewer');
    const original = Buffer.from(`Synthetic retained original for an OQ operational milestone, run ${ctx.runId}; test stack only.\n`, 'utf8');
    const fileId = randomUUID(), label = ctx.label();
    const upload = await run.call(op, 'POST', `/api/sites/study/${ctx.site}/lifecycle/evidence/${fileId}`, undefined,
      { multipart: { field: 'file', filename: 'oq-ta3-milestone.txt', contentType: 'text/plain', bytes: original } });
    run.expect(upload, [200], 'Uploading the milestone\'s retained original');
    ctx.own('lifecycle-evidence', fileId, run.caseId);
    const workspace = async (): Promise<Record<string, any>> => {
      const reply = await run.call(op, 'GET', `/api/sites/study/${ctx.root}/milestones`);
      run.expect(reply, [200], 'Reading the milestone workspace');
      const data = dataOf(reply);
      demand(isRecord(data) && Number.isSafeInteger(data.revision) && typeof data.sourceHash === 'string', 'The milestone workspace lacks its revision or source hash.');
      return data;
    };
    const decide = async (session: Ta3Session, input: Record<string, unknown>): Promise<Reply> => {
      const current = await workspace();
      return run.call(session, 'POST', `/api/sites/study/${ctx.root}/milestones`, { requestKey: randomUUID(), revision: current.revision, sourceHash: current.sourceHash,
        reason: `${label} synthetic milestone decision; test stack only`, ...input, ...signatureOf(session) }, { signed: true });
    };
    const ids = (list: unknown): unknown[] => (Array.isArray(list) ? list.filter(isRecord).map(entry => entry.recordEventId) : []);
    const recorded = await decide(op, { kind: 'record', milestone: 'contract.sent', scopeStudyId: ctx.site, armId: null,
      occurredAt: new Date(ctx.clock.now() - 2 * 60_000).toISOString(), reference: `${label} synthetic contract reference`, evidence: { fileId, sha256: sha256(original) } });
    run.expect(recorded, [201], 'Recording contract.sent for the OQ site');
    const recordEventId = dataOf(recorded)?.event?.eventId;
    demand(nativeId(recordEventId), 'The milestone record returned no event id.');
    ctx.own('milestone', recordEventId, run.caseId, label);
    const pending = await workspace();
    demand(ids(pending.pendingReview).includes(recordEventId) && !ids(pending.inForce).includes(recordEventId),
      `Milestone record ${recordEventId} is in force before review, or not awaiting review.`);
    const byRecorder = await decide(op, { kind: 'review', recordEventId, accepted: true });
    demand(byRecorder.status === 403, `The recorder's own review answered HTTP ${byRecorder.status}, not 403.`);
    run.expect(await decide(reviewer, { kind: 'review', recordEventId, accepted: true }), [201], 'The reviewer\'s signed review');
    demand(ids((await workspace()).inForce).includes(recordEventId), `Milestone record ${recordEventId} is not in force after the reviewer's acceptance.`);
    Object.assign(run.facts, { recordEventId, fileId });
    return `contract.sent for the OQ site (record ${recordEventId}) awaited review, was refused review by its recorder (403) and is in force after the reviewer's signed acceptance.`;
  });

  await ctx.runCase('OQ-233', run => exactBytes(run, 'milestone'));
  await ctx.runCase('OQ-234', run => exactBytes(run, 'effort'));
  await ctx.runCase('OQ-235', run => exactBytes(run, 'latency'));

  await ctx.runCase('OQ-236', async run => {
    const blinded = ctx.session('blinded');
    const problems: string[] = [], recorded: string[] = [];
    for (const kind of ['milestone', 'effort', 'latency'] as const) {
      const reply = await request(run, blinded, kind, `oq-ta3-${tag}-blinded-${kind}`);
      run.expect(reply, [201], `Recording the ${kind} document as the blinded account`);
      const id = idOf(kind, recordOf(kind, reply));
      demand(nativeId(id), `The blinded ${kind} request returned no record id.`);
      ctx.own(`${kind}-document`, id, run.caseId);
      const read = await readExact(run, blinded, kind, id);
      run.expect(read, [200], `Reading the blinded ${kind} document ${id}`);
      const document = parsed(read);
      if (!isRecord(document) || document.armGrouping !== 'withheld') problems.push(`${kind} ${id} has armGrouping ${String(isRecord(document) ? document.armGrouping : 'unreadable')}`);
      const grouped = armGroupedContent(document);
      if (grouped.length) problems.push(`${kind} ${id} carries arm-grouped content at ${grouped.slice(0, 3).join(', ')}`);
      recorded.push(`${kind} ${id}`);
    }
    demand(problems.length === 0, `A blinded reader received arm-level content: ${problems.join('; ')}.`);
    const included = (['milestone', 'effort', 'latency'] as const).filter(kind => ctx.facts.documents[kind]?.armGrouping === 'included');
    if (!included.length) {
      if (!(['milestone', 'effort', 'latency'] as const).some(kind => ctx.facts.documents[kind])) prerequisite('OQ-233 to OQ-235', 'The operator\'s measurement documents');
      notExecuted(OUTCOME.OPERATOR_NOT_UNBLINDED, `The blinded account's documents withhold arms (${recorded.join(', ')}), but no operator document is included, so the operator holds no unblinded authority and the refusal of an included document cannot be shown.`);
    }
    for (const kind of included) {
      const document = ctx.facts.documents[kind]!;
      const refused = await readExact(run, blinded, kind, document.id);
      demand(refused.status === 403, `The blinded account read the included ${kind} document ${document.id} with HTTP ${refused.status}, not 403.`);
    }
    run.facts.recorded = recorded;
    return `The blinded account's documents (${recorded.join(', ')}) are withheld with no arm-grouped content, and its reads of the included ${included.join(', ')} documents were refused with 403.`;
  });

  await ctx.runCase('OQ-237', async run => {
    const op = ctx.session('operator'), blinded = ctx.session('blinded');
    const first = await request(run, op, 'ledger', `oq-ta3-${tag}-ledger`);
    run.expect(first, [201], 'Recording the TA3 ledger');
    const record = recordOf('ledger', first), id = idOf('ledger', record);
    demand(record && nativeId(id), 'The TA3 ledger request returned no document id.');
    ctx.own('ta3-ledger', id, run.caseId);
    const read = await readExact(run, op, 'ledger', id);
    run.expect(read, [200], `Reading TA3 ledger ${id} as exact bytes`);
    const problems = [...retainedDocumentProblems(read.bytes ?? Buffer.alloc(0), { schemaVersion: TA3_LEDGER_CONTRACT,
      sha256: [first.headers['x-content-sha256'], typeof record.contentHash === 'string' ? record.contentHash : undefined, read.headers['x-content-sha256']] }),
    ...ta3LedgerProblems(parsed(read))];
    demand(problems.length === 0, `TA3 ledger ${id}: ${problems.join('; ')}.`);
    const blindReply = await request(run, blinded, 'ledger', `oq-ta3-${tag}-blinded-ledger`);
    run.expect(blindReply, [201], 'Recording the TA3 ledger as the blinded account');
    const blindId = idOf('ledger', recordOf('ledger', blindReply));
    demand(nativeId(blindId), 'The blinded TA3 ledger request returned no document id.');
    const blindRead = await readExact(run, blinded, 'ledger', blindId);
    run.expect(blindRead, [200], `Reading the blinded TA3 ledger ${blindId}`);
    const blindProblems = ta3LedgerProblems(parsed(blindRead), { blinded: true });
    demand(blindProblems.length === 0, `The blinded TA3 ledger ${blindId}: ${blindProblems.join('; ')}.`);
    const visible = await listed(run, blinded, 'ledger');
    demand(visible.every(item => !isRecord(item) || item.armGrouping !== 'included'), 'The blinded account\'s list of TA3 ledgers shows an included document.');
    ctx.facts.documents.ledger = { id: Number(id), contentHash: String(record.contentHash), armGrouping: String(record.armGrouping ?? ''), requestKey: `oq-ta3-${tag}-ledger`,
      sha256: read.sha256!, document: undefined };
    Object.assign(run.facts, { id, sha256: read.sha256, blindId });
    return `TA3 ledger ${id} is one retained ${TA3_LEDGER_CONTRACT} document with every required member and one read-only snapshot, read as exact bytes (SHA-256 ${read.sha256}); the blinded account's ledger ${blindId} is withheld and its list shows no included document.`;
  });

  await ctx.runCase('OQ-238', async run => {
    const op = ctx.session('operator');
    const effort = ctx.facts.documents.effort ?? prerequisite('OQ-234', 'The retained effort ledger');
    const reply = await request(run, op, 'effort', effort.requestKey, { from: '2020-01-01T00:00:00.000Z', to: '2020-01-02T00:00:00.000Z' });
    demand(reply.status === 409, `The same request key with a different period answered HTTP ${reply.status}, not 409.`);
    const read = await readExact(run, op, 'effort', effort.id);
    run.expect(read, [200], `Reading effort ledger ${effort.id} again`);
    demand(read.sha256 === effort.sha256, `Effort ledger ${effort.id} changed (SHA-256 ${effort.sha256} before, ${String(read.sha256)} after).`);
    return `The same request key with a different period was refused with 409, and effort ledger ${effort.id} still reads back as SHA-256 ${effort.sha256}.`;
  });
}

// ---------------------------------------------------------------------------
// Suite 18, Inspection Copy Completeness (OQ-239 to OQ-244)
// ---------------------------------------------------------------------------

/** The additional store tables a flat copy's manifest declares. */
function additionalStoreTables(packet: Record<string, unknown>): string[] {
  const stores = isRecord(packet.manifest) && Array.isArray(packet.manifest.additionalStores) ? packet.manifest.additionalStores : [];
  return stores.filter(isRecord).map(store => String(store.table));
}

async function suite18(ctx: Ta3Context): Promise<void> {
  const copyPath = `/api/regulatory-export/inspection-package/${ctx.root}`;
  const ta3Flag = ctx.declared('INSPECTION_COPY_TA3_INVENTORY'), segmentedFlag = ctx.declared('ENABLE_SEGMENTED_INSPECTION_EXPORT');
  const historyOf = async (run: CaseRun, session: Ta3Session, query = ''): Promise<Record<string, any>[]> => {
    const reply = await run.call(session, 'GET', `${copyPath}${query}`);
    run.expect(reply, [200], 'Reading the inspection copy history');
    const packages = dataOf(reply)?.packages;
    demand(Array.isArray(packages), 'The inspection copy history holds no packages list.');
    return packages.filter(isRecord);
  };
  const packageIdOf = (value: unknown): string => (isRecord(value) ? String(value.packageId ?? value.package_id ?? '').toLowerCase() : '');

  await ctx.runCase('OQ-239', async run => {
    const op = ctx.session('operator');
    const requestKey = randomUUID();
    const generate = () => run.call(op, 'POST', copyPath, { requestKey }, { timeoutMs: LONG_REQUEST_TIMEOUT_MS, reconcileWrite: true });
    const created = await generate();
    if (created.captureError) {
      // Never resent: the request key is the package id, so the history shows whether the copy was retained.
      run.remark(`The generation request ended with a transport error (${created.captureError}) and was reconciled by reading the history.`);
    } else run.expect(created, [201], 'Generating the flat inspection copy');
    const entry = (await historyOf(run, op)).find(item => packageIdOf(item) === requestKey);
    demand(entry && typeof entry.fileSha256 === 'string', `The history does not list package ${requestKey} with its SHA-256.`);
    const download = await run.call(op, 'GET', `${copyPath}/${requestKey}`, undefined, { digest: true, maxBytes: COPY_BYTE_LIMIT, timeoutMs: LONG_REQUEST_TIMEOUT_MS });
    run.expect(download, [200], 'Downloading the inspection copy');
    demand(download.sha256 === download.headers['x-source-sha256'] && download.sha256 === entry.fileSha256,
      `The downloaded copy hashes to ${String(download.sha256)}; X-Source-SHA256 is ${String(download.headers['x-source-sha256'])} and the history ${String(entry.fileSha256)}.`);
    const packet = download.body;
    demand(isRecord(packet) && isRecord(packet.manifest), 'The downloaded copy is not an inspection packet.');
    const schemaVersion = packet.manifest.schemaVersion;
    demand(schemaVersion === 'edc-inspection-copy/1' || schemaVersion === 'edc-inspection-copy/2', `The flat copy states schemaVersion ${String(schemaVersion)}, not edc-inspection-copy/1 or /2.`);
    const replay = await generate();
    run.expect(replay, [200], 'Repeating the request key');
    demand(packageIdOf(dataOf(replay)) === requestKey && dataOf(replay)?.fileSha256 === entry.fileSha256, 'The repeated request key returned another package.');
    ctx.facts.copy = { packageId: requestKey, sha256: download.sha256!, packet };
    ctx.own('inspection-copy', requestKey, run.caseId);
    Object.assign(run.facts, { packageId: requestKey, sha256: download.sha256, schemaVersion, additionalStores: additionalStoreTables(packet).length });
    return `Flat copy ${requestKey} (${String(schemaVersion)}) downloads byte for byte: SHA-256 ${download.sha256} equals X-Source-SHA256 and the history entry, and its request key replays it.`;
  });

  await ctx.runCase('OQ-240', async run => {
    const op = ctx.session('operator');
    const copy = ctx.facts.copy ?? prerequisite('OQ-239', 'The retained flat copy');
    run.facts.packageId = copy.packageId;
    const owned = [...new Set(ctx.owned.filter(entry => entry.kind === 'deviation').map(entry => Number(entry.id)).filter(nativeId))];
    if (!owned.length) prerequisite('suites 13 and 15', 'An owned deviation');
    const rowsOf = (table: string): Record<string, any>[] | null => {
      const store = Array.isArray(copy.packet.additionalStores) ? copy.packet.additionalStores.find((entry: unknown) => isRecord(entry) && entry.table === table) : undefined;
      return isRecord(store) && Array.isArray(store.rows) ? store.rows.map((row: any) => JSON.parse(String(row?.nativeJson))) : null;
    };
    const [deviationTable, eventTable] = FLAT_DEVIATION_TABLES;
    const deviations = rowsOf(deviationTable), events = rowsOf(eventTable);
    demand(deviations && events, `The copy holds no ${deviations ? eventTable : deviationTable} store.`);
    const problems: string[] = [];
    for (const id of owned) {
      if (!deviations.some(row => Number(row.deviation_id) === id)) { problems.push(`deviation ${id} is not in the copy`); continue; }
      const history = (await workspaceOf(run, op, id)).history.length;
      const copied = events.filter(row => Number(row.deviation_id) === id).length;
      if (copied !== history) problems.push(`deviation ${id} has ${copied} action events in the copy and ${history} in the API`);
    }
    demand(problems.length === 0, `The copy misses deviation records: ${problems.join('; ')}.`);
    run.facts.deviations = owned;
    return `Every owned deviation (${owned.join(', ')}) is in ${deviationTable}, with as many ${eventTable} rows as its API history.`;
  });

  await ctx.runCase('OQ-241', async run => {
    const op = ctx.session('operator');
    if (typeof ta3Flag !== 'boolean') {
      notExecuted(OUTCOME.NO_TARGET_CONFIGURATION, 'No validation-target-configuration/1 declaration states INSPECTION_COPY_TA3_INVENTORY (--target-config), so the expected flat inventory is unknown.');
    }
    const copy = ctx.facts.copy ?? prerequisite('OQ-239', 'The retained flat copy');
    run.facts.packageId = copy.packageId;
    const tables = new Set(additionalStoreTables(copy.packet));
    const present = TA3_INSPECTION_COVERAGE.filter(entry => tables.has(entry.table));
    if (!ta3Flag) {
      if (present.length) {
        fail(`${CONFIGURATION_MISMATCH_CODE}: INSPECTION_COPY_TA3_INVENTORY is declared false, yet the flat copy carries ${plural(present.length, 'TA3 table')} (${present.slice(0, 5).map(entry => entry.table).join(', ')}).`, OUTCOME.CONFIGURATION_MISMATCH);
      }
      fail(`INSPECTION_COPY_TA3_INVENTORY is declared false, and the flat copy carries no TA3 table among its ${tables.size} additional stores: the TA3 inventory is off at the target.`, OUTCOME.FEATURE_DISABLED_AT_TARGET);
    }
    if (!present.length) fail('INSPECTION_COPY_TA3_INVENTORY is declared true, but the flat copy carries no TA3 table: the release has no W-1.', OUTCOME.FEATURE_ABSENT_AT_RELEASE);
    // Suite 16 runs after this suite, so O-2's policy route is read here when no case has observed it yet.
    if (!ctx.facts.observedItems.has('O-2')) {
      const probe = await run.call(op, 'GET', `/api/protocol-deviations/escalation-policy?studyId=${ctx.root}`);
      if (probe.status === 200 || refusalCode(probe) === OUTCOME.FEATURE_DISABLED_AT_TARGET) ctx.facts.observedItems.add('O-2');
    }
    const observed = ctx.facts.observedItems;
    const missing = TA3_INSPECTION_COVERAGE.filter(entry => !entry.segmentedOnly && (!entry.late || observed.has(entry.late.item)) && !tables.has(entry.table)).map(entry => entry.table);
    const segmented = present.filter(entry => entry.segmentedOnly).map(entry => entry.table);
    const notRequired = TA3_INSPECTION_COVERAGE.filter(entry => entry.late && !observed.has(entry.late.item)).map(entry => `${entry.table} (${entry.late!.item})`);
    Object.assign(run.facts, { ta3Tables: present.length, missing, segmented, notRequiredAtThisRelease: notRequired });
    demand(missing.length === 0 && segmented.length === 0,
      `The flat TA3 inventory is incomplete: ${missing.length ? `missing ${missing.join(', ')}` : ''}${missing.length && segmented.length ? '; ' : ''}${segmented.length ? `segmented-only ${segmented.join(', ')} present` : ''}.`);
    return `The flat copy carries every required TA3 table (${plural(present.length, 'table')}) and no segmented-only one. Not required at this release: ${notRequired.length ? notRequired.join(', ') : 'none'}.`;
  });

  await ctx.runCase('OQ-242', async run => {
    const op = ctx.session('operator');
    if (typeof ta3Flag !== 'boolean' || typeof segmentedFlag !== 'boolean') {
      notExecuted(OUTCOME.NO_TARGET_CONFIGURATION, 'No validation-target-configuration/1 declaration states INSPECTION_COPY_TA3_INVENTORY and ENABLE_SEGMENTED_INSPECTION_EXPORT (--target-config).');
    }
    const copy = ctx.facts.copy ?? prerequisite('OQ-239', 'The retained flat copy');
    run.facts.flatPackageId = copy.packageId;
    if (ta3Flag) {
      const manifest = copy.packet.manifest as Record<string, unknown>;
      const limitations = Array.isArray(manifest.limitations) ? manifest.limitations : [];
      if (!limitations.includes(W1_SEGMENTED_LIMITATION) && !TA3_INSPECTION_COVERAGE.some(entry => additionalStoreTables(copy.packet).includes(entry.table))) {
        fail('The flat copy carries neither W-1\'s segmented-only limitation nor any TA3 table: the release has no W-1.', OUTCOME.FEATURE_ABSENT_AT_RELEASE);
      }
      demand(limitations.includes(W1_SEGMENTED_LIMITATION), 'The flat copy does not state W-1\'s limitation naming the segmented-only domains.');
      demand(!additionalStoreTables(copy.packet).includes('acc_deviation_evaluations'), 'The flat copy carries acc_deviation_evaluations, a segmented-only table.');
    } else run.remark('INSPECTION_COPY_TA3_INVENTORY is declared false, so the flat copy states no segmented-only limitation.');
    const requestKey = randomUUID();
    const generate = () => run.call(op, 'POST', copyPath, { requestKey, profile: 'edc-inspection-copy/3' }, { timeoutMs: LONG_REQUEST_TIMEOUT_MS });
    const created = await generate();
    const code = refusalCode(created, 'profile');
    if (code === OUTCOME.FEATURE_DISABLED_AT_TARGET) {
      ctx.crossCheck(run, 'ENABLE_SEGMENTED_INSPECTION_EXPORT', false);
      fail('The segmented profile answers HTTP 503 SEGMENTED_INSPECTION_EXPORT_DISABLED: ENABLE_SEGMENTED_INSPECTION_EXPORT is off at the target.', code);
    }
    if (code === OUTCOME.FEATURE_ABSENT_AT_RELEASE) fail(`The release refuses the profile member (HTTP ${created.status}): it has no segmented export route (W-1).`, code);
    run.expect(created, [201], 'Generating the segmented copy');
    ctx.crossCheck(run, 'ENABLE_SEGMENTED_INSPECTION_EXPORT', true);
    const receipt = dataOf(created);
    const version = isRecord(receipt) ? receipt.packageVersion ?? (isRecord(receipt.manifest) ? receipt.manifest.packageVersion ?? receipt.manifest.schemaVersion : undefined) : undefined;
    demand(version === 'edc-inspection-copy/3', `The segmented receipt states ${String(version)}, not edc-inspection-copy/3.`);
    const replay = await generate();
    run.expect(replay, [200], 'Repeating the segmented request key');
    demand(packageIdOf(dataOf(replay)) === requestKey, 'The repeated segmented request key returned another package.');
    demand((await historyOf(run, op, `?profile=${encodeURIComponent('edc-inspection-copy/3')}`)).some(item => packageIdOf(item) === requestKey),
      `The segmented history does not list package ${requestKey}.`);
    ctx.facts.segmentedPackageId = requestKey;
    ctx.own('inspection-copy', requestKey, run.caseId);
    run.facts.packageId = requestKey;
    return `The flat copy keeps receipts out${ta3Flag ? ' and states the segmented-only limitation' : ''}; segmented copy ${requestKey} (edc-inspection-copy/3) was generated, replays and is listed under its profile.`;
  });

  await ctx.runCase('OQ-243', async () => notExecuted(OUTCOME.SEGMENTED_READ_NOT_EXPOSED,
    `Segmented roots and parts are served only through the sponsor-access delegated read to an M2M service credential, never to a user account (spec P17 2.2.7), so the receipts, blobs and audit-chain result of the segmented copy${ctx.facts.segmentedPackageId ? ` ${ctx.facts.segmentedPackageId}` : ''} cannot be read here. W-1's native suite (RUN_INSPECTION_SEGMENT_SOURCE_PG=1) is the supporting evidence until a user download route exists.`));

  await ctx.runCase('OQ-244', async run => {
    const monitor = ctx.session('monitor');
    const generate = await run.call(monitor, 'POST', copyPath, { requestKey: randomUUID() });
    const history = await run.call(monitor, 'GET', copyPath);
    demand(generate.status === 403 && history.status === 403,
      `The monitor's inspection copy requests answered HTTP ${generate.status} (generate) and ${history.status} (history), not 403.`);
    return 'The monitor was refused with HTTP 403 for both the generation and the history of inspection copies.';
  });
}
