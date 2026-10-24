import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { captureApiCall, isRecord, redactEvidenceSecrets, saveEvidence, strictObject, type EvidenceResult } from './evidence-capture';
import { parseReleaseComponent } from './release-identity';
import { ta3RegulatoryRef } from '../config/ta3-oq-cases';
import {
  BENCHMARK_RECONSTRUCTION_ENTRY, CRITICAL_EXPLAINED_GATE, CRITICAL_MISS_EXPLANATIONS, DEVIATION_DETECTION_CONTRACT,
  DEVIATION_MACHINE_CLASSES, DEVIATION_RECONSTRUCTION_ENTRY, TA3_PQ_CASES, UNSUPPORTED_DEVIATION_SUMMARY, type Ta3PqCase,
} from '../config/ta3-pq-cases';

export interface BenchmarkEvidenceOptions {
  runDir: string;
  /** Canonical CommandCenter checkout; historical evaluators use evaluatorRoot. */
  commandCenterRoot?: string;
  evaluatorRoot?: string;
}

/** The two files of a scored run the import reads and links; a retained package copies them as inputs. */
export const BENCHMARK_RUN_FILES = { summary: 'run-summary.json', metrics: 'metrics.json' } as const;

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const SCOPE = 'Synthetic engineering evidence only. Reconstruction verifies retained results; it does not establish independent clinical validation, SURPASS attainment, or IL extraction performance.';

/** The members a summary may name its contract in: spec P09 8.2 names `contract`, spec P20 3.5 also
 * `schemaVersion`, and the CommandCenter evaluator writes `schema`. */
const SUMMARY_CONTRACT_MEMBERS = ['contract', 'schema', 'schemaVersion'] as const;

/** Which reconstruction a run needs, read from the summary bytes before anything is spawned (spec P20 3.5). A
 * summary that names the deviation detection contract in one of those members is a deviation run; `conflict` says
 * when another of them names a different contract, which refuses the run. Anything else, unparseable bytes
 * included, is a benchmark run and reconstructs exactly as before. */
export function summaryContractOf(summaryBytes: Buffer): { contract?: typeof DEVIATION_DETECTION_CONTRACT; conflict?: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(summaryBytes.toString('utf8')); } catch { return {}; }
  if (!isRecord(parsed)) return {};
  const summary = parsed;
  const named = SUMMARY_CONTRACT_MEMBERS.filter(key => Object.prototype.hasOwnProperty.call(summary, key));
  if (!named.some(key => summary[key] === DEVIATION_DETECTION_CONTRACT)) return {};
  const others = named.filter(key => summary[key] !== DEVIATION_DETECTION_CONTRACT);
  return { contract: DEVIATION_DETECTION_CONTRACT, ...(others.length ? { conflict: `run-summary.json names another contract in ${others.join(', ')}` } : {}) };
}

/** A deviation detection summary records the SHA-256 of the metrics written with it (`artifacts['metrics.json']`,
 * the evaluator's convention), so the import admits only the metrics the reconstruction checked. */
function requireMetricsBinding(summary: Record<string, unknown>, metrics: Buffer): void {
  const recorded = isRecord(summary.artifacts) ? summary.artifacts[BENCHMARK_RUN_FILES.metrics] : undefined;
  if (typeof recorded !== 'string') {
    throw new Error(`Unsupported deviation detection summary: run-summary.json records no SHA-256 of ${BENCHMARK_RUN_FILES.metrics} under artifacts.`);
  }
  if (recorded !== `sha256:${hash(metrics)}`) throw new Error(`${BENCHMARK_RUN_FILES.metrics} does not match the SHA-256 run-summary.json records for it.`);
}

/** Reuse the authoritative evaluator, including its byte-for-byte re-score.
 * Never accept a submitted summary or an externally supplied "ok" flag alone.
 * This is offline: it does not execute products, models, or live clinical APIs.
 * A run whose summary contract is synthetic-trial.deviation-detection-summary/1
 * (the O-7 run, spec P09 8.2) reconstructs through its own CommandCenter entry
 * and adds PQT-001 to PQT-006 (`derivePqtResults`) after the two rows every
 * import records; any other run keeps exactly those two rows.
 */
