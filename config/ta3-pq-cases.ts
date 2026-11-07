import { type E6R3Key } from './regulatory-scope';

/**
 * The TA3 PQ cases tied to the O-7 run, PQT-001 to PQT-006 (TA3 plan VAL-1, spec
 * P20 3.5 and VD-6). Data only: the PQ protocol (09) prints each case from this
 * list, and the benchmark import (runners/benchmark-evidence.ts,
 * `derivePqtResults`) records each case's title and acceptance criterion from it
 * when it imports a run whose summary contract is
 * synthetic-trial.deviation-detection-summary/1 (spec P09 8.2). The cases are
 * derived from the reconstructed run without re-scoring; no other import or
 * runner records them. PQT-006 is manual and never passes automatically: the
 * answer key stays a draft, unadjudicated self-review until a qualified person
 * adjudicates it (D-10). What the import actually checks is RUNNER_CASE_CHECKS
 * (generators/helpers/evidence-linker.ts).
 */

/** The summary contract of a deviation detection run (spec P09 8.2; the CommandCenter O-7 scorer owns it). */
export const DEVIATION_DETECTION_CONTRACT = 'synthetic-trial.deviation-detection-summary/1';

/** The CommandCenter entry that reconstructs a deviation detection run (spec P09 8.2), and the benchmark
 * evaluator's entry that reconstructs every other scored run, as paths under the CommandCenter checkout. */
export const DEVIATION_RECONSTRUCTION_ENTRY = 'synthetic-trial/surpass/deviations/reconstruct-detection.mjs';
export const BENCHMARK_RECONSTRUCTION_ENTRY = 'synthetic-trial/evaluate/reconstruct.mjs';

/** The ten machine logic kinds of the delivered deviation spec, in the order of the EDC's vendored
 * `DeviationLogic` union (libreclinicaapi src/services/deviation-engine/vendor/v2/shared-types/
 * study-exchange-amendment/deviation/deviation-types.ts; checked by tests/cross-repo.contract.test.ts). */
export const DEVIATION_MACHINE_CLASSES = [
  'visit_window', 'visit_order', 'missed_visit', 'required_assessment', 'numeric_threshold',
  'prohibited_medication', 'dosing_bound', 'visit_after_disposition', 'consent_before_procedure', 'field_range',
] as const;
export type DeviationMachineClass = typeof DEVIATION_MACHINE_CLASSES[number];

/** The explanation codes of a critical miss the O-7 scorer derives from retained evidence (spec P09 8.2). */
export const CRITICAL_MISS_EXPLANATIONS = [
  'RULE_NOT_DERIVED', 'RULE_MANUAL', 'OUTCOME_SKIPPED_MISSING_DATA', 'NOT_EVALUATED', 'ANCHOR_UNBOUND',
  'BINDING_UNBOUND', 'VERSION_UNRESOLVED',
] as const;

/** The only gate of the O-7 scorer: no critical miss without an explanation code (spec P09 8.2). */
export const CRITICAL_EXPLAINED_GATE = 'DEV-CRITICAL-EXPLAINED';

/** The PQ case of an O-7 import that states the run's own EDC API release; the platform summary (22) compares it
 * with the OQ release (spec P20 3.5). */
export const RELEASE_PQ_CASE = 'PQT-005';

/** The outcome of a case whose part of the summary holds a member, value or shape the import does not
 * recognise: never a guess (spec P20 3.5). */
export const UNSUPPORTED_DEVIATION_SUMMARY = 'UNSUPPORTED_DEVIATION_SUMMARY';

export interface Ta3PqCase {
  id: string;
  title: string;
  requirement: string;
  /** 21 CFR Part 11 sections, without the section sign. */
  cfr: string;
  e6r3: readonly E6R3Key[];
  riskLevel: 'Critical' | 'High' | 'Medium' | 'Low';
  /** OFFLINE: derived by the import from the reconstructed run; MANUAL: a qualified person's act, never passed. */
  method: 'OFFLINE' | 'MANUAL';
  /** The spec P20 3.5 criterion, recorded as the case's acceptance criterion. */
  passesWhen: string;
  /** The outcome code a failed case records; null for the manual case. */
  failureCode: string | null;
  preconditions: string;
  steps: readonly string[];
  expectedResult: string;
  /** Pilot cases only: the plan revision 3 section 10 acceptance case (A1 to A20), G3, or the CSV control. */
  acceptanceCase?: string;
  /** Pilot cases only: the stage whose exit requires the case (plan section 10). */
  stage?: 'B' | 'C';
  /** Pilot cases only: what the case runs on (backlog section 5.3). */
  source?: 'real' | 'overlay' | 'real and overlay';
  /** Pilot cases only: the lab-to-endpoint backlog items whose code produces the evidence. */
  items?: readonly string[];
}

const RUN = 'A retained O-7 run (CommandCenter, spec P09 8.3) whose run-summary.json states the contract '
  + `${DEVIATION_DETECTION_CONTRACT}, imported with --benchmark-run`;
const RECONSTRUCTED = `${RUN}; PQT-001 passed`;

