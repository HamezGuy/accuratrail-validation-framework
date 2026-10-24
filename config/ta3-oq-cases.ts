import { e6r3, type E6R3Key } from './regulatory-scope';

/**
 * The TA3 OQ cases, OQ-206 to OQ-244 (suites 13 to 18; TA3 plan VAL-1, spec P20
 * 3.4). Data only: the OQ protocol prints each case from this list, and the TA3
 * runner (runners/oq-ta3-runner.ts) records each case's description, acceptance
 * criterion and regulatory reference from it. `needs` names the plan item whose
 * code the case exercises: without it at the release the case fails
 * FEATURE_ABSENT_AT_RELEASE. `accounts` are the ta3-oq-plan/1 accounts the case
 * acts as; a case whose account cannot log in is recorded not executed
 * (ACCOUNT_LOGIN_FAILED). The requirement IDs are the URS-081 to URS-098 of spec
 * P20 3.6. What the runner actually checks is RUNNER_CASE_CHECKS
 * (generators/helpers/evidence-linker.ts).
 */

export type Ta3Account = 'operator' | 'reviewer' | 'thirdPerson' | 'blinded' | 'monitor';
export const TA3_ACCOUNTS: readonly Ta3Account[] = ['operator', 'reviewer', 'thirdPerson', 'blinded', 'monitor'];

export interface Ta3OqCase {
  id: string;
  suite: number;
  title: string;
  requirement: string;
  /** 21 CFR Part 11 sections, without the section sign. */
  cfr: string;
  e6r3: readonly E6R3Key[];
  riskLevel: 'Critical' | 'High' | 'Medium' | 'Low';
  needs: string;
  accounts: readonly Ta3Account[];
  preconditions: string;
  steps: readonly string[];
  expectedResult: string;
}

const PLAN = 'A ta3-oq-plan/1 names the armed OQ study (a dedicated duplicate, never the study O-7 scores), its OQ site and the accounts';
const ENGINE = `${PLAN}; ENABLE_DEVIATION_ENGINE is on at the test stack`;
const DECISIONS = `${ENGINE}; ENABLE_DEVIATION_DECISIONS is on`;

