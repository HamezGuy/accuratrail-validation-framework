import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { captureApiCall, isRecord, redactEvidenceSecrets, saveEvidence, type EvidenceResult } from './evidence-capture';

export interface BenchmarkEvidenceOptions {
  runDir: string;
  /** Canonical CommandCenter checkout; historical evaluators use evaluatorRoot. */
  commandCenterRoot?: string;
  evaluatorRoot?: string;
}

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const SCOPE = 'Synthetic engineering evidence only. Reconstruction verifies retained results; it does not establish independent clinical validation, SURPASS attainment, or IL extraction performance.';

/** Reuse the authoritative evaluator, including its byte-for-byte re-score.
 * Never accept a submitted summary or an externally supplied "ok" flag alone.
 * This is offline: it does not execute products, models, or live clinical APIs.
 */
export async function importBenchmarkEvidence(outputDir: string, options: BenchmarkEvidenceOptions): Promise<EvidenceResult[]> {
  const runDir = path.resolve(options.runDir);
  const root = path.resolve(options.commandCenterRoot ?? path.join(__dirname, '..', '..', '..', 'CommandCenter'));
  const script = path.join(root, 'synthetic-trial', 'evaluate', 'reconstruct.mjs');
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
  try {
    const summaryPath = path.join(runDir, 'run-summary.json');
    const metricsPath = path.join(runDir, 'metrics.json');
    const beforeSummary = fs.readFileSync(summaryPath);
    const beforeMetrics = fs.readFileSync(metricsPath);
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
    const attachment = {
      contract: 'accura-benchmark-qualification/1', evidenceLevel: 'synthetic_engineering',
      independentlyValidated: false, runDir, evaluator: summary.evaluator,
      summarySha256: hash(beforeSummary), metricsSha256: hash(beforeMetrics),
      reconstruction, localEngineering: summary.localEngineering,
      gateGroups: summary.gateGroups, reEvaluation: summary.reEvaluation ?? null,
      // Original records remain authoritative. Do not copy sealed case-level gold.
      artifacts: { summary: summaryPath, metrics: metricsPath },
    };
    results = [
      makeResult('BENCHMARK-RECONSTRUCTION', true, attachment, 'Retained results reconstructed.'),
      makeResult('BENCHMARK-ENGINEERING-GATES', summary.localEngineering === 'passed', attachment,
        `Local engineering status: ${summary.localEngineering}. Other gate groups retain their original status.`),
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results = [makeResult('BENCHMARK-RECONSTRUCTION', false,
      { contract: 'accura-benchmark-qualification/1', evidenceLevel: 'synthetic_engineering', independentlyValidated: false, error: message },
      'Benchmark evidence could not be reconstructed; no performance claim is admitted.'),
    makeResult('BENCHMARK-ENGINEERING-GATES', false, { status: 'not_run' }, 'Gate result unavailable without successful reconstruction.')];
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