export const TA3_PQ_CASES: readonly Ta3PqCase[] = [
  {
    id: 'PQT-001', title: 'Deviation Detection Run Reconstructed', requirement: 'URS-081, URS-082', cfr: '11.10(a)',
    e6r3: ['validation'], riskLevel: 'Critical', method: 'OFFLINE',
    passesWhen: 'BENCHMARK-RECONSTRUCTION passed for a deviation detection run',
    failureCode: 'RECONSTRUCTION_FAILED',
    preconditions: `${RUN}; the CommandCenter checkout holds ${DEVIATION_RECONSTRUCTION_ENTRY}.`,
    steps: [
      `Import the retained run; its summary contract selects ${DEVIATION_RECONSTRUCTION_ENTRY} (every other run keeps ${BENCHMARK_RECONSTRUCTION_ENTRY}).`,
      'Verify that the entry exits 0 and prints ok true with rescored compared, and that run-summary.json and metrics.json are byte for byte unchanged.',
      'Verify that run-summary.json records the SHA-256 of metrics.json under artifacts.',
    ],
    expectedResult: 'The run reconstructs byte for byte through the deviation entry, and the summary binds the metrics the import read.',
  },
  {
    id: 'PQT-002', title: 'No Unexplained Critical Miss', requirement: 'URS-081, URS-082', cfr: '11.10(a)',
    e6r3: ['nonCompliance', 'validation'], riskLevel: 'Critical', method: 'OFFLINE',
    passesWhen: `gate ${CRITICAL_EXPLAINED_GATE} is passed in the reconstructed gateGroups`,
    failureCode: 'UNEXPLAINED_CRITICAL_MISS',
    preconditions: `${RECONSTRUCTED}.`,
    steps: [
      `Read the gate ${CRITICAL_EXPLAINED_GATE} from the gateGroups of the reconstructed summary.`,
      'Verify that it appears exactly once and that its status is passed.',
    ],
    expectedResult: 'Every critical miss of the run carries an explanation code from the retained evidence, so the gate is passed.',
  },
  {
    id: 'PQT-003', title: 'Every Machine Class Reported', requirement: 'URS-081, URS-082', cfr: '11.10(a)',
    e6r3: ['nonCompliance', 'validation'], riskLevel: 'High', method: 'OFFLINE',
    passesWhen: `each of the ten machine classes (${DEVIATION_MACHINE_CLASSES.join(', ')}) reports seeded, detected, `
      + 'recall with its interval and precision with denominators, or is not-seedable with a reason',
    failureCode: 'CLASS_NOT_REPORTED',
    preconditions: `${RECONSTRUCTED}.`,
    steps: [
      'Read ruleClasses from the reconstructed summary.',
      'Verify that each of the ten machine classes appears exactly once.',
      'For a seeded class verify seeded (at least 1), detected, recall with its interval and precision with its matched and governed denominators, consistent with each other.',
      'For a class the protocol states no requirement for, verify not-seedable with a reason.',
    ],
    expectedResult: 'Each machine class is reported with its counts, recall interval and precision denominators, or is stated not seedable with the reason.',
  },
  {
    id: 'PQT-004', title: 'Manual Rules Counted, Never Scored', requirement: 'URS-081, URS-082', cfr: '11.10(a)',
    e6r3: ['nonCompliance', 'validation'], riskLevel: 'High', method: 'OFFLINE',
    passesWhen: 'manual rules are counted and never scored',
    failureCode: 'MANUAL_RULE_SCORED',
    preconditions: `${RECONSTRUCTED}.`,
    steps: [
      'Read manualRules from the reconstructed summary.',
      'Verify that it counts the manual rules of the spec and the manual_review_required outcomes and carries no scoring member.',
      'Verify that no rule class of ruleClasses is manual.',
    ],
    expectedResult: 'Manual rules appear as counts only; none carries a recall, precision or detection figure.',
  },
  {
    id: 'PQT-005', title: 'Run States Its EDC API Release', requirement: 'URS-081, URS-082', cfr: '11.10(a)',
    e6r3: ['validation'], riskLevel: 'High', method: 'OFFLINE',
    passesWhen: 'the run states its EDC API release (commit or image)',
    failureCode: 'RELEASE_NOT_RECORDED',
    preconditions: `${RECONSTRUCTED}.`,
    steps: [
      'Read release from the reconstructed summary.',
      'Verify that release.api states the EDC API release as a 40-character Git commit or a sha256 image ID, and record it.',
      'Compare it with the OQ release only in the platform summary (document 22, RELEASE_MISMATCH), never here.',
    ],
    expectedResult: 'The release the run exercised is recorded, so the platform summary can compare it with the release the OQ qualified.',
  },
  {
    id: 'PQT-006', title: 'Answer Key Adjudicated by a Qualified Person', requirement: 'URS-081, URS-082', cfr: '11.10(a)',
    e6r3: ['validation'], riskLevel: 'High', method: 'MANUAL',
    passesWhen: 'an adjudication record by a qualified person exists',
    failureCode: null,
    preconditions: `${RUN}; its deviation answer key (synthetic-trial.deviation-answer-key/1) is retained with the run.`,
    steps: [
      'A qualified person adjudicates the run\'s deviation answer key outside the framework.',
      'The adjudication record is retained beside the package; the import records this case manual and never passes it.',
    ],
    expectedResult: 'A qualified person has adjudicated the answer key; until then it is a draft, unadjudicated self-review.',
  },
];

/** The catalog entry of one TA3 PQ case; an unknown ID is a defect. */
export function ta3PqCase(id: string): Ta3PqCase {
  const found = TA3_PQ_CASES.find(entry => entry.id === id);
  if (!found) throw new Error(`No TA3 PQ case ${id} is catalogued.`);
  return found;
}

