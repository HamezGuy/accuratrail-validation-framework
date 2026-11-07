import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { captureApiCall, isInside, isRecord, redactEvidenceSecrets, saveEvidence, strictObject, SHA256_HEX, type EvidenceResult } from './evidence-capture';
import { parseReleaseComponent } from './release-identity';
import { ta3RegulatoryRef } from '../config/ta3-oq-cases';
import {
  BENCHMARK_RECONSTRUCTION_ENTRY, CRITICAL_EXPLAINED_GATE, CRITICAL_MISS_EXPLANATIONS, DEVIATION_DETECTION_CONTRACT,
  DEVIATION_MACHINE_CLASSES, DEVIATION_RECONSTRUCTION_ENTRY, PILOT_ACCEPTANCE_CONTRACT, PILOT_CONTROL_SYSTEMS, PILOT_CONTROLS,
  PILOT_IMPORT_SWITCH, PILOT_MIN_CRITICAL_INSTANCES, PILOT_NON_CLAIMS, PILOT_NON_CLAIM_STATUSES, PILOT_PQ_CASES, PILOT_PUBLIC_DATA_BASIS_CONTRACT,
  PILOT_RECONSTRUCTION_ENTRY, PILOT_RECONSTRUCTION_TIMEOUT_MS, PILOT_STUDY, PUBLIC_DATA_BASIS_NOT_ADMITTED,
  TA3_PQ_CASES, UNSUPPORTED_DEVIATION_SUMMARY, UNSUPPORTED_PILOT_SUMMARY, type PilotControl, type Ta3PqCase,
} from '../config/ta3-pq-cases';

export interface BenchmarkEvidenceOptions {
  runDir: string;
  /** Canonical CommandCenter checkout; historical evaluators use evaluatorRoot. */
  commandCenterRoot?: string;
  evaluatorRoot?: string;
  /** Derive the pilot cases from a run naming PILOT_ACCEPTANCE_CONTRACT; by default the PILOT_IMPORT_SWITCH
   * environment variable, on only when it is exactly 'true' (D-P13). */
  pilotImport?: boolean;
  /** The D-LE-14 decision on this run (admitPublicDataRun, taken before the package exists). Absent, an R2 pilot run
   * is not admitted and the import stays synthetic engineering evidence. */
  publicData?: PublicDataAdmission;
}

/** The two files of a scored run the import reads and links; a retained package copies them as inputs. */
export const BENCHMARK_RUN_FILES = { summary: 'run-summary.json', metrics: 'metrics.json' } as const;

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const SCOPE = 'Synthetic engineering evidence only. Reconstruction verifies retained results; it does not establish independent clinical validation, SURPASS attainment, or IL extraction performance.';
const PUBLIC_DATA_SCOPE = 'Declared public data under the basis the QA owner filed (D-LE-14): the public CDISCPILOT01 data with declared synthetic overlays. Reconstruction verifies retained results; it does not establish independent clinical validation, SURPASS attainment, or IL extraction performance.';

/** The evidence level of an import's records: synthetic engineering unless the run was admitted (D-LE-14). */
export const SYNTHETIC_EVIDENCE_LEVEL = 'synthetic_engineering';
export const PUBLIC_DATA_EVIDENCE_LEVEL = 'declared_public_data';

/** The members a summary may name its contract in: spec P09 8.2 names `contract`, spec P20 3.5 also
 * `schemaVersion`, and the CommandCenter evaluator writes `schema`. */
const SUMMARY_CONTRACT_MEMBERS = ['contract', 'schema', 'schemaVersion'] as const;

/** Which reconstruction a run needs, read from the summary bytes before anything is spawned (spec P20 3.5). A
 * summary that names the deviation detection contract in one of those members is a deviation run; `conflict` says
 * when another of them names a different contract, which refuses the run. With `pilot` (the import's
 * VALIDATION_PILOT_ACCEPTANCE_IMPORT switch, LE-7.2) a summary naming the pilot acceptance contract is a pilot run
 * under the same rule. Anything else, unparseable bytes included, is a benchmark run and reconstructs exactly as
 * before. */
export function summaryContractOf(summaryBytes: Buffer, options: { pilot?: boolean } = {}): {
  contract?: typeof DEVIATION_DETECTION_CONTRACT | typeof PILOT_ACCEPTANCE_CONTRACT; conflict?: string;
} {
  let parsed: unknown;
  try { parsed = JSON.parse(summaryBytes.toString('utf8')); } catch { return {}; }
  if (!isRecord(parsed)) return {};
  const summary = parsed;
  const named = SUMMARY_CONTRACT_MEMBERS.filter(key => Object.prototype.hasOwnProperty.call(summary, key));
  const recognised: (typeof DEVIATION_DETECTION_CONTRACT | typeof PILOT_ACCEPTANCE_CONTRACT)[] = options.pilot
    ? [DEVIATION_DETECTION_CONTRACT, PILOT_ACCEPTANCE_CONTRACT] : [DEVIATION_DETECTION_CONTRACT];
  const contract = recognised.find(candidate => named.some(key => summary[key] === candidate));
  if (!contract) return {};
  const others = named.filter(key => summary[key] !== contract);
  return { contract, ...(others.length ? { conflict: `run-summary.json names another contract in ${others.join(', ')}` } : {}) };
}

/** A deviation detection summary, and a pilot acceptance summary, records the SHA-256 of the metrics written with it
 * (`artifacts['metrics.json']`, the evaluator's convention), so the import admits only the metrics the reconstruction
 * checked. */
function requireMetricsBinding(summary: Record<string, unknown>, metrics: Buffer, kind = 'deviation detection'): void {
  const recorded = isRecord(summary.artifacts) ? summary.artifacts[BENCHMARK_RUN_FILES.metrics] : undefined;
  if (typeof recorded !== 'string') {
    throw new Error(`Unsupported ${kind} summary: run-summary.json records no SHA-256 of ${BENCHMARK_RUN_FILES.metrics} under artifacts.`);
  }
  if (recorded !== `sha256:${hash(metrics)}`) throw new Error(`${BENCHMARK_RUN_FILES.metrics} does not match the SHA-256 run-summary.json records for it.`);
}

/** Reuse the authoritative evaluator, including its byte-for-byte re-score.
 * Never accept a submitted summary or an externally supplied "ok" flag alone.
 * This is offline: it does not execute products, models, or live clinical APIs.
 * A run whose summary contract is synthetic-trial.deviation-detection-summary/1
 * (the O-7 run, spec P09 8.2) reconstructs through its own CommandCenter entry
 * and adds PQT-001 to PQT-006 (`derivePqtResults`) after the two rows every
 * import records. While the pilot import is on, a run whose summary contract is
 * cdisc-pilot-acceptance-summary/1 (the lab-to-endpoint pilot, LE-7.2)
 * reconstructs through its own CommandCenter entry, PILOT_RECONSTRUCTION_ENTRY, and
 * adds PQA-001 to PQA-021 and PQC-001 to PQC-004 (`derivePilotResults`) after the
 * two rows. The pilot summary is the observer's, not the scorer's: the benchmark
 * entry compares run-summary.json byte for byte with a fresh scoring, so it can
 * never accept one. Any other run keeps exactly those two rows.
 */
export async function importBenchmarkEvidence(outputDir: string, options: BenchmarkEvidenceOptions): Promise<EvidenceResult[]> {
  const pilotImport = options.pilotImport ?? process.env[PILOT_IMPORT_SWITCH] === 'true';
  const runDir = path.resolve(options.runDir);
  const root = path.resolve(options.commandCenterRoot ?? path.join(__dirname, '..', '..', '..', 'CommandCenter'));
  const timestamp = new Date().toISOString();
  // Admitted only as decided before the package existed (D-LE-14); the verifier recomputes the rule from the retained bytes.
  const admitted = options.publicData?.admitted ? options.publicData : undefined;
  const evidenceLevel = admitted ? PUBLIC_DATA_EVIDENCE_LEVEL : SYNTHETIC_EVIDENCE_LEVEL;
  // Appended last and only for an admitted run, so every other attachment keeps its bytes.
  const admittedBasis = admitted ? { publicDataBasis: {
    basisRef: admitted.basisRef, basisSha256: admitted.basisSha256, filedBy: admitted.filedBy, filedAt: admitted.filedAt,
  } } : {};
  const makeResult = (testCaseId: string, passed: boolean, responseBody: unknown, notes: string): EvidenceResult => ({
    testCaseId, timestamp, endpoint: runDir, method: 'OFFLINE', responseStatus: 0,
    responseBody, passed, notes: `${notes} ${admitted ? PUBLIC_DATA_SCOPE : SCOPE}`,
    testDescription: testCaseId === 'BENCHMARK-RECONSTRUCTION' ? 'Reconstruct frozen benchmark evidence' : 'Retained local engineering gate result',
    acceptanceCriteria: testCaseId === 'BENCHMARK-RECONSTRUCTION'
      ? 'All retained inputs, metrics, gates and outputs reconstruct with the recorded evaluator.'
      : 'Reconstruction succeeds and the authoritative localEngineering gate is passed.',
  });
  let results: EvidenceResult[];
  // Known once the summary bytes are read: a deviation detection run records its PQT rows whatever happens next,
  // from the reconstructed summary or from why the reconstruction failed.
  let deviationRun = false, pilotRun = false;
  let summarySha256: string | null = null, metricsSha256: string | null = null;
  let reconstructed: Record<string, unknown> | undefined, reconstructionError: string | undefined;
  try {
    const summaryPath = path.join(runDir, BENCHMARK_RUN_FILES.summary);
    const metricsPath = path.join(runDir, BENCHMARK_RUN_FILES.metrics);
    const beforeSummary = fs.readFileSync(summaryPath);
    const dispatch = summaryContractOf(beforeSummary, { pilot: pilotImport });
    deviationRun = dispatch.contract === DEVIATION_DETECTION_CONTRACT;
    pilotRun = dispatch.contract === PILOT_ACCEPTANCE_CONTRACT;
    summarySha256 = hash(beforeSummary);
    const beforeMetrics = fs.readFileSync(metricsPath);
    metricsSha256 = hash(beforeMetrics);
    if (dispatch.conflict) throw new Error(`Unsupported ${pilotRun ? 'pilot acceptance' : 'deviation detection'} summary: ${dispatch.conflict}.`);
    const script = path.join(root, ...(deviationRun ? DEVIATION_RECONSTRUCTION_ENTRY : pilotRun ? PILOT_RECONSTRUCTION_ENTRY : BENCHMARK_RECONSTRUCTION_ENTRY).split('/'));
    if (!fs.statSync(script, { throwIfNoEntry: false })?.isFile()) throw new Error(`Benchmark reconstruction entry not found: ${script}`);
    const args = [script, '--dir', runDir];
    if (options.evaluatorRoot) args.push('--evaluator-root', path.resolve(options.evaluatorRoot));
    const execution = spawnSync(process.execPath, args, {
      cwd: root, encoding: 'utf8', timeout: pilotRun ? PILOT_RECONSTRUCTION_TIMEOUT_MS : 120_000, maxBuffer: 4 * 1024 * 1024,
      windowsHide: true, shell: false,
    });
    if (execution.error) throw execution.error;
    if (execution.status !== 0 || execution.signal) {
      // Retain the diagnostic in the protected qualification package, not stdout.
      throw new Error(`Benchmark reconstruction failed: ${execution.stderr.trim() || execution.signal || execution.status}`);
    }
    const reconstruction: unknown = JSON.parse(execution.stdout);
    if (!isRecord(reconstruction) || reconstruction.ok !== true || reconstruction.rescored !== 'compared') {
      throw new Error('Benchmark reconstruction did not complete a byte-for-byte re-score.');
    }
    if (!beforeSummary.equals(fs.readFileSync(summaryPath)) || !beforeMetrics.equals(fs.readFileSync(metricsPath))) {
      throw new Error('Benchmark outputs changed during reconstruction.');
    }
    const summary: unknown = JSON.parse(beforeSummary.toString('utf8'));
    if (!isRecord(summary) || !isRecord(summary.evaluator) || !Array.isArray(summary.gateGroups)
      || !['passed', 'failed', 'blocked', 'not_run'].includes(String(summary.localEngineering))) {
      throw new Error('Unsupported benchmark summary contract.');
    }
    if (deviationRun) requireMetricsBinding(summary, beforeMetrics);
    if (pilotRun) requireMetricsBinding(summary, beforeMetrics, 'pilot acceptance');
    const attachment = {
      contract: 'accura-benchmark-qualification/1', evidenceLevel,
      independentlyValidated: false, runDir, evaluator: summary.evaluator,
      summarySha256, metricsSha256,
      reconstruction, localEngineering: summary.localEngineering,
      gateGroups: summary.gateGroups, reEvaluation: summary.reEvaluation ?? null,
      // Original records remain authoritative. Do not copy sealed case-level gold.
      artifacts: { summary: summaryPath, metrics: metricsPath },
      // Appended last and only for a deviation detection or pilot run, so every other attachment keeps its bytes.
      ...(deviationRun ? { summaryContract: DEVIATION_DETECTION_CONTRACT, reconstructionEntry: DEVIATION_RECONSTRUCTION_ENTRY } : {}),
      ...(pilotRun ? { summaryContract: PILOT_ACCEPTANCE_CONTRACT, reconstructionEntry: PILOT_RECONSTRUCTION_ENTRY } : {}),
      ...admittedBasis,
    };
    results = [
      makeResult('BENCHMARK-RECONSTRUCTION', true, attachment, 'Retained results reconstructed.'),
      makeResult('BENCHMARK-ENGINEERING-GATES', summary.localEngineering === 'passed', attachment,
        `Local engineering status: ${summary.localEngineering}. Other gate groups retain their original status.`),
    ];
    reconstructed = summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reconstructionError = message;
    results = [makeResult('BENCHMARK-RECONSTRUCTION', false,
      { contract: 'accura-benchmark-qualification/1', evidenceLevel, independentlyValidated: false, error: message,
        ...(deviationRun ? { summaryContract: DEVIATION_DETECTION_CONTRACT, reconstructionEntry: DEVIATION_RECONSTRUCTION_ENTRY } : {}),
        ...(pilotRun ? { summaryContract: PILOT_ACCEPTANCE_CONTRACT, reconstructionEntry: PILOT_RECONSTRUCTION_ENTRY } : {}),
        ...admittedBasis },
      'Benchmark evidence could not be reconstructed; no performance claim is admitted.'),
    makeResult('BENCHMARK-ENGINEERING-GATES', false, { status: 'not_run' }, 'Gate result unavailable without successful reconstruction.')];
  }
  if (deviationRun) {
    results.push(...derivePqtResults({ runDir, timestamp, summary: reconstructed, reconstructionError, summarySha256, metricsSha256 }));
  }
  if (pilotRun) {
    results.push(...derivePilotResults({ runDir, timestamp, summary: reconstructed, reconstructionError, summarySha256, metricsSha256,
      publicData: options.publicData }));
  }
  const target = path.join(outputDir, 'evidence', 'benchmark');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    // Atomically reserve the category: simultaneous imports cannot overwrite it.
    fs.mkdirSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('Benchmark evidence already exists; use a new qualification output directory.');
    }
    throw error;
  }
  saveEvidence(outputDir, 'benchmark', results);
  return results;
}