export const TA3_OQ_CASES: readonly Ta3OqCase[] = [
  // Suite 13, Deviation Detection on Save and in the Sweep.
  {
    id: 'OQ-206', suite: 13, title: 'Engine Armed at the Target', requirement: 'URS-081', cfr: '11.10(a)',
    e6r3: ['nonCompliance', 'dataCapture'], riskLevel: 'Critical', needs: 'exists', accounts: ['operator'],
    preconditions: `${ENGINE}.`,
    steps: [
      'GET /api/deviation-engine/spec?studyId=<study> as the operator.',
      'Verify HTTP 200 with an active spec that has at least one machine rule; HTTP 503 naming ENABLE_DEVIATION_ENGINE records ENGINE_DISABLED.',
      'Verify that the spec hash of the first OQ receipt (OQ-207) equals the plan\'s expectedSpecHash.',
      'When the plan states expectedCslReleaseId, verify that the stored release binding names it.',
    ],
    expectedResult: 'The engine answers for the study with its active spec, the OQ receipts carry the expected spec hash, and the release binding names the expected CSL release when one is stated.',
  },
  {
    id: 'OQ-207', suite: 13, title: 'Save-Time Detection', requirement: 'URS-081', cfr: '11.10(a), 11.10(e)',
    e6r3: ['nonCompliance', 'dataCapture'], riskLevel: 'Critical', needs: 'exists', accounts: ['operator'],
    preconditions: `${ENGINE}; the operator's training for data entry is current where TRAINING_SERVICE_URL is set.`,
    steps: [
      'Enroll an owned synthetic subject at the OQ site and schedule the plan\'s visit.',
      'Save the plan\'s item with its violating value on the plan\'s form version; verify the save succeeds (the engine never blocks a save).',
      'Within the bounded wait, verify a new receipt by the saving user that marks the plan\'s save rule violated.',
      'Verify exactly one machine deviation for that subject and rule in the site\'s deviation log.',
    ],
    expectedResult: 'The save succeeds, a receipt by the saving user marks the rule violated, and exactly one machine deviation for the subject and rule is logged.',
  },
  {
    id: 'OQ-208', suite: 13, title: 'Save-Time Negative Control', requirement: 'URS-081', cfr: '11.10(a)',
    e6r3: ['nonCompliance', 'dataCapture'], riskLevel: 'High', needs: 'exists', accounts: ['operator'],
    preconditions: `${ENGINE}.`,
    steps: [
      'Enroll a second owned subject and save the plan\'s compliant value.',
      'Verify a receipt by the saving user that records the rule passed.',
      'Verify that no machine deviation exists for that subject and rule.',
    ],
    expectedResult: 'The compliant save is evaluated, the rule reads passed, and no deviation is logged.',
  },
  {
    id: 'OQ-209', suite: 13, title: 'Unevaluated Is Never Clean', requirement: 'URS-083', cfr: '11.10(a)',
    e6r3: ['nonCompliance'], riskLevel: 'High', needs: 'exists', accounts: ['operator'],
    preconditions: `${ENGINE}.`,
    steps: [
      'Enroll a third owned subject and read its outcomes at once.',
      'Verify no outcome and no passed state for the never-evaluated subject.',
      'If a sweep receipt already exists for it, retry once with a new subject; a second race records SWEEP_RACED.',
    ],
    expectedResult: 'A subject that was never evaluated shows no outcome, never a passed one.',
  },
  {
    id: 'OQ-210', suite: 13, title: 'Sweep Detection of an Absence Rule', requirement: 'URS-082', cfr: '11.10(a), 11.10(e)',
    e6r3: ['nonCompliance'], riskLevel: 'Critical', needs: 'exists (cron stage 5)', accounts: ['operator'],
    preconditions: `${ENGINE}; ENABLE_STUDY_TASK_CRON is on; the plan names an absence rule and its anchor date.`,
    steps: [
      'Enroll an owned subject at the absence rule\'s anchor date and enter no visit data.',
      'Poll the subject\'s receipts every 30 seconds within the plan\'s sweep.maxWaitMinutes.',
      'Verify a receipt by the system actor (user 1) that marks the absence rule violated, and one machine deviation for that subject and rule; otherwise SWEEP_NOT_OBSERVED.',
    ],
    expectedResult: 'The sweep evaluates the subject without any save and logs exactly one machine deviation for the absence rule.',
  },
  {
    id: 'OQ-211', suite: 13, title: 'No Duplicate Deviation', requirement: 'URS-081', cfr: '11.10(a)',
    e6r3: ['nonCompliance'], riskLevel: 'High', needs: 'exists', accounts: ['operator'],
    preconditions: 'OQ-207 logged its machine deviation.',
    steps: [
      'POST /api/deviation-engine/evaluate for the OQ-207 subject with unchanged data.',
      'Verify one more receipt and still exactly one machine deviation for the rule.',
    ],
    expectedResult: 'Re-evaluation adds a receipt and no second deviation.',
  },
  {
    id: 'OQ-212', suite: 13, title: 'Receipts Append-Only Through the API', requirement: 'URS-081', cfr: '11.10(e)',
    e6r3: ['auditTrails'], riskLevel: 'Critical', needs: 'exists', accounts: ['operator'],
    preconditions: 'OQ-207 produced its receipt.',
    steps: [
      'Read the OQ-207 receipt by id as exact bytes.',
      'Send PUT, PATCH and DELETE to /api/deviation-engine/evaluations/:id; each must answer 404 or 405.',
      'Read the receipt again and verify that its bytes are unchanged (API refusal only; the database triggers are native-suite evidence).',
    ],
    expectedResult: 'No API method changes or removes a receipt.',
  },
  {
    id: 'OQ-213', suite: 13, title: 'Correction Keeps History', requirement: 'URS-081', cfr: '11.10(e)',
    e6r3: ['dataCorrections', 'nonCompliance'], riskLevel: 'High', needs: 'exists', accounts: ['operator'],
    preconditions: 'OQ-207 logged its machine deviation.',
    steps: [
      'Correct the OQ-207 value to the compliant value with a reason for change.',
      'Verify a new receipt by the saving user that records the rule not violated.',
      'Verify that the earlier violated receipt stays in the subject\'s history.',
      'Verify that the machine deviation stays open until a person acts.',
    ],
    expectedResult: 'The correction is evaluated, history keeps the violated state, and the deviation is not closed by the system.',
  },
  {
    id: 'OQ-214', suite: 13, title: 'Follow-Up Task Through Domain Events', requirement: 'URS-081', cfr: '11.10(a)',
    e6r3: ['nonCompliance', 'qualityManagement'], riskLevel: 'High', needs: 'exists; flag off by default', accounts: ['operator'],
    preconditions: `${ENGINE}; ENABLE_DOMAIN_EVENTS is on; the plan names a study task with an action trigger on deviation.logged.`,
    steps: [
      'Verify that the plan\'s follow-up study task has an action trigger on deviation.logged.',
      'Within two cron cycles of the OQ-207 machine deviation, verify a workflow task from that study task that names the deviation.',
      'ENABLE_DOMAIN_EVENTS declared false records FEATURE_DISABLED_AT_TARGET.',
    ],
    expectedResult: 'A machine deviation raises the configured task through the domain-event chain.',
  },
  // Suite 14, Protocol Version Applicability.
  {
    id: 'OQ-215', suite: 14, title: 'Applicability Recording Is Restricted', requirement: 'URS-084', cfr: '11.10(g)',
    e6r3: ['protocolAndRecords'], riskLevel: 'High', needs: 'exists', accounts: ['operator', 'monitor'],
    preconditions: `${ENGINE}.`,
    steps: [
      'As the monitor, POST /api/deviation-engine/protocol-applicability for the OQ site: HTTP 403.',
      'As the operator (administrator or data manager), POST the owned record, an OQ version whose stated dates lie in 2099 so that no evaluation sees it: HTTP 201.',
    ],
    expectedResult: 'Only the roles that build studies record applicability.',
  },
  {
    id: 'OQ-216', suite: 14, title: 'Stated Applicability Dates', requirement: 'URS-084', cfr: '11.10(a)',
    e6r3: ['protocolAndRecords'], riskLevel: 'High', needs: 'exists', accounts: ['operator'],
    preconditions: 'OQ-215 recorded the owned version.',
    steps: [
      'GET /api/deviation-engine/protocol-applicability?studyId=<OQ site>.',
      'Verify that the owned record reads back effectiveFrom, ethicsApprovalDate and documentedOn exactly as stated, not the system date.',
      'Record the owned version withdrawn, so that it drops out of every later selection.',
    ],
    expectedResult: 'Applicability dates are the stated clinical dates.',
  },
  {
    id: 'OQ-217', suite: 14, title: 'Governing Version by Planned Date', requirement: 'URS-084', cfr: '11.10(a)',
    e6r3: ['protocolAndRecords', 'nonCompliance'], riskLevel: 'High', needs: 'exists', accounts: ['operator'],
    preconditions: `${ENGINE}; the plan states two established versions recorded at the OQ site and two enrollment dates.`,
    steps: [
      'Verify that both versions of the plan are current and established at the OQ site; otherwise VERSION_FIXTURE_ABSENT.',
      'Enroll owned subjects at the plan\'s early and late enrollment dates and evaluate each.',
      'Verify that the versioned rule\'s outcome names the first version for the visit planned before the second effectiveFrom, and the second version for the one planned on or after it.',
    ],
    expectedResult: 'The governing version follows the planned visit date at the site.',
  },
  {
    id: 'OQ-218', suite: 14, title: 'Unresolved Applicability Is Explicit', requirement: 'URS-084', cfr: '11.10(a)',
    e6r3: ['protocolAndRecords', 'nonCompliance'], riskLevel: 'High', needs: 'exists', accounts: ['operator'],
    preconditions: 'OQ-207 left an owned subject with a scheduled visit.',
    steps: [
      'Record an owned version unresolved at the OQ site.',
      'Re-evaluate the owned subject and verify that the rule\'s applicability reports version_status unresolved with no governing version, never a silent fallback.',
      'Record the owned version withdrawn.',
    ],
    expectedResult: 'An unresolved version is reported as unresolved.',
  },
  // Suite 15, Deviation Assessment and Reviewer Independence (FDA draft guidance on protocol deviations, December 2024).
  {
    id: 'OQ-219', suite: 15, title: 'Platform List Includes Site Deviations', requirement: 'URS-090', cfr: '11.10(d)',
    e6r3: ['nonCompliance'], riskLevel: 'High', needs: 'O-1', accounts: ['operator'],
    preconditions: `${PLAN}.`,
    steps: [
      'GET /api/protocol-deviations?studyId=<study>&includeSites=true.',
      'Verify that every OQ deviation of the OQ site is listed with O-1\'s record fields; a release without them records FEATURE_ABSENT_AT_RELEASE.',
    ],
    expectedResult: 'The platform read lists its sites\' deviations.',
  },
  {
    id: 'OQ-220', suite: 15, title: 'Occurrence Date and Basis', requirement: 'URS-085', cfr: '11.10(a)',
    e6r3: ['nonCompliance'], riskLevel: 'High', needs: 'O-1', accounts: ['operator'],
    preconditions: 'OQ-207 logged its machine deviation.',
    steps: [
      'Read the OQ-207 machine deviation: occurredOn with basis visit-date.',
      'Create a manual deviation with a stated occurredOn: basis stated.',
    ],
    expectedResult: 'Every deviation carries its occurrence date and the basis of that date.',
  },
  {
    id: 'OQ-221', suite: 15, title: 'Unsigned or Self Assessment Refused', requirement: 'URS-086', cfr: '11.10(g), 11.200',
    e6r3: ['nonCompliance', 'signatures'], riskLevel: 'Critical', needs: 'O-1', accounts: ['operator', 'reviewer'],
    preconditions: `${DECISIONS}.`,
    steps: [
      'POST /api/protocol-deviations/:id/assessment as the reviewer without password re-entry: refused.',
      'POST the signed assessment as the account that logged the deviation: HTTP 403.',
      'Verify that no assessment was appended.',
    ],
    expectedResult: 'An assessment needs a signature and a person other than the logger.',
  },
  {
    id: 'OQ-222', suite: 15, title: 'Signed Assessment by Another Person', requirement: 'URS-086', cfr: '11.50, 11.70',
    e6r3: ['nonCompliance', 'signatures'], riskLevel: 'Critical', needs: 'O-1', accounts: ['reviewer'],
    preconditions: `${DECISIONS}; the reviewer holds an investigator or data manager role at the OQ site.`,
    steps: [
      'POST the assessment (confirmed, not important) as the reviewer with password re-entry: accepted.',
      'Read the corrective-action workspace: the in-force assessment names the assessor, the time, the meaning DEVIATION_ASSESSMENT_MEANING and its revision.',
    ],
    expectedResult: 'The signed assessment is in force with its manifestation.',
  },
  {
    id: 'OQ-223', suite: 15, title: 'Importance Rules', requirement: 'URS-086', cfr: '11.10(a)',
    e6r3: ['nonCompliance'], riskLevel: 'High', needs: 'O-1', accounts: ['reviewer'],
    preconditions: `${DECISIONS}.`,
    steps: [
      'POST a signed assessment confirmed without importance: HTTP 400.',
      'POST a signed assessment not a deviation with importance: HTTP 400.',
    ],
    expectedResult: 'Importance is stated exactly when a deviation is confirmed.',
  },
  {
    id: 'OQ-224', suite: 15, title: 'Not-a-Deviation Closure Needs a Second Person', requirement: 'URS-087', cfr: '11.10(g), 11.50',
    e6r3: ['nonCompliance', 'signatures'], riskLevel: 'Critical', needs: 'O-1', accounts: ['reviewer', 'thirdPerson'],
    preconditions: `${DECISIONS}; the third person holds an investigator or data manager role at the OQ site.`,
    steps: [
      'Assess an owned deviation not a deviation, signed, as the reviewer.',
      'Close it as not a deviation, signed, as the assessor: refused.',
      'Close it as not a deviation, signed, as the third person: accepted, and the close event records closureKind not-a-deviation.',
    ],
    expectedResult: 'A not-a-deviation closure is made by a second person under signature.',
  },
  {
    id: 'OQ-225', suite: 15, title: 'Corrective-Action Review Independence', requirement: 'URS-087', cfr: '11.10(g), 11.50',
    e6r3: ['nonCompliance', 'qualityManagement'], riskLevel: 'High', needs: 'exists; the signature part needs O-1', accounts: ['operator', 'reviewer'],
    preconditions: `${PLAN}; OQ-222 left an assessment in force.`,
    steps: [
      'Record a corrective-action plan and its completion with a retained original as the operator (planner, owner and completer).',
      'Review it as the operator: HTTP 403.',
      'With an assessment in force, review it as the reviewer without a signature: refused; with a signature: accepted.',
    ],
    expectedResult: 'The effectiveness review is independent of the planner, owner and completer, and signed once an assessment is in force.',
  },
  {
    id: 'OQ-226', suite: 15, title: 'Stale Decision Refused', requirement: 'URS-087', cfr: '11.10(a), 11.10(e)',
    e6r3: ['nonCompliance'], riskLevel: 'High', needs: 'exists', accounts: ['operator', 'reviewer'],
    preconditions: `${PLAN}.`,
    steps: [
      'POST a corrective-action step with an old revision: HTTP 409.',
      'With O-1, POST a signed assessment with an old source hash: HTTP 409.',
      'Verify that the deviation\'s history is unchanged.',
    ],
    expectedResult: 'A decision made on stale evidence is refused and appends nothing.',
  },
  // Suite 16, Deviation Escalation Timing (runs last).
  {
    id: 'OQ-227', suite: 16, title: 'Escalation Policy Needs Two Signed People', requirement: 'URS-088', cfr: '11.10(g), 11.50',
    e6r3: ['qualityManagement', 'nonCompliance'], riskLevel: 'High', needs: 'O-2', accounts: ['operator', 'reviewer'],
    preconditions: `${DECISIONS}.`,
    steps: [
      'Propose the OQ escalation policy, signed, as the operator (one row for the OQ site: assessment level 1 after 1 hour, corrective action level 1 at 0 hours past due, the plan\'s recipient role).',
      'Review it as the proposer: refused; the proposal is not in force.',
      'Review it, signed, as the reviewer: accepted; the policy is in force.',
    ],
    expectedResult: 'An escalation policy is in force only after another person\'s signed review.',
  },
  {
    id: 'OQ-228', suite: 16, title: 'Unassessed Deviation Escalates Once at Level 1', requirement: 'URS-088', cfr: '11.10(a), 11.10(e)',
    e6r3: ['qualityManagement', 'nonCompliance'], riskLevel: 'High', needs: 'O-2', accounts: ['operator'],
    preconditions: 'OQ-227 put the policy in force; the plan allows a wait of at least 70 minutes; the recipient holds the recipient role at the OQ site or its parent.',
    steps: [
      'Create a fresh unassessed owned deviation at the OQ site.',
      'Poll every 30 seconds within escalation.maxWaitMinutes for its escalate event (clock assessment, level 1) and its task for the recipient role.',
      'Fewer than 70 minutes allowed records ESCALATION_WINDOW_NOT_WAITED; a recipient without the role records RECIPIENT_UNAVAILABLE.',
    ],
    expectedResult: 'Exactly one escalate event and one task for level 1.',
  },
  {
    id: 'OQ-229', suite: 16, title: 'Escalation Happens Exactly Once', requirement: 'URS-088', cfr: '11.10(a), 11.10(e)',
    e6r3: ['qualityManagement'], riskLevel: 'High', needs: 'O-2', accounts: ['operator'],
    preconditions: 'OQ-228 observed its escalation.',
    steps: [
      'Wait two further cron cycles.',
      'Verify still one escalate event and one task for that level.',
    ],
    expectedResult: 'No level escalates twice.',
  },
  {
    id: 'OQ-230', suite: 16, title: 'Overdue Corrective Action Escalates', requirement: 'URS-088', cfr: '11.10(a), 11.10(e)',
    e6r3: ['qualityManagement', 'nonCompliance'], riskLevel: 'High', needs: 'O-2', accounts: ['operator'],
    preconditions: 'OQ-227 put the policy in force; the plan allows a wait of at least four minutes.',
    steps: [
      'Create a fresh owned deviation and record a corrective-action plan whose dueAt has passed (refused by the EDC: DUE_AT_REFUSED).',
      'Within three cron cycles, verify one escalate event on the corrective-action clock.',
    ],
    expectedResult: 'An overdue corrective action escalates once.',
  },
  {
    id: 'OQ-231', suite: 16, title: 'Escalations Carry Codes Only, No Arm', requirement: 'URS-089', cfr: '11.10(a)',
    e6r3: ['blinding', 'nonCompliance'], riskLevel: 'High', needs: 'O-2', accounts: ['operator'],
    preconditions: 'OQ-228 or OQ-230 observed an escalation.',
    steps: [
      'Read every escalate event and escalation task of the OQ deviations.',
      'Verify that titles, descriptions and payloads carry codes, no deviation description and no arm member (D-25).',
    ],
    expectedResult: 'Escalation records reveal no treatment arm and no free text.',
  },
  // Suite 17, TA3 Metrics Ledger Records.
  {
    id: 'OQ-232', suite: 17, title: 'Milestone Recorded and Independently Reviewed', requirement: 'URS-095', cfr: '11.10(e), 11.50',
    e6r3: ['retention', 'signatures'], riskLevel: 'High', needs: 'exists', accounts: ['operator', 'reviewer'],
    preconditions: `${PLAN}; the operator and the reviewer hold an investigator or data manager role at the OQ site.`,
    steps: [
      'Upload a synthetic retained original to the OQ site\'s lifecycle evidence.',
      'Record contract.sent for the OQ site, signed (OPERATIONAL_MILESTONE_MEANING), as the operator: pending review, not in force.',
      'Review it as the recorder: HTTP 403.',
      'Review it, signed, as the reviewer: accepted and in force.',
    ],
    expectedResult: 'A milestone is in force only after another person\'s signed review.',
  },
  {
    id: 'OQ-233', suite: 17, title: 'Milestone Measurement by Exact Bytes', requirement: 'URS-096', cfr: '11.10(b), 11.10(c)',
    e6r3: ['retention'], riskLevel: 'High', needs: 'exists', accounts: ['operator'],
    preconditions: `${PLAN}.`,
    steps: [
      'POST /api/sites/study/:studyId/milestone-measurements {requestKey}.',
      'GET the measurement by id: its bytes hash to X-Content-SHA256 and to the list entry\'s contentHash.',
      'Repeat the request key: the same id and hash.',
    ],
    expectedResult: 'The measurement is retained as exact, hash-identified bytes and replays.',
  },
  {
    id: 'OQ-234', suite: 17, title: 'Effort Ledger by Exact Bytes', requirement: 'URS-096', cfr: '11.10(b), 11.10(c)',
    e6r3: ['retention'], riskLevel: 'High', needs: 'exists', accounts: ['operator'],
    preconditions: `${PLAN}.`,
    steps: [
      'POST /api/sites/study/:studyId/effort-ledger {requestKey}.',
      'GET the ledger by id: its bytes hash to X-Content-SHA256 and to the list entry\'s contentHash.',
      'Repeat the request key: the same id and hash.',
    ],
    expectedResult: 'The effort ledger is retained as exact, hash-identified bytes and replays.',
  },
  {
    id: 'OQ-235', suite: 17, title: 'Latency Measurement by Exact Bytes', requirement: 'URS-096', cfr: '11.10(b), 11.10(c)',
    e6r3: ['retention'], riskLevel: 'High', needs: 'exists', accounts: ['operator'],
    preconditions: `${PLAN}.`,
    steps: [
      'POST /api/data-cuts/latency-measurements {studyId, requestKey}.',
      'GET the measurement by id: its bytes hash to X-Content-SHA256 and to the list entry\'s contentHash.',
      'Repeat the request key: the same id and hash.',
    ],
    expectedResult: 'The latency measurement is retained as exact, hash-identified bytes and replays.',
  },
  {
    id: 'OQ-236', suite: 17, title: 'Measurement Documents Withhold Arms from Blinded Readers', requirement: 'URS-098', cfr: '11.10(d)',
    e6r3: ['blinding'], riskLevel: 'Critical', needs: 'exists', accounts: ['operator', 'blinded'],
    preconditions: `${PLAN}; the blinded account is blinded at the OQ site; the operator holds current unblinded authority.`,
    steps: [
      'Record a milestone measurement, an effort ledger and a latency measurement as the blinded account.',
      'Verify armGrouping withheld and no arm-grouped content in each document.',
      'Read the operator\'s included documents by id as the blinded account: refused.',
    ],
    expectedResult: 'A blinded reader never receives arm-level content.',
  },
  {
    id: 'OQ-237', suite: 17, title: 'One-Snapshot TA3 Ledger', requirement: 'URS-097', cfr: '11.10(b), 11.10(c)',
    e6r3: ['retention', 'blinding'], riskLevel: 'High', needs: 'M-2', accounts: ['operator', 'blinded'],
    preconditions: `${PLAN}.`,
    steps: [
      'POST /api/sites/study/:studyId/ta3-ledgers {requestKey}.',
      'GET the ledger by id: exact bytes with X-Content-SHA256, contract edc-ta3-ledger/1 and every required top-level member of its schema.',
      'As the blinded account, list and record ledgers: only withheld documents.',
    ],
    expectedResult: 'The TA3 ledger is one retained document of its published contract, and blinded readers see only withheld ones.',
  },
  {
    id: 'OQ-238', suite: 17, title: 'No Rewrite Under a Request Key', requirement: 'URS-096', cfr: '11.10(c), 11.10(e)',
    e6r3: ['retention'], riskLevel: 'High', needs: 'exists', accounts: ['operator'],
    preconditions: 'OQ-234 retained its effort ledger.',
    steps: [
      'POST the effort ledger again with the same request key and a different period (from and to).',
      'Verify HTTP 409 and that the original ledger bytes are unchanged.',
    ],
    expectedResult: 'A request key never rewrites a retained document.',
  },
  // Suite 18, Inspection Copy Completeness (W-1, spec P17 2.2.1 to 2.2.7).
  {
    id: 'OQ-239', suite: 18, title: 'Flat Inspection Copy Byte for Byte', requirement: 'URS-094', cfr: '11.10(b)',
    e6r3: ['essentialRecords', 'retention'], riskLevel: 'Critical', needs: 'exists', accounts: ['operator'],
    preconditions: `${PLAN}; the operator holds current unblinded export authority for every scope.`,
    steps: [
      'POST /api/regulatory-export/inspection-package/:studyId {requestKey}.',
      'Read the history and download the copy: its bytes hash to X-Source-SHA256 and to the history entry.',
      'Verify schemaVersion edc-inspection-copy/1 or /2, and that the same request key replays the same package.',
    ],
    expectedResult: 'The flat copy is retrievable byte for byte with its hash and replays.',
  },
  {
    id: 'OQ-240', suite: 18, title: 'Deviation Records in the Copy', requirement: 'URS-091', cfr: '11.10(b), 11.10(e)',
    e6r3: ['essentialRecords', 'nonCompliance'], riskLevel: 'Critical', needs: 'exists', accounts: ['operator'],
    preconditions: 'OQ-239 retained the copy after the deviation suites ran.',
    steps: [
      'Read acc_protocol_deviations and acc_deviation_action_events from the copy.',
      'Verify every OQ deviation and its action events, with counts equal to the API reads.',
    ],
    expectedResult: 'The copy holds every deviation record and its decision history.',
  },
  {
    id: 'OQ-241', suite: 18, title: 'Flat TA3 Inventory Follows Its Flag', requirement: 'URS-091', cfr: '11.10(b)',
    e6r3: ['essentialRecords', 'retention'], riskLevel: 'Critical', needs: 'W-1 (late tables with their items)', accounts: ['operator'],
    preconditions: 'OQ-239 retained the copy; a validation-target-configuration/1 declaration states INSPECTION_COPY_TA3_INVENTORY.',
    steps: [
      'Declared true: verify that the copy\'s additional stores hold every coverage table that is neither segmented only nor late, no segmented-only table, and each late table whose item this run observed; name every missing table.',
      'Declared true with no TA3 table: FEATURE_ABSENT_AT_RELEASE. Declared false: verify no TA3 table and record FEATURE_DISABLED_AT_TARGET. No declaration: NO_TARGET_CONFIGURATION.',
    ],
    expectedResult: 'The flat copy carries the TA3 inventory exactly when its flag is on.',
  },
  {
    id: 'OQ-242', suite: 18, title: 'Receipts Segmented Only, Segmented Copy Generated', requirement: 'URS-092', cfr: '11.10(b), 11.10(c)',
    e6r3: ['essentialRecords', 'retention'], riskLevel: 'High', needs: 'W-1', accounts: ['operator'],
    preconditions: 'A declaration states ENABLE_SEGMENTED_INSPECTION_EXPORT and INSPECTION_COPY_TA3_INVENTORY.',
    steps: [
      'With the TA3 flag declared true, verify W-1\'s limitation line naming the segmented-only domains and no acc_deviation_evaluations rows in the flat copy.',
      'POST {requestKey, profile: edc-inspection-copy/3}: HTTP 201, and 200 on replay, with packageVersion edc-inspection-copy/3; GET ?profile=edc-inspection-copy/3 lists it.',
      'HTTP 503 SEGMENTED_INSPECTION_EXPORT_DISABLED records FEATURE_DISABLED_AT_TARGET; the head\'s 400 for the profile member records FEATURE_ABSENT_AT_RELEASE.',
    ],
    expectedResult: 'Receipts are only in the segmented representation, which is generated on request.',
  },
  {
    id: 'OQ-243', suite: 18, title: 'Segmented Copy Content', requirement: 'URS-093', cfr: '11.10(b), 11.10(e)',
    e6r3: ['essentialRecords', 'retention'], riskLevel: 'High', needs: 'W-1 and a later user download route', accounts: ['operator'],
    preconditions: 'A user route that downloads segmented roots and parts.',
    steps: [
      'Read the /3 copy: every OQ receipt and the blobs it references, and its coverage index recording auditChain valid with no truncated chain.',
      'Roots and parts are served only through the sponsor-access read to an M2M service credential, so the case records SEGMENTED_READ_NOT_EXPOSED until a user download route exists; W-1\'s native suite (RUN_INSPECTION_SEGMENT_SOURCE_PG=1) is the supporting evidence.',
    ],
    expectedResult: 'The segmented copy holds every receipt and a valid audit-chain result.',
  },
  {
    id: 'OQ-244', suite: 18, title: 'Inspection Copy Role Restriction', requirement: 'URS-094', cfr: '11.10(d), 11.10(g)',
    e6r3: ['essentialRecords'], riskLevel: 'High', needs: 'exists', accounts: ['monitor'],
    preconditions: `${PLAN}.`,
    steps: [
      'As the monitor, POST /api/regulatory-export/inspection-package/:studyId and GET its history.',
      'Verify HTTP 403 for both.',
    ],
    expectedResult: 'Only administrators and data managers generate and read inspection copies.',
  },
];

/** The catalog entry of one TA3 case; an unknown ID is a defect. */
export function ta3OqCase(id: string): Ta3OqCase {
  const found = TA3_OQ_CASES.find(entry => entry.id === id);
  if (!found) throw new Error(`No TA3 OQ case ${id} is catalogued.`);
  return found;
}

/** The Part 11 sections and the ICH E6(R3) references of a case, as its evidence records them (also the TA3 PQ
 * cases of config/ta3-pq-cases.ts, which carry the same two members). */
export function ta3RegulatoryRef(entry: Pick<Ta3OqCase, 'cfr' | 'e6r3'>): string {
  const sections = entry.cfr.split(',').map(section => `§${section.trim()}`).join(', ');
  return [sections, ...entry.e6r3.map(e6r3)].join('; ');
}