/*
 * The lab-to-endpoint pilot cases (backlog LE-7.2, plan revision 3 sections 9 and 10; TA3 plan VAL-1 extended for
 * the pilot's intended use). PQA-001 to PQA-020 are the acceptance cases A1 to A20, PQA-021 is the G3 bound and
 * PQC-001 to PQC-004 are the computerised-system validation controls plan section 9 names as missing: security,
 * backup and disaster recovery, signature-to-record linking (21 CFR 11.70) and the access and account-change log
 * census. Data only. The PQ protocol (09) and the pilot validation plan (23) print them; the benchmark import
 * (runners/benchmark-evidence.ts, `derivePilotResults`) records them from a reconstructed run of the qualification
 * estate whose summary states PILOT_ACCEPTANCE_CONTRACT, and only while PILOT_IMPORT_SWITCH is exactly 'true'.
 * Every case names one requirement of PILOT_REQUIREMENTS (config/ta3-requirements.ts), which cites it back.
 */

/** The summary contract of a pilot run (R1 or R2). Producer: the LE-7.3 observer, in a directory of its own, because the
 * scorer's run-summary.json is write-once and is compared byte for byte with a fresh scoring; consumer: this framework's
 * benchmark import. */
export const PILOT_ACCEPTANCE_CONTRACT = 'cdisc-pilot-acceptance-summary/1';

/** The CommandCenter entry that reconstructs a pilot run, under the CommandCenter checkout. LE-7.3 owns it: it runs the
 * evaluator's reconstruction over the scored run the summary names, compares the summary's evaluator, gates and metrics with
 * that run's, re-hashes every file the pilot block cites and re-derives the block from the observer's retained records, then
 * prints ok true with rescored compared. Until it exists a pilot import fails closed: BENCHMARK-RECONSTRUCTION fails and
 * every pilot case is recorded not executed (RECONSTRUCTION_FAILED). */
export const PILOT_RECONSTRUCTION_ENTRY = 'synthetic-trial/evaluate/reconstruct-pilot.mjs';

/** How long the import waits for that entry: the scored run's re-score plus the observer's records. The evaluator's own
 * entry took 15 s without a re-score on the largest retained run (129,822 cases). */
export const PILOT_RECONSTRUCTION_TIMEOUT_MS = 300_000;

/** What a pilot run does not claim. An R1 summary must state all three as written here (OD-23, OD-24), or every case records
 * UNSUPPORTED_PILOT_SUMMARY, and the import copies them into every row; R2 exercises the governed lane end to end (OD-23), so
 * it cannot state that one. No status means passed. */
export const PILOT_NON_CLAIM_STATUSES = ['not-applicable', 'not-exercised'] as const;
export const PILOT_NON_CLAIMS = [
  { claim: 'governed-lane', status: 'not-exercised', decision: 'OD-23', onR2: false, what: 'The EDC governed lane: platform OIDC stays off for the R1 EDC' },
  { claim: 'osb-strict', status: 'not-applicable', decision: 'OD-24', onR2: true, what: 'OSB strict: S9 is in no stage order and CDISCPILOT01 is not OSB-bound' },
  { claim: 'il-source-fact-consumer', status: 'not-applicable', decision: 'OD-24', onR2: true, what: 'The IL source-fact consumer: no IL package exists under D-LE-3' },
] as const;

/** The switch that lets the benchmark import derive the pilot cases (D-P13: off unless exactly 'true'). Off, a run
 * naming PILOT_ACCEPTANCE_CONTRACT imports as a plain benchmark run, with its two rows, as before LE-7.2. */
export const PILOT_IMPORT_SWITCH = 'VALIDATION_PILOT_ACCEPTANCE_IMPORT';

/** The switch that lets an R2 pilot import be admitted as a package that is not synthetic (D-LE-14; D-P13: off unless
 * exactly 'true'). Off, every benchmark import stays synthetic engineering evidence, as before. */
export const PILOT_PUBLIC_DATA_SWITCH = 'VALIDATION_PILOT_PUBLIC_DATA_ADMISSION';

/** The study the pilot validation plan and the filed basis name. */
export const PILOT_STUDY = 'CDISCPILOT01';

/** The record the QA owner files in the QA retention root (contracts/pilot-declared-public-data-basis-v1.schema.json):
 * the declared-public-data basis an R2 run's summary cites by relative path and SHA-256. No code creates it. */
export const PILOT_PUBLIC_DATA_BASIS_CONTRACT = 'pilot-declared-public-data-basis/1';

/** A pilot case of an R2 run that was not admitted under its filed declared-public-data basis (D-LE-14). */
export const PUBLIC_DATA_BASIS_NOT_ADMITTED = 'PUBLIC_DATA_BASIS_NOT_ADMITTED';

/** The keys of the A11(c) standalone ADVS check on the unchanged bytes (OD-22: "keys stated by the validation plan"), and
 * the duplicate key groups it must find in the unchanged pilot ADVS (LE-6.15). The file is pinned by LE-6.17 in the
 * data-use manifest and read by the evaluator zone only, never parsed into BW records. */
export const PILOT_ADVS_KEYS = ['USUBJID', 'PARAMCD', 'ATPT', 'AVISIT'] as const;
export const PILOT_ADVS_DUPLICATE_KEY_GROUPS = '2,540';

/** The outcome of a pilot case whose part of the summary holds a member, value or shape the import does not
 * recognise: never a guess. */
export const UNSUPPORTED_PILOT_SUMMARY = 'UNSUPPORTED_PILOT_SUMMARY';

