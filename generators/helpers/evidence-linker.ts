import { EVIDENCE_CATEGORIES, loadEvidence, type EvidenceCategory, type EvidenceResult } from '../../runners/evidence-capture';

/** The saved evidence fields generators read. Every value is the one `saveEvidence`
 * wrote; no tester identity or environment name exists in the evidence, so
 * generators must leave those unknown. `method === 'MANUAL'` marks a manual
 * verification row, which the evidence contract never lets pass. */
export type RunnerResult = Pick<EvidenceResult,
  'testCaseId' | 'passed' | 'notes' | 'timestamp' | 'method' | 'endpoint' | 'testDescription' | 'captureError'>;

/** Every runner result keyed by test case ID, read from each category's
 * `${category}-results.json` as written by `saveEvidence`. */
export function loadRunnerEvidence(outputDir: string): Map<string, RunnerResult> {
  const resultMap = new Map<string, RunnerResult>();
  for (const category of EVIDENCE_CATEGORIES) {
    for (const result of loadEvidence(outputDir, category)) {
      if (resultMap.has(result.testCaseId)) throw new Error(`Duplicate qualification test case: ${result.testCaseId}`);
      resultMap.set(result.testCaseId, result);
    }
  }
  return resultMap;
}

export interface EvidenceStats {
  total: number;
  pass: number;
  fail: number;
}

/** Pass/fail counts for one runner category from its `${category}-results.json`.
 * All zeros when that category has not been executed into this output directory. */
export function tryLoadEvidence(outputDir: string, category: EvidenceCategory): EvidenceStats {
  const results = loadEvidence(outputDir, category);
  return {
    total: results.length,
    pass: results.filter(result => result.passed).length,
    fail: results.filter(result => !result.passed).length,
  };
}

/** What a runner case actually executes. `manual` marks a case whose designed
 * outcome is a manual-verification row with no automated assertion. */
export interface RunnerCaseCheck {
  check: string;
  manual?: true;
}

const auditRefusal = (verb: string, path = '/api/audit/:auditId on an owned audit row'): string =>
  `Synthetic fixture: ${verb} ${path} must be refused with HTTP 403, 404 or 405 and every owned audit row `
  + 'must read back unchanged (API refusal only, not database enforcement).';
const exactLogout = 'A fresh login of the operator account is logged out, and that same token must then be refused '
  + 'by GET /api/auth/verify with HTTP 401.';
const auditCsv = 'Synthetic fixture: GET /api/audit/export (CSV, owned study) must return text/csv whose parsed rows contain '
  + 'the owned correction\'s entity ID, old value 75, new value 70.5, reason and username.';
const formPdf = 'Synthetic fixture: the owned form PDF (with audit trail and signatures) is parsed; it must show the subject, '
  + 'every field/value/unit, the signature manifestation (signer full name and username, signed at, meaning, record, SHA-256) '
  + 'and the exact audit correction, with the native source and proof unchanged.';
const weakPassword = (account: string) => `Synthetic fixture only: changing the ${account} password to "123" must be refused `
  + 'with HTTP 400 PASSWORD_POLICY_VIOLATION and non-empty errors, and the unchanged password must still log in.';
const ownedAuditRow = (table: string, entity: string) => `Synthetic fixture: the owned-study audit read must contain a ${table} `
  + `row whose entityId is the owned ${entity} (the action type is not checked).`;

/** Actual checks of the runner cases that generators cite, verified against
 * runners/oq-runner.ts, pq-runner.ts and security-runner.ts. A generator may cite a
 * case only for a control this text shows it verifies; update both with the runner. */
