import { e6r3, type E6R3Key } from './regulatory-scope';
import { pilotPqCase } from './ta3-pq-cases';

/**
 * The TA3 platform requirements, URS-081 to URS-101, each with its functional
 * requirement FRS-087 to FRS-107 (TA3 plan VAL-1, spec P20 3.6). Data only: the
 * URS (03) prints the requirements and their planned verification, the FRS (04)
 * the functional requirements with the cases of that verification, and the
 * traceability matrix (06) one row per requirement, so a case list is written
 * once. A requirement cites a runner case only where that case's implemented
 * check (RUNNER_CASE_CHECKS, generators/helpers/evidence-linker.ts) matches the
 * activity; anything else is an explicit gap. Every OQ case of suites 13 to 18
 * is cited by the requirement its catalog entry names (config/ta3-oq-cases.ts).
 * Implementation references are libreclinicaapi paths unless they name this
 * framework.
 */

/** One planned verification activity of a user requirement. It cites a runner case
 * only where the case's actual check (RUNNER_CASE_CHECKS) matches the activity;
 * otherwise it is a gap. */
export interface PlannedVerification {
  activity: string;
  cases: string[];
  /** What the cited cases do not cover, or why no executed case is mapped. */
  note?: string;
}

export const verify = (activity: string, cases: string[], note?: string): PlannedVerification => ({ activity, cases, note });
export const gap = (activity: string, note: string): PlannedVerification => ({ activity, cases: [], note });

export interface Ta3Requirement {
  id: string;
  title: string;
  description: string;
  priority: 'Must' | 'Should' | 'Could';
  risk: 'Critical' | 'High' | 'Medium' | 'Low';
  /** 21 CFR Part 11 sections, without the section sign. */
  part11Ref: string;
  /** The ICH E6(R3) topics of the URS cross-reference matrix. */
  e6r3: readonly E6R3Key[];
  acceptance: string;
  rationale: string;
  context: string;
  planned: readonly PlannedVerification[];
  /** The one functional requirement that implements it. */
  frs: { id: string; requirement: string; implementation: string };
}

const ENGINE_ROUTES = 'src/routes/deviation-engine.routes.ts';
const DEVIATION_ROUTES = 'src/routes/protocol-deviation.routes.ts';
const CORRECTIVE_ACTIONS = 'src/services/database/deviation-corrective-actions.service.ts';