/** The pilot legs every CSV control must report (backlog section 5.2: EDC, CSL with its regional instance, CC, BW).
 * IL and OSB are not on the pilot path (D-LE-3; CDISCPILOT01 is not OSB-bound, D-A1). */
export const PILOT_CONTROL_SYSTEMS = ['edc', 'csl', 'cc', 'bw'] as const;

/** The four CSV controls, in PQC order. */
export const PILOT_CONTROLS = ['security', 'backup-restore', 'signature-linking', 'access-census'] as const;
export type PilotControl = typeof PILOT_CONTROLS[number];

/** G3: the least number of scored critical case instances across A1 to A20 the sealed key may declare, so that zero
 * failures gives a 95% upper bound below 1% (3/N). */
export const PILOT_MIN_CRITICAL_INSTANCES = 300;

const PILOT_RUN = 'A retained pilot run of the qualification estate (R1 at the Stage B or C exit, or R2) whose run-summary.json '
  + `states ${PILOT_ACCEPTANCE_CONTRACT}, imported with --benchmark-run while ${PILOT_IMPORT_SWITCH}=true; BENCHMARK-RECONSTRUCTION `
  + `passed through ${PILOT_RECONSTRUCTION_ENTRY} (LE-7.3); the run cites the sealed key set's manifest and seal record, which show it sealed before the run started (LE-3.2, D-LE-21)`;
const IMPORT_STEP = 'Import the run; read the result for this case from pilot.cases (or pilot.controls) of the reconstructed summary.';
const EVIDENCE_STEP = 'Verify every evidence file the result cites: a path inside the run directory whose bytes have the recorded SHA-256.';
const VERDICT_STEP = 'Admit a pass only with coverage complete, at least one scored instance, zero critical failures, a key set whose own manifest and '
  + 'seal record say what the summary states, sealed before the run start and not holding the case, and, for R2, a countersignature the manifest records and a '
  + 'package admitted under its filed declared-public-data basis; an incomplete or inconclusive result is never a pass.';

type PilotCaseInput = Omit<Ta3PqCase, 'method' | 'failureCode' | 'steps' | 'preconditions'> & {
  failureCode?: string; check: string; preconditions?: string;
};

/** One pilot case: imported, its observer verdict admitted only by the import's rules, never re-judged here. */
const pilotCase = (input: PilotCaseInput): Ta3PqCase => {
  const { check, failureCode, preconditions, ...rest } = input;
  return {
    ...rest, method: 'OFFLINE', failureCode: failureCode ?? 'CASE_FAILED',
    preconditions: preconditions ?? `${PILOT_RUN}.`,
    steps: [IMPORT_STEP, EVIDENCE_STEP, check, VERDICT_STEP],
  };
};

const LEGS = PILOT_CONTROL_SYSTEMS.join(', ');