export async function importBenchmarkEvidence(outputDir: string, options: BenchmarkEvidenceOptions): Promise<EvidenceResult[]> {
  const runDir = path.resolve(options.runDir);
  const root = path.resolve(options.commandCenterRoot ?? path.join(__dirname, '..', '..', '..', 'CommandCenter'));
  const timestamp = new Date().toISOString();
  const makeResult = (testCaseId: string, passed: boolean, responseBody: unknown, notes: string): EvidenceResult => ({
    testCaseId, timestamp, endpoint: runDir, method: 'OFFLINE', responseStatus: 0,
    responseBody, passed, notes: `${notes} ${SCOPE}`,
    testDescription: testCaseId === 'BENCHMARK-RECONSTRUCTION' ? 'Reconstruct frozen benchmark evidence' : 'Retained local engineering gate result',
    acceptanceCriteria: testCaseId === 'BENCHMARK-RECONSTRUCTION'
      ? 'All retained inputs, metrics, gates and outputs reconstruct with the recorded evaluator.'
      : 'Reconstruction succeeds and the authoritative localEngineering gate is passed.',
  });
  let results: EvidenceResult[];
  // Known once the summary bytes are read: a deviation detection run records its PQT rows whatever happens next,
  // from the reconstructed summary or from why the reconstruction failed.
  let deviationRun = false;
  let summarySha256: string | null = null, metricsSha256: string | null = null;
  let reconstructed: Record<string, unknown> | undefined, reconstructionError: string | undefined;
  try {
    const summaryPath = path.join(runDir, BENCHMARK_RUN_FILES.summary);
    const metricsPath = path.join(runDir, BENCHMARK_RUN_FILES.metrics);
    const beforeSummary = fs.readFileSync(summaryPath);
    const dispatch = summaryContractOf(beforeSummary);
    deviationRun = dispatch.contract !== undefined;
    summarySha256 = hash(beforeSummary);
    const beforeMetrics = fs.readFileSync(metricsPath);
    metricsSha256 = hash(beforeMetrics);
    if (dispatch.conflict) throw new Error(`Unsupported deviation detection summary: ${dispatch.conflict}.`);
    const script = path.join(root, ...(deviationRun ? DEVIATION_RECONSTRUCTION_ENTRY : BENCHMARK_RECONSTRUCTION_ENTRY).split('/'));
    if (!fs.statSync(script, { throwIfNoEntry: false })?.isFile()) throw new Error(`Benchmark reconstruction entry not found: ${script}`);
    const args = [script, '--dir', runDir];
    if (options.evaluatorRoot) args.push('--evaluator-root', path.resolve(options.evaluatorRoot));
    const execution = spawnSync(process.execPath, args, {
      cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
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
    const attachment = {
      contract: 'accura-benchmark-qualification/1', evidenceLevel: 'synthetic_engineering',
      independentlyValidated: false, runDir, evaluator: summary.evaluator,
      summarySha256, metricsSha256,
      reconstruction, localEngineering: summary.localEngineering,
      gateGroups: summary.gateGroups, reEvaluation: summary.reEvaluation ?? null,
      // Original records remain authoritative. Do not copy sealed case-level gold.
      artifacts: { summary: summaryPath, metrics: metricsPath },
      // Appended last and only for a deviation detection run, so every other attachment keeps its bytes.
      ...(deviationRun ? { summaryContract: DEVIATION_DETECTION_CONTRACT, reconstructionEntry: DEVIATION_RECONSTRUCTION_ENTRY } : {}),
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
      { contract: 'accura-benchmark-qualification/1', evidenceLevel: 'synthetic_engineering', independentlyValidated: false, error: message,
        ...(deviationRun ? { summaryContract: DEVIATION_DETECTION_CONTRACT, reconstructionEntry: DEVIATION_RECONSTRUCTION_ENTRY } : {}) },
      'Benchmark evidence could not be reconstructed; no performance claim is admitted.'),
    makeResult('BENCHMARK-ENGINEERING-GATES', false, { status: 'not_run' }, 'Gate result unavailable without successful reconstruction.')];
  }
  if (deviationRun) {
    results.push(...derivePqtResults({ runDir, timestamp, summary: reconstructed, reconstructionError, summarySha256, metricsSha256 }));
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
