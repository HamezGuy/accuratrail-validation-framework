import { e6r3, type E6R3Key } from './regulatory-scope';

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
        'needs a wait of at least 70 minutes (ESCALATION_WINDOW_NOT_WAITED otherwise) and a confirmed recipient (RECIPIENT_UNAVAILABLE otherwise).'),
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
