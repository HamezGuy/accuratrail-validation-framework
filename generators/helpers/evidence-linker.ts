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
const TA3_PLAN = 'TA3 plan study (the designated armed duplicate a ta3-oq-plan/1 names)';

/** Actual checks of the runner cases that generators cite, verified against
 * runners/oq-runner.ts, oq-ta3-runner.ts, pq-runner.ts and security-runner.ts. A generator may cite a
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
  'OQ-071': { check: 'Synthetic fixture only: on the owned password-suite account, after one accepted change, changing to the current '
    + 'password and then to the previous password must each be refused with HTTP 400 PASSWORD_REUSED, a following change with the '
    + 'same current password must be accepted (the refusal changed nothing), and the final new password must sign in.' },
  'OQ-072': { check: 'Synthetic fixture only: two logins of the owned account must issue distinct session IDs that both verify; after '
    + 'logout of A, A must get a native session refusal (401) while B verifies; refreshing B must return a usable token with B\'s '
    + 'session ID while A stays refused; the owned account\'s chained audit must hold exactly one User Login row for each session and '
    + 'one User Logout row for A only, each carrying its session ID.' },
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
  // The TA3 suites 13 to 18 (runners/oq-ta3-runner.ts), against the armed study a ta3-oq-plan/1 names. A refusal
  // that shows the feature off at the target or absent at the release fails with its code; a setup gap is not executed.
  'OQ-206': { check: `${TA3_PLAN}: GET /api/deviation-engine/spec?studyId=<study> must answer 200 with hasSpec true and at least one machine rule `
    + '(503 naming ENABLE_DEVIATION_ENGINE fails ENGINE_DISABLED); the spec hash of the OQ-207 receipt must equal the plan\'s expectedSpecHash, and a '
    + 'stated expectedCslReleaseId must equal sourceManifest.releaseBinding.cslReleaseId.' },
  'OQ-207': { check: `${TA3_PLAN}: an owned subject is enrolled at the OQ site, the plan's visit scheduled and its form located; a save of the violating `
    + 'value must answer 200, a new receipt by the saving user (actorId) must mark the save rule violated within 120 seconds, and the site\'s machine '
    + 'deviation log must hold exactly one deviation for that subject and rule. A training refusal of a clinical write records TRAINING_NOT_CURRENT.' },
  'OQ-208': { check: `${TA3_PLAN}: a second owned subject saved with the compliant value must get a new receipt by the saving user that records the `
    + 'rule passed, and no machine deviation for that subject and rule.' },
  'OQ-209': { check: `${TA3_PLAN}: an owned subject read right after enrollment (outcomes, then receipts) must show no passed outcome; a sweep receipt `
    + 'already present gives one retry with a new subject, then SWEEP_RACED (not executed).' },
  'OQ-210': { check: `${TA3_PLAN}: an owned subject enrolled at the absence rule's anchor date with no visit data must, within sweep.maxWaitMinutes `
    + '(polled every 30 seconds), get a receipt by the system actor (user 1) marking the rule violated (else SWEEP_NOT_OBSERVED) and exactly one machine '
    + 'deviation for that subject and rule.' },
  'OQ-211': { check: 'POST /api/deviation-engine/evaluate for the OQ-207 subject must add the receipt it returns, and the OQ-207 deviation must stay '
    + 'the only machine deviation for the rule.' },
  'OQ-212': { check: 'PUT, PATCH and DELETE on /api/deviation-engine/evaluations/:id of the OQ-207 receipt must each answer 404 or 405, and the '
    + 'receipt read as exact bytes must hash the same before and after (API refusal only, not database enforcement).' },
  'OQ-213': { check: 'Correcting the OQ-207 item to the compliant value with a reason must give a new receipt by the saving user that records the rule '
    + 'neither violated nor missing; the OQ-207 receipt must still read violated in the subject\'s history and the deviation must read open.' },
  'OQ-214': { check: 'The plan\'s follow-up study task must be an action trigger on deviation.logged (else FOLLOW_UP_TASK_NOT_CONFIGURED); within two '
    + 'cron cycles and 30 seconds exactly one workflow task from it must name the OQ-207 deviation (else TASK_NOT_OBSERVED). ENABLE_DOMAIN_EVENTS '
    + 'declared false records FEATURE_DISABLED_AT_TARGET after one read, or CONFIGURATION_MISMATCH when a task exists.' },
  'OQ-215': { check: 'POST /api/deviation-engine/protocol-applicability for the OQ site must answer 403 to the monitor and 201 with an applicabilityId '
    + 'to the operator, for an owned version established from 2099-12-31.' },
  'OQ-216': { check: 'The OQ-215 record must read back effectiveFrom 2099-12-31, ethicsApprovalDate 2099-12-30 and documentedOn 2099-12-31 exactly; '
    + 'a withdrawn record of the owned version must answer 201 and leave it not current.' },
  'OQ-217': { check: 'Both plan versions must be current and established at the OQ site from their effectiveFrom (else VERSION_FIXTURE_ABSENT); for '
    + 'owned subjects enrolled at the plan\'s early and late dates and evaluated, the versioned rule\'s applicability must name the first version for a '
    + 'target date before the second effectiveFrom and the second version for one on or after it.' },
  'OQ-218': { check: 'With an owned version recorded unresolved at the OQ site, a re-evaluated owned subject must have outcomes that state '
    + 'applicability, each with version_status unresolved and protocol_version null and one listing the owned version as a candidate; the owned '
    + 'version is then withdrawn.' },
  'OQ-219': { check: 'GET /api/protocol-deviations?studyId=<study>&includeSites=true must list every owned deviation of the OQ site; rows or an owned '
    + 'deviation without O-1\'s captureSource fail FEATURE_ABSENT_AT_RELEASE.' },
  'OQ-220': { check: 'The OQ-207 machine deviation must carry occurredOn with basis visit-date, and a manual deviation logged with a stated occurredOn '
    + 'must read back that date with basis stated; no captureSource, or a 400 refusing occurredOn, fails FEATURE_ABSENT_AT_RELEASE.' },
  'OQ-221': { check: 'On an owned manual deviation the reviewer\'s unsigned POST /api/protocol-deviations/:id/assessment must answer 403 '
    + 'SIGNATURE_REQUIRED and the logger\'s signed one 403, appending no assess event; 503 DEVIATION_DECISIONS_DISABLED fails '
    + 'FEATURE_DISABLED_AT_TARGET and the unknown-route 404 FEATURE_ABSENT_AT_RELEASE.' },
  'OQ-222': { check: 'The reviewer\'s signed assessment (confirmed, not important) must answer 201; the assessment in force must state them, assessedBy '
    + 'the reviewer, a parseable assessedAt, an integer revision and the reviewer\'s signature with DEVIATION_ASSESSMENT_MEANING.' },
  'OQ-223': { check: 'Signed assessments confirmed without importance and not a deviation with importance must each answer 400, appending no assess event.' },
  'OQ-224': { check: 'After the reviewer\'s signed not-a-deviation assessment, a signed not-a-deviation closure must answer 403 to the assessor and 200 '
    + 'to the third person; the close event must record closureKind not-a-deviation by the third person with DEVIATION_CLOSURE_MEANING and the '
    + 'deviation must read closed.' },
  'OQ-225': { check: 'On the assessed deviation, with a retained original uploaded, the operator plans and completes; the operator\'s review (signed when '
    + 'an assessment is in force) must answer 403, the reviewer\'s unsigned review 403 and signed review 200. Without an assessment in force the '
    + 'independence part runs and the signature part fails FEATURE_ABSENT_AT_RELEASE or FEATURE_DISABLED_AT_TARGET.' },
  'OQ-226': { check: 'A corrective-action plan with a stale revision must answer 409 and, unless O-1 is absent or off, a signed assessment with a stale '
    + 'source hash 409; the deviation\'s history and revision must be unchanged.' },
  'OQ-227': { check: 'O-2 (spec P09 5.2.5): the policy workspace must read (a head answer, the deviation-id 400 or the unknown-route 404, fails '
    + 'FEATURE_ABSENT_AT_RELEASE); the operator\'s signed proposal must answer 201 and not be in force, the proposer\'s signed review 403, and the '
    + 'reviewer\'s signed acceptance 201, after which the OQ row is in force. 503 DEVIATION_DECISIONS_DISABLED fails FEATURE_DISABLED_AT_TARGET.' },
  'OQ-228': { check: 'With the OQ policy in force and escalation.maxWaitMinutes at least 70 (else ESCALATION_WINDOW_NOT_WAITED), a fresh owned '
    + 'deviation must show no escalation at 58 minutes, then exactly one escalate event (clock assessment, level 1) at least 59 minutes after it was '
    + 'logged, naming the one deviation_escalation task listed for it. None while the recipient is unconfirmed in the site staff list records '
    + 'RECIPIENT_UNAVAILABLE.' },
  'OQ-229': { check: 'Two cron cycles and 15 seconds after the OQ-228 escalation the deviation must still have one level-1 assessment escalate event '
    + 'and one deviation_escalation task.' },
  'OQ-230': { check: 'With the OQ policy in force and at least four minutes allowed, a fresh owned deviation with a corrective-action plan due a minute '
    + 'ago (a refusal naming the due date records DUE_AT_REFUSED) must show exactly one escalate event on a corrective-action clock within three '
    + 'cron cycles and 30 seconds (RECIPIENT_UNAVAILABLE as in OQ-228).' },
  'OQ-231': { check: 'Every escalate event of the OQ-228 and OQ-230 deviations and the task it names must carry no arm member (arm, armId, '
    + 'studyGroupId, treatment and the like) and must not repeat the deviation description.' },
  'OQ-232': { check: 'With a synthetic original in the OQ site\'s lifecycle evidence, the operator\'s signed contract.sent record must answer 201 and '
    + 'await review, the recorder\'s signed review 403, and the reviewer\'s signed acceptance 201, after which the record is in force.' },
  'OQ-233': { check: 'POST /api/sites/study/:studyId/milestone-measurements {requestKey} must answer 201; the measurement read by id must be exact bytes '
    + 'of edc-milestone-measurement/1 hashing to both X-Content-SHA256 headers and the record\'s contentHash; the list must show that hash; the same '
    + 'request key must answer 200 with the same id and hash.' },
  'OQ-234': { check: 'The OQ-233 checks on /api/sites/study/:studyId/effort-ledger (edc-effort-ledger/1).' },
  'OQ-235': { check: 'The OQ-233 checks on /api/data-cuts/latency-measurements {studyId, requestKey} (edc-latency-measurement/1 or /2).' },
  'OQ-236': { check: 'The blinded account\'s milestone measurement, effort ledger and latency measurement must each read back withheld with no '
    + 'arm-grouped content (allocation counts, per-arm target dates or first dosing, unwithheld windows ending at per-arm first dosing, byArm, a '
    + 'per-form arm), and its reads of the operator\'s included documents must answer 403; no included operator document records OPERATOR_NOT_UNBLINDED.' },
  'OQ-237': { check: 'M-2: POST /api/sites/study/:studyId/ta3-ledgers {requestKey} must answer 201 (the unknown-route 404 fails FEATURE_ABSENT_AT_RELEASE); '
    + 'the ledger read by id must be exact bytes of edc-ta3-ledger/1 matching its stated hashes, with every required member and one repeatable-read '
    + 'read-only snapshot; the blinded account\'s ledger must be withheld with no arm-grouped content and its list must show no included ledger.' },
  'OQ-238': { check: 'The OQ-234 request key with a different period (from and to) must answer 409, and the ledger read by id must keep its SHA-256.' },
  'OQ-239': { check: 'POST /api/regulatory-export/inspection-package/:studyId {requestKey} must answer 201 (a transport error is reconciled by reading '
    + 'the history, never resent); the history must list it with fileSha256, the download must hash to X-Source-SHA256 and that entry, its manifest '
    + 'must state edc-inspection-copy/1 or /2, and the same request key must answer 200 with the same package and hash.' },
  'OQ-240': { check: 'Every owned deviation of the run must be an acc_protocol_deviations row of the OQ-239 copy, with as many '
    + 'acc_deviation_action_events rows as its corrective-action history.' },
  'OQ-241': { check: 'INSPECTION_COPY_TA3_INVENTORY declared true: the OQ-239 manifest\'s additionalStores must hold every coverage table not segmented only '
    + 'and each late table whose item the run observed, and no segmented-only table (no TA3 table fails FEATURE_ABSENT_AT_RELEASE). Declared false: '
    + 'no TA3 table, recorded FEATURE_DISABLED_AT_TARGET (CONFIGURATION_MISMATCH when one is present). No declaration: NO_TARGET_CONFIGURATION.' },
  'OQ-242': { check: 'With both W-1 flags declared (else NO_TARGET_CONFIGURATION) and the TA3 flag true, the flat copy must state the segmented-only '
    + 'limitation and hold no acc_deviation_evaluations; POST {requestKey, profile: edc-inspection-copy/3} must answer 201 with packageVersion '
    + 'edc-inspection-copy/3 and 200 on replay, and the /3 history must list it. 503 SEGMENTED_INSPECTION_EXPORT_DISABLED fails '
    + 'FEATURE_DISABLED_AT_TARGET; the head\'s 400 for profile FEATURE_ABSENT_AT_RELEASE.' },
  'OQ-243': { check: 'Recorded not executed, SEGMENTED_READ_NOT_EXPOSED, with no request: segmented roots and parts reach only an M2M service '
    + 'credential until a user download route exists.' },
  'OQ-244': { check: 'As the monitor, POST /api/regulatory-export/inspection-package/:studyId and GET its history must each answer 403.' },
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