export const PILOT_PQ_CASES: readonly Ta3PqCase[] = [
  pilotCase({
    id: 'PQA-001', acceptanceCase: 'A1', title: 'Requirement Traced to Observation, Derivation and Result', requirement: 'URS-102',
    cfr: '11.10(a), 11.10(e)', e6r3: ['dataCapture', 'protocolAndRecords'], riskLevel: 'Critical', stage: 'B', source: 'real',
    items: ['LE-3.4', 'LE-6.2', 'LE-6.3', 'LE-7.3'],
    passesWhen: 'every Week 24 ALT value of the released ADLB traces to its protocol requirement, form item, laboratory definition, source observation, derived variable and result: 113 of 113 with a lineage record (G8), and the comparator verdict holds (G1)',
    check: 'The evidence shows the lineage census of the 113 Week 24 ALT values (each with its protocol citation, CSL definition, EDC item, observation, ADLB variable and result) and the LE-6.3 comparison against ADLBC.',
    expectedResult: 'Each Week 24 ALT result reads back to the protocol requirement it implements through the definition, the form item and the observation, with zero values lacking a lineage record.',
  }),
  pilotCase({
    id: 'PQA-002', acceptanceCase: 'A2', title: 'Specimen and Identity Linkage, Units and Censored Results', requirement: 'URS-103',
    cfr: '11.10(a)', e6r3: ['dataCapture', 'reviewOfData'], riskLevel: 'Critical', stage: 'B', source: 'real and overlay',
    items: ['LE-3.6', 'LE-3.7', 'LE-3.8'],
    passesWhen: 'distinct specimens and participant or event identities stay distinct; the overlay ambiguous linkage is refused with its ambiguity state; an incompatible unit assumption is refused; the bilirubin, glucose and albumin conventional and SI pairs standardise to LBSTRESN; the 6 censored results keep character value, limit and comparator with numeric null (D-LE-13)',
    check: 'The evidence shows the refused ambiguous linkage with its ambiguity state, the unit refusals, the SI values against LBSTRESN and the 6 censored results as stored.',
    expectedResult: 'No two specimens or participants are merged, no unit is assumed, and no censored result becomes zero, null or its limit.',
  }),
  pilotCase({
    id: 'PQA-003', acceptanceCase: 'A3', title: 'Correction Reason, Retained Value and Missing Rationale Status', requirement: 'URS-104',
    cfr: '11.10(e)', e6r3: ['dataCorrections', 'auditTrails'], riskLevel: 'High', stage: 'B', source: 'overlay',
    items: ['LE-4.1', 'LE-4.2', 'LE-4.4', 'LE-4.12', 'LE-4.13'],
    passesWhen: 'the overlay site correction carries its reason for change; a retained-value resolution closes verified without a value change; the edit with no rationale shows rationale status missing in the EDC, CSL and BW, never a sentinel string',
    check: 'The evidence shows the correction with its reason, the retained-value decision (accept-explanation or reject-resolution) and the rationale status read back in each of the three systems.',
    expectedResult: 'Corrections, retained values and missing rationales are told apart in every system that shows them.',
  }),
  pilotCase({
    id: 'PQA-004', acceptanceCase: 'A4', title: 'Form Definition Change Apart from Response Correction', requirement: 'URS-105',
    cfr: '11.10(a), 11.10(e)', e6r3: ['protocolAndRecords', 'auditTrails'], riskLevel: 'High', stage: 'B', source: 'overlay',
    items: ['LE-4.10'],
    passesWhen: 'the overlay amendment changes no collected instance in place; a form-definition change and a response correction are different record types; the affected deployed versions are listed; collected data keep their definition and form version, also after a form-version migration',
    check: 'The evidence shows each collected pilot form with the crf_version it was collected under before and after the amendment, the amendment rows only for explicitly propagated instances and the list of affected deployed versions.',
    expectedResult: 'Collected data keep the form version they were collected under; definition changes and corrections are separate records.',
  }),
  pilotCase({
    id: 'PQA-005', acceptanceCase: 'A5', title: 'Discrepancy to Verified Resolution and Regenerated Analysis', requirement: 'URS-106',
    cfr: '11.10(e), 11.50, 11.70', e6r3: ['dataCorrections', 'reviewOfData', 'signatures'], riskLevel: 'Critical', stage: 'C', source: 'overlay',
    items: ['LE-4.4', 'LE-4.5', 'LE-4.6'],
    passesWhen: 'the injected ALT discrepancy goes finding, signed raise-query decision, EDC query, site correction with reason, outcome verification on a later EDC revision, new cut and BW regeneration, each hop timed; verified_resolved to the regenerated BW result in at most one business day (G2)',
    check: 'The evidence shows each hop record with its time, the signed decision, the EDC query and correction, the later EDC revision the verification read and the BW regeneration record.',
    expectedResult: 'The discrepancy reaches the analysis through people\'s signed decisions and the EDC\'s own correction, with nothing verified before the later revision is read.',
  }),
  pilotCase({
    id: 'PQA-006', acceptanceCase: 'A6', title: 'Duplicates, Relabels, Late Corrections and Unknown Outcomes', requirement: 'URS-107',
    cfr: '11.10(a), 11.10(f)', e6r3: ['dataCapture', 'auditTrails'], riskLevel: 'Critical', stage: 'C', source: 'overlay',
    items: ['LE-3.6', 'LE-4.3'],
    passesWhen: 'a duplicate event, a correction, a relabel, a late correction, a concurrent edit, a failed query or configuration write and an ambiguous timeout (a query whose creation outcome is unknown included) give no duplicate and no falsely verified effect; the L1 to L11 delivery faults are each detected and coded',
    check: 'The evidence shows each injected fault with the record or refusal it produced, every outcome_unknown command resolved only by readback, and the coded L1 to L11 detections.',
    expectedResult: 'No fault produces a second effect or an action shown verified without readback.',
  }),
  pilotCase({
    id: 'PQA-007', acceptanceCase: 'A7', title: 'Scoped Amendment Activation and Blinded Arm Change', requirement: 'URS-108',
    cfr: '11.10(a), 11.10(d)', e6r3: ['protocolAndRecords', 'blinding'], riskLevel: 'Critical', stage: 'C', source: 'overlay',
    items: ['LE-4.9', 'LE-5.7'],
    passesWhen: 'the overlay amendment activates for one site or the open-label scope while another stays on its old release; a newly added requirement without a dependency edge is detected; the arm-specific change is refused or shown identically to blinded roles with its blinding-impact assessment; a diff of released artifacts outside the declared scope is empty (G9)',
    check: 'The evidence shows each site\'s active release, the impact plan with the undetected-edge finding, the blinded-role views of the arm-specific change with its assessment and the out-of-scope diff.',
    expectedResult: 'Only the intended scope changes, and blinded roles cannot infer allocation from the change.',
  }),
  pilotCase({
    id: 'PQA-008', acceptanceCase: 'A8', title: 'Optional Consent Restriction and Restricted Uses', requirement: 'URS-109',
    cfr: '11.10(d)', e6r3: ['gcp', 'qualityManagement'], riskLevel: 'Critical', stage: 'B', source: 'overlay',
    items: ['LE-5.1', 'LE-5.6'],
    passesWhen: 'the overlay optional-consent restriction is enforced and the EDC reconsent gate holds; an unknown permission blocks the optional use and raises a site query (D-LE-7); restricted joins and exports in BW and the CSL regional plane are refused with a code',
    check: 'The evidence shows the data-use evaluations (unknown included), the blocked optional use, the site query and each refused join or export with its code.',
    expectedResult: 'No consent-restricted use is permitted, and unknown is never treated as permitted.',
  }),
  pilotCase({
    id: 'PQA-009', acceptanceCase: 'A9', title: 'Alternative Baseline as a Scoped Version', requirement: 'URS-110',
    cfr: '11.10(a)', e6r3: ['blinding', 'reviewOfData'], riskLevel: 'Critical', stage: 'C', source: 'real',
    items: ['LE-5.4', 'LE-6.6'],
    passesWhen: 'the alternative baseline held as a scoped version changes BASE and CHG on 9 of the 113 Week 24 ALT rows and gives 01-708-1348 a baseline; the diff lists each changed value; blinded roles see pooled impact only',
    check: 'The evidence shows the per-value diff between the reviewed and the alternative definition on the same cut and the blinded-role read of the impact.',
    expectedResult: 'The statistician sees exactly which derived values the alternative changes; no by-arm output reaches a blinded role.',
  }),
  pilotCase({
    id: 'PQA-010', acceptanceCase: 'A10', title: 'Earlier Analysis Reproduced from Pinned Inputs', requirement: 'URS-111',
    cfr: '11.10(a), 11.10(b)', e6r3: ['validation', 'retention'], riskLevel: 'High', stage: 'C', source: 'real',
    items: ['LE-6.4'],
    passesWhen: 'the earlier analysis release re-run from its pinned inputs after source, document and mapping changes reproduces every output digest exactly, or within the numeric tolerance declared in the release before the re-run; superseded outputs are identified explicitly (G7)',
    check: 'The evidence shows the release\'s pinned inputs, the re-run output digests against the originals and the list of superseded outputs.',
    expectedResult: 'The earlier result is reproduced, and nothing superseded is shown as current.',
  }),
  pilotCase({
    id: 'PQA-011', acceptanceCase: 'A11', title: 'Standards Finding Mapped to Evidence, Coverage Kept Apart', requirement: 'URS-112',
    cfr: '11.10(a)', e6r3: ['reviewOfData', 'validation'], riskLevel: 'High', stage: 'B', source: 'real',
    items: ['LE-6.8', 'LE-6.10', 'LE-6.11', 'LE-6.15', 'LE-6.16', 'LE-6.17'],
    passesWhen: 'three parts (OD-16, OD-18). (a) CORE V1.0 on the unchanged pilot SDTM under the explicitly selected SDTMIG 3.2 profile, with no define, records '
      + 'declared and executed versions and an inconclusive verdict for the declared SDTMIG 3.1.2; CORE-002087 reports exactly 306 DM.RFICDTC occurrences, each '
      + 'traced to the pinned file SHA-256, row and USUBJID; any other known defect, the CM duplicate keys included, is found or shown not covered, and "not covered" '
      + 'stands only when the run\'s rule manifest shows no selected rule scope can include it. (b) CORE V1.0 on the SDTMIG 3.4 datasets BW produces traces every '
      + 'occurrence to its row, EDC record, definition and citation with the exact rule and engine versions. (c) ADVS is scored separately as a declared gap, because '
      + `no CORE ADaM rule exists: the standalone key check over the pinned unchanged bytes (OD-22) finds ${PILOT_ADVS_DUPLICATE_KEY_GROUPS} duplicate key groups on `
      + `the keys this plan states (${PILOT_ADVS_KEYS.join(', ')}), and BW's keySequence check finds none on the ADaM it produces. Issues, execution errors, skips and `
      + 'verified coverage are counted apart and add up to the rule count; a skipped rule is listed, never counted as passed',
    check: 'The evidence shows the structured runner result with its coverage sets, the rule manifest, each occurrence\'s trace, the CORE-002087 count, the declared and executed versions and the ADVS key check against its pinned file. The inconclusive verdict for SDTMIG 3.1.2 is what part (a) must show; the case verdict is pass when the three parts hold.',
    expectedResult: 'A skipped or erroring rule is never counted as verified coverage, a defect no selected rule can reach is reported as not covered and never as a pass, and every occurrence traces to its evidence.',
  }),
  pilotCase({
    id: 'PQA-012', acceptanceCase: 'A12', title: 'Correction after Hard Lock and Unblinding', requirement: 'URS-113',
    cfr: '11.10(d), 11.10(e), 11.50', e6r3: ['dataCorrections', 'signatures', 'blinding'], riskLevel: 'Critical', stage: 'C', source: 'overlay',
    items: ['LE-5.5'],
    passesWhen: 'a correction after hard lock and unblinding is refused; the approved unlock, the site correction the investigator authorises, the re-lock and the investigator endorsement are recorded; the change is listed for the clinical study report',
    check: 'The evidence shows the refusal, the unlock approval by a person other than the requester, the authorised correction with its reason, the re-lock, the endorsement and the post-unblinding change list.',
    expectedResult: 'A locked, unblinded record changes only through the recorded unlock path, and the change is reported.',
  }),
  pilotCase({
    id: 'PQA-013', acceptanceCase: 'A13', title: 'Reference Ranges by Laboratory and Collection Date', requirement: 'URS-114',
    cfr: '11.10(a)', e6r3: ['dataCapture', 'reviewOfData'], riskLevel: 'Critical', stage: 'B', source: 'real and overlay',
    items: ['LE-3.5'],
    passesWhen: 'each of the 1,814 ALT results binds the range its SDTM LB row carries (6-32, 6-34, 6-35, 6-43) with zero mismatches; the overlay mid-study change at one laboratory and the second site\'s local range apply by collection date; the 2,041 no-range results are flagged, never defaulted',
    check: 'The evidence shows the range binding census of the ALT results, the overlay results either side of the change date and the flagged no-range results.',
    expectedResult: 'Every indicator and grade uses the range in force at collection; a result with no range is flagged.',
  }),
  pilotCase({
    id: 'PQA-014', acceptanceCase: 'A14', title: 'Partial Date and Untimed Dose under Two Baseline Rules', requirement: 'URS-115',
    cfr: '11.10(a)', e6r3: ['dataCapture', 'reviewOfData'], riskLevel: 'High', stage: 'B', source: 'overlay',
    items: ['LE-6.2'],
    passesWhen: 'the overlay participant with a partial collection date and an untimed same-day dose gets the SAP baseline and the imputation flag, and both change as the key states under the alternative rule',
    check: 'The evidence shows the participant\'s ADLB rows under the reviewed and the alternative definitions with the imputation flags.',
    expectedResult: 'The baseline and imputation flag follow the SAP, and change predictably under the alternative rule.',
  }),
  pilotCase({
    id: 'PQA-015', acceptanceCase: 'A15', title: 'Specimen before Consent Raises a Finding', requirement: 'URS-116',
    cfr: '11.10(a)', e6r3: ['nonCompliance', 'protocolAndRecords'], riskLevel: 'Critical', stage: 'B', source: 'overlay',
    items: ['LE-1.6', 'LE-3.4', 'LE-5.1', 'LE-5.1-edc'],
    passesWhen: 'a specimen collected before signature of the applicable ICF version raises one finding from the EDC deviation engine, read back in the EDC; no second consent-timing evaluator exists; on the OD-21 basis (consent on the Screening 1 visit date) the 85 participants with earlier draws, about 350 accessions, are reported as the declared source-timing findings the key lists',
    check: 'The evidence shows the deviation receipt for the overlay specimen and the rule version that evaluated it.',
    expectedResult: 'The consent-timing breach is found once, by its single producer.',
  }),
  pilotCase({
    id: 'PQA-016', acceptanceCase: 'A16', title: 'Hidden Laboratory Field and Unblinding Event', requirement: 'URS-117',
    cfr: '11.10(d)', e6r3: ['blinding'], riskLevel: 'Critical', stage: 'B', source: 'overlay',
    items: ['LE-5.2', 'LE-5.3'],
    passesWhen: 'the overlay laboratory field classified hidden from the study team never reaches a blinded channel, decision rationale, AI context or log; the simulated inadvertent exposure creates one unblinding event with kind, scope, blinded roles and impact assessment',
    check: 'The evidence shows the blinded-channel census for the hidden field and the unblinding event record with its impact assessment.',
    expectedResult: 'Blinded roles never receive the hidden field, and the exposure is recorded as an unblinding event.',
  }),
  pilotCase({
    id: 'PQA-017', acceptanceCase: 'A17', title: 'Out-of-Window Draw to Confirmed Deviation and Analysis Set', requirement: 'URS-118',
    cfr: '11.10(a), 11.50', e6r3: ['nonCompliance', 'blinding', 'signatures'], riskLevel: 'High', stage: 'C', source: 'real and overlay',
    items: ['LE-1.6', 'LE-4.7'],
    passesWhen: 'the real out-of-window ALT draws in the key become deviation candidates, each with importance unassessed and its rule version, apart from the 3 key rows that cannot be candidates (01-703-1210 and 01-710-1354 at Week 26, a manual rule, and 01-705-1186 at Week 4), within the 149 machine candidates (OD-28; on pack cdisc-pilot-replay-1.0.0-3d3c8257 the key has 111 rows and 108 machine candidates sit at visits with an ALT record, OD-29); a named person confirms one deviation and assigns its importance; a documented pre-unblinding decision sets the overlay per-protocol membership',
    check: 'The evidence shows the candidates against the key with importance unassessed and the rule version of each, the 3 named key rows left out, the signed confirmation with the importance the person assigned and the analysis-set determination with its time relative to unblinding.',
    expectedResult: 'A rule raises the candidate and assigns no importance; a named person decides importance; analysis-set membership is fixed before unblinding.',
  }),
  pilotCase({
    id: 'PQA-018', acceptanceCase: 'A18', title: 'Schedule Divergence Raises a Finding', requirement: 'URS-119',
    cfr: '11.10(a)', e6r3: ['protocolAndRecords', 'nonCompliance'], riskLevel: 'High', stage: 'B', source: 'real',
    items: ['LE-3.11'],
    passesWhen: 'every difference between the CSL release schedule and the approved schedule of activities (Attachment LZZT.1), or the difference an overlay injects when there is none, raises exactly one dispatchable:false finding, and nothing else does',
    check: 'The evidence shows the findings against the key\'s list of differing cells.',
    expectedResult: 'Each schedule difference is found once and no false difference is raised.',
  }),
  pilotCase({
    id: 'PQA-019', acceptanceCase: 'A19', title: 'Platform Wrote No Participant Value', requirement: 'URS-120',
    cfr: '11.10(d), 11.10(e)', e6r3: ['dataCapture', 'auditTrails'], riskLevel: 'Critical', stage: 'C', source: 'real',
    items: ['LE-7.3'],
    passesWhen: 'the census of participant values written by declared site-entry accounts, by named people and by platform principals reports zero values written by any platform principal',
    check: 'The evidence shows the A19 census by writer class over every participant value of the run, each writer resolved through the EDC audit trail.',
    expectedResult: 'Every participant value was written by a site-entry account or a named person; none by a platform principal.',
  }),
  pilotCase({
    id: 'PQA-020', acceptanceCase: 'A20', title: 'Liver Injury Pattern Reaches the Safety Owner', requirement: 'URS-121',
    cfr: '11.10(a)', e6r3: ['reviewOfData', 'qualityManagement'], riskLevel: 'Critical', stage: 'B', source: 'real',
    items: ['LE-1.6', 'LE-4.11'],
    passesWhen: 'dili-pattern@1 flags 01-705-1186 on its 4 draws and no other participant; the finding reaches the safety owner within one hour of the reconciliation run with no review step before it',
    check: 'The evidence shows the dispatchable:false findings, the safety-owner task with its creation time against the reconciliation run and the absence of a review step.',
    expectedResult: 'The potential liver-injury signal reaches the safety owner directly and in time.',
  }),
  pilotCase({
    id: 'PQA-021', acceptanceCase: 'G3', title: 'Zero Critical Failures in N Scored Critical Instances', requirement: 'URS-122',
    cfr: '11.10(a)', e6r3: ['validation', 'qualityManagement'], riskLevel: 'Critical', stage: 'C', source: 'real and overlay',
    items: ['LE-3.2', 'LE-7.3'], failureCode: 'CRITICAL_FAILURE_BOUND_NOT_MET',
    passesWhen: `the critical instances of A1 to A20 sum to the N the sealed key declares, N is at least ${PILOT_MIN_CRITICAL_INSTANCES}, every A case executed and none has a critical failure; the record states N and the 95% upper bound 3/N`,
    check: 'Sum criticalInstances and criticalFailures over the A1 to A20 results and compare the sum with the N the sealed key set manifest declares, which the summary must state unchanged.',
    expectedResult: 'Zero critical failures (wrong linkage, wrong value or unit in an analysis input, falsely verified action, unblinding of a blinded role, permitted consent-restricted use) in at least 300 scored critical instances.',
  }),
  pilotCase({
    id: 'PQC-001', acceptanceCase: 'security', title: 'Security Test of Every Pilot Leg', requirement: 'URS-123',
    cfr: '11.10(d), 11.300', e6r3: ['validation'], riskLevel: 'Critical', stage: 'C', source: 'real',
    items: ['LE-7.1', 'LE-7.3'], failureCode: 'SECURITY_PROBE_ACCEPTED',
    passesWhen: `each pilot leg (${LEGS}) reports at least one security probe (no session, a forged or expired token, another tenant or study, a blinded role reading unblinded data) and every probe was refused: zero unexpected acceptances`,
    check: 'For each leg read probes, refusedAsExpected and unexpectedAcceptances; a leg not reported leaves the case inconclusive.',
    expectedResult: 'No leg accepts a request it must refuse.',
  }),
  pilotCase({
    id: 'PQC-002', acceptanceCase: 'backup-restore', title: 'Backup and Disaster-Recovery Restore of Every Pilot Store', requirement: 'URS-124',
    cfr: '11.10(c)', e6r3: ['retention', 'validation'], riskLevel: 'Critical', stage: 'C', source: 'real',
    items: ['LE-7.1', 'LE-7.3'], failureCode: 'RESTORE_DIGEST_MISMATCH',
    passesWhen: `each pilot leg's store (${LEGS}) was backed up and restored into an isolated target, and the restored content digest equals the source digest; the recovery point and recovery time are recorded`,
    check: 'For each leg read backupTaken, restoredIsolated, sourceDigest, restoredDigest, recoveryPointSeconds and recoveryTimeSeconds.',
    expectedResult: 'Every pilot store can be restored to an identical copy, and the time it takes is known.',
  }),
  pilotCase({
    id: 'PQC-003', acceptanceCase: 'signature-linking', title: 'Signature-to-Record Linking across the Pilot', requirement: 'URS-125',
    cfr: '11.70', e6r3: ['signatures'], riskLevel: 'Critical', stage: 'C', source: 'real',
    items: ['LE-7.3'], failureCode: 'SIGNATURE_NOT_LINKED',
    passesWhen: `every electronic signature the run produced in ${LEGS} is linked to its signed record revision and the digest recorded at signing recomputes from that revision: zero unlinked, zero mismatched`,
    check: 'For each leg read signatures, linked, digestRecomputedEqual, unlinked and mismatched; a leg with no signature cannot show linking and leaves the case inconclusive.',
    expectedResult: 'No signature can be excised, copied or transferred: each one binds the exact revision it signed (21 CFR 11.70).',
  }),
  pilotCase({
    id: 'PQC-004', acceptanceCase: 'access-census', title: 'Access and Account-Change Log Census', requirement: 'URS-126',
    cfr: '11.10(d), 11.10(e)', e6r3: ['auditTrails', 'validation'], riskLevel: 'High', stage: 'C', source: 'real',
    items: ['LE-7.3'], failureCode: 'ACCESS_LOG_INCOMPLETE',
    passesWhen: `each application (${LEGS}) reports an access log and an account-change log whose window starts at or before the run start, with at least one event of each; every account of the run's declared set (OD-8 on R1, the owner's list of named role holders and site-entry accounts on R2) is found in the account-change log, and no account appears in either log that the set does not declare`,
    check: 'For each application read accessEvents, accountChangeEvents, accountsDeclared, accountsFound, accountsUndeclared and windowStart; an undeclared account, or more accounts found than declared, fails the case.',
    expectedResult: 'Who could reach each application, and every change to their accounts, can be shown for the whole run.',
  }),
];

/** The catalog entry of one pilot case; an unknown ID is a defect. */
export function pilotPqCase(id: string): Ta3PqCase {
  const found = PILOT_PQ_CASES.find(entry => entry.id === id);
  if (!found) throw new Error(`No pilot PQ case ${id} is catalogued.`);
  return found;
}