export const TA3_REQUIREMENTS: readonly Ta3Requirement[] = [
  // Protocol deviations (TA3 plan section o): detection, applicability, records, assessment, escalation.
  {
    id: 'URS-081', title: 'Deviation rules evaluated on every clinical save',
    description: 'The system SHALL evaluate the governing deviation rules on every clinical save without blocking the save, and SHALL keep each evaluation as an append-only receipt',
    priority: 'Must', risk: 'Critical', part11Ref: '11.10(a), 11.10(e)', e6r3: ['nonCompliance', 'dataCapture'],
    acceptance: 'A violating save succeeds and yields a receipt by the saving user that marks the rule violated and exactly one machine deviation; a compliant save yields a passing receipt and no deviation; re-evaluation adds no second deviation; receipts cannot be changed through the API; a correction keeps the violated state in history',
    rationale: '21 CFR Part 11 §11.10(a) requires a validated system to perform accurately, reliably and consistently, and '
      + `${e6r3('nonCompliance')} requires noncompliance with the protocol to be identified and acted on. Detection on save is how `
      + 'the platform finds deviations when the data are entered, so a missed, duplicated or silently changed evaluation would '
      + 'misstate protocol compliance for the whole trial.',
    context: 'The engine evaluates a subject after the save has committed, logs a deviation only when a rule newly changes to violated, '
      + 'never closes one itself, and stores manual-review and missing-data outcomes as exactly that. It runs only where '
      + 'ENABLE_DEVIATION_ENGINE is true, which stays off in the live trial until a change-control record and this OQ evidence exist '
      + '(D-04); the follow-up task also needs ENABLE_DOMAIN_EVENTS.',
    planned: [
      verify('Engine armed for the study, with the expected spec hash and CSL release binding', ['OQ-206']),
      verify('Violating save accepted and detected with exactly one machine deviation', ['OQ-207']),
      verify('Compliant save evaluated as passed with no deviation', ['OQ-208']),
      verify('Re-evaluation of unchanged data adds a receipt and no second deviation', ['OQ-211']),
      verify('Receipts refused change through the API and read back unchanged', ['OQ-212'],
        'API refusal only; the database triggers are evidence of the EDC native suites.'),
      verify('A correction is evaluated, the violated state stays in history and the deviation stays open', ['OQ-213']),
      verify('A machine deviation raises the configured follow-up task through domain events', ['OQ-214'],
        'ENABLE_DOMAIN_EVENTS is off by default; declared off, the case records FEATURE_DISABLED_AT_TARGET.'),
    ],
    frs: {
      id: 'FRS-087',
      requirement: 'Deviation rules shall be evaluated for the saved subject after every clinical save commits; a deviation shall be logged only when a rule newly changes to violated and never closed by the engine; every evaluation shall be kept as an append-only receipt carrying the spec hash, submission hash and actor',
      implementation: 'src/services/deviation-engine/deviation-evaluation.service.ts (evaluation after the committed save, transition-only logging, no automatic closure); '
        + 'src/services/deviation-engine/deviation-v2-migration.ts (acc_deviation_evaluations, append-only by trigger); '
        + `${ENGINE_ROUTES} (spec, outcome, evaluate and receipt routes; HTTP 503 while ENABLE_DEVIATION_ENGINE is off)`,
    },
  },
  {
    id: 'URS-082', title: 'Absence rules evaluated by a daily sweep',
    description: 'The system SHALL evaluate absence rules (missed visits, visit windows, visits after disposition) by a sweep at least daily, with the same logic as on save',
    priority: 'Must', risk: 'Critical', part11Ref: '11.10(a)', e6r3: ['nonCompliance'],
    acceptance: 'A subject enrolled at the absence rule\'s anchor date with no visit data receives, within the sweep interval, a receipt by the system actor that marks the rule violated and exactly one machine deviation',
    rationale: 'A visit that never happened produces no save, so evaluation on save alone can never detect it. 21 CFR Part 11 §11.10(a) and '
      + `${e6r3('nonCompliance')} require these deviations to be found reliably, which needs an evaluation that runs without any user action.`,
    context: 'The sweep evaluates every subject with no outcome or with outcomes older than 23 hours, as the system actor (user 1), from '
      + 'stage 5 of the study-task worker, which runs every minute while ENABLE_STUDY_TASK_CRON is not false. A stack with the worker '
      + 'switched off never sweeps.',
    planned: [
      verify('A subject without visit data is evaluated by the sweep and its absence rule logs one machine deviation', ['OQ-210'],
        'the wait is bounded by the plan\'s sweep.maxWaitMinutes; a sweep not observed in that time fails SWEEP_NOT_OBSERVED.'),
      gap('The sweep runs at least once a day on the deployed configuration',
        'No case observes a whole day; IQ-033 records the declared ENABLE_STUDY_TASK_CRON value.'),
    ],
    frs: {
      id: 'FRS-088',
      requirement: 'A sweep shall evaluate every subject that has no outcome or whose outcomes are older than 23 hours, as the system actor, through the same evaluation service as a save',
      implementation: 'src/services/deviation-engine/deviation-sweep.service.ts (subject selection, SWEEP_STALE_AFTER_MS of 23 hours, system actor user 1); '
        + 'src/services/study-task-cron.service.ts (stage 5, every minute while ENABLE_STUDY_TASK_CRON is not false)',
    },
  },
  {
    id: 'URS-083', title: 'Unevaluated subjects never reported compliant',
    description: 'The system SHALL report a subject that has not been evaluated as unevaluated, never as compliant',
    priority: 'Must', risk: 'High', part11Ref: '11.10(a)', e6r3: ['nonCompliance'],
    acceptance: 'A subject read before any evaluation shows no outcome or an explicit unevaluated state, and no passed rule',
    rationale: 'Reporting an unchecked subject as compliant would hide exactly the subjects whose deviations nobody has looked for. '
      + `${e6r3('nonCompliance')} and 21 CFR Part 11 §11.10(a) require the system to tell "checked and compliant" from "not checked".`,
    context: 'Outcomes exist only for evaluated rules; manual-review and missing-data outcomes are stored as such and never count as a pass. '
      + 'A sweep that evaluates the subject between its enrollment and the read makes the case retry once with a new subject.',
    planned: [
      verify('A never-evaluated subject shows no passed outcome', ['OQ-209'],
        'a sweep that races the read twice records SWEEP_RACED (not executed).'),
    ],
    frs: {
      id: 'FRS-089',
      requirement: 'Outcome reads shall return no outcome for a rule never evaluated, and manual-review and skipped-for-missing-data outcomes shall be stored as such and never counted as passed',
      implementation: 'src/services/deviation-engine/deviation-evaluation.service.ts (manual_review_required and skipped_missing_data stored, never a pass); '
        + `acc_deviation_rule_outcomes; ${ENGINE_ROUTES} (outcome and receipt reads)`,
    },
  },
  {
    id: 'URS-084', title: 'Governing protocol version per site and planned visit',
    description: 'The system SHALL choose the governing protocol version per site and planned visit from stated applicability records, and SHALL report unresolved applicability explicitly',
    priority: 'Must', risk: 'High', part11Ref: '11.10(a), 11.10(g)', e6r3: ['protocolAndRecords', 'nonCompliance'],
    acceptance: 'Only study builders record applicability; the stated dates read back exactly; a visit planned before a version\'s effective date is evaluated under the earlier version and one on or after it under the later; an unresolved version is reported unresolved',
    rationale: 'Sites move to a protocol amendment at different times, after their own ethics approval, so the rules that govern a visit '
      + `depend on the site and the visit date. ${e6r3('protocolAndRecords')} and 21 CFR Part 11 §11.10(a) and §11.10(g) require the `
      + 'governing version to be decided from stated, authorized records rather than the system date.',
    context: 'Applicability records state effectiveFrom, ethicsApprovalDate and documentedOn per site and are recorded by administrators and '
      + 'data managers only; a version approved but not yet established is unresolved. Evaluations never fall back silently to another version.',
    planned: [
      verify('Applicability recording refused to the monitor and accepted for a study builder', ['OQ-215']),
      verify('Stated applicability dates read back exactly', ['OQ-216']),
      verify('Governing version follows the planned visit date at the site', ['OQ-217'],
        'needs the plan\'s two established versions (VERSION_FIXTURE_ABSENT otherwise).'),
      verify('Unresolved applicability reported explicitly', ['OQ-218']),
    ],
    frs: {
      id: 'FRS-090',
      requirement: 'Protocol version applicability shall be recorded per site with stated dates by administrators and data managers only, and each evaluation shall name the governing version for the planned visit date or report it unresolved',
      implementation: 'src/services/deviation-engine/protocol-applicability.ts (acc_protocol_version_applicability; established and unresolved versions); '
        + `${ENGINE_ROUTES} (protocol-applicability GET and POST, SOURCE_ROLES); src/services/deviation-engine/deviation-evaluation.service.ts (applicability on each outcome)`,
    },
  },
  {
    id: 'URS-085', title: 'Deviation occurrence date, basis and source',
    description: 'Each deviation SHALL carry its occurrence date and the basis of that date, its site, its rule and spec hash for machine detections, and its detection source',
    priority: 'Must', risk: 'High', part11Ref: '11.10(a)', e6r3: ['nonCompliance'],
    acceptance: 'A machine deviation carries occurredOn with basis visit-date; a manual deviation logged with a stated date carries basis stated; every deviation states its capture source',
    rationale: 'Assessment, escalation clocks, trending and SDTM DV all start from when a deviation occurred, not when it was typed. '
      + `${e6r3('nonCompliance')} and 21 CFR Part 11 §11.10(a) need each record to state that date, how it was established and which rule `
      + 'and spec found it.',
    context: 'O-1 added the occurrence date and its basis (stated, dv-form, visit-date, window-closed, anchor-date, evaluation-date or '
      + 'recorded-date), the evaluation and release spec hashes and the capture source (log or DV form) to the deviation log.',
    planned: [
      verify('Machine deviation dated by its visit and manual deviation by its stated date', ['OQ-220']),
      gap('Spec hash on every machine deviation',
        'OQ-219 and OQ-220 require O-1\'s captureSource to be present; no case compares the stored spec hashes with the receipt.'),
    ],
    frs: {
      id: 'FRS-091',
      requirement: 'Each deviation record shall store its occurrence date with its basis, the evaluation and release spec hashes for machine detections, and its capture source',
      implementation: 'src/services/database/deviation-record-completeness-migration.ts (occurred_on, occurred_on_basis, evaluation_spec_hash, release_spec_hash and capture_source on acc_protocol_deviations); '
        + 'src/services/deviation-engine/deviation-occurrence.ts; src/services/database/protocol-deviation.service.ts',
    },
  },
  {
    id: 'URS-086', title: 'Signed assessment by a person other than the logger',
    description: 'The disposition and importance of a deviation SHALL be assessed by an authorized person other than its logger, under a Part 11 signature bound to the record',
    priority: 'Must', risk: 'Critical', part11Ref: '11.50, 11.70, 11.200', e6r3: ['nonCompliance', 'signatures'],
    acceptance: 'An unsigned assessment and the logger\'s own assessment are refused; another person\'s signed assessment is in force with assessor, time, meaning and revision; importance is stated exactly when a deviation is confirmed',
    rationale: '21 CFR Part 11 §11.50, §11.70 and §11.200 require a signed decision to show who signed, when and what the signature means, '
      + `bound to the record. ${e6r3('nonCompliance')} and the FDA draft guidance on protocol deviations (December 2024) make the `
      + 'assessment of whether a deviation is important a decision of a qualified person.',
    context: 'An O-1 assessment states confirmed or not a deviation, and important or not, signed with DEVIATION_ASSESSMENT_MEANING and '
      + 'password re-entry, and is refused to the logger. The decision routes answer 503 DEVIATION_DECISIONS_DISABLED while '
      + 'ENABLE_DEVIATION_DECISIONS is off.',
    planned: [
      verify('Unsigned assessment and self assessment refused', ['OQ-221']),
      verify('Signed assessment by another person in force with its manifestation', ['OQ-222']),
      verify('Importance stated exactly when a deviation is confirmed', ['OQ-223']),
    ],
    frs: {
      id: 'FRS-092',
      requirement: 'A deviation assessment shall be refused to its logger and without password re-entry, and an accepted assessment shall record assessor, time, revision and the canonical assessment meaning',
      implementation: `${DEVIATION_ROUTES} (POST /:deviationId/assessment, ASSESS_ROLES, DEVIATION_ASSESSMENT_MEANING; 503 DEVIATION_DECISIONS_DISABLED while ENABLE_DEVIATION_DECISIONS is off); `
        + `${CORRECTIVE_ACTIONS} (the assess event in acc_deviation_action_events); src/middleware/part11.middleware.ts`,
    },
  },
  {
    id: 'URS-087', title: 'Independent corrective-action review and closure',
    description: 'Corrective-action review and not-a-deviation closure SHALL be independent of the action owner and of the assessor, and their history SHALL be append-only',
    priority: 'Must', risk: 'Critical', part11Ref: '11.10(g), 11.50', e6r3: ['nonCompliance', 'qualityManagement'],
    acceptance: 'The planner, owner or completer cannot review a corrective action; with an assessment in force the review is signed; a not-a-deviation closure by the assessor is refused and accepted from a third person under signature; a decision on a stale revision or source hash is refused and appends nothing',
    rationale: 'An effectiveness review by the person who did the work, or a dismissal by the person who assessed it, is no independent check. '
      + `21 CFR Part 11 §11.10(g) and §11.50, with ${e6r3('qualityManagement')}, require authority checks and signed, attributable `
      + 'decisions, and the append-only history keeps every decision reconstructible.',
    context: 'Corrective actions are plan, complete, review, close and reopen events in acc_deviation_action_events; a request carrying an '
      + 'old revision or source hash is refused with HTTP 409. The signed review and the not-a-deviation closure are O-1 decision paths, '
      + 'switched on by ENABLE_DEVIATION_DECISIONS.',
    planned: [
      verify('Not-a-deviation closure refused to the assessor and accepted from a third person under signature', ['OQ-224']),
      verify('Effectiveness review refused to the planner, owner and completer, and signed once an assessment is in force', ['OQ-225']),
      verify('Decision on a stale revision or source hash refused, appending nothing', ['OQ-226']),
    ],
    frs: {
      id: 'FRS-093',
      requirement: 'Corrective-action effectiveness review shall be refused to the planner, action owner and completer and be signed once an assessment is in force; a not-a-deviation closure shall be refused to the assessor; a stale revision or source hash shall be refused with HTTP 409',
      implementation: `${CORRECTIVE_ACTIONS} (independent review, revision and source-hash checks, append-only events); `
        + 'src/services/database/deviation-corrective-actions-migration.ts (acc_deviation_action_events, acc_deviation_action_evidence); '
        + `${DEVIATION_ROUTES} (corrective-action and close routes, DEVIATION_CLOSURE_MEANING)`,
    },
  },
  {
    id: 'URS-088', title: 'Escalation under a signed, independently approved policy',
    description: 'Unassessed deviations and overdue corrective actions SHALL escalate under a signed, independently approved policy, with one escalation and one task per level and the times recorded',
    priority: 'Must', risk: 'High', part11Ref: '11.10(a), 11.10(e), 11.50', e6r3: ['qualityManagement', 'nonCompliance'],
    acceptance: 'A policy is in force only after a different person\'s signed review; an unassessed deviation escalates exactly once at level 1 after the policy\'s hours with one task for the named role; an overdue corrective action escalates once; no level escalates twice',
    rationale: 'Deviations left unassessed and corrective actions left overdue are quality failures that must reach a responsible person on a '
      + `clock rather than when someone happens to look. ${e6r3('qualityManagement')} and 21 CFR Part 11 §11.10(a), §11.10(e) and §11.50 `
      + 'require the policy to be a signed, attributable decision and each escalation to be recorded once with its times.',
    context: 'O-2 keeps the platform study\'s policy ledger (propose and review by different people) and escalates from a stage of the '
      + 'study-task worker: one escalate event per deviation, clock and level, with a deviation_escalation task for the holders of the '
      + 'named role at the site or its parent. With no holder the attempt is held (RECIPIENT_UNAVAILABLE) and no task is created. It runs '
      + 'only while ENABLE_DEVIATION_DECISIONS is on.',
    planned: [
      verify('Policy in force only after another person\'s signed review', ['OQ-227']),
      verify('Unassessed deviation escalates once at level 1 with one task', ['OQ-228'],
        'needs a wait of at least 70 minutes (ESCALATION_WINDOW_NOT_WAITED otherwise); a missing escalation records RECIPIENT_UNAVAILABLE only '
          + 'when O-2 holds the level so coded or both staff lists show nobody in the role.'),
      verify('No level escalates twice', ['OQ-229']),
      verify('Overdue corrective action escalates once', ['OQ-230']),
    ],
    frs: {
      id: 'FRS-094',
      requirement: 'A deviation policy shall be in force only after a different person\'s signed review, and a stage of the study-task worker shall escalate each due level of each deviation exactly once, with one deviation_escalation task for the named role and its times recorded',
      implementation: 'src/services/database/deviation-escalation.service.ts (policy proposal and review, processDueDeviationEscalations); '
        + 'src/services/deviation-engine/deviation-escalation-policy.ts (edc-deviation-escalation-policy/1); '
        + 'src/services/database/deviation-escalation-migration.ts (acc_deviation_escalation_policy_event, acc_deviation_escalation_attempt); '
        + `${DEVIATION_ROUTES} (escalation-policy GET and POST)`,
    },
  },
  {
    id: 'URS-089', title: 'No treatment arm in deviation records and escalations',
    description: 'Deviation records, decision events and escalation tasks SHALL carry no treatment arm, and arm-level deviation detail SHALL be available to unblinded roles only',
    priority: 'Must', risk: 'High', part11Ref: '11.10(d)', e6r3: ['blinding'],
    acceptance: 'Escalate events and escalation tasks carry codes, no deviation description and no arm member',
    rationale: 'Arm-level deviation counts or texts can reveal allocation to blinded staff. '
      + `${e6r3('blinding')} and the platform rule that blinding never widens (D-25) require deviation records and the tasks they raise to name no treatment arm.`,
    context: 'Escalate events and deviation_escalation tasks carry the clock, level, recipient role and codes only, and the task description is '
      + 'fixed text. Arm-level deviation trending (O-3) is a later item and reaches only the unblinded role.',
    planned: [
      verify('Escalate events and tasks carry codes and no arm', ['OQ-231']),
      gap('Deviation records and decision events read by a blinded account carry no arm',
        'No case reads deviation records as the blinded account; OQ-236 covers measurement documents only.'),
    ],
    frs: {
      id: 'FRS-095',
      requirement: 'Escalate events and escalation tasks shall carry clock, level, recipient role and codes only, with no treatment arm and no deviation text',
      implementation: 'src/services/database/deviation-escalation.service.ts (a deviation.escalated payload of codes; fixed task title and description); '
        + `${CORRECTIVE_ACTIONS} (appendSystemEscalation)`,
    },
  },
  {
    id: 'URS-090', title: 'Platform deviation list includes site deviations',
    description: 'The platform deviation list SHALL include the deviations filed at its sites',
    priority: 'Must', risk: 'High', part11Ref: '11.10(b), 11.10(d)', e6r3: ['nonCompliance'],
    acceptance: 'A platform read with includeSites lists every deviation of its sites with O-1\'s record fields, within the caller\'s scope',
    rationale: 'Platform oversight reviews deviations across every site of the platform study, and a list that filters on the exact study '
      + `misses every deviation filed at a site. 21 CFR Part 11 §11.10(b) and ${e6r3('nonCompliance')} require that review to see the complete record set.`,
    context: 'O-1 adds includeSites to GET /api/protocol-deviations: a platform read then returns its sites\' rows too, limited to the '
      + 'members of the study family the caller may read. Machine deviations are filed at the subject\'s own site, so the exact-study read misses them.',
    planned: [
      verify('Platform list with includeSites lists the OQ site\'s deviations', ['OQ-219']),
    ],
    frs: {
      id: 'FRS-096',
      requirement: 'GET /api/protocol-deviations with includeSites shall list the deviations of the platform study and of its sites, limited to the study family members the caller may read',
      implementation: `${DEVIATION_ROUTES} (listQuery includeSites); src/controllers/protocol-deviation.controller.ts; src/services/database/protocol-deviation.service.ts`,
    },
  },
  // The inspection copy (TA3 plan section w).
  {
    id: 'URS-091', title: 'Inspection copy holds the TA3 records',
    description: 'A retained, hash-identified inspection copy SHALL include the deviation records and their decision history, rule specifications, outcomes and history, applicability, milestones, effort, retained documents, latency and escalation records',
    priority: 'Must', risk: 'Critical', part11Ref: '11.10(b), 11.10(e)', e6r3: ['essentialRecords', 'retention'],
    acceptance: 'The flat copy holds every deviation and its action events with counts equal to the API reads and, with INSPECTION_COPY_TA3_INVENTORY on, every table of the TA3 coverage list that is not segmented only',
    rationale: `21 CFR Part 11 §11.10(b) requires accurate and complete copies for inspection, and ${e6r3('essentialRecords')} treats these `
      + 'records as essential records of the trial. A copy that leaves out the deviation rule history or the TA3 measurement records '
      + 'cannot support an inspection of the TA3 uses.',
    context: 'Deviation records and their action events are exported today. W-1 adds 39 TA3 tables to flat copies only when '
      + 'INSPECTION_COPY_TA3_INVENTORY is true (default false), then a late block of tables owned by later items; it has not landed at the EDC head.',
    planned: [
      verify('Flat copy retrieved byte for byte with its hash', ['OQ-239']),
      verify('Every deviation and its action events in the copy', ['OQ-240']),
      verify('Flat TA3 inventory follows INSPECTION_COPY_TA3_INVENTORY', ['OQ-241'],
        'needs W-1 (FEATURE_ABSENT_AT_RELEASE without it) and a configuration declaration (NO_TARGET_CONFIGURATION without one).'),
    ],
    frs: {
      id: 'FRS-097',
      requirement: 'The inspection copy shall export the deviation records and their action events and, with INSPECTION_COPY_TA3_INVENTORY on, the tables of the TA3 coverage list that are not segmented only',
      implementation: 'src/services/database/fda-inspection-export.service.ts (INSPECTION_STORES; the ta3 tables are W-1\'s, not landed at the EDC head); '
        + 'src/controllers/regulatory-export.controller.ts; framework config/ta3-inspection-coverage.ts (the expected list)',
    },
  },
  {
    id: 'URS-092', title: 'Evaluation receipts in the segmented copy only',
    description: 'Evaluation receipts too large for the flat copy SHALL be exported in the segmented format, and the flat copy SHALL state the domains it excludes',
    priority: 'Must', risk: 'High', part11Ref: '11.10(b), 11.10(c)', e6r3: ['essentialRecords', 'retention'],
    acceptance: 'With the TA3 inventory on, the flat copy states the segmented-only domains and holds no receipt rows, and a request for edc-inspection-copy/3 is generated and listed',
    rationale: '21 CFR Part 11 §11.10(b) and §11.10(c) require complete copies that protect the records. Receipts and their evidence blobs '
      + 'are too large for one flat file, so they go to the segmented representation, and the flat copy names the domains it leaves out '
      + 'so that no reader takes it for complete.',
    context: 'The segmented representation edc-inspection-copy/3 exists at the EDC head, but no user route reaches it; W-1 adds the profile '
      + 'member behind ENABLE_SEGMENTED_INSPECTION_EXPORT (default false; off answers 503 SEGMENTED_INSPECTION_EXPORT_DISABLED).',
    planned: [
      verify('Flat copy states the segmented-only domains and the segmented copy is generated on request', ['OQ-242'],
        'needs W-1 and both W-1 flags declared.'),
    ],
    frs: {
      id: 'FRS-098',
      requirement: 'Flat copies shall leave out evaluation receipts and evidence blobs and state that limitation, and a request with profile edc-inspection-copy/3 shall generate the segmented copy while ENABLE_SEGMENTED_INSPECTION_EXPORT is on',
      implementation: 'src/services/database/inspection-segment-generation.service.ts (edc-inspection-copy/3); src/services/database/fda-inspection-export.service.ts; '
        + 'W-1\'s profile member on POST /api/regulatory-export/inspection-package/:studyId (not landed at the EDC head)',
    },
  },
  {
    id: 'URS-093', title: 'Audit-chain result recorded in the copy',
    description: 'The inspection copy SHALL record the per-study audit-chain verification result at capture',
    priority: 'Must', risk: 'High', part11Ref: '11.10(b), 11.10(e)', e6r3: ['essentialRecords', 'auditTrails'],
    acceptance: 'The segmented copy holds every receipt and the blobs it references, and its coverage index records auditChain valid with no truncated chain',
    rationale: 'An inspector relies on the copy to show that the records were not altered. 21 CFR Part 11 §11.10(b) and §11.10(e), with '
      + `${e6r3('auditTrails')}, require the audit trail and its integrity result to travel with the copy.`,
    context: 'The audit-chain result exists only in the segmented representation, whose roots and parts are served only by the sponsor-access '
      + 'read to an M2M service credential, never to a user account; a user download route is a later item. Meanwhile W-1\'s native suite '
      + '(RUN_INSPECTION_SEGMENT_SOURCE_PG=1) asserts the result.',
    planned: [
      verify('Segmented content and the audit-chain result', ['OQ-243'],
        'recorded not executed (SEGMENTED_READ_NOT_EXPOSED) until a user route downloads segmented copies.'),
    ],
    frs: {
      id: 'FRS-099',
      requirement: 'The segmented copy shall carry each receipt with the blobs it references and a coverage index recording the audit-chain verification result',
      implementation: 'src/services/database/inspection-segment-generation.service.ts; src/services/database/sponsor-access.service.ts (the segmented-internal read for an M2M credential); '
        + 'the W-1 coverage index (spec P17 2.2.4)',
    },
  },
  {
    id: 'URS-094', title: 'Copies retrievable byte for byte by authorized roles',
    description: 'Inspection copies SHALL be retrievable byte for byte with their hash, by authorized roles only',
    priority: 'Must', risk: 'Critical', part11Ref: '11.10(b), 11.10(d)', e6r3: ['essentialRecords', 'retention'],
    acceptance: 'The download hashes to X-Source-SHA256 and to its history entry; the same request key replays the same package; a monitor is refused',
    rationale: '21 CFR Part 11 §11.10(b) requires accurate and complete copies and §11.10(d) limits access to authorized individuals. '
      + `${e6r3('retention')} requires retained records to be retrievable unchanged by the people entitled to them.`,
    context: 'Generation, history and download are open to administrators and data managers with export permission, and the generator also '
      + 'needs current unblinded export authority for every scope; the download sets X-Source-SHA256.',
    planned: [
      verify('Flat copy hashes to its header and history entry and replays under its request key', ['OQ-239']),
      verify('Monitor refused generation and history', ['OQ-244']),
    ],
    frs: {
      id: 'FRS-100',
      requirement: 'Inspection copies shall be generated, listed and downloaded only by administrators and data managers with export permission, served as exact bytes with X-Source-SHA256, and replayed under the same request key',
      implementation: 'src/routes/regulatory-export.routes.ts (inspection-package routes, admin and data_manager, canExportData); '
        + 'src/controllers/regulatory-export.controller.ts (X-Source-SHA256); src/services/database/fda-inspection-export.service.ts (unblinded export authority for every scope)',
    },
  },
  // The metrics ledger (TA3 plan shared foundation 3).
  {
    id: 'URS-095', title: 'Signed milestones in force only after independent review',
    description: 'Typed operational milestones SHALL be recorded under signature and SHALL be in force only after an independent signed review',
    priority: 'Must', risk: 'High', part11Ref: '11.10(e), 11.50', e6r3: ['signatures', 'retention'],
    acceptance: 'A signed milestone record awaits review; the recorder\'s review is refused; another person\'s signed review puts it in force',
    rationale: 'The TA3 timing metrics are computed from these milestones, so each one is a signed attestation backed by its retained '
      + `original. 21 CFR Part 11 §11.10(e) and §11.50, with ${e6r3('signatures')}, require the record and its independent review to be signed and attributable.`,
    context: 'Milestones are record and review events in acc_operational_milestone_event, signed with OPERATIONAL_MILESTONE_MEANING and backed '
      + 'by a retained original from the site\'s lifecycle evidence; a person other than the recorder accepts or rejects each record once.',
    planned: [
      verify('Milestone recorded under signature, review by the recorder refused, in force after another person\'s signed review', ['OQ-232']),
    ],
    frs: {
      id: 'FRS-101',
      requirement: 'A milestone shall be recorded with its retained original under signature and be in force only after a different person\'s signed review',
      implementation: 'src/services/database/operational-milestone.service.ts (record and review, reviewer independent of the recorder); '
        + 'src/services/database/operational-milestone-migration.ts (acc_operational_milestone_event); src/routes/site.routes.ts (milestone and lifecycle evidence routes); '
        + 'OPERATIONAL_MILESTONE_MEANING in src/middleware/part11.middleware.ts',
    },
  },
  {
    id: 'URS-096', title: 'Retained measurement documents as exact bytes',
    description: 'Retained measurement documents SHALL be immutable and retrievable as exact bytes with their SHA-256, and a repeated request key SHALL return the original',
    priority: 'Must', risk: 'High', part11Ref: '11.10(b), 11.10(c)', e6r3: ['retention'],
    acceptance: 'Milestone measurements, effort ledgers and latency measurements read back as bytes that hash to X-Content-SHA256 and to the list\'s contentHash; the same request key returns the same id and hash; a different body under the same key is refused with HTTP 409 and the bytes stay unchanged',
    rationale: 'Every TA3 metric value names the document and hash it came from, so a document must never change once it is retained. '
      + `21 CFR Part 11 §11.10(b) and §11.10(c), with ${e6r3('retention')}, require accurate copies and protected records.`,
    context: 'Measurement documents are kept as artifacts with their hash and summary in acc_retained_document (milestone measurements and '
      + 'effort ledgers) and acc_latency_measurement, append-only, and served as exact bytes with X-Content-SHA256.',
    planned: [
      verify('Milestone measurement, effort ledger and latency measurement read as exact bytes that replay', ['OQ-233', 'OQ-234', 'OQ-235']),
      verify('A different body under the same request key refused and the bytes unchanged', ['OQ-238']),
    ],
    frs: {
      id: 'FRS-102',
      requirement: 'Milestone measurements, effort ledgers and latency measurements shall be retained append-only with their SHA-256, served as exact bytes with X-Content-SHA256, replayed under the same request key and refused with HTTP 409 for a different body',
      implementation: 'src/services/data-factory/catalog/milestone-measurement.service.ts, effort-ledger.service.ts and latency-measurement.service.ts; '
        + 'src/services/data-factory/catalog/retained-document.ts (acc_retained_document); src/routes/site.routes.ts and src/routes/data-cut.routes.ts (measurement routes)',
    },
  },
  {
    id: 'URS-097', title: 'One-snapshot TA3 ledger of its published schema',
    description: 'The TA3 ledger document SHALL be read in one database snapshot and SHALL conform to its published schema',
    priority: 'Must', risk: 'High', part11Ref: '11.10(b), 11.10(c)', e6r3: ['retention'],
    acceptance: 'A ledger request yields exact bytes of edc-ta3-ledger/1 with every required member, and a blinded caller sees only withheld ledgers',
    rationale: 'The ledger is the one document Command Center reads for the TA3 metrics, and reading its parts at different moments could '
      + `combine inconsistent states. 21 CFR Part 11 §11.10(b) and §11.10(c), with ${e6r3('retention')}, require an accurate, protected copy.`,
    context: 'M-2 builds the ledger, a retained document per platform study and date read in one snapshot, with its contract edc-ta3-ledger/1; '
      + 'it has not landed at the EDC head, so the case fails FEATURE_ABSENT_AT_RELEASE. The one-snapshot read itself is native-suite evidence of M-2.',
    planned: [
      verify('Ledger retained as exact bytes of its contract and withheld from blinded readers', ['OQ-237'],
        'needs M-2; the one-snapshot read is evidence of M-2\'s native suite, not of this case.'),
    ],
    frs: {
      id: 'FRS-103',
      requirement: 'A TA3 ledger request shall read milestones, derived milestones, checkpoint hours and pointers in one repeatable-read snapshot and retain the result as exact bytes of edc-ta3-ledger/1',
      implementation: 'The M-2 TA3 ledger service and src/services/data-factory/contracts/edc-ta3-ledger-v1.schema.json (M-2, not landed at the EDC head); POST /api/sites/study/:studyId/ta3-ledgers',
    },
  },
  {
    id: 'URS-098', title: 'Measurement documents withhold arms from blinded readers',
    description: 'Measurement documents SHALL withhold arm grouping from blinded readers',
    priority: 'Must', risk: 'Critical', part11Ref: '11.10(d)', e6r3: ['blinding'],
    acceptance: 'Documents a blinded account records read back withheld with no arm-grouped content, and its reads of included documents are refused',
    rationale: 'Per-arm milestone and enrollment timing can reveal allocation. '
      + `${e6r3('blinding')} and the rule that blinding never widens (D-25) require blinded readers to receive arm-free documents only.`,
    context: 'Each retained document records its arm grouping (included, withheld or not-applicable); a blinded caller gets withheld documents '
      + 'and is refused an included one.',
    planned: [
      verify('Blinded account receives withheld documents and is refused included ones', ['OQ-236']),
    ],
    frs: {
      id: 'FRS-104',
      requirement: 'A measurement document recorded or read by a blinded principal shall be withheld, with no arm-grouped content, and a blinded read of an included document shall be refused',
      implementation: 'src/services/data-factory/catalog/effort-ledger.service.ts and latency-measurement.service.ts (arm grouping withheld from blinded readers); '
        + 'src/services/data-factory/catalog/milestone-measurement.service.ts; arm_grouping on acc_retained_document',
    },
  },
  {
    id: 'URS-099', title: 'Retained TA3 documents survive redeployment',
    description: 'Retained TA3 documents SHALL survive a redeployment of the API service with their exact bytes',
    priority: 'Must', risk: 'High', part11Ref: '11.10(c)', e6r3: ['retention'],
    acceptance: 'After a redeployment every retained document reads back with its recorded SHA-256',
    rationale: `21 CFR Part 11 §11.10(c) requires records to be protected and readily retrievable throughout their retention period, and ${e6r3('retention')} `
      + 'requires the same of trial records. A document written only to a container\'s disk is lost when the container is replaced.',
    context: 'Retained document bytes are written under DATA_CUT_ARTIFACT_PATH, by default ./artifacts on the container disk. N-STORE adds a '
      + 'PostgreSQL copy of the bytes, used only while ENABLE_ARTIFACT_DATABASE_COPY is true, which is false in the production profile.',
    planned: [
      gap('Every retained document reads back with its hash after a redeployment',
        'Open gap (N-STORE): the PostgreSQL copy is off in .env.production.example and no case redeploys the API service.'),
    ],
    frs: {
      id: 'FRS-105',
      requirement: 'Retained document bytes shall be stored where a redeployment of the API service does not remove them',
      implementation: 'src/services/data-factory/catalog/artifact-store.ts (DATA_CUT_ARTIFACT_PATH, default ./artifacts); the PostgreSQL byte copy under ENABLE_ARTIFACT_DATABASE_COPY '
        + '(src/config/environment.ts; src/cli/artifact-bytes-backfill.ts), off in the production profile',
    },
  },
  // Validation of the platform for the TA3 uses (TA3 plan item VAL-1).
  {
    id: 'URS-100', title: 'Validation status record for every TA3 system',
    description: 'Every computerised system used for a TA3 purpose SHALL have a validation status record that lists its evidence or its gap',
    priority: 'Must', risk: 'High', part11Ref: '11.10(a)', e6r3: ['validation'],
    acceptance: 'The platform validation summary lists every inventory system with its qualification statement, its hash-verified evidence or an explicit gap with its plan item, and never reports a system qualified',
    rationale: `${e6r3('validation')} requires the computerised systems of a trial to be validated in proportion to their risk, and 21 CFR Part 11 `
      + '§11.10(a) requires the systems that hold the records to be validated. The platform spans fourteen systems, so the status of each, '
      + 'evidence or gap, must be visible before any of them is relied on.',
    context: 'Document 22 (22-platform-validation-summary.md and platform-validation-summary.json) is generated from config/platform-inventory.ts. '
      + 'It quotes each system\'s statement from its current bytes, verifies the evidence a platform-validation-evidence-plan/1 cites by hash, '
      + 'and leaves approval to the eTMF.',
    planned: [
      gap('Every inventory system shows its evidence or its gap',
        'Not a runner case: generator 22 produces the record, and the framework\'s contract and cross-repo tests check it '
        + '(tests/platform-summary.contract.test.ts, tests/cross-repo.contract.test.ts).'),
    ],
    frs: {
      id: 'FRS-106',
      requirement: 'The platform validation summary shall quote each system\'s statement with its file hash and line, verify cited evidence by hash, list each gap with its plan item and probe, and never report a system qualified',
      implementation: 'accuratrail-validation-framework generators/22-platform-validation-summary.ts; config/platform-inventory.ts; runners/platform-evidence-plan.ts; '
        + 'collectors/workspace-paths.ts',
    },
  },
  {
    id: 'URS-101', title: 'Validation evidence retained, sealed and approved in the eTMF',
    description: 'Validation evidence SHALL be retained in hashed packages that cannot be overwritten, and SHALL be approved by QA in the eTMF',
    priority: 'Must', risk: 'High', part11Ref: '11.10(a), 11.10(c)', e6r3: ['validation', 'essentialRecords'],
    acceptance: 'A package directory is created exclusively and sealed by package-manifest.json; npm run verify:package fails on any changed, extra or missing file; QA approves the filed manifest as a signed eTMF governance decision',
    rationale: `${e6r3('validation')} and 21 CFR Part 11 §11.10(a) require validation documentation that can be shown to an inspector `
      + 'unchanged, and §11.10(c) requires such records to be protected. Approval is a person\'s act: the package carries no signature, '
      + 'and QA records the approval in the eTMF.',
    context: 'runners/evidence-package.ts creates each package exclusively, seals it with a hashed, read-only manifest and verifies it; '
      + 'TMF-FILING.md tells the validation lead and a different QA lead how to file and approve it. A Part 11 signature on that decision '
      + 'needs IL_TMF_SIGNATURE=required.',
    planned: [
      gap('Packages created exclusively, sealed and verified',
        'Not a runner case: runners/evidence-package.ts and npm run verify:package, checked by tests/evidence-package.contract.test.ts.'),
      gap('QA approval recorded in the eTMF',
        'A person\'s act in the Intelligence Layer eTMF (TMF-FILING.md); this framework signs nothing (D-21).'),
    ],
    frs: {
      id: 'FRS-107',
      requirement: 'A retained package shall be created exclusively under its retention root, sealed by a hashed, read-only package-manifest.json and verified by npm run verify:package; approval shall be recorded in the eTMF, never in the package',
      implementation: 'accuratrail-validation-framework runners/evidence-package.ts (createPackage, sealPackage, verifyPackage); scripts/verify-package.ts; '
        + 'generators/helpers/tmf-filing.ts (TMF-FILING.md); the IL eTMF governance decision (manual)',
    },
  },
];

