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