export interface PqtDerivationInput {
  runDir: string;
  timestamp: string;
  /** The reconstructed summary; absent when BENCHMARK-RECONSTRUCTION failed. */
  summary?: Record<string, unknown>;
  /** Why the reconstruction failed, when it did. */
  reconstructionError?: string;
  summarySha256: string | null;
  metricsSha256: string | null;
}

/** One case's reading of the reconstructed summary. */
interface PqtOutcome { passed: boolean; code?: string; detail: string; body: Record<string, unknown> }

const PQT_SCOPE = 'Derived from the reconstructed O-7 run without re-scoring. Synthetic engineering evidence only: the answer key stays a draft, unadjudicated self-review until a qualified person adjudicates it (PQT-006), and no clinical accuracy, independent validation or SURPASS attainment follows.';
/** The evaluator's gate statuses (CommandCenter synthetic-trial/evaluate/common.mjs `GATE_STATUSES`). */
const GATE_STATUSES = ['passed', 'failed', 'blocked', 'not_run', 'not_applicable'];
/** The members of a rule class entry, by its status; a reported class may add its unmatched detections, its
 * criticality and its critical misses. */
const RULE_CLASS_MEMBERS = {
  reported: { required: ['class', 'status', 'seeded', 'detected', 'recall', 'precision'], optional: ['unmatched', 'critical', 'criticalMisses'] },
  'not-seedable': { required: ['class', 'status', 'reason'], optional: [] },
} as const;
const RECALL_MEMBERS = ['value', 'lower', 'upper', 'method', 'confidence'];
const PRECISION_MEMBERS = ['matched', 'governed', 'value'];
/** Members that would score what they sit on; manual rules carry none (PQT-004). */
const SCORING_MEMBERS = ['seeded', 'detected', 'recall', 'precision', 'unmatched', 'criticalMisses'];
/** The release members a run may state (spec P20 7: the EDC API commit or image, IL commit, CSL release id, training commit). */
const RELEASE_COMPONENT_MEMBERS = ['api', 'ui', 'core', 'training'] as const;
const RELEASE_MEMBERS = [...RELEASE_COMPONENT_MEMBERS, 'il', 'csl'];

const isCount = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && (value as number) >= min;
const isRate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const isRateOrNull = (value: unknown) => value === null || isRate(value);
const isText = (value: unknown, max = 2048): value is string => typeof value === 'string' && value.trim().length > 0
  && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
/** Equal within the rounding of a JSON number; a ratio is compared, never recomputed into the record. */
const same = (left: number, right: number) => Math.abs(left - right) <= 1e-9;