/** The runner cases a requirement's planned verification cites, in order, each once. */
export function ta3RequirementCases(requirement: Ta3Requirement): string[] {
  return [...new Set(requirement.planned.flatMap(item => item.cases))];
}

/*
 * The lab-to-endpoint pilot requirements, URS-102 to URS-126, each with its functional requirement FRS-108 to
 * FRS-132 (backlog LE-7.2; plan revision 3 sections 9 and 10; the TA3 plan item VAL-1 extended to the pilot's
 * intended use). URS-102 to URS-121 are the acceptance cases A1 to A20, URS-122 the G3 bound and URS-123 to
 * URS-126 the computerised-system validation controls. Each cites exactly one pilot case of PILOT_PQ_CASES
 * (config/ta3-pq-cases.ts), whose risk, Part 11 sections, ICH E6(R3) topics and pass criterion it takes, so the
 * criterion is written once. The URS (03), FRS (04) and traceability matrix (06) print them in their
 * "Lab-to-Endpoint Pilot (CDISCPILOT01)" category through the same code as the TA3 requirements; the pilot
 * validation plan (23) prints the requirement-to-test matrix. Implementation references name the owning
 * repository and the backlog item that builds it.
 */

/** What every pilot case leaves to the evidence it admits, stated once in each planned verification. */
const ADMITS_BY_HASH = 'The framework admits the run\'s verdict for this case only with every cited evidence file verified by SHA-256, '
  + 'complete coverage and a key sealed before the run; it does not re-judge the evidence content, which the LE-7.3 observer produces.';