export const RUNNER_CASE_CHECKS: Readonly<Record<string, RunnerCaseCheck>> = {
  'OQ-001': { check: 'Operator login (POST /api/auth/login with the configured OQ operator) must succeed with a usable access token.' },
  'OQ-002': { check: 'Synthetic fixture only: re-submitting the owned account to POST /api/users must be refused with HTTP 400 '
    + '"Username already exists", and the original account must read back unchanged.' },
  'OQ-003': { check: 'Login with a wrong password for the owned synthetic account (without the fixture: an absent username) '
    + 'must return HTTP 401; the response message is not compared.' },
  'OQ-004': { check: weakPassword('owned authentication account') },
  'OQ-006': { check: 'A login probe decodes the issued access token and requires a positive integer userId, a role and a future '
    + 'exp claim; the probe then logs out its exact session and requires that token to be refused.' },
  'OQ-007': { manual: true, check: 'Manual case: requires native readback of two owned sessions created with distinct '
    + 'x-device-fingerprint headers; the runner records "manual verification required" and never passes it automatically.' },
  'OQ-008': { check: 'Run last: repeated failed logins for an absent user must report authoritative rate-limit headers (limit at '
    + 'most 500) and end in HTTP 429 with zero remaining, Retry-After of at least 1 and the native lockout message.' },
  'OQ-009': { check: 'Synthetic fixture only: up to seven wrong-password logins on the owned viewer account (after a valid baseline '
    + 'login) must lock it (statusId 5, lockCounter > 0); its correct password must then be refused with a "locked" message.' },
  'OQ-010': { check: exactLogout },
  'OQ-021': { check: 'Synthetic fixture only: the owned account is raised to data_manager and logged in, then lowered to viewer; '
    + 'the privileged session must be refused with HTTP 401, a fresh login must carry only the viewer role, and that viewer must '
    + 'receive HTTP 403 FORBIDDEN on GET /api/users/:id. No audit is read.' },
  'OQ-022': { check: 'Synthetic fixture only: disabling the owned account (with readback) must cause its existing session to be '
    + 'refused with HTTP 401 and its correct password to be refused with "User account is disabled". No audit is read.' },
  'OQ-027': { check: 'The first row returned by GET /api/audit/form/:id must carry a non-empty eventTypeName; action values are not validated.' },
  'OQ-028': { check: 'The first row returned by GET /api/audit/form/:id must carry a non-empty auditTable and a positive entityId.' },
  'OQ-030': { check: auditRefusal('PUT') },
  'OQ-031': { check: auditRefusal('DELETE') },
  'OQ-032': { check: auditCsv },
  'OQ-033': { check: 'Synthetic fixture: POST /api/esignature/sign without a password must be refused with HTTP 400 (one error: '
    + 'field password, any.required) and the owned form\'s signature proof must be unchanged.' },
  'OQ-041': { check: 'Synthetic fixture: POST /api/esignature/sign with a wrong password must be refused with HTTP 400 '
    + '"Invalid password" and the signature proof must be unchanged; no audit is read.' },
  'OQ-042': { check: 'Synthetic fixture: the two signature IDs come from the retained signature proofs of PQ-027 and PQ-029 '
    + 'and must differ; for each, exactly one form-audit row whose auditId is that signature ID must match scope, the signer\'s '
    + 'userId and username, the canonical FORM_DATA_COMPLETE meaning, signed_at and a sha256 64-hex content hash; the active '
    + 'signature\'s row must also agree with the current proof.' },
  'OQ-047': { check: 'Synthetic fixture: POST /api/export/execute (CSV) must return text/csv with exactly one row per expected owned '
    + 'field carrying its exact value for the owned subject.' },
  'OQ-048': { check: formPdf },
  'OQ-053': { check: 'Synthetic fixture: as an admin or data_manager, POST /api/data-locks/:id/unlock with a reason and signature '
    + 'credentials must unlock the locked owned form with unchanged values and add a history row (unlock, performedBy = the '
    + '/api/auth/verify user, performedAt, exact reason); the lock is then restored. Unlock without a signature is not attempted.' },
  'OQ-055': { check: 'Synthetic fixture: the owned form\'s data-lock history must contain freeze, unfreeze and lock rows with the '
    + 'exact requested reasons, performedBy equal to the /api/auth/verify user and parseable timestamps; OQ-053 must also pass.' },
  'OQ-060': { check: auditRefusal('DELETE') },
  'OQ-061': { check: 'Synthetic fixture: POST /api/forms/save changing the owned weight without reasonForChange must be refused '
    + 'with HTTP 400 (REASON_REQUIRED, FORM_REASON_REQUIRED or REASON_FOR_CHANGE_REQUIRED) and the form must be unchanged.' },
  'OQ-062': { check: exactLogout },
  'OQ-067': { check: formPdf },
  'OQ-085': { check: 'Synthetic fixture only: login of the owned account must return success=true, a non-empty accessToken and '
    + 'user.userId equal to the owned account.' },
  'OQ-086': { check: 'Synthetic fixture only: the decoded access-token exp must lie more than 0 and at most 24 hours ahead '
    + '(absolute token lifetime, not idle timeout).' },
  'OQ-087': { check: 'Synthetic fixture only: POST /api/auth/refresh with the owned session\'s refresh token must return an access '
    + 'token that GET /api/auth/verify accepts with HTTP 200.' },
  'OQ-092': { check: 'Synthetic fixture only: a password change with a wrong current password must be refused with HTTP 400, 401 '
    + 'or 403; the stored password is not re-read.' },
  'OQ-093': { check: weakPassword('owned password-suite account') },
  'OQ-094': { check: 'Synthetic fixture only: two concurrent logins of the same owned account must both issue a session, and both '
    + 'tokens must be accepted by GET /api/auth/verify with HTTP 200.' },
  'OQ-095': { check: 'GET /api/auth/verify with a forged token (userId 99999, invalid signature) must return HTTP 401.' },
  'OQ-121': { check: 'Synthetic fixture: GET /api/audit for the owned study must return rows all scoped to that study, each with a '
    + 'parseable auditDate (UTC is not checked).' },
  'OQ-122': { check: 'Synthetic fixture: in the same owned-study audit read every row must carry a positive integer userId, or be '
    + 'followed (higher auditId) by a row that does for the same table, entity and event type (a legacy trigger row paired with '
    + 'its attributed application row).' },
  'OQ-127': { check: 'Synthetic fixture: login history for the qualification operator with status=success must contain a row for '
    + 'that username with login status 1 and status text success (camelCase or snake_case fields; successful logins only; IP '
    + 'and session are not checked).' },
  'OQ-129': { check: auditRefusal('PUT') },
  'OQ-130': { check: auditRefusal('PATCH') },
  'OQ-131': { check: auditRefusal('DELETE') },
  'OQ-132': { check: auditRefusal('POST', '/api/audit') },
  'OQ-136': { check: ownedAuditRow('study', 'study') },
  'OQ-137': { check: ownedAuditRow('study_subject', 'subject') },
  'OQ-139': { check: ownedAuditRow('discrepancy_note', 'query') },
  'OQ-140': { check: 'Synthetic fixture: the owned-study audit read must contain the "Electronic Signature Applied" event_crf row '
    + 'whose auditId is the active signature ID and whose entityId is the owned form.' },
  'OQ-141': { check: ownedAuditRow('event_crf', 'form') },
  'OQ-142': { check: 'Synthetic fixture: GET /api/audit must contain some user_account row for the owned authentication account '
    + '(the event type is not checked).' },
  'OQ-143': { check: ownedAuditRow('study_event', 'visit') },
  'OQ-154': { check: 'Synthetic fixture: passes only if all ten study-setup rows PQ-001 to PQ-010 (signed release, reviewed '
    + 'activation, enrollment and visit readbacks) passed.' },
  'OQ-193': { check: auditCsv },
  'OQ-AUTH-FIXTURE': { check: 'Synthetic fixture only (auxiliary row): as the operator, POST /api/users creates a viewer account '
    + '(HTTP 201) and GET /api/users/:id must read back its username, email, viewer role and enabled state.' },
  'SEC-004': { check: 'GET /api/studies with a JWT whose payload claims userId 1 and role admin but whose signature is invalid '
    + 'must return HTTP 401.' },
  'PQ-005': { check: 'Creates a five-field synthetic CRF, verifies its native item IDs, creates and reads back an error-severity '
    + 'range rule (0 to 300) on its weight item, and assigns the version to the visit; with the synthetic qualification flags '
    + 'also signed release, application and reviewed activation.' },
  'PQ-006': { check: 'Synthetic fixture: enrolls a new subject in the active owned study and verifies the native subject.' },
  'PQ-007': { check: 'Synthetic fixture: reads the native subject back and checks its study, label and enrollment date.' },
  'PQ-008': { check: 'Synthetic fixture: re-submitting the same enrollment must be refused with an unchanged subject census.' },
  'PQ-011': { check: 'Synthetic fixture: saves initial values for all five owned fields with a reason and verifies every native value on readback.' },
  'PQ-012': { check: 'Synthetic fixture: re-reads the owned form and asserts every submitted value.' },
  'PQ-013': { check: 'Synthetic fixture: saves weight 70.5 with an explicit reason and verifies the readback (no audit read).' },
  'PQ-014': { check: 'Synthetic fixture: POST /api/forms/validate-field/:id with weight -1 (below the PQ-005 range rule, '
    + 'createQueries false) must return HTTP 200 with success false, valid false and errors, and leave the observation snapshot '
    + 'unchanged (preview endpoint, not the save path).' },
  'PQ-015': { check: 'Synthetic fixture: saves all five scalar field types and verifies each value on readback.' },
  'PQ-017': { check: 'Synthetic fixture: creates a query on the owned weight item (HTTP 201) and reads it back with matching study, '
    + 'form, item and open status (the assignee is not checked).' },
  'PQ-018': { check: 'Synthetic fixture: responds to the query with proposed status 3 and reads back resolution status 3 (response '
    + 'text and audit are not read).' },
  'PQ-019': { check: 'Synthetic fixture: closes the query with a reason and signature credentials and reads back resolution status 4.' },
  'PQ-020': { check: 'Synthetic fixture: completes the reviewed owned form and reads back isComplete true.' },
  'PQ-021': { check: 'Synthetic fixture: saves only the notes field and verifies every prior value is preserved.' },
  'PQ-022': { check: 'Synthetic fixture: after a newer save, a save carrying the stale observation snapshot must be refused with '
    + 'HTTP 409 STUDY_FORM_OBSERVATION_STALE and the newer value must remain (sequential, from one session).' },
  'PQ-024': { check: 'Synthetic fixture: saves accented initials and Spanish/Japanese/emoji notes and verifies the exact readback '
    + '(field values only; the reason text is ASCII).' },
  'PQ-027': { check: 'Synthetic fixture: re-completes the reviewed, unsigned form with the signer\'s username and password (the '
    + 'API\'s signing event; it keeps one active signature per form) and requires the form complete and a verified integrity '
    + 'proof whose active signature is by that signer.' },
  'PQ-028': { check: 'Synthetic fixture: the signature status must show the PQ-027 signature as active with the signer username, '
    + 'the canonical form-completion meaning (FORM_DATA_COMPLETE), a parseable signedAt and a 64-hex contentHash.' },
  'PQ-029': { check: 'Synthetic fixture: a material correction after signing must leave the form unsigned with no active signature; '
    + 'a fresh signed re-completion must then produce a new signature ID with a verified integrity proof (hash values are not '
    + 'compared).' },
  'PQ-030': { check: 'Synthetic fixture: freezes the signed form with a reason and signature credentials and reads back frozen true.' },
  'PQ-031': { check: 'Synthetic fixture: a save on the frozen form must be refused with HTTP 423 DATA_LOCKED (lock level form, a '
    + 'message naming frozen), and the observation snapshot must be unchanged with the form still frozen.' },
  'PQ-032': { check: 'Synthetic fixture: unfreezes with a reason and signature credentials and reads back frozen false.' },
  'PQ-033': { check: 'Synthetic fixture: locks the form with a reason and signature credentials and reads back locked true.' },
  'PQ-034': { check: 'Synthetic fixture: a save on the locked form must be refused with HTTP 423 DATA_LOCKED (lock level form, a '
    + 'message naming locked), and the snapshot must be unchanged with the form still locked (form save only).' },
  'PQ-035': { check: 'Synthetic fixture: the study raw-store snapshot must report complete scope, and the owned form\'s item_data rows '
    + 'must equal every expected value.' },
  'PQ-036': { check: 'Synthetic fixture: GET /api/audit/form/:id must be non-empty with a row scoped to the owned form and study '
    + 'that carries a userId and auditDate.' },
  'PQ-037': { check: 'Synthetic fixture: GET /api/audit/form/:id must contain the weight row with old value 75, new value 70.5, the '
    + 'exact reason, a native userId and the visit ID.' },
  'PQ-038': { check: 'Synthetic fixture: reads the owned query back and requires the same form and closed status 4.' },
  'PQ-039': { check: 'Synthetic fixture: the final signature proof must be signed, integrity-valid and verified, with the latest '
    + 'signature active (same run).' },
};

/** The actual check of a cited runner case; citing an uncatalogued case is a defect. */
export function runnerCaseCheck(testCaseId: string): RunnerCaseCheck {
  const check = RUNNER_CASE_CHECKS[testCaseId];
  if (!check) throw new Error(`No verified runner check is recorded for ${testCaseId}`);
  return check;
}

/** How one mapped case's retained evidence counts. A manual row never passes, and a
 * blocked or "did not execute" placeholder is not an executed check. */
export type MappedCaseState = 'passed' | 'failed' | 'manual-pending' | 'not-executed' | 'missing';

export function mappedCaseState(testCaseId: string, evidence: Map<string, RunnerResult>): MappedCaseState {
  const result = evidence.get(testCaseId);
  if (!result) return 'missing';
  if (result.passed) return 'passed';
  if (result.method === 'MANUAL') return runnerCaseCheck(testCaseId).manual ? 'manual-pending' : 'not-executed';
  if (result.method === 'CONTRACT') return 'not-executed';
  return 'failed';
}