/** The strict reading of one part of the summary: undefined when it holds exactly the members named, else why not. */
function membersProblem(value: unknown, at: string, required: readonly string[], optional: readonly string[] = []): string | undefined {
  try {
    strictObject(value, at, required, optional);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const pqtPass = (detail: string, body: Record<string, unknown>): PqtOutcome => ({ passed: true, detail, body });
const pqtFail = (code: string, detail: string, body: Record<string, unknown> = {}): PqtOutcome => ({ passed: false, code, detail, body });
const unsupported = (problems: string[], body: Record<string, unknown> = {}): PqtOutcome =>
  pqtFail(UNSUPPORTED_DEVIATION_SUMMARY, `The summary is not in a shape the import recognises: ${problems.join('; ')}.`, { ...body, problems });

/** PQT-002: the scorer's gate, read from the reconstructed gateGroups. */
function criticalMissesExplained(summary: Record<string, unknown>): PqtOutcome {
  if (!Array.isArray(summary.gateGroups)) return unsupported(['gateGroups is not an array']);
  const found: { group: unknown; gate: Record<string, unknown> }[] = [];
  for (const [index, group] of summary.gateGroups.entries()) {
    if (!isRecord(group) || !Array.isArray(group.gates)) return unsupported([`gateGroups[${index}] is not a gate group with a gates array`]);
    for (const gate of group.gates) {
      if (!isRecord(gate) || typeof gate.id !== 'string') return unsupported([`gateGroups[${index}] holds a gate without an id`]);
      if (gate.id === CRITICAL_EXPLAINED_GATE) found.push({ group: group.id, gate });
    }
  }
  if (found.length !== 1) {
    return unsupported([found.length ? `the gate ${CRITICAL_EXPLAINED_GATE} appears ${found.length} times` : `gateGroups hold no gate ${CRITICAL_EXPLAINED_GATE}`]);
  }
  const [{ group, gate }] = found;
  if (!GATE_STATUSES.includes(String(gate.status))) return unsupported([`the gate ${CRITICAL_EXPLAINED_GATE} has status ${JSON.stringify(gate.status)}`]);
  const body = { gateGroup: group, gate };
  return gate.status === 'passed'
    ? pqtPass(`The gate ${CRITICAL_EXPLAINED_GATE} is passed: no critical miss lacks an explanation code.`, body)
    : pqtFail('UNEXPLAINED_CRITICAL_MISS', `The gate ${CRITICAL_EXPLAINED_GATE} is ${gate.status}.`, body);
}

/** The shape of a reported class entry (types and members); undefined when the import recognises it. */
function reportedClassShape(entry: Record<string, unknown>, name: string): string | undefined {
  if (!isCount(entry.seeded) || !isCount(entry.detected)) return `${name}: seeded and detected are not counts`;
  const recallMembers = membersProblem(entry.recall, `${name}.recall`, RECALL_MEMBERS);
  if (recallMembers) return recallMembers;
  const recall = entry.recall as Record<string, unknown>;
  if (!['value', 'lower', 'upper'].every(key => isRateOrNull(recall[key])) || recall.method !== 'wilson'
    || typeof recall.confidence !== 'number' || !(recall.confidence > 0 && recall.confidence < 1)) {
    return `${name}.recall is not a Wilson interval (value, lower and upper rates or null, method wilson, a confidence between 0 and 1)`;
  }
  const precisionMembers = membersProblem(entry.precision, `${name}.precision`, PRECISION_MEMBERS);
  if (precisionMembers) return precisionMembers;
  const precision = entry.precision as Record<string, unknown>;
  if (!isCount(precision.matched) || !isCount(precision.governed) || !isRateOrNull(precision.value)) {
    return `${name}.precision is not matched and governed counts with a rate or null`;
  }
  if (entry.unmatched !== undefined && !isCount(entry.unmatched)) return `${name}.unmatched is not a count`;
  if (entry.critical !== undefined && typeof entry.critical !== 'boolean') return `${name}.critical is not a boolean`;
  if (entry.criticalMisses !== undefined) {
    if (!Array.isArray(entry.criticalMisses)) return `${name}.criticalMisses is not an array`;
    for (const [index, miss] of entry.criticalMisses.entries()) {
      const problem = membersProblem(miss, `${name}.criticalMisses[${index}]`, ['code', 'count']);
      if (problem) return problem;
      const { code, count } = miss as Record<string, unknown>;
      // A null code is a critical miss without an explanation, which the gate of PQT-002 reports.
      if (!(code === null || (CRITICAL_MISS_EXPLANATIONS as readonly unknown[]).includes(code)) || !isCount(count, 1)) {
        return `${name}.criticalMisses[${index}] is not an explanation code (or null) with a count of at least 1`;
      }
    }
  }
  return undefined;
}

/** Why a recognised reported class does not report its measures, or undefined when it does. */
function reportedClassGap(entry: Record<string, unknown>, name: string): string | undefined {
  const seeded = entry.seeded as number, detected = entry.detected as number;
  const recall = entry.recall as Record<string, number | null>, precision = entry.precision as Record<string, number | null>;
  if (seeded < 1) return `${name} seeded no deviation, so its recall is not measured`;
  if (detected > seeded) return `${name} detected more seeds than it seeded`;
  if (recall.value === null || recall.lower === null || recall.upper === null) return `${name} reports no recall with its interval`;
  if (!(recall.lower <= recall.value && recall.value <= recall.upper) || !same(recall.value, detected / seeded)) {
    return `${name} recall ${recall.value} [${recall.lower}, ${recall.upper}] is not ${detected} of ${seeded} within its interval`;
  }
  const matched = precision.matched as number, governed = precision.governed as number;
  if (matched > governed) return `${name} matched more detections than it governed`;
  if (governed === 0 ? precision.value !== null : precision.value === null || !same(precision.value, matched / governed)) {
    return `${name} precision ${precision.value} is not ${matched} of ${governed}`;
  }
  if (entry.unmatched !== undefined && entry.unmatched !== governed - matched) return `${name} unmatched ${entry.unmatched} is not ${governed} minus ${matched}`;
  return undefined;
}

/** PQT-003: every machine class reported, or stated not seedable with the reason. */
function everyClassReported(summary: Record<string, unknown>): PqtOutcome {
  if (!Array.isArray(summary.ruleClasses)) return unsupported(['ruleClasses is not an array of rule class entries']);
  const unrecognised: string[] = [], gaps: string[] = [], seen = new Set<string>();
  for (const [index, entry] of summary.ruleClasses.entries()) {
    const at = `ruleClasses[${index}]`;
    if (!isRecord(entry)) { unrecognised.push(`${at} is not an object`); continue; }
    const name = entry.class;
    if (typeof name !== 'string' || !(DEVIATION_MACHINE_CLASSES as readonly string[]).includes(name)) {
      unrecognised.push(`${at} names no machine class (${JSON.stringify(name)})`);
      continue;
    }
    if (seen.has(name)) { unrecognised.push(`${at} repeats ${name}`); continue; }
    seen.add(name);
    if (entry.status !== 'reported' && entry.status !== 'not-seedable') { unrecognised.push(`${name} has status ${JSON.stringify(entry.status)}`); continue; }
    const members = RULE_CLASS_MEMBERS[entry.status];
    const shape = membersProblem(entry, name, members.required, members.optional)
      ?? (entry.status === 'reported' ? reportedClassShape(entry, name) : typeof entry.reason === 'string' ? undefined : `${name}.reason is not text`);
    if (shape) { unrecognised.push(shape); continue; }
    const gap = entry.status === 'reported' ? reportedClassGap(entry, name) : isText(entry.reason) ? undefined : `${name} is not-seedable without a reason`;
    if (gap) gaps.push(gap);
  }
  const missing = DEVIATION_MACHINE_CLASSES.filter(name => !seen.has(name));
  if (missing.length) gaps.push(`no entry for ${missing.join(', ')}`);
  const body = { ruleClasses: summary.ruleClasses };
  if (unrecognised.length) return unsupported(unrecognised, body);
  if (gaps.length) return pqtFail('CLASS_NOT_REPORTED', `Not every machine class is reported: ${gaps.join('; ')}.`, { ...body, problems: gaps });
  const notSeedable = summary.ruleClasses.filter(entry => isRecord(entry) && entry.status === 'not-seedable').length;
  return pqtPass(`All ten machine classes are reported: ${10 - notSeedable} seeded, ${notSeedable} not seedable with a reason.`, body);
}

/** PQT-004: manual rules counted, never scored. */
function manualRulesCounted(summary: Record<string, unknown>): PqtOutcome {
  const manual = summary.manualRules;
  const scored = isRecord(manual) ? Object.keys(manual).filter(key => SCORING_MEMBERS.includes(key)) : [];
  const manualClass = Array.isArray(summary.ruleClasses) && summary.ruleClasses.some(entry => isRecord(entry) && entry.class === 'manual');
  if (scored.length || manualClass) {
    return pqtFail('MANUAL_RULE_SCORED', `Manual rules are scored: ${[...scored.map(key => `manualRules.${key}`), ...(manualClass ? ['a manual rule class'] : [])].join(', ')}.`, { manualRules: manual ?? null });
  }
  const problem = membersProblem(manual, 'manualRules', ['specRules', 'manualReviewRequired']);
  if (problem) return unsupported([problem]);
  const counts = manual as Record<string, unknown>;
  if (!isCount(counts.specRules) || !isCount(counts.manualReviewRequired)) return unsupported(['manualRules.specRules and manualRules.manualReviewRequired are not counts']);
  return pqtPass(`Manual rules are counted, never scored: ${counts.specRules} manual rule(s) in the spec, ${counts.manualReviewRequired} manual_review_required outcome(s).`, { manualRules: counts });
}

/** PQT-005: the run's own EDC API release; the OQ release is compared only by the platform summary (22). */
function releaseStated(summary: Record<string, unknown>): PqtOutcome {
  const release = summary.release;
  if (release === undefined || release === null) return pqtFail('RELEASE_NOT_RECORDED', 'The run states no release.', { release: null });
  const problem = membersProblem(release, 'release', [], RELEASE_MEMBERS);
  if (problem) return unsupported([problem]);
  const stated = release as Record<string, unknown>;
  if (stated.api === undefined || stated.api === null) return pqtFail('RELEASE_NOT_RECORDED', 'The run states no EDC API release (release.api).', { release: null });
  const recorded: Record<string, string> = {};
  for (const name of RELEASE_COMPONENT_MEMBERS) {
    const value = stated[name];
    if (value === undefined) continue;
    try {
      if (typeof value !== 'string') throw new Error('not text');
      recorded[name] = parseReleaseComponent(name, value).identity;
    } catch {
      return unsupported([`release.${name} is not a 40-character Git commit or a sha256 image ID${name === 'api' ? '' : ', or none'}`]);
    }
  }
  if (stated.il !== undefined) {
    if (typeof stated.il !== 'string' || !/^[0-9a-f]{40}$/.test(stated.il.trim().toLowerCase())) return unsupported(['release.il is not a 40-character Git commit']);
    recorded.il = stated.il.trim().toLowerCase();
  }
  if (stated.csl !== undefined) {
    if (!isText(stated.csl, 256)) return unsupported(['release.csl is not a release id']);
    recorded.csl = stated.csl;
  }
  return pqtPass(`The run states its EDC API release ${recorded.api}.`, { release: recorded });
}

/** PQT-001 to PQT-006 of a deviation detection run (spec P20 3.5), derived from the reconstructed summary without
 * re-scoring. Pure: it reads no file, clock or process. A case whose part of the summary holds a member, value or
 * shape it does not recognise records UNSUPPORTED_DEVIATION_SUMMARY, never a guess; without a reconstruction
 * PQT-002 to PQT-005 are not executed; PQT-006 is manual and never passes (D-10). */
export function derivePqtResults(input: PqtDerivationInput): EvidenceResult[] {
  const identity = { summaryContract: DEVIATION_DETECTION_CONTRACT, summarySha256: input.summarySha256, metricsSha256: input.metricsSha256 };
  const row = (pqCase: Ta3PqCase, method: string, outcome: PqtOutcome, notes: string): EvidenceResult => ({
    testCaseId: pqCase.id, timestamp: input.timestamp, endpoint: input.runDir, method, responseStatus: 0,
    responseBody: { ...identity, ...outcome.body }, passed: outcome.passed, notes,
    ...(outcome.code ? { outcomeCode: outcome.code } : {}),
    regulatoryRef: ta3RegulatoryRef(pqCase), testDescription: pqCase.title, acceptanceCriteria: pqCase.passesWhen,
  });
  const summary = input.summary;
  const derived: Record<string, () => PqtOutcome> = {
    'PQT-001': () => summary
      ? pqtPass(`The run reconstructed through ${DEVIATION_RECONSTRUCTION_ENTRY} (BENCHMARK-RECONSTRUCTION passed).`, { reconstructionEntry: DEVIATION_RECONSTRUCTION_ENTRY })
      : pqtFail('RECONSTRUCTION_FAILED', `BENCHMARK-RECONSTRUCTION failed: ${input.reconstructionError ?? 'no reconstruction'}`,
        { reconstructionEntry: DEVIATION_RECONSTRUCTION_ENTRY, error: input.reconstructionError ?? null }),
    'PQT-002': () => criticalMissesExplained(summary!),
    'PQT-003': () => everyClassReported(summary!),
    'PQT-004': () => manualRulesCounted(summary!),
    'PQT-005': () => releaseStated(summary!),
  };
  return TA3_PQ_CASES.map(pqCase => {
    if (pqCase.method === 'MANUAL') {
      return row(pqCase, 'MANUAL', { passed: false, detail: '', body: { adjudication: 'required: the answer key is a draft, unadjudicated self-review' } },
        'Manual verification required: a qualified person adjudicates the run\'s deviation answer key and the adjudication record is retained beside the package; the import never passes this case (D-10). '
        + PQT_SCOPE);
    }
    if (!summary && pqCase.id !== 'PQT-001') {
      return row(pqCase, 'CONTRACT', { passed: false, code: 'RECONSTRUCTION_FAILED', detail: '', body: {} },
        `Not derived: the run did not reconstruct (PQT-001), so no reconstructed summary is admitted. ${PQT_SCOPE}`);
    }
    const outcome = derived[pqCase.id]();
    return row(pqCase, 'OFFLINE', outcome, `${outcome.detail} ${PQT_SCOPE}`);
  });
}

/* ------------------------------------------------------------------------------------------------------------- */
/*  The lab-to-endpoint pilot cases (LE-7.2): PQA-001 to PQA-021 and PQC-001 to PQC-004                          */
/* ------------------------------------------------------------------------------------------------------------- */

export interface PilotDerivationInput extends PqtDerivationInput {
  /** Reads one evidence file the summary cites, by absolute path; injected so the derivation reads nothing else. */
  readEvidence?: (absolutePath: string) => Buffer;
  /** The D-LE-14 decision on this run; an R2 run passes no case without an admission. */
  publicData?: PublicDataAdmission;
}

const PILOT_SCOPE = 'Derived from the reconstructed pilot run without re-scoring: the import admits the run\'s verdict for a case only with every '
  + 'evidence file it cites verified by SHA-256 under the run directory, complete coverage and an answer key whose own manifest and seal record show it sealed before the run; it does not '
  + 're-judge the evidence content. An R1 run is synthetic engineering evidence (D-LE-14) with mechanical or builder-declared keys (D-LE-21); only '
  + 'an R2 run with countersigned keys and the declared-public-data basis is the run of record.';
const PILOT_MEMBERS = ['runKind', 'startedAt', 'classification', 'keySet', 'cases', 'controls'];
const PILOT_KEY_SET_MEMBERS = ['keySetId', 'manifestSha256', 'sealedAt', 'criticalInstancesDeclared', 'manifest', 'seal'];
const PILOT_NON_CLAIM_MEMBERS = ['claim', 'status', 'decision'];
const PILOT_CASE_MEMBERS = ['case', 'requirement', 'verdict', 'coverage', 'scoredInstances', 'criticalInstances', 'criticalFailures', 'keyBasis', 'evidence'];
const PILOT_CONTROL_MEMBERS = ['control', 'requirement', 'systems'];
const PILOT_VERDICTS = ['pass', 'fail', 'inconclusive', 'not-run'];
const PILOT_COVERAGE = ['complete', 'incomplete'];
const PILOT_KEY_BASES = ['mechanical', 'builder-declared', 'countersigned'];
/** The counts each control reports per system (the LE-7.3 producer writes exactly these members). */
const PILOT_CONTROL_COUNTS: Readonly<Record<PilotControl, readonly string[]>> = {
  security: ['probes', 'refusedAsExpected', 'unexpectedAcceptances'],
  'backup-restore': ['backupTaken', 'restoredIsolated', 'sourceDigest', 'restoredDigest', 'recoveryPointSeconds', 'recoveryTimeSeconds'],
  'signature-linking': ['signatures', 'linked', 'digestRecomputedEqual', 'unlinked', 'mismatched'],
  'access-census': ['accessEvents', 'accountChangeEvents', 'accountsDeclared', 'accountsFound', 'accountsUndeclared', 'windowStart'],
};
const isInstant = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

interface PilotRunBlock {
  runKind: 'R1' | 'R2';
  startedAt: string;
  classification: { kind: string; basisRef?: string; basisSha256?: string };
  keySet: {
    keySetId: string; manifestSha256: string; sealedAt: string; criticalInstancesDeclared: number;
    manifest: { path: string; sha256: string }; seal: { path: string; sha256: string };
  };
  cases: Record<string, unknown>[];
  controls: Record<string, unknown>[];
  nonClaims?: { claim: string; status: string; decision: string }[];
}

/** What a run does not claim, read strictly: every claim the catalog names, in a status it allows. An R1 summary must state
 * the three non-claims OD-23 and OD-24 decide; R2 exercises the governed lane, so it cannot list that one. There is no
 * passed status, so a non-claim can never read as a pass. */
function nonClaimProblems(pilot: Record<string, unknown>): string[] {
  const value = pilot.nonClaims;
  const stated: Record<string, unknown>[] = [];
  const problems: string[] = [];
  if (value !== undefined) {
    if (!Array.isArray(value)) return ['pilot.nonClaims is not an array'];
    for (const [index, entry] of value.entries()) {
      const at = `pilot.nonClaims[${index}]`;
      const shape = membersProblem(entry, at, PILOT_NON_CLAIM_MEMBERS);
      if (shape) { problems.push(shape); continue; }
      const item = entry as Record<string, unknown>;
      if (!PILOT_NON_CLAIMS.some(known => known.claim === item.claim)) problems.push(`${at}.claim is ${JSON.stringify(item.claim)}, which the catalog lacks`);
      if (!(PILOT_NON_CLAIM_STATUSES as readonly unknown[]).includes(item.status)) problems.push(`${at}.status is ${JSON.stringify(item.status)}, not ${PILOT_NON_CLAIM_STATUSES.join(' or ')}`);
      if (!isText(item.decision, 64)) problems.push(`${at}.decision is not text`);
      if (stated.some(other => other.claim === item.claim)) problems.push(`pilot.nonClaims repeats ${String(item.claim)}`);
      stated.push(item);
    }
  }
  if (pilot.runKind === 'R1') {
    for (const required of PILOT_NON_CLAIMS) {
      const found = stated.find(item => item.claim === required.claim);
      if (!found) problems.push(`an R1 summary must state pilot.nonClaims ${required.claim} as ${required.status} (${required.decision})`);
      else if (found.status !== required.status || found.decision !== required.decision) problems.push(`pilot.nonClaims ${required.claim} must be ${required.status} (${required.decision}) on R1`);
    }
  }
  if (pilot.runKind === 'R2') {
    for (const item of stated) {
      if (PILOT_NON_CLAIMS.find(known => known.claim === item.claim)?.onR2 === false) problems.push(`an R2 run cannot state ${String(item.claim)} as a non-claim`);
    }
  }
  return problems;
}

/** The run block every pilot case reads, or the problems that make the whole summary unrecognised (never a guess). */
function pilotRunBlock(summary: Record<string, unknown>): { run?: PilotRunBlock; problems: string[] } {
  const problems: string[] = [];
  const shape = membersProblem(summary.pilot, 'pilot', PILOT_MEMBERS, ['nonClaims']);
  if (shape) return { problems: [shape] };
  const pilot = summary.pilot as Record<string, unknown>;
  if (pilot.runKind !== 'R1' && pilot.runKind !== 'R2') problems.push(`pilot.runKind is ${JSON.stringify(pilot.runKind)}, not R1 or R2`);
  if (!isInstant(pilot.startedAt)) problems.push('pilot.startedAt is not an RFC 3339 instant');
  const classification = pilot.classification;
  const kind = isRecord(classification) ? classification.kind : undefined;
  const classificationShape = kind === 'synthetic-engineering' ? membersProblem(classification, 'pilot.classification', ['kind'])
    : kind === 'declared-public-data' ? membersProblem(classification, 'pilot.classification', ['kind', 'basisRef', 'basisSha256'])
      ?? (isText((classification as Record<string, unknown>).basisRef, 512) ? undefined : 'pilot.classification.basisRef is not text')
      ?? (SHA256_HEX.test(String((classification as Record<string, unknown>).basisSha256)) ? undefined : 'pilot.classification.basisSha256 is not a SHA-256 hex')
      : `pilot.classification.kind is ${JSON.stringify(kind)}, not synthetic-engineering or declared-public-data`;
  if (classificationShape) problems.push(classificationShape);
  const keyShape = membersProblem(pilot.keySet, 'pilot.keySet', PILOT_KEY_SET_MEMBERS);
  if (keyShape) problems.push(keyShape);
  else {
    const keySet = pilot.keySet as Record<string, unknown>;
    if (!isText(keySet.keySetId, 256)) problems.push('pilot.keySet.keySetId is not text');
    if (typeof keySet.manifestSha256 !== 'string' || !SHA256_HEX.test(keySet.manifestSha256)) problems.push('pilot.keySet.manifestSha256 is not a SHA-256 hex');
    if (!isInstant(keySet.sealedAt)) problems.push('pilot.keySet.sealedAt is not an RFC 3339 instant');
    if (!isCount(keySet.criticalInstancesDeclared)) problems.push('pilot.keySet.criticalInstancesDeclared is not a count');
    for (const member of ['manifest', 'seal']) {
      const file = keySet[member];
      const fileShape = membersProblem(file, `pilot.keySet.${member}`, ['path', 'sha256']);
      if (fileShape) { problems.push(fileShape); continue; }
      const { path: cited, sha256 } = file as Record<string, unknown>;
      if (!isText(cited, 1024) || typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) problems.push(`pilot.keySet.${member} is not a path with a SHA-256 hex`);
    }
    if (isRecord(keySet.manifest) && keySet.manifest.sha256 !== keySet.manifestSha256) problems.push('pilot.keySet.manifest.sha256 is not pilot.keySet.manifestSha256');
  }
  problems.push(...nonClaimProblems(pilot));
  const known = new Set(PILOT_PQ_CASES.map(entry => entry.acceptanceCase));
  for (const [member, key, allowed] of [['cases', 'case', /^A\d+$/], ['controls', 'control', null]] as const) {
    const list = pilot[member];
    if (!Array.isArray(list)) { problems.push(`pilot.${member} is not an array`); continue; }
    const seen = new Set<string>();
    for (const [index, entry] of list.entries()) {
      const id = isRecord(entry) ? entry[key] : undefined;
      const recognised = typeof id === 'string' && known.has(id) && (allowed ? allowed.test(id) : (PILOT_CONTROLS as readonly string[]).includes(id));
      if (!recognised) { problems.push(`pilot.${member}[${index}].${key} is ${JSON.stringify(id)}, which the catalog lacks`); continue; }
      if (seen.has(id as string)) problems.push(`pilot.${member} repeats ${id}`);
      seen.add(id as string);
    }
  }
  if (problems.length) return { problems };
  return { run: pilot as unknown as PilotRunBlock, problems };
}

/** The classification rule of D-LE-14: R1 keeps the synthetic classification, R2 needs the declared-public-data basis,
 * and an R2 case passes only from a run admitted under that basis, so a pass is never recorded in a synthetic package. */
function classificationFailure(run: PilotRunBlock, publicData?: PublicDataAdmission): PqtOutcome | undefined {
  const expected = run.runKind === 'R1' ? 'synthetic-engineering' : 'declared-public-data';
  if (run.classification.kind !== expected) {
    return pqtFail('CLASSIFICATION_MISMATCH', `A ${run.runKind} run must be classified ${expected} (D-LE-14); it states ${run.classification.kind}.`,
      { classification: run.classification });
  }
  if (run.runKind !== 'R2' || publicData?.admitted) return undefined;
  const why = publicData && !publicData.admitted ? `${publicData.code}: ${publicData.reason}` : 'no admission was decided for this import';
  return pqtFail(PUBLIC_DATA_BASIS_NOT_ADMITTED, `The R2 run was not admitted under a filed declared-public-data basis (D-LE-14). ${why}`,
    { classification: run.classification });
}

/** The D-LE-14 decision on an imported run. Only an admitted run makes a package that is not synthetic. `claimed` says
 * whether the summary claims the declared-public-data basis at all; a run that does not stays synthetic silently. */
export type PublicDataAdmission =
  | { admitted: true; claimed: true; basisRef: string; basisSha256: string; summarySha256: string; filedBy: string; filedAt: string; bytes: Buffer }
  | { admitted: false; claimed: boolean; code: string; reason: string };

/** The members of a filed basis (contracts/pilot-declared-public-data-basis-v1.schema.json). */
export const PILOT_PUBLIC_DATA_BASIS_MEMBERS = ['contract', 'study', 'runKind', 'classification', 'decisions', 'dataUseManifestSha256', 'keySetManifestSha256', 'filedBy', 'filedRole', 'filedAt'] as const;
/** The decisions a basis must cite: the CDISC data use (D-LE-1) and the evidence classification (D-LE-14). */
const PILOT_PUBLIC_DATA_DECISIONS = ['D-LE-1', 'D-LE-14'];

const notAdmitted = (claimed: boolean, code: string, reason: string): PublicDataAdmission => ({ admitted: false, claimed, code, reason });

/** What a run summary claims. Not a claim: a summary that is not the pilot contract, or whose classification is not
 * declared-public-data. A claim the rule refuses before any basis is read carries its refusal. Pure. */
export function publicDataClaim(summaryBytes: Buffer):
  { claimed: false } | { claimed: true; refusal: PublicDataAdmission } | { claimed: true; basisRef: string; basisSha256: string; startedAt: string; keySetManifestSha256: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(summaryBytes.toString('utf8')); } catch { return { claimed: false }; }
  if (!isRecord(parsed)) return { claimed: false };
  const dispatch = summaryContractOf(summaryBytes, { pilot: true });
  const pilot = parsed.pilot;
  const kind = isRecord(pilot) && isRecord(pilot.classification) ? pilot.classification.kind : undefined;
  if (dispatch.contract !== PILOT_ACCEPTANCE_CONTRACT || kind !== 'declared-public-data') return { claimed: false };
  const refused = (code: string, reason: string) => ({ claimed: true as const, refusal: notAdmitted(true, code, reason) });
  if (dispatch.conflict) return refused('PUBLIC_DATA_SUMMARY_UNSUPPORTED', dispatch.conflict);
  if (isRecord(pilot) && pilot.runKind === 'R1') return refused('PUBLIC_DATA_NOT_R2', 'only an R2 run is admitted under the declared-public-data basis; this summary states R1 (D-LE-14)');
  const { run, problems } = pilotRunBlock(parsed);
  if (!run) return refused('PUBLIC_DATA_SUMMARY_UNSUPPORTED', problems.join('; '));
  return { claimed: true, basisRef: run.classification.basisRef!, basisSha256: run.classification.basisSha256!, startedAt: run.startedAt, keySetManifestSha256: run.keySet.manifestSha256 };
}

/** The D-LE-14 rule on the bytes of a run summary and of the basis it cites: an R2 pilot summary classified
 * declared-public-data, whose basisSha256 is these bytes, a record in the basis contract naming the pilot study and the
 * sealed key set this run states (so a rehearsal under another key set cannot borrow it), filed before the run started. Pure: `admitPublicDataRun` reads the filed bytes, the package verifier the retained ones. */
export function publicDataAdmissionOf(summaryBytes: Buffer, basisBytes: Buffer): PublicDataAdmission {
  const claim = publicDataClaim(summaryBytes);
  if (!claim.claimed) return notAdmitted(false, 'PUBLIC_DATA_NOT_CLAIMED', 'the run summary claims no declared-public-data basis');
  if ('refusal' in claim) return claim.refusal;
  const actual = hash(basisBytes);
  if (actual !== claim.basisSha256) {
    return notAdmitted(true, 'PUBLIC_DATA_BASIS_HASH_MISMATCH', `the summary cites basis SHA-256 ${claim.basisSha256}; the filed bytes are ${actual}`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(basisBytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { return notAdmitted(true, 'PUBLIC_DATA_BASIS_UNSUPPORTED', 'the filed basis is not JSON'); }
  const shape = membersProblem(parsed, 'the filed basis', PILOT_PUBLIC_DATA_BASIS_MEMBERS);
  if (shape) return notAdmitted(true, 'PUBLIC_DATA_BASIS_UNSUPPORTED', shape);
  const basis = parsed as Record<string, unknown>;
  const gaps = [
    ...(basis.contract === PILOT_PUBLIC_DATA_BASIS_CONTRACT ? [] : [`contract is not ${PILOT_PUBLIC_DATA_BASIS_CONTRACT}`]),
    ...(basis.study === PILOT_STUDY ? [] : [`study is not ${PILOT_STUDY}`]),
    ...(basis.runKind === 'R2' ? [] : ['runKind is not R2']),
    ...(basis.classification === 'declared-public-data' ? [] : ['classification is not declared-public-data']),
    ...(Array.isArray(basis.decisions) && basis.decisions.every(id => isText(id, 64)) && new Set(basis.decisions).size === basis.decisions.length
      && PILOT_PUBLIC_DATA_DECISIONS.every(id => (basis.decisions as unknown[]).includes(id)) ? [] : [`decisions are not distinct ids citing ${PILOT_PUBLIC_DATA_DECISIONS.join(' and ')}`]),
    ...(typeof basis.dataUseManifestSha256 === 'string' && SHA256_HEX.test(basis.dataUseManifestSha256) ? [] : ['dataUseManifestSha256 is not a SHA-256 hex']),
    ...(typeof basis.keySetManifestSha256 === 'string' && SHA256_HEX.test(basis.keySetManifestSha256) ? [] : ['keySetManifestSha256 is not a SHA-256 hex']),
    ...(isText(basis.filedBy, 200) ? [] : ['filedBy is not text']),
    ...(isText(basis.filedRole, 200) ? [] : ['filedRole is not text']),
    ...(isInstant(basis.filedAt) ? [] : ['filedAt is not an RFC 3339 instant']),
  ];
  if (gaps.length) return notAdmitted(true, 'PUBLIC_DATA_BASIS_UNSUPPORTED', gaps.join('; '));
  if (basis.keySetManifestSha256 !== claim.keySetManifestSha256) {
    return notAdmitted(true, 'PUBLIC_DATA_BASIS_KEY_SET_MISMATCH', `the basis covers the sealed key set ${basis.keySetManifestSha256}; this run states ${claim.keySetManifestSha256}`);
  }
  if (Date.parse(basis.filedAt as string) >= Date.parse(claim.startedAt)) {
    return notAdmitted(true, 'PUBLIC_DATA_BASIS_FILED_AFTER_RUN_START', `the basis was filed at ${basis.filedAt}, not before the run started at ${claim.startedAt}`);
  }
  return { admitted: true, claimed: true, basisRef: claim.basisRef, basisSha256: actual, summarySha256: hash(summaryBytes),
    filedBy: basis.filedBy as string, filedAt: basis.filedAt as string, bytes: basisBytes };
}

interface PilotEvidenceCheck { path: string; sha256: string; status: 'verified' | 'missing' | 'mismatch' | 'outside'; actualSha256?: string }

/** Verifies each evidence file a result cites: a relative path inside the run directory whose bytes have the recorded
 * SHA-256. Returns undefined checks when the list is not in the recognised shape. */
function pilotEvidence(runDir: string, value: unknown, at: string, read: (absolutePath: string) => Buffer):
  { checks?: PilotEvidenceCheck[]; problem?: string } {
  if (!Array.isArray(value)) return { problem: `${at} is not an array` };
  const checks: PilotEvidenceCheck[] = [];
  for (const [index, entry] of value.entries()) {
    const problem = membersProblem(entry, `${at}[${index}]`, ['path', 'sha256']);
    if (problem) return { problem };
    const { path: relative, sha256 } = entry as Record<string, unknown>;
    if (!isText(relative, 1024) || typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) {
      return { problem: `${at}[${index}] is not a path with a SHA-256 hex` };
    }
    const target = path.resolve(runDir, relative);
    // A link inside the run directory that resolves outside it is outside too.
    let resolvedOutside = false;
    try { resolvedOutside = !isInside(fs.realpathSync(runDir), fs.realpathSync(target)); } catch { /* absent: reported missing below */ }
    if (path.isAbsolute(relative) || !isInside(runDir, target) || resolvedOutside) {
      checks.push({ path: relative, sha256, status: 'outside' });
      continue;
    }
    let bytes: Buffer;
    try { bytes = read(target); } catch { checks.push({ path: relative, sha256, status: 'missing' }); continue; }
    const actual = hash(bytes);
    checks.push(actual === sha256 ? { path: relative, sha256, status: 'verified' } : { path: relative, sha256, status: 'mismatch', actualSha256: actual });
  }
  return { checks };
}

/** The refusal an evidence list gives, the worst first; undefined when every file verified. */
function evidenceFailure(checks: readonly PilotEvidenceCheck[], at: string): PqtOutcome | undefined {
  const named = (status: PilotEvidenceCheck['status']) => checks.filter(check => check.status === status).map(check => check.path);
  const body = { evidence: checks };
  if (named('outside').length) return pqtFail('EVIDENCE_PATH_OUTSIDE_RUN', `${at} cites files outside the run directory: ${named('outside').join(', ')}.`, body);
  if (named('mismatch').length) return pqtFail('EVIDENCE_HASH_MISMATCH', `${at} cites files whose bytes differ from the recorded SHA-256: ${named('mismatch').join(', ')}.`, body);
  if (named('missing').length) return pqtFail('EVIDENCE_MISSING', `${at} cites files the run directory lacks: ${named('missing').join(', ')}.`, body);
  return undefined;
}

/** What the sealed key set's own bytes state (D-LE-21): identifiers, the seal time, N, the held case ids and which cases are
 * countersigned. Only these are read and recorded; no key file is opened, so no gold enters the framework. */
interface SealedKeySet {
  keySetId: string;
  manifestSha256: string;
  sealedAt: string;
  criticalInstancesDeclared: number;
  /** The case ids the manifest's coverage still holds (coverage.held[].case). */
  held: string[];
  /** The cases adjudication.countersignatures names, each with who countersigned, in what role and when. */
  countersignedCases: string[];
}

/** Reads the key set a run states from the two files it cites, the sealed manifest and the seal record (the key set's
 * root COMPLETE marker), both inside the run directory with the recorded SHA-256. A cited file that is absent or outside
 * the run records KEY_MANIFEST_MISSING; bytes or facts that differ from what the summary states record KEY_MANIFEST_MISMATCH. */
function sealedKeySetOf(run: PilotRunBlock, runDir: string, read: (absolutePath: string) => Buffer): { sealed?: SealedKeySet; failure?: PqtOutcome } {
  const { manifest: manifestFile, seal: sealFile } = run.keySet;
  const checks = pilotEvidence(runDir, [manifestFile, sealFile], 'pilot.keySet', read).checks ?? [];
  const body = { keySetFiles: checks };
  const named = (...statuses: PilotEvidenceCheck['status'][]) => checks.filter(check => statuses.includes(check.status)).map(check => check.path);
  if (named('missing', 'outside').length) {
    return { failure: pqtFail('KEY_MANIFEST_MISSING', `The run cites a key set manifest or seal record it does not hold inside the run directory: ${named('missing', 'outside').join(', ')}.`, body) };
  }
  if (named('mismatch').length) {
    return { failure: pqtFail('KEY_MANIFEST_MISMATCH', `The key set files differ from the SHA-256 the summary records: ${named('mismatch').join(', ')}.`, body) };
  }
  const parsed = (file: { path: string }): Record<string, unknown> | undefined => {
    try {
      const value: unknown = JSON.parse(read(path.resolve(runDir, file.path)).toString('utf8').replace(/^\uFEFF/, ''));
      return isRecord(value) ? value : undefined;
    } catch { return undefined; }
  };
  const manifest = parsed(manifestFile), seal = parsed(sealFile);
  if (!manifest || !seal) return { failure: pqtFail('KEY_MANIFEST_MISMATCH', 'The key set manifest or seal record is not a JSON object.', body) };
  const bare = (value: unknown) => (typeof value === 'string' ? value.replace(/^sha256:/, '') : '');
  const stated = run.keySet;
  const coverage = isRecord(manifest.coverage) ? manifest.coverage : undefined;
  const adjudication = isRecord(manifest.adjudication) ? manifest.adjudication : undefined;
  const held = Array.isArray(coverage?.held) ? coverage.held : undefined;
  const countersignatures = Array.isArray(adjudication?.countersignatures) ? adjudication.countersignatures : undefined;
  const gaps = [
    ...(seal.status === 'COMPLETE' ? [] : ['the seal record is not status COMPLETE']),
    ...(seal.keySetId === stated.keySetId ? [] : [`the seal record names key set ${JSON.stringify(seal.keySetId)}`]),
    ...(manifest.keySetId === stated.keySetId ? [] : [`the manifest names key set ${JSON.stringify(manifest.keySetId)}`]),
    ...(bare(seal.manifestSha256) === manifestFile.sha256 ? [] : ['the seal record names another manifest']),
    ...(isInstant(seal.sealedAt) && Date.parse(seal.sealedAt) === Date.parse(stated.sealedAt) ? [] : [`the seal record states sealedAt ${JSON.stringify(seal.sealedAt)}`]),
    ...(manifest.study === PILOT_STUDY ? [] : [`the manifest names study ${JSON.stringify(manifest.study)}`]),
    ...(isCount(manifest.criticalInstancesDeclared) ? [] : ['the manifest declares no criticalInstancesDeclared']),
    ...(isCount(manifest.criticalInstancesDeclared) && manifest.criticalInstancesDeclared !== stated.criticalInstancesDeclared
      ? [`the manifest declares ${manifest.criticalInstancesDeclared} critical instances`] : []),
    ...(held?.every(entry => isRecord(entry) && isText(entry.case, 64)) ? [] : ['the manifest has no coverage.held list of case ids']),
    ...(countersignatures?.every(entry => isRecord(entry) && isText(entry.case, 64) && isText(entry.by, 200) && isText(entry.role, 200) && isInstant(entry.at))
      ? [] : ['the manifest has no adjudication.countersignatures list of case, by, role and at']),
  ];
  if (gaps.length) return { failure: pqtFail('KEY_MANIFEST_MISMATCH', `The sealed key set does not say what the summary states: ${gaps.join('; ')}.`, { ...body, problems: gaps }) };
  return { sealed: {
    keySetId: stated.keySetId, manifestSha256: manifestFile.sha256, sealedAt: seal.sealedAt as string, criticalInstancesDeclared: manifest.criticalInstancesDeclared as number,
    held: (held as Record<string, unknown>[]).map(entry => entry.case as string),
    countersignedCases: (countersignatures as Record<string, unknown>[]).map(entry => entry.case as string),
  } };
}

/** Whether the sealed key set holds an acceptance case: its id, or a part of it (A13-overlay holds A13). */
const keySetHolds = (sealed: SealedKeySet, acceptanceCase: string) => sealed.held.some(id => id === acceptanceCase || id.startsWith(`${acceptanceCase}-`));

/** One acceptance case's result as admitted, or not executed (`executed: false`) when the run did not run or report it. */
interface PilotCaseOutcome { executed: boolean; outcome: PqtOutcome; criticalInstances?: number; criticalFailures?: number }

function acceptanceOutcome(pqCase: Ta3PqCase, run: PilotRunBlock, keys: ReturnType<typeof sealedKeySetOf>, runDir: string, read: (absolutePath: string) => Buffer, publicData?: PublicDataAdmission): PilotCaseOutcome {
  const at = `pilot.cases ${pqCase.acceptanceCase}`;
  const result = run.cases.find(entry => entry.case === pqCase.acceptanceCase);
  if (!result) {
    return { executed: false, outcome: pqtFail('CASE_NOT_REPORTED', `The run reports no result for ${pqCase.acceptanceCase}; nothing is admitted.`) };
  }
  const shape = membersProblem(result, at, PILOT_CASE_MEMBERS, ['reason']);
  if (shape) return { executed: true, outcome: unsupportedPilot([shape]) };
  const problems: string[] = [];
  if (typeof result.requirement !== 'string') problems.push(`${at}.requirement is not text`);
  if (!PILOT_VERDICTS.includes(String(result.verdict))) problems.push(`${at}.verdict is ${JSON.stringify(result.verdict)}`);
  if (!PILOT_COVERAGE.includes(String(result.coverage))) problems.push(`${at}.coverage is ${JSON.stringify(result.coverage)}`);
  if (!PILOT_KEY_BASES.includes(String(result.keyBasis))) problems.push(`${at}.keyBasis is ${JSON.stringify(result.keyBasis)}`);
  if (!isCount(result.scoredInstances) || !isCount(result.criticalInstances) || !isCount(result.criticalFailures)) {
    problems.push(`${at}: scoredInstances, criticalInstances and criticalFailures are not counts`);
  } else if ((result.criticalFailures as number) > (result.criticalInstances as number) || (result.criticalInstances as number) > (result.scoredInstances as number)) {
    problems.push(`${at}: criticalFailures ${result.criticalFailures}, criticalInstances ${result.criticalInstances} and scoredInstances ${result.scoredInstances} are not nested`);
  }
  if (result.reason !== undefined && !isText(result.reason)) problems.push(`${at}.reason is not text`);
  const evidence = pilotEvidence(runDir, result.evidence, `${at}.evidence`, read);
  if (evidence.problem) problems.push(evidence.problem);
  if (problems.length) return { executed: true, outcome: unsupportedPilot(problems) };
  const counts = { scoredInstances: result.scoredInstances, criticalInstances: result.criticalInstances, criticalFailures: result.criticalFailures };
  const body = {
    case: pqCase.acceptanceCase, requirement: result.requirement, verdict: result.verdict, coverage: result.coverage, keyBasis: result.keyBasis,
    ...counts, evidence: evidence.checks, ...(result.reason !== undefined ? { reason: result.reason } : {}),
  };
  const tally = { criticalInstances: result.criticalInstances as number, criticalFailures: result.criticalFailures as number };
  const decided = (outcome: PqtOutcome, executed = true): PilotCaseOutcome => ({ executed, outcome: { ...outcome, body: { ...body, ...outcome.body } }, ...tally });
  if (result.requirement !== pqCase.requirement) {
    return decided(pqtFail('REQUIREMENT_MISMATCH', `${pqCase.acceptanceCase} names requirement ${result.requirement}; the catalog names ${pqCase.requirement}.`));
  }
  const classification = classificationFailure(run, publicData);
  if (classification) return decided(classification);
  if (!keys.sealed) return decided(keys.failure!);
  if (Date.parse(keys.sealed.sealedAt) >= Date.parse(run.startedAt)) {
    return decided(pqtFail('KEY_NOT_SEALED_BEFORE_RUN', `The answer key ${keys.sealed.keySetId} was sealed at ${keys.sealed.sealedAt}, not before the run started at ${run.startedAt}.`));
  }
  if (result.verdict === 'not-run') return decided(pqtFail('CASE_NOT_RUN', `The run did not run ${pqCase.acceptanceCase}${result.reason ? `: ${result.reason}` : ''}.`), false);
  const evidenceRefusal = evidenceFailure(evidence.checks!, at);
  if (evidenceRefusal) return decided(evidenceRefusal);
  if (result.verdict === 'fail' || (result.criticalFailures as number) > 0) {
    return decided(pqtFail(pqCase.failureCode ?? 'CASE_FAILED', `${pqCase.acceptanceCase} failed in the run (verdict ${result.verdict}, ${result.criticalFailures} critical failure(s))${result.reason ? `: ${result.reason}` : ''}.`));
  }
  if (result.verdict === 'inconclusive' || result.coverage !== 'complete' || (result.scoredInstances as number) < 1 || !evidence.checks!.length) {
    return decided(pqtFail('INCONCLUSIVE', `${pqCase.acceptanceCase} is inconclusive (verdict ${result.verdict}, coverage ${result.coverage}, `
      + `${result.scoredInstances} scored instance(s), ${evidence.checks!.length} evidence file(s)); an inconclusive result never passes.`));
  }
  if (keySetHolds(keys.sealed, pqCase.acceptanceCase!)) {
    return decided(pqtFail('KEY_CASE_HELD', `The sealed key set ${keys.sealed.keySetId} still holds ${pqCase.acceptanceCase} (coverage.held), so a pass has no key to rest on.`));
  }
  if (run.runKind === 'R2' && result.keyBasis !== 'countersigned') {
    return decided(pqtFail('KEY_NOT_COUNTERSIGNED', `The R2 key of ${pqCase.acceptanceCase} is ${result.keyBasis}; the run of record needs a countersigned key (D-LE-21).`));
  }
  if (run.runKind === 'R2' && !keys.sealed.countersignedCases.includes(pqCase.acceptanceCase!)) {
    return decided(pqtFail('KEY_NOT_COUNTERSIGNED', `The summary says the R2 key of ${pqCase.acceptanceCase} is countersigned; the sealed manifest records no countersignature for it (D-LE-21).`));
  }
  const keyNote = result.keyBasis === 'countersigned' ? 'its key countersigned' : `its key ${result.keyBasis}, admitted for R1 only (D-LE-21)`;
  return decided(pqtPass(`${pqCase.acceptanceCase} passed in the ${run.runKind} run with ${result.scoredInstances} scored instance(s), `
    + `${result.criticalInstances} critical and none failed, ${evidence.checks!.length} evidence file(s) verified, ${keyNote}.`, {}));
}

const unsupportedPilot = (problems: string[], body: Record<string, unknown> = {}): PqtOutcome =>
  pqtFail(UNSUPPORTED_PILOT_SUMMARY, `The pilot summary is not in a shape the import recognises: ${problems.join('; ')}.`, { ...body, problems });

/** PQA-021, the G3 bound, from the admitted A1 to A20 outcomes. */
function criticalBoundOutcome(run: PilotRunBlock, outcomes: ReadonlyMap<string, PilotCaseOutcome>): PilotCaseOutcome {
  const acceptance = PILOT_PQ_CASES.filter(entry => /^A\d+$/.test(entry.acceptanceCase ?? ''));
  const notRun = acceptance.filter(entry => !outcomes.get(entry.id)!.executed).map(entry => entry.acceptanceCase);
  const declared = run.keySet.criticalInstancesDeclared;
  if (notRun.length) {
    return { executed: false, outcome: pqtFail('CASES_NOT_RUN', `G3 needs every acceptance case executed; not executed: ${notRun.join(', ')}.`, { notRun, declared }) };
  }
  const notPassed = acceptance.filter(entry => !outcomes.get(entry.id)!.outcome.passed).map(entry => entry.acceptanceCase);
  const instances = acceptance.reduce((sum, entry) => sum + (outcomes.get(entry.id)!.criticalInstances ?? 0), 0);
  const failures = acceptance.reduce((sum, entry) => sum + (outcomes.get(entry.id)!.criticalFailures ?? 0), 0);
  const body = { declared, criticalInstances: instances, criticalFailures: failures, upperBound95: instances > 0 ? 3 / instances : null, notPassed };
  const gaps = [
    ...(notPassed.length ? [`acceptance cases not passed: ${notPassed.join(', ')}`] : []),
    ...(instances !== declared ? [`the cases' ${instances} critical instances differ from the ${declared} the sealed key declares`] : []),
    ...(declared < PILOT_MIN_CRITICAL_INSTANCES ? [`the key declares ${declared} critical instances, fewer than ${PILOT_MIN_CRITICAL_INSTANCES}`] : []),
    ...(failures > 0 ? [`${failures} critical failure(s)`] : []),
  ];
  if (gaps.length) return { executed: true, outcome: pqtFail('CRITICAL_FAILURE_BOUND_NOT_MET', `G3 is not met: ${gaps.join('; ')}.`, body) };
  return { executed: true, outcome: pqtPass(`G3 holds: zero critical failures in ${instances} scored critical instances; 95% upper bound ${(3 / instances).toFixed(4)} (3/N).`, body) };
}

/** Why one system's control counts break the control's rule ('fail'), cannot show it ('inconclusive'), or are not
 * recognised ('unsupported'); undefined when the system passes. */
function controlSystemVerdict(control: PilotControl, counts: Record<string, unknown>, run: PilotRunBlock):
  { kind: 'fail' | 'inconclusive' | 'unsupported'; detail: string } | undefined {
  const allCounts = (...keys: string[]) => keys.every(key => isCount(counts[key]));
  switch (control) {
    case 'security': {
      if (!allCounts('probes', 'refusedAsExpected', 'unexpectedAcceptances')) return { kind: 'unsupported', detail: 'probe counts are not counts' };
      const { probes, refusedAsExpected, unexpectedAcceptances } = counts as Record<string, number>;
      if (refusedAsExpected + unexpectedAcceptances !== probes) return { kind: 'unsupported', detail: `refused ${refusedAsExpected} and accepted ${unexpectedAcceptances} do not add up to ${probes} probes` };
      if (unexpectedAcceptances > 0) return { kind: 'fail', detail: `${unexpectedAcceptances} of ${probes} probes were accepted` };
      if (probes < 1) return { kind: 'inconclusive', detail: 'no probe was run' };
      return undefined;
    }
    case 'backup-restore': {
      if (typeof counts.backupTaken !== 'boolean' || typeof counts.restoredIsolated !== 'boolean'
        || typeof counts.sourceDigest !== 'string' || !SHA256_HEX.test(counts.sourceDigest)
        || typeof counts.restoredDigest !== 'string' || !SHA256_HEX.test(counts.restoredDigest)
        || !allCounts('recoveryPointSeconds', 'recoveryTimeSeconds')) {
        return { kind: 'unsupported', detail: 'backupTaken and restoredIsolated are not booleans, a digest is not a SHA-256 hex, or a recovery time is not a count' };
      }
      if (!counts.backupTaken || !counts.restoredIsolated) return { kind: 'inconclusive', detail: 'no backup was restored into an isolated target' };
      if (counts.sourceDigest !== counts.restoredDigest) return { kind: 'fail', detail: `restored digest ${counts.restoredDigest} differs from source ${counts.sourceDigest}` };
      return undefined;
    }
    case 'signature-linking': {
      if (!allCounts('signatures', 'linked', 'digestRecomputedEqual', 'unlinked', 'mismatched')) return { kind: 'unsupported', detail: 'signature counts are not counts' };
      const { signatures, linked, digestRecomputedEqual, unlinked, mismatched } = counts as Record<string, number>;
      if (linked + unlinked !== signatures || digestRecomputedEqual + mismatched !== linked) {
        return { kind: 'unsupported', detail: `linked ${linked} plus unlinked ${unlinked} is not ${signatures}, or recomputed ${digestRecomputedEqual} plus mismatched ${mismatched} is not ${linked}` };
      }
      if (unlinked > 0 || mismatched > 0) return { kind: 'fail', detail: `${unlinked} unlinked and ${mismatched} mismatched of ${signatures} signatures` };
      if (signatures < 1) return { kind: 'inconclusive', detail: 'no signature was produced, so linking cannot be shown' };
      return undefined;
    }
    case 'access-census': {
      if (!allCounts('accessEvents', 'accountChangeEvents', 'accountsDeclared', 'accountsFound', 'accountsUndeclared') || !isInstant(counts.windowStart)) {
        return { kind: 'unsupported', detail: 'census counts are not counts or windowStart is not an RFC 3339 instant' };
      }
      const { accessEvents, accountChangeEvents, accountsDeclared, accountsFound, accountsUndeclared } = counts as Record<string, number>;
      // Both directions: every declared account appears, and nothing in the logs is outside the declared set.
      const gaps = [
        ...(accountsUndeclared > 0 ? [`${accountsUndeclared} account(s) in the logs that were never declared`] : []),
        ...(accountsFound > accountsDeclared ? [`${accountsFound} accounts found against ${accountsDeclared} declared`] : []),
        ...(accessEvents < 1 ? ['no access event'] : []),
        ...(accountChangeEvents < 1 ? ['no account-change event'] : []),
        ...(accountsDeclared < 1 ? ['no declared account'] : []),
        ...(accountsFound < accountsDeclared ? [`${accountsDeclared - accountsFound} declared account(s) missing from the account-change log`] : []),
        ...(Date.parse(counts.windowStart as string) > Date.parse(run.startedAt) ? [`the log window starts at ${counts.windowStart}, after the run start`] : []),
      ];
      return gaps.length ? { kind: 'fail', detail: gaps.join(', ') } : undefined;
    }
  }
}

/** PQC-001 to PQC-004: one control's per-system results. */
function controlOutcome(pqCase: Ta3PqCase, run: PilotRunBlock, runDir: string, read: (absolutePath: string) => Buffer, publicData?: PublicDataAdmission): PilotCaseOutcome {
  const control = pqCase.acceptanceCase as PilotControl;
  const at = `pilot.controls ${control}`;
  const entry = run.controls.find(candidate => candidate.control === control);
  if (!entry) return { executed: false, outcome: pqtFail('CONTROL_NOT_REPORTED', `The run reports no ${control} result; nothing is admitted.`) };
  const shape = membersProblem(entry, at, PILOT_CONTROL_MEMBERS);
  if (shape) return { executed: true, outcome: unsupportedPilot([shape]) };
  if (!Array.isArray(entry.systems)) return { executed: true, outcome: unsupportedPilot([`${at}.systems is not an array`]) };
  const problems: string[] = [], systems: Record<string, unknown>[] = [], seen = new Set<string>();
  const evidenceChecks: PilotEvidenceCheck[] = [];
  const verdicts: { system: string; kind: 'fail' | 'inconclusive' | 'pass'; detail: string }[] = [];
  for (const [index, system] of entry.systems.entries()) {
    const where = `${at}.systems[${index}]`;
    const systemShape = membersProblem(system, where, ['system', 'counts', 'evidence']);
    if (systemShape) { problems.push(systemShape); continue; }
    const { system: name, counts, evidence } = system as Record<string, unknown>;
    if (typeof name !== 'string' || !(PILOT_CONTROL_SYSTEMS as readonly string[]).includes(name)) { problems.push(`${where}.system is ${JSON.stringify(name)}`); continue; }
    if (seen.has(name)) { problems.push(`${at} repeats ${name}`); continue; }
    seen.add(name);
    const countsShape = membersProblem(counts, `${where}.counts`, PILOT_CONTROL_COUNTS[control]);
    if (countsShape) { problems.push(countsShape); continue; }
    const checked = pilotEvidence(runDir, evidence, `${where}.evidence`, read);
    if (checked.problem) { problems.push(checked.problem); continue; }
    evidenceChecks.push(...checked.checks!);
    const verdict = controlSystemVerdict(control, counts as Record<string, unknown>, run);
    if (verdict?.kind === 'unsupported') { problems.push(`${where}: ${verdict.detail}`); continue; }
    if (!checked.checks!.length && !verdict) verdicts.push({ system: name, kind: 'inconclusive', detail: 'no evidence file' });
    else verdicts.push({ system: name, kind: verdict?.kind ?? 'pass', detail: verdict?.detail ?? 'passed' });
    systems.push({ system: name, counts, evidence: checked.checks });
  }
  if (problems.length) return { executed: true, outcome: unsupportedPilot(problems) };
  const body = { control, requirement: entry.requirement, systems };
  const decided = (outcome: PqtOutcome): PilotCaseOutcome => ({ executed: true, outcome: { ...outcome, body: { ...body, ...outcome.body } } });
  if (entry.requirement !== pqCase.requirement) {
    return decided(pqtFail('REQUIREMENT_MISMATCH', `The ${control} result names requirement ${String(entry.requirement)}; the catalog names ${pqCase.requirement}.`));
  }
  const classification = classificationFailure(run, publicData);
  if (classification) return decided(classification);
  const evidenceRefusal = evidenceFailure(evidenceChecks, at);
  if (evidenceRefusal) return decided({ ...evidenceRefusal, body: {} });
  const failed = verdicts.filter(item => item.kind === 'fail');
  if (failed.length) return decided(pqtFail(pqCase.failureCode!, `${control} failed: ${failed.map(item => `${item.system} (${item.detail})`).join('; ')}.`));
  const missing = PILOT_CONTROL_SYSTEMS.filter(name => !seen.has(name));
  const inconclusive = verdicts.filter(item => item.kind === 'inconclusive');
  if (missing.length || inconclusive.length) {
    return decided(pqtFail('INCONCLUSIVE', `${control} is inconclusive: ${[...missing.map(name => `${name} not reported`),
      ...inconclusive.map(item => `${item.system} (${item.detail})`)].join('; ')}; an inconclusive control never passes.`, { missingSystems: missing }));
  }
  return decided(pqtPass(`${control} passed for ${PILOT_CONTROL_SYSTEMS.join(', ')}, each with its evidence verified.`, {}));
}

/** PQA-001 to PQA-021 and PQC-001 to PQC-004 of a pilot run (LE-7.2), derived from the reconstructed summary without
 * re-scoring. It reads only the evidence files the summary cites, through `readEvidence`, and no clock or process.
 * Without a reconstruction every case is not executed (RECONSTRUCTION_FAILED); a summary the import does not
 * recognise records UNSUPPORTED_PILOT_SUMMARY on every case, never a guess; a case the run did not run or report is
 * recorded not executed, so an R1 at the Stage B exit shows its Stage C cases not executed, never failed. */
export function derivePilotResults(input: PilotDerivationInput): EvidenceResult[] {
  const read = input.readEvidence ?? ((absolutePath: string) => fs.readFileSync(absolutePath));
  const identity = { summaryContract: PILOT_ACCEPTANCE_CONTRACT, summarySha256: input.summarySha256, metricsSha256: input.metricsSha256 };
  const row = (pqCase: Ta3PqCase, executed: boolean, outcome: PqtOutcome, runBody: Record<string, unknown>): EvidenceResult => ({
    testCaseId: pqCase.id, timestamp: input.timestamp, endpoint: input.runDir, method: executed ? 'OFFLINE' : 'CONTRACT', responseStatus: 0,
    responseBody: { ...identity, ...runBody, ...outcome.body }, passed: outcome.passed,
    notes: `${executed ? '' : 'Not executed: '}${outcome.detail} ${PILOT_SCOPE}`,
    ...(outcome.code ? { outcomeCode: outcome.code } : {}),
    regulatoryRef: ta3RegulatoryRef(pqCase), testDescription: `${pqCase.acceptanceCase}: ${pqCase.title}`, acceptanceCriteria: pqCase.passesWhen,
  });
  const summary = input.summary;
  if (!summary) {
    return PILOT_PQ_CASES.map(pqCase => row(pqCase, false, pqtFail('RECONSTRUCTION_FAILED',
      `the run did not reconstruct (${input.reconstructionError ?? 'no reconstruction'}), so no pilot result is admitted.`), {}));
  }
  const { run, problems } = pilotRunBlock(summary);
  if (!run) return PILOT_PQ_CASES.map(pqCase => row(pqCase, true, unsupportedPilot(problems), {}));
  const keys = sealedKeySetOf(run, input.runDir, read);
  const runBody = { runKind: run.runKind, startedAt: run.startedAt, classification: run.classification, keySet: run.keySet,
    ...(keys.sealed ? { sealedKeySet: keys.sealed } : {}), nonClaims: run.nonClaims ?? [] };
  const outcomes = new Map<string, PilotCaseOutcome>();
  for (const pqCase of PILOT_PQ_CASES) {
    if (/^A\d+$/.test(pqCase.acceptanceCase ?? '')) outcomes.set(pqCase.id, acceptanceOutcome(pqCase, run, keys, input.runDir, read, input.publicData));
    else if (pqCase.acceptanceCase !== 'G3') outcomes.set(pqCase.id, controlOutcome(pqCase, run, input.runDir, read, input.publicData));
  }
  const bound = PILOT_PQ_CASES.find(entry => entry.acceptanceCase === 'G3')!;
  outcomes.set(bound.id, criticalBoundOutcome(run, outcomes));
  return PILOT_PQ_CASES.map(pqCase => {
    const decided = outcomes.get(pqCase.id)!;
    return row(pqCase, decided.executed, decided.outcome, runBody);
  });
}

export interface P13EvidenceOptions {
  planFile: string;
  /** Same explicit nonlocal qualification acknowledgement as the live runners. */
  allowProductionQualification?: boolean;
}

const P13_SCOPE = 'Native P13 engineering evidence attachment only; no model invocation, offline re-score, independent clinical validation, or SURPASS attainment. The native GET verifies terminal evidence; local hashes identify retained attachments, not the deployed image.';
const P13_PARTITIONS = ['training_development_set', 'regression_set', 'locked_validation_set', 'blind_holdout_set',
  'adversarial_negative_control_set', 'amendment_mutation_set', 'event_replay_set', 'target_adapter_fixture_set',
  'large_protocol_load_cost_set', 'unadjudicated_corpus_queue'];
function p13Require(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(`P13_ATTACHMENT_${code}`); }
function p13Object(value: unknown): Record<string, unknown> {
  p13Require(isRecord(value), 'OBJECT_REQUIRED'); return value;
}
function p13Keys(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  const object = p13Object(value);
  p13Require(required.every(key => Object.prototype.hasOwnProperty.call(object, key))
    && Object.keys(object).every(key => [...required, ...optional].includes(key)), 'PLAN_FIELDS_INVALID');
  return object;
}
function p13Text(value: unknown): string {
  p13Require(typeof value === 'string' && value.trim().length > 0 && value.length <= 2048
    && !/[\x00-\x1f\x7f]/.test(value), 'TEXT_INVALID'); return value;
}
function p13Array(value: unknown, nonempty = true): unknown[] {
  p13Require(Array.isArray(value) && (!nonempty || value.length > 0), 'ARRAY_INVALID'); return value;
}
function p13Unique(values: unknown[]): void {
  p13Require(new Set(values).size === values.length, 'DUPLICATE_IDENTITY');
}
function p13Sha(value: unknown): void { p13Require(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'HASH_INVALID'); }
function p13Version(value: unknown): Record<string, unknown> {
  const version = p13Keys(value, ['component_type', 'component_id', 'version', 'content_hash']);
  Object.values(version).forEach(p13Text); p13Sha(version.content_hash); return version;
}
function p13Ref(value: unknown): Record<string, unknown> {
  const ref = p13Keys(value, ['evidence_id', 'evidence_type', 'content_hash', 'uri', 'produced_at', 'producer_version']);
  Object.values(ref).forEach(p13Text); p13Sha(ref.content_hash);
  p13Require(Number.isFinite(Date.parse(String(ref.produced_at))), 'EVIDENCE_DATE_INVALID'); return ref;
}
function p13Contains(values: unknown, expected: unknown): boolean {
  return p13Array(values).some(value => isDeepStrictEqual(value, expected));
}
function p13Identity(value: unknown): Record<string, unknown> {
  const identity = p13Keys(value, ['case_id', 'scenario_id', 'document_version_id', 'measurement_family', 'category', 'document_kind']);
  Object.values(identity).forEach(p13Text);
  p13Require(['parser', 'extraction'].includes(String(identity.measurement_family)), 'MEASUREMENT_FAMILY_INVALID');
  return identity;
}

/** Read only the three native P13 routes. The accepted execution request and
 * contract snapshots are operator-supplied expected identities, not proof of
 * preregistration or independent adjudication. No arbitrary JSON report passes.
 */
export async function importP13BenchmarkEvidence(outputDir: string, options: P13EvidenceOptions): Promise<EvidenceResult[]> {
  const target = path.join(outputDir, 'evidence', 'p13');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try { fs.mkdirSync(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('P13 evidence already exists; use a new qualification output directory.');
    throw error;
  }
  const timestamp = new Date().toISOString(), captures: EvidenceResult[] = [];
  let token = '', inputPlanSha256: string | null = null, retainedPlanSha256: string | null = null;
  const sanitize = (value: unknown): unknown => {
    const scrub = (item: unknown): unknown => {
      if (typeof item === 'string') return token ? item.split(token).join('[redacted]') : item;
      if (Array.isArray(item)) return item.map(scrub);
      if (isRecord(item)) return Object.fromEntries(Object.entries(item).map(([key, field]) => [String(scrub(key)), scrub(field)]));
      return item;
    };
    return JSON.parse(JSON.stringify(scrub(redactEvidenceSecrets(value))));
  };
  const make = (testCaseId: string, passed: boolean, responseBody: unknown, notes: string): EvidenceResult => ({
    testCaseId, timestamp, endpoint: path.resolve(options.planFile), method: 'ATTACHMENT', responseStatus: 0,
    passed, responseBody, notes: `${notes} ${P13_SCOPE}`,
  });
  let results: EvidenceResult[];
  try {
    const planBytes = fs.readFileSync(options.planFile);
    p13Require(planBytes.length <= 4 * 1024 * 1024, 'PLAN_TOO_LARGE');
    inputPlanSha256 = hash(planBytes);
    const plan = p13Keys(JSON.parse(planBytes.toString('utf8')), ['contract', 'apiBaseUrl', 'bearerTokenEnv', 'expected', 'measurements']);
    p13Require(plan.contract === 'p13-qualification-attachment/1', 'CONTRACT_UNSUPPORTED');
    const base = new URL(p13Text(plan.apiBaseUrl));
    p13Require(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password
      && !base.search && !base.hash, 'URL_INVALID');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    p13Require(local || (options.allowProductionQualification === true && base.protocol === 'https:'), 'NONLOCAL_TARGET_REFUSED');
    const envName = p13Text(plan.bearerTokenEnv);
    p13Require(/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName), 'TOKEN_ENV_INVALID');
    const expected = p13Keys(plan.expected, ['benchmark_run_id', 'tenant_id', 'study_id', 'system_version_bundle_id',
      'corpus_commit_hash', 'execution_request', 'metric_definition_versions', 'threshold_policy_versions', 'metrics_contract', 'benchmark_contract']);
    for (const key of ['benchmark_run_id', 'tenant_id', 'study_id', 'system_version_bundle_id']) p13Text(expected[key]);
    p13Require(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(expected.benchmark_run_id)), 'RUN_ID_INVALID');
    p13Sha(expected.corpus_commit_hash);
    const request = p13Keys(expected.execution_request, ['contract_version', 'tenant_id', 'study_id', 'idempotency_key', 'request_hash', 'partitions', 'scenarios']);
    p13Require(request.contract_version === 'p13-benchmark-execution/1'
      && request.tenant_id === expected.tenant_id && request.study_id === expected.study_id, 'REQUEST_SCOPE_INVALID');
    p13Text(request.idempotency_key); p13Sha(request.request_hash);
    const partitions = p13Array(request.partitions); p13Unique(partitions);
    p13Require(partitions.every(partition => P13_PARTITIONS.includes(String(partition))), 'PARTITION_INVALID');
    const scenarios = p13Array(request.scenarios).map(value => {
      const scenario = p13Keys(value, ['scenario_id', 'case_id', 'runner_type', 'definition_ref', 'runner_version']);
      p13Text(scenario.scenario_id); p13Text(scenario.case_id); p13Ref(scenario.definition_ref); p13Version(scenario.runner_version);
      p13Require(['event_replay', 'amendment', 'stored_evidence_measurement'].includes(String(scenario.runner_type)), 'RUNNER_UNSUPPORTED');
      return scenario;
    });
    p13Unique(scenarios.map(scenario => scenario.scenario_id));
    const metricsContract = p13Object(expected.metrics_contract), benchmarkContract = p13Object(expected.benchmark_contract);
    p13Require(metricsContract.measurement_contract === 'p13-identity-measurement/3'
      && benchmarkContract.execution_contract === request.contract_version
      && benchmarkContract.scenario_contract === 'p13-benchmark-scenario/1', 'NATIVE_CONTRACT_UNSUPPORTED');
    for (const key of ['metric_definition_versions', 'threshold_policy_versions']) {
      p13Array(metricsContract[key]).forEach(p13Version);
      const versions = p13Array(expected[key]); versions.forEach(p13Version);
      p13Require(versions.every(version => p13Contains(metricsContract[key], version)), 'VERSION_NOT_IN_CONTRACT');
    }
    for (const scenario of scenarios) p13Require(p13Array(benchmarkContract.runners).some(value => {
      const runner = p13Object(value);
      return runner.runner_type === scenario.runner_type && isDeepStrictEqual(runner.version, scenario.runner_version);
    }), 'RUNNER_VERSION_UNSUPPORTED');
    const measurements = p13Array(plan.measurements, false).map(value => {
      const measurement = p13Keys(value, ['identity', 'actual_ref', 'gold_ref', 'metric_definition_ref', 'threshold_policy_ref', 'metric_ids']);
      const identity = p13Identity(measurement.identity);
      p13Ref(measurement.actual_ref); p13Ref(measurement.gold_ref);
      p13Version(measurement.metric_definition_ref); p13Version(measurement.threshold_policy_ref);
      p13Require(scenarios.some(scenario => scenario.scenario_id === identity.scenario_id && scenario.case_id === identity.case_id
        && scenario.runner_type === 'stored_evidence_measurement'), 'MEASUREMENT_SCENARIO_INVALID');
      p13Require(p13Contains(expected.metric_definition_versions, measurement.metric_definition_ref)
        && p13Contains(expected.threshold_policy_versions, measurement.threshold_policy_ref), 'MEASUREMENT_VERSION_INVALID');
      p13Array(measurement.metric_ids).forEach(p13Text); return measurement;
    });
    const expectedMetricIds = measurements.flatMap(measurement => p13Array(measurement.metric_ids));
    p13Unique(expectedMetricIds);
    token = process.env[envName] ?? '';
    p13Require(token.length > 0 && token.length <= 16384 && /^[A-Za-z0-9._~+/-]+=*$/.test(token), 'TOKEN_UNAVAILABLE');
    const retainedPlan = Buffer.from(JSON.stringify(sanitize(plan), null, 2) + '\n');
    retainedPlanSha256 = hash(retainedPlan);
    fs.writeFileSync(path.join(target, 'attachment-plan.json'), retainedPlan, { flag: 'wx' });
    const read = async (name: string, route: string): Promise<Record<string, unknown>> => {
      const capture = await captureApiCall({ testCaseId: `P13-HTTP-${name}`, method: 'GET', baseUrl: base.href,
        url: `internal/p13/${route}`, headers: { Authorization: `Bearer ${token}`,
          'x-tenant-id': String(expected.tenant_id), 'x-study-id': String(expected.study_id) },
        redirect: 'error', timeoutMs: 30000, maxResponseBytes: 16 * 1024 * 1024 });
      captures.push(capture);
      p13Require(capture.responseStatus === 200 && capture.passed && !capture.captureError, 'NATIVE_READ_FAILED');
      return p13Object(capture.responseBody);
    };
    const nativeMetrics = await read('METRICS-CONTRACT', 'metrics/contracts');
    p13Require(isDeepStrictEqual(nativeMetrics, metricsContract), 'METRICS_CONTRACT_MISMATCH');
    const nativeBenchmark = await read('BENCHMARK-CONTRACT', 'benchmark/contracts');
    p13Require(isDeepStrictEqual(nativeBenchmark, benchmarkContract), 'BENCHMARK_CONTRACT_MISMATCH');
    const run = await read('RECORD', `benchmark/records/${expected.benchmark_run_id}`);
    for (const key of ['benchmark_run_id', 'tenant_id', 'study_id', 'system_version_bundle_id', 'corpus_commit_hash',
      'execution_request', 'metric_definition_versions', 'threshold_policy_versions']) {
      p13Require(isDeepStrictEqual(run[key], expected[key]), 'RUN_IDENTITY_MISMATCH');
    }
    p13Require(p13Object(run.execution_context).mode === 'benchmark', 'EXECUTION_MODE_INVALID');
    p13Text(p13Object(run.execution_context).execution_context_id);
    p13Require(Number.isFinite(Date.parse(String(run.started_at))) && Number.isFinite(Date.parse(String(run.completed_at)))
      && Date.parse(String(run.completed_at)) >= Date.parse(String(run.started_at)), 'RUN_TIME_INVALID');
    const terminal = p13Object(run.terminal);
    p13Require(['completed', 'failed', 'aborted', 'dead_lettered'].includes(String(run.run_status))
      && terminal.status === run.run_status && terminal.execution_completed === true && run.execution_completed === true
      && typeof terminal.promotion_evidence_ready === 'boolean', 'TERMINAL_INVALID');
    p13Require(p13Ref(terminal.terminal_evidence_ref).evidence_type === 'benchmark_execution_terminal', 'TERMINAL_REF_INVALID');
    p13Array(terminal.evidence_refs, false).forEach(p13Ref);
    const outcomes = p13Array(terminal.scenario_results, false).map(p13Object);
    p13Unique(outcomes.map(outcome => outcome.scenario_id));
    const rows: Record<string, unknown>[] = [];
    for (const outcome of outcomes) {
      const scenario = scenarios.find(value => value.scenario_id === outcome.scenario_id);
      p13Require(scenario && ['passed', 'failed'].includes(String(outcome.status)), 'SCENARIO_INVALID');
      p13Array(outcome.evidence_refs).forEach(p13Ref);
      p13Array(outcome.executed_implementations).forEach(p13Version);
      p13Require(p13Contains(outcome.executed_implementations, scenario.runner_version), 'RUNNER_IDENTITY_MISMATCH');
      const metrics = p13Array(outcome.metric_results, false).map(p13Object);
      for (const metric of metrics) {
        p13Text(metric.metric_id); p13Text(metric.metric_name);
        p13Require(typeof metric.value === 'number' && Number.isFinite(metric.value)
          && typeof metric.threshold === 'number' && Number.isFinite(metric.threshold)
          && ['passed', 'regressed', 'improved', 'no_baseline', 'failed', 'vacuous'].includes(String(metric.status)), 'METRIC_INVALID');
        const measurement = p13Object(metric.measurement);
        const pinned = measurements.find(value => p13Array(value.metric_ids).includes(metric.metric_id));
        p13Require(pinned && outcome.measurement_contract === metricsContract.measurement_contract, 'UNEXPECTED_MEASUREMENT');
        for (const key of ['identity', 'actual_ref', 'gold_ref', 'metric_definition_ref', 'threshold_policy_ref']) {
          p13Require(isDeepStrictEqual(measurement[key], pinned[key]), 'MEASUREMENT_IDENTITY_MISMATCH');
        }
        const identity = p13Object(measurement.identity);
        p13Require(p13Contains(outcome.executed_implementations, measurement.metric_definition_ref)
          && p13Contains(outcome.executed_implementations, measurement.threshold_policy_ref), 'MEASUREMENT_IMPLEMENTATION_NOT_EXECUTED');
        p13Require(identity.scenario_id === outcome.scenario_id && metric.metric_family === identity.measurement_family
          && isDeepStrictEqual(metric.evidence_ref, measurement.actual_ref)
          && measurement.implementation_hash === p13Object(measurement.metric_definition_ref).content_hash
          && measurement.threshold_policy_hash === p13Object(measurement.threshold_policy_ref).content_hash, 'MEASUREMENT_PROVENANCE_INVALID');
        if (identity.measurement_family === 'extraction') {
          for (const key of ['candidate_count', 'gold_count']) p13Require(Number.isSafeInteger(measurement[key]) && Number(measurement[key]) >= 0, 'DENOMINATOR_INVALID');
          const counts = p13Object(measurement.typed_gold_counts);
          p13Require(Object.values(counts).every(value => Number.isSafeInteger(value) && Number(value) >= 0), 'TYPED_DENOMINATOR_INVALID');
        }
        rows.push(metric);
      }
    }
    p13Unique(rows.map(row => row.metric_id));
    p13Require(isDeepStrictEqual(terminal.evidence_refs, outcomes.flatMap(outcome => p13Array(outcome.evidence_refs))), 'TERMINAL_EVIDENCE_CENSUS_MISMATCH');
    const censusComplete = outcomes.length === scenarios.length && rows.length === expectedMetricIds.length
      && expectedMetricIds.every(id => rows.some(row => row.metric_id === id));
    const attachment = { contract: plan.contract, evidenceLevel: 'synthetic_engineering', independentlyValidated: false,
      inputPlanSha256, retainedPlanSha256, nativeTerminalVerification: 'performed_by_scoped_native_GET', offlineRescored: false,
      attachmentImplementation: { nodeVersion: process.version, sourceHashes: [__filename, require.resolve('./evidence-capture')]
        .map(file => ({ path: file, sha256: hash(fs.readFileSync(file)) })) },
      censusComplete, expectedScenarioCount: scenarios.length, retainedScenarioCount: outcomes.length,
      expectedMetricCount: expectedMetricIds.length, retainedMetricCount: rows.length,
      run, metricsContract: nativeMetrics, benchmarkContract: nativeBenchmark,
      metricCoverage: rows.map(row => ({ metricId: row.metric_id, nativeStatus: row.status,
        denominatorStatus: p13Object(p13Object(row.measurement).identity).measurement_family === 'parser' ? 'not_exposed_by_native_contract' : 'retained' })),
      artifactHashes: captures.map(capture => ({ testCaseId: capture.testCaseId,
        sha256: hash(Buffer.from(JSON.stringify(sanitize(capture.responseBody)))) })),
    };
    const measured = censusComplete && rows.length > 0;
    const metricPass = measured && run.run_status === 'completed' && terminal.promotion_evidence_ready === true
      && outcomes.every(outcome => outcome.status === 'passed') && rows.every(row => ['passed', 'improved'].includes(String(row.status)));
    results = [make('P13-NATIVE-ATTACHMENT', censusComplete, attachment,
      censusComplete ? 'Scoped terminal record and expected scenario/metric census match.' : 'Incomplete expected scenario/metric census; no successful attachment.'),
    make('P13-NATIVE-METRICS', metricPass, { ...attachment, status: !measured ? 'not_run' : metricPass ? 'passed' : 'failed' },
      'Native statuses, details and available denominators retained verbatim. Parser denominator counts are not exposed by this contract; unmeasured and vacuous rows cannot pass.')];
  } catch (error) {
    // Fixed adapter codes only: never retain token-bearing parser/transport messages here.
    const code = error instanceof Error && /^P13_ATTACHMENT_[A-Z_]+$/.test(error.message) ? error.message : 'P13_ATTACHMENT_INVALID';
    results = [make('P13-NATIVE-ATTACHMENT', false, { status: 'failed', inputPlanSha256, retainedPlanSha256, error: code }, 'Native evidence was not admitted.'),
      make('P13-NATIVE-METRICS', false, { status: 'not_run' }, 'No metric credit without an admitted native record.')];
  }
  results[0].relatedEvidence = captures;
  const retained = sanitize(results) as EvidenceResult[];
  saveEvidence(outputDir, 'p13', retained);
  return retained;
}