const DERIVATION = 'accuratrail-validation-framework runners/pilot-evidence.ts (derivePilotResults, behind VALIDATION_PILOT_ACCEPTANCE_IMPORT)';

interface PilotRequirementInput {
  id: string;
  caseId: string;
  title: string;
  description: string;
  rationale: string;
  context: string;
  activity: string;
  frs: { id: string; requirement: string; implementation: string };
}

function pilotRequirement(input: PilotRequirementInput): Ta3Requirement {
  const pqCase = pilotPqCase(input.caseId);
  if (pqCase.requirement !== input.id) throw new Error(`${input.caseId} names ${pqCase.requirement}, not ${input.id}.`);
  return {
    id: input.id, title: input.title, description: input.description, priority: 'Must', risk: pqCase.riskLevel,
    part11Ref: pqCase.cfr, e6r3: pqCase.e6r3, acceptance: pqCase.passesWhen,
    rationale: input.rationale, context: input.context,
    planned: [verify(input.activity, [input.caseId], ADMITS_BY_HASH)],
    frs: { ...input.frs, implementation: `${input.frs.implementation}; ${DERIVATION}` },
  };
}

const CRITICAL_CLASSES = 'a wrong participant or specimen linkage, a wrong value or unit in an analysis input, a falsely verified '
  + 'action, unblinding of a blinded role, or a permitted consent-restricted use';

export const PILOT_REQUIREMENTS: readonly Ta3Requirement[] = [
  pilotRequirement({
    id: 'URS-102', caseId: 'PQA-001', title: 'Protocol requirement traced to the endpoint result (A1)',
    description: 'The platform SHALL trace each protocol requirement of the pilot endpoint through its form item and laboratory definition to the observation, the derived variable and the result',
    rationale: `${e6r3('dataCapture')} and 21 CFR Part 11 §11.10(a) and §11.10(e) require data to be attributable and traceable to source. `
      + 'The pilot endpoint (ALT change from baseline at Week 24 by arm) is only credible when every value can be followed back to the requirement it answers.',
    context: 'CDISCPILOT01 definitions are authored and signed in CSL (D-A1, LE-3.4); the EDC captures, BW derives ADLB (LE-6.2), the CC evaluator compares with ADLBC (LE-6.3) and the LE-7.3 observer takes the lineage census (G8).',
    activity: 'Lineage census of the 113 Week 24 ALT values and the reference comparison, from the reconstructed pilot run',
    frs: { id: 'FRS-108', requirement: 'Each released ADLB value shall carry a lineage record naming its protocol citation, CSL definition, EDC item, source observation and derivation; the run shall count values without one',
      implementation: 'ClinicalSemanticLayer csl-authored release (LE-3.4, LE-3.10); BiometricsWorkbench ADLB derivation (LE-6.2); CommandCenter synthetic-trial/evaluate/reference comparator (LE-6.3); lineage census of the LE-7.3 observer' },
  }),
  pilotRequirement({
    id: 'URS-103', caseId: 'PQA-002', title: 'Specimen and identity linkage, units and censored results (A2)',
    description: 'The platform SHALL keep different specimens and participant or event identities apart, refuse ambiguous linkage and incompatible unit assumptions, standardise one analyte reported in different units identically and never coerce a censored result',
    rationale: `A wrong linkage or unit in an analysis input is a critical failure (plan section 10). ${e6r3('dataCapture')} and §11.10(a) require the system to keep values exactly as reported and attributed to the right participant.`,
    context: 'The real data carry 6 censored results and conventional and SI pairs for bilirubin, glucose and albumin; the overlay adds specimen ids and an ambiguous linkage. D-LE-13 keeps a censored value as character with its limit and comparator.',
    activity: 'Linkage refusals, unit standardisation and censored-value storage, from the reconstructed pilot run',
    frs: { id: 'FRS-109', requirement: 'Lab intake shall refuse an ambiguous participant, event or specimen linkage with its ambiguity state, refuse a unit it cannot convert, convert by UCUM to the standard unit and store censored results as character with limit and comparator',
      implementation: 'ClinicalSemanticLayer lab transfer semantics (LE-3.6), units and conversion (LE-3.7), regional identity crosswalk (LE-3.8)' },
  }),
  pilotRequirement({
    id: 'URS-104', caseId: 'PQA-003', title: 'Correction reason, retained value and missing rationale (A3)',
    description: 'The platform SHALL record a site correction with its reason for change, a retained-value decision, and an edit without rationale with the rationale status missing rather than a sentinel string',
    rationale: `${e6r3('dataCorrections')} and 21 CFR Part 11 §11.10(e) require every change to keep the previous value and the reason; a sentinel string reads as a reason that was never given.`,
    context: 'LE-4.1 maps the EDC sentinel reasons to stated, coded-only or missing; LE-4.12 and LE-4.13 carry the status unchanged into CSL and BW; LE-4.4 separates action and outcome verification.',
    activity: 'Correction, retained-value decision and rationale status read back in the EDC, CSL and BW, from the reconstructed pilot run',
    frs: { id: 'FRS-110', requirement: 'The EDC shall classify each change\'s rationale as stated, coded-only or missing and the CSL and BW projections shall carry that status unchanged; a retained-value resolution shall close verified without a value change',
      implementation: 'libreclinicaapi form-save reason gate and rationale status (LE-4.1); ClinicalSemanticLayer decision index and clinical projection (LE-4.2, LE-4.4, LE-4.12); BiometricsWorkbench cell and decision views (LE-4.13)' },
  }),
  pilotRequirement({
    id: 'URS-105', caseId: 'PQA-004', title: 'Form definition change apart from response correction (A4)',
    description: 'The platform SHALL show a form-definition change separately from a participant-response correction, identify the affected deployed versions and keep collected data under the definition and form version they were collected under',
    rationale: `${e6r3('protocolAndRecords')} and §11.10(e) require collected records to keep their context; rewriting a collected form\'s structure would change what a participant\'s answer meant.`,
    context: 'LE-4.10 stops template propagation rewriting instances that hold data and adds instance form amendments.',
    activity: 'Collected form versions before and after the overlay amendment and a form-version migration, from the reconstructed pilot run',
    frs: { id: 'FRS-111', requirement: 'Template propagation shall not rewrite the structure of a form instance that holds data; a form-definition change and a response correction shall be different record types',
      implementation: 'libreclinicaapi form-propagation.service.ts and study-definition-form-amendment.ts (LE-4.10)' },
  }),
  pilotRequirement({
    id: 'URS-106', caseId: 'PQA-005', title: 'Discrepancy to verified resolution and regenerated analysis (A5)',
    description: 'The platform SHALL take a cross-system discrepancy through a signed raise-query decision, the site\'s correction with its reason, verification on a later system revision and regeneration of the dependent analysis',
    rationale: `A falsely verified action is a critical failure. ${e6r3('dataCorrections')}, §11.50 and §11.70 require the decision to be signed and bound to its record, and the resolution to be read back from the system of record.`,
    context: 'LE-4.5 runs the real EDC query path (PR-11.C); LE-4.6 has BW regenerate on closure; LE-4.4 records action and outcome verification separately. G2 times every hop.',
    activity: 'Hop records, signed decision, EDC correction, later-revision verification and BW regeneration, from the reconstructed pilot run',
    frs: { id: 'FRS-112', requirement: 'A query shall be raised only from a signed decision, closed verified only on readback of a later EDC revision, and its closure shall trigger an analysis regeneration plan',
      implementation: 'ClinicalSemanticLayer action proposals and query source (LE-4.5, LE-4.4); libreclinicaapi edc-query-intake; BiometricsWorkbench regeneration plan (LE-4.6)' },
  }),
  pilotRequirement({
    id: 'URS-107', caseId: 'PQA-006', title: 'Duplicates, relabels, late corrections and unknown outcomes (A6)',
    description: 'The platform SHALL handle duplicate events, corrections, relabels, late corrections, concurrent edits, failed writes and ambiguous timeouts without duplicate or falsely verified effects',
    rationale: `§11.10(a) and §11.10(f) require accurate and correctly sequenced operation; ${e6r3('dataCapture')} requires that retried or reordered transfers change nothing they should not.`,
    context: 'LE-4.3 adds the outcome-unknown state with no path to verified without readback; LE-3.6 detects and codes the L1 to L11 delivery faults.',
    activity: 'Each injected fault with its record or refusal and every unknown outcome resolved by readback, from the reconstructed pilot run',
    frs: { id: 'FRS-113', requirement: 'A command whose outcome is unknown shall be held outcome_unknown until readback resolves it; duplicates, corrections and relabels shall be told apart by natural key and content',
      implementation: 'CommandCenter control.command outcome-unknown state and transition table (LE-4.3); ClinicalSemanticLayer lab transfer semantics (LE-3.6)' },
  }),
  pilotRequirement({
    id: 'URS-108', caseId: 'PQA-007', title: 'Scoped amendment activation and blinded arm change (A7)',
    description: 'The platform SHALL activate an amendment for one site or open-label scope while another stays on its old release, detect a new requirement without a dependency edge, and keep blinded roles unable to infer allocation from an arm-specific change',
    rationale: `${e6r3('protocolAndRecords')} requires the governing version per site; ${e6r3('blinding')} requires that no configuration change reveals allocation.`,
    context: 'LE-4.9 builds the impact assessment chain (G9); LE-5.7 the blinded-configuration check with a blinding-impact assessment per arm-scoped assignment.',
    activity: 'Per-site release state, impact plan, blinded-role views and the out-of-scope diff, from the reconstructed pilot run',
    frs: { id: 'FRS-114', requirement: 'Amendment activation shall be scoped to the declared sites or open-label scope; an arm-scoped change shall be refused unless blinded roles see identical forms, schedules, requisitions and layouts',
      implementation: 'ClinicalSemanticLayer impact assessment chain (LE-4.9); libreclinicaapi arm lifecycle blinded-configuration check (LE-5.7)' },
  }),
  pilotRequirement({
    id: 'URS-109', caseId: 'PQA-008', title: 'Optional consent restriction and restricted uses (A8)',
    description: 'The platform SHALL enforce an optional-consent restriction and the EDC reconsent gate, block the optional use while a permission is unknown and refuse restricted joins and exports',
    rationale: `A permitted consent-restricted use is a critical failure (plan section 10). ${e6r3('gcp')} requires participants\' consent to govern every use of their data.`,
    context: 'The consent records are a declared synthetic overlay (D-A8); unknown blocks and raises a site query (D-LE-7); LE-5.6 records every export with recipient, purpose, scope and digest.',
    activity: 'Data-use evaluations, the blocked use, the site query and the refused joins and exports, from the reconstructed pilot run',
    frs: { id: 'FRS-115', requirement: 'Data-use evaluation shall report unknown when no permission is recorded, unknown shall block the optional use, and a restricted join or export shall be refused with a code',
      implementation: 'ClinicalSemanticLayer DataUsePolicyV1 consent route (LE-5.1) and export controls (LE-5.6); libreclinicaapi reconsent gate; BiometricsWorkbench restricted joins' },
  }),
  pilotRequirement({
    id: 'URS-110', caseId: 'PQA-009', title: 'Alternative baseline held as a scoped version (A9)',
    description: 'The platform SHALL hold a statistician\'s alternative mapping or baseline rule as a scoped version, report the affected records, derived values and pooled outputs, and keep by-arm outputs from blinded roles',
    rationale: `${e6r3('reviewOfData')} requires analysis choices to be documented and reproducible; ${e6r3('blinding')} forbids by-arm results to blinded roles.`,
    context: 'The real unscheduled 1.x retests give the alternative baseline; LE-6.6 holds it as a scoped version with a per-value diff; LE-5.4 partitions unblinding per study and allocation level.',
    activity: 'Per-value diff of the alternative definition and the blinded-role read, from the reconstructed pilot run',
    frs: { id: 'FRS-116', requirement: 'An alternative derivation shall be a scoped version over the same cut with a per-derived-value diff; blinded roles shall see pooled impact only',
      implementation: 'BiometricsWorkbench revision impact and regeneration plan (LE-6.6); study unblinding partition (LE-5.4)' },
  }),
  pilotRequirement({
    id: 'URS-111', caseId: 'PQA-010', title: 'Earlier analysis reproduced from pinned inputs (A10)',
    description: 'The platform SHALL reproduce an earlier analysis from its pinned inputs after source, document and mapping changes and SHALL identify superseded outputs explicitly',
    rationale: `${e6r3('validation')} and §11.10(b) require records that can be reproduced accurately for inspection; ${e6r3('retention')} requires them to stay retrievable.`,
    context: 'LE-6.4 makes the analysis release owned by BW, pinning the CSL snapshot when configured, with a reproduction gate (G7).',
    activity: 'Re-run output digests against the release and the superseded-output list, from the reconstructed pilot run',
    frs: { id: 'FRS-117', requirement: 'An analysis release shall pin its inputs and declared tolerances; a re-run shall compare every output digest and list superseded outputs',
      implementation: 'BiometricsWorkbench analysis release and reproduction gate (LE-6.4)' },
  }),
  pilotRequirement({
    id: 'URS-112', caseId: 'PQA-011', title: 'Standards finding mapped to evidence (A11)',
    description: 'The platform SHALL map each standards finding back to its original evidence, SHALL distinguish a skipped or erroring validation from verified coverage and SHALL report a defect no selected rule can reach as not covered, never as a pass',
    rationale: `${e6r3('reviewOfData')} and §11.10(a) require a validation result to state what was checked; a skipped rule counted as coverage overstates conformance.`,
    context: 'BW runs CORE V1.0 (LE-6.10, LE-6.11; OD-15, OD-18) on the SDTMIG 3.4 datasets it produces and, through an imported-dataset input pinned by its data-use manifest SHA-256, on the unchanged SDTMIG 3.1.2 pilot files under an explicitly selected SDTMIG 3.2 profile with no define (OD-16, OD-19). USDM, TIG and SEND stay on 0.17.1, and no ADaM runs until a pinned release ships adamig rules (OD-18). The run stays local only if LE-6.11\'s measured peak fits its stage budget, otherwise it uses the LE-2.10 copy (LE-6.18).',
    activity: 'Structured runner result with coverage sets, rule manifest and occurrence traces, the CORE-002087 count and the ADVS key check, from the reconstructed pilot run',
    frs: { id: 'FRS-118', requirement: 'Each CORE V1.0 occurrence shall be joined to dataset, row and variable, the EDC source record, the CSL definition and the citation, with the exact rule and engine versions; issues, execution errors, skips and verified coverage shall be counted apart; the unchanged files shall record declared and executed versions; the ADVS duplicate keys shall be checked by a standalone reader on the keys this plan states',
      implementation: 'BiometricsWorkbench src/cdisc-core-runner.ts, validator-runner-result/2, standards-lineage/2 and CoreFindingEvidenceJoinV1 (LE-6.8, LE-6.10, LE-6.11); keySequence check (LE-6.15); EDC audit read at the cut (LE-6.16); data-use manifest pins (LE-6.17); the standalone ADVS reader (OD-22)' },
  }),
  pilotRequirement({
    id: 'URS-113', caseId: 'PQA-012', title: 'Correction after hard lock and unblinding (A12)',
    description: 'The platform SHALL refuse a correction after hard lock and unblinding and SHALL record the approved unlock, the authorised site correction, the re-lock, the investigator endorsement and the change for the clinical study report',
    rationale: `${e6r3('dataCorrections')}, §11.10(d), §11.10(e) and §11.50 require that locked data change only through an authorised, signed and audited path.`,
    context: 'LE-5.5 adds the finalisation record per analysis release or milestone (D-LE-9) with its unlock path.',
    activity: 'Refusal, unlock approval, authorised correction, re-lock, endorsement and change list, from the reconstructed pilot run',
    frs: { id: 'FRS-119', requirement: 'A finalisation record shall move through soft lock, endorsement, hard lock and unblinded states with an unlock path approved by a person other than the requester, and list post-unblinding changes',
      implementation: 'libreclinicaapi finalisation record and EDC locks (LE-5.5); BiometricsWorkbench release pin' },
  }),
  pilotRequirement({
    id: 'URS-114', caseId: 'PQA-013', title: 'Reference ranges by laboratory and collection date (A13)',
    description: 'The platform SHALL bind each laboratory result to the reference range in force at its laboratory on its collection date and SHALL flag a result with no applicable range rather than default one',
    rationale: `Indicators and grades drive safety review. ${e6r3('dataCapture')} and §11.10(a) require the range applied to be the one that governed the result; a defaulted range is a wrong analysis input.`,
    context: 'The real data hold 1,814 ALT results in four range sets and 2,041 numeric results with no range; the overlay adds a mid-study change and a second-site local range. LE-3.5 versions the ranges.',
    activity: 'Range binding census, overlay results either side of the change and flagged no-range results, from the reconstructed pilot run',
    frs: { id: 'FRS-120', requirement: 'Reference range sets shall be versioned by laboratory, analyte, sex, age band, method, unit and effective interval, bound at collection, never retroactively, with no-range results flagged',
      implementation: 'ClinicalSemanticLayer ReferenceRangePolicy catalog type and laboratory profile (LE-3.5)' },
  }),
  pilotRequirement({
    id: 'URS-115', caseId: 'PQA-014', title: 'Partial date and untimed dose under two baseline rules (A14)',
    description: 'The platform SHALL derive the SAP baseline and imputation flag for a partial collection date with an untimed same-day dose, and SHALL change both predictably under the alternative rule',
    rationale: `${e6r3('reviewOfData')} requires derivations to follow the pre-specified analysis plan, with imputations flagged.`,
    context: 'The partial date and untimed dose are a declared overlay; LE-6.2 runs the reviewed and the alternative definitions on the same cut.',
    activity: 'The overlay participant\'s ADLB rows under both definitions, from the reconstructed pilot run',
    frs: { id: 'FRS-121', requirement: 'ADLB derivation shall apply the SAP baseline and imputation rules and flag imputed dates; the alternative definition shall be a second reviewed definition on the same cut',
      implementation: 'BiometricsWorkbench standards engine and analysis contracts (LE-6.2)' },
  }),
  pilotRequirement({
    id: 'URS-116', caseId: 'PQA-015', title: 'Specimen before consent raises a finding (A15)',
    description: 'The platform SHALL raise a finding when a specimen is collected before signature of the applicable ICF version',
    rationale: `${e6r3('nonCompliance')} requires protocol and consent noncompliance to be identified; a procedure before consent is a serious deviation.`,
    context: 'Consent timing is an EDC deviation rule authored as data in the deviation specification (LE-3.4, LE-1.6), with the EDC deviation engine as its single producer; the consent records are a declared overlay (LE-5.1); the replay keeps consent on the Screening 1 visit date, and the 85 participants with earlier draws are declared source-timing findings in the key (OD-21).',
    activity: 'The deviation receipt for the overlay specimen, from the reconstructed pilot run',
    frs: { id: 'FRS-122', requirement: 'The deviation specification shall carry the consent-before-procedure rule and the EDC deviation engine shall evaluate it against the applicable ICF version',
      implementation: 'libreclinicaapi deviation-evaluation.service.ts, with the rule kind LE-5.1-edc adds to judge each dated draw against the ICF version applicable on that date (OD-28); csl-study-deviation-spec/1 (LE-3.4, OD-11); ClinicalSemanticLayer consent route (LE-5.1)' },
  }),
  pilotRequirement({
    id: 'URS-117', caseId: 'PQA-016', title: 'Hidden laboratory field and unblinding event (A16)',
    description: 'The platform SHALL withhold a laboratory field classified as hidden from the study team from blinded roles and SHALL record a simulated inadvertent exposure as an unblinding event with an impact assessment',
    rationale: `Unblinding of a blinded role is a critical failure. ${e6r3('blinding')} requires blinding to be safeguarded in data governance and every unblinding to be recorded.`,
    context: 'LE-5.2 classifies laboratory fields by allocation level (D-LE-10); LE-5.3 adds the unblinding event as the D-S3 decision record.',
    activity: 'Blinded-channel census of the hidden field and the unblinding event record, from the reconstructed pilot run',
    frs: { id: 'FRS-123', requirement: 'A field classified hidden shall be separated at intake and never reach a blinded channel, rationale, AI context or log; an exposure shall create an unblinding event with kind, scope, blinded roles and impact assessment',
      implementation: 'ClinicalSemanticLayer security markings and laboratory-field classes (LE-5.2); libreclinicaapi randomization unblinding event (LE-5.3)' },
  }),
  pilotRequirement({
    id: 'URS-118', caseId: 'PQA-017', title: 'Out-of-window draw to confirmed deviation and analysis set (A17)',
    description: 'The platform SHALL raise a deviation candidate for an out-of-window lab draw with importance unassessed and its rule version, have a named person confirm it and assign its importance, and set analysis-set membership by a documented pre-unblinding decision',
    rationale: `${e6r3('nonCompliance')} makes importance a qualified person\'s decision; ${e6r3('blinding')} requires analysis sets to be fixed before unblinding.`,
    context: 'The key holds 111 scheduled ALT draws outside the SAP section 8.2 windows (15 at Week 24) on the bound pack; 3 of those rows cannot be candidates, and the machine rules give 149 candidates, 108 at visits with an ALT record (OD-28, OD-29). A rule\'s mandatory severity is not its importance (OD-28). LE-4.7 adds candidates and analysis-set determinations; the per-protocol rule is an overlay.',
    activity: 'Candidates against the key with importance unassessed, signed confirmation with the importance assigned and the analysis-set determination, from the reconstructed pilot run',
    frs: { id: 'FRS-124', requirement: 'The deviation engine shall emit candidates with importance unassessed; a named person shall confirm each with its importance; BW shall record each analysis-set determination with its time relative to unblinding',
      implementation: 'libreclinicaapi deviation-evaluation.service.ts and deviation decisions (LE-4.7, ENABLE_DEVIATION_ENGINE, ENABLE_DEVIATION_DECISIONS); BiometricsWorkbench analysis-set determinations' },
  }),
  pilotRequirement({
    id: 'URS-119', caseId: 'PQA-018', title: 'Schedule divergence raises a finding (A18)',
    description: 'The platform SHALL raise a finding for each CSL or OSB schedule entry that differs from the approved schedule of activities',
    rationale: `${e6r3('protocolAndRecords')} requires the system to implement the approved protocol; a schedule that drifts from it changes what data are collected.`,
    context: 'LE-3.11 extends the CSL G5.6 schedule-cell check; the key records each real difference against Attachment LZZT.1, or an overlay injects one.',
    activity: 'Findings against the key\'s differing cells, from the reconstructed pilot run',
    frs: { id: 'FRS-125', requirement: 'The schedule comparison shall raise one dispatchable:false finding per differing cell between the release schedule and the approved schedule of activities',
      implementation: 'ClinicalSemanticLayer protocol-conformance-v1 schedule-cell check (LE-3.11)' },
  }),
  pilotRequirement({
    id: 'URS-120', caseId: 'PQA-019', title: 'Platform wrote no participant value (A19)',
    description: 'The platform SHALL write no participant value at any step; every participant value SHALL be written by a declared site-entry account or a named person',
    rationale: `${e6r3('dataCapture')}, §11.10(d) and §11.10(e) require participant data to be attributable to the person who entered it; corrections stay native to the EDC (BW ADR 001, CC ADR-009).`,
    context: 'The LE-7.3 observer counts participant values by writer class through the EDC audit trail; G3 needs the platform-principal count to be zero.',
    activity: 'A19 census by writer class over every participant value of the run, from the reconstructed pilot run',
    frs: { id: 'FRS-126', requirement: 'No platform principal shall hold a participant-value write path; the census shall resolve every participant value\'s writer through the EDC audit trail',
      implementation: 'libreclinicaapi audit trail; the LE-7.3 observer A19 census' },
  }),
  pilotRequirement({
    id: 'URS-121', caseId: 'PQA-020', title: 'Liver injury pattern reaches the safety owner (A20)',
    description: 'The platform SHALL route a potential drug-induced liver injury pattern found during reconciliation to the safety owner without waiting in a review queue',
    rationale: `${e6r3('reviewOfData')} and ${e6r3('qualityManagement')} require potential safety signals to reach the responsible person promptly; a review queue in front of them delays a safety decision.`,
    context: 'CDISCPILOT01 participant 01-705-1186 shows the pattern on 4 draws; LE-1.6 adds dili-pattern@1 and LE-4.11 routes the finding to a safety-owner task outside every review queue.',
    activity: 'Findings, the safety-owner task and its timing against the reconciliation run, from the reconstructed pilot run',
    frs: { id: 'FRS-127', requirement: 'dili-pattern@1 shall evaluate each draw\'s ALT or AST against 3x ULN with total bilirubin against 2x ULN and report ALP; a hit shall open a safety-owner task with a protocol-timeline due time and no review step before it',
      implementation: 'ClinicalSemanticLayer dili-pattern@1 module evaluator (LE-1.6, OD-13) and safety linkage (LE-4.11); CommandCenter operator task (CcOperatorTaskDueSourceV1)' },
  }),
  pilotRequirement({
    id: 'URS-122', caseId: 'PQA-021', title: 'Zero critical failures across the acceptance cases (G3)',
    description: `The pilot SHALL show zero critical failures (${CRITICAL_CLASSES}) in at least 300 scored critical case instances across A1 to A20, with N fixed in the sealed key before the run`,
    rationale: `${e6r3('validation')} requires validation in proportion to risk; a statement of zero failures means something only with its denominator, reported as the 95% upper bound 3/N, never as a universal accuracy claim (plan section 10).`,
    context: 'N is written into the sealed key by the adjudicator (LE-3.2, D-LE-21) before the run; the LE-7.3 observer scores each case\'s critical instances.',
    activity: 'Sum of critical instances and failures over A1 to A20 against the key\'s declared N, from the reconstructed pilot run',
    frs: { id: 'FRS-128', requirement: 'The sealed key set manifest shall declare N; the run shall report critical instances and failures per case and cite that manifest and its seal record; the import shall read N from those bytes and require the sum to equal it, N to be at least 300 and failures to be zero',
      implementation: 'CommandCenter synthetic-trial/evaluate/reference key sets (LE-3.2); the LE-7.3 observer' },
  }),
  pilotRequirement({
    id: 'URS-123', caseId: 'PQC-001', title: 'Security test of every pilot leg',
    description: 'Every pilot leg SHALL be security tested on the qualification estate, refusing requests without a session, with a forged or expired token, for another tenant or study, and blinded reads of unblinded data',
    rationale: `${e6r3('validation')} (computerised systems, 4.3) requires security controls to be in place and tested; §11.10(d) and §11.300 require access limited to authorised individuals.`,
    context: 'The EDC alone has a security suite today (SEC-001 to SEC-010); the pilot also runs on CSL, CC and BW. The probes run on the qualification estate (LE-7.1) and their results enter the pilot run (LE-7.3).',
    activity: 'Per-leg probe counts with zero unexpected acceptances, from the reconstructed pilot run',
    frs: { id: 'FRS-129', requirement: 'Each pilot leg shall refuse an unauthenticated, forged, expired, cross-tenant, cross-study or blinded-to-unblinded request; the run shall record probes and refusals per leg',
      implementation: 'the qualification estate (LE-7.1); probe results in the pilot run (LE-7.3); libreclinicaapi auth middleware, ClinicalSemanticLayer auth.ts, CommandCenter server/auth.js, BiometricsWorkbench session checks' },
  }),
  pilotRequirement({
    id: 'URS-124', caseId: 'PQC-002', title: 'Backup and disaster-recovery restore of every pilot store',
    description: 'The store of every pilot leg SHALL be backed up and restored into an isolated target, with the restored content digest equal to the source digest and the recovery point and time recorded',
    rationale: `§11.10(c) requires records to be protected and retrievable throughout retention; ${e6r3('retention')} and ICH E6(R3) 4.3.3 require backup and disaster recovery with periodic tests.`,
    context: 'The EDC DR runner checks files and endpoints only and DR-005 (restore) is manual. The restore test runs on the qualification estate (LE-7.1) and its digests enter the pilot run (LE-7.3).',
    activity: 'Per-leg backup, isolated restore and digest equality with recovery point and time, from the reconstructed pilot run',
    frs: { id: 'FRS-130', requirement: 'Each pilot store shall be restorable from its backup into an isolated target whose content digest equals the source; recovery point and time shall be recorded per store',
      implementation: 'the qualification estate (LE-7.1); restore results in the pilot run (LE-7.3); libreclinicaapi backup routes; the Postgres and SQLite stores of CSL, CC and BW' },
  }),
  pilotRequirement({
    id: 'URS-125', caseId: 'PQC-003', title: 'Signature-to-record linking across the pilot (21 CFR 11.70)',
    description: 'Every electronic signature produced in the pilot SHALL be linked to the record revision it signed, so that the digest recorded at signing recomputes from that revision',
    rationale: '21 CFR Part 11 §11.70 requires signatures to be linked to their records so they cannot be excised, copied or transferred. The EDC binding is qualified by OQ-037, OQ-040 and OQ-065; the pilot also signs in CSL, BW and CC.',
    context: 'Signing systems in the pilot: EDC Part 11 acts, CSL signed decisions, BW review approvals and CC approved-change receipts (D-LE-5: one record, one meaning, one signer).',
    activity: 'Per-system signature census with zero unlinked and zero mismatched, from the reconstructed pilot run',
    frs: { id: 'FRS-131', requirement: 'Each signing system shall store with every signature the signed record id, its revision and the content digest at signing; the census shall recompute each digest from the stored revision',
      implementation: 'libreclinicaapi esignature.service.ts (content_hash); ClinicalSemanticLayer approval-service.ts; BiometricsWorkbench signed reviews; CommandCenter approved-change receipts; the census in the pilot run (LE-7.3)' },
  }),
  pilotRequirement({
    id: 'URS-126', caseId: 'PQC-004', title: 'Access and account-change log census',
    description: 'Every pilot application SHALL keep an access log and an account-change log covering the run; every declared account SHALL appear in its account-change log and no account SHALL appear in a log that the run did not declare',
    rationale: `§11.10(d) and §11.10(e) require access to be limited and changes to be audited; ${e6r3('auditTrails')} requires the audit trail to show who could act. Plan section 9 names these logs missing across applications.`,
    context: 'The declared set is the OD-8 le_* accounts on R1, created through each application\'s own routes (LE-7.1), and the owner\'s list of named role holders and site-entry accounts on R2; the census runs over the EDC, CSL, CC and BW logs (LE-7.3).',
    activity: 'Per-application access and account-change event counts, declared accounts found and undeclared accounts seen, from the reconstructed pilot run',
    frs: { id: 'FRS-132', requirement: 'Each application shall log sign-ins and account creation, role change, deactivation and credential change; the census shall count them over the run window and match the declared accounts in both directions',
      implementation: 'libreclinicaapi audit login history and user audit; ClinicalSemanticLayer, CommandCenter and BiometricsWorkbench access and account logs; the census in the pilot run (LE-7.3)' },
  }),
];
