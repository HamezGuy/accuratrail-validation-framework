import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { importBenchmarkEvidence, importP13BenchmarkEvidence } from '../runners/benchmark-evidence';
import { createHash } from 'node:crypto';
import { loadEvidence } from '../runners/evidence-capture';
import { loadRunnerEvidence } from '../generators/helpers/evidence-linker';
import { generate } from '../generators/20-test-execution-records';

const cc = path.resolve(__dirname, '..', '..', '..', 'CommandCenter');
function workspace(t: { after(fn: () => void): void }) {
  const base = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(base, 'accura-benchmark-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), base);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
function fixture(dir: string) {
  const runDir = path.join(dir, 'run');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'fixtures', 'benchmark-offline.mjs'), cc, runDir], {
    encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return runDir;
}

test('real retained scoring evidence reconstructs and preserves blocked engineering gates', async t => {
  const dir = workspace(t), runDir = fixture(dir), output = path.join(dir, 'qualification');
  const original = fs.readFileSync(path.join(runDir, 'run-summary.json'));
  const results = await importBenchmarkEvidence(output, { runDir });
  assert.equal(results[0].passed, true, JSON.stringify(results[0].responseBody));
  assert.equal(results[1].passed, false, 'a scorer-only fixture cannot establish product qualification');
  assert.equal((results[0].responseBody as any).independentlyValidated, false);
  assert.equal((results[0].responseBody as any).reconstruction.rescored, 'compared');
  assert.deepEqual(loadEvidence(output, 'benchmark'), results);
  assert.equal(loadRunnerEvidence(output).get('BENCHMARK-ENGINEERING-GATES')?.passed, false);
  generate(output, output);
  const document = fs.readFileSync(path.join(output, '20-test-execution-records.md'), 'utf8');
  assert.match(document, /BENCHMARK-RECONSTRUCTION/);
  assert.doesNotMatch(document, /Send OFFLINE request/);
  assert.deepEqual(fs.readFileSync(path.join(runDir, 'run-summary.json')), original);
  await assert.rejects(importBenchmarkEvidence(output, { runDir }), /already exists/);
});

for (const tamper of ['metrics', 'summary', 'missing', 'wrong-evaluator']) {
  test(`refuses ${tamper} evidence without converting missing checks to success`, async t => {
    const dir = workspace(t), runDir = fixture(dir);
    if (tamper === 'metrics') fs.writeFileSync(path.join(runDir, 'metrics.json'), '{"rows":[]}');
    if (tamper === 'summary') {
      const file = path.join(runDir, 'run-summary.json');
      const summary = JSON.parse(fs.readFileSync(file, 'utf8'));
      summary.localEngineering = 'passed';
      fs.writeFileSync(file, JSON.stringify(summary));
    }
    if (tamper === 'missing') fs.unlinkSync(path.join(runDir, 'run-summary.json'));
    const results = await importBenchmarkEvidence(path.join(dir, 'qualification'), {
      runDir, ...(tamper === 'wrong-evaluator' ? { evaluatorRoot: dir } : {}),
    });
    assert.equal(results.length, 2);
    assert(results.every(result => result.passed === false));
  });
}

// Models the actual bare P13 controller DTOs, including a metric identity suffix,
// stored-evidence runner, and a terminal reference. Fetch is always intercepted;
// this proves adapter behavior, not a live terminal CAS or model execution.
function p13Fixture(family: 'extraction' | 'parser' = 'extraction'): any {
  const ref = (id: string, type: string) => ({ evidence_id: id, evidence_type: type,
    content_hash: createHash('sha256').update(id).digest('hex'), uri: `cas://${id}`,
    produced_at: '2026-10-02T00:00:00Z', producer_version: 'fictional-test/1' });
  const version = (type: string, id: string) => ({ component_type: type, component_id: id, version: '3.0.0',
    content_hash: createHash('sha256').update(id).digest('hex') });
  const metricVersion = version('metric_definition', `p13-${family}`), policyVersion = version('threshold_policy', `p13-${family}`);
  const runnerVersion = version('benchmark_runner', 'stored-evidence-measurement');
  const actual = ref('actual', 'benchmark_actual'), gold = ref('gold', 'benchmark_gold');
  const report = ref('measurement-report', 'benchmark_measurement_report');
  const identity = { case_id: 'case-1', scenario_id: 'scenario-1', document_version_id: 'protocol-1',
    measurement_family: family, category: 'eligibility', document_kind: 'protocol' };
  const metricId = `${family === 'parser' ? 'parser-cer' : 'extraction-recall'}:${'f'.repeat(64)}`;
  const measurement = { identity, actual_ref: actual, gold_ref: gold,
    metric_definition_ref: metricVersion, threshold_policy_ref: policyVersion };
  const metric = { metric_id: metricId, metric_name: 'recall', metric_family: family, value: 1, threshold: 0.95,
    status: 'passed', direction: 'floor', evidence_ref: actual,
    measurement: { ...measurement, implementation_hash: metricVersion.content_hash, threshold_policy_hash: policyVersion.content_hash,
      ...(family === 'extraction' ? { candidate_count: 3, gold_count: 3, typed_gold_counts: { dose: 1, operator: 1 } } : {}) },
    details: { matched: [{ gold: 'criterion-1', actual: 'candidate-1' }], source_span: 'Protocol section 4.2' } };
  const request = { contract_version: 'p13-benchmark-execution/1', tenant_id: 'tenant-1', study_id: 'study-1',
    idempotency_key: 'request-1', request_hash: 'b'.repeat(64), partitions: ['regression_set'], scenarios: [{
      scenario_id: 'scenario-1', case_id: 'case-1', runner_type: 'stored_evidence_measurement',
      definition_ref: ref('scenario-1', 'benchmark_scenario'), runner_version: runnerVersion }] };
  const metricsContract = { measurement_contract: 'p13-identity-measurement/3', metric_definition_versions: [metricVersion],
    threshold_policy_versions: [policyVersion], thresholds: { extraction: { recall_floor: 0.95 } },
    evidence_identity_fields: Object.keys(identity) };
  const benchmarkContract = { execution_contract: 'p13-benchmark-execution/1', scenario_contract: 'p13-benchmark-scenario/1',
    runners: [{ runner_type: 'stored_evidence_measurement', version: runnerVersion }], replay: {},
    amendment: { verification_scope: 'authored_hash_keyed_scenario' } };
  const expected = { benchmark_run_id: 'run-1', tenant_id: 'tenant-1', study_id: 'study-1', system_version_bundle_id: 'bundle-1',
    corpus_commit_hash: 'a'.repeat(64), execution_request: request,
    metric_definition_versions: [metricVersion], threshold_policy_versions: [policyVersion],
    metrics_contract: metricsContract, benchmark_contract: benchmarkContract };
  const run = { ...expected, metrics_contract: undefined, benchmark_contract: undefined,
    execution_context: { mode: 'benchmark', execution_context_id: 'execution-1' }, attempt: 1,
    correlation_id: 'correlation-1', started_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-02T00:01:00Z',
    run_status: 'completed', execution_completed: true,
    terminal: { status: 'completed', execution_completed: true, promotion_evidence_ready: true,
      scenario_results: [{ scenario_id: 'scenario-1', status: 'passed', evidence_refs: [report],
        metric_results: [metric], measurement_contract: metricsContract.measurement_contract, executed_implementations: [runnerVersion, metricVersion, policyVersion] }],
      evidence_refs: [report], terminal_evidence_ref: ref('terminal-1', 'benchmark_execution_terminal') } };
  return JSON.parse(JSON.stringify({ plan: { contract: 'p13-qualification-attachment/1', apiBaseUrl: 'http://127.0.0.1:3099/api',
    bearerTokenEnv: 'P13_ATTACHMENT_TEST_TOKEN', expected, measurements: [{ ...measurement, metric_ids: [metricId] }] },
    run, metricsContract, benchmarkContract }));
}

async function p13Import(t: any, data = p13Fixture(), options: { external?: boolean; status?: number; response?: unknown; rawBody?: string;
  contentType?: string; token?: string; responseFactory?: (init: RequestInit) => Response | Promise<Response>; failFetch?: boolean } = {}) {
  const dir = workspace(t), output = path.join(dir, 'qualification'), planFile = path.join(dir, 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify(data.plan));
  const oldToken = process.env.P13_ATTACHMENT_TEST_TOKEN;
  process.env.P13_ATTACHMENT_TEST_TOKEN = options.token ?? 'private-scoped-bearer';
  t.after(() => { if (oldToken === undefined) delete process.env.P13_ATTACHMENT_TEST_TOKEN; else process.env.P13_ATTACHMENT_TEST_TOKEN = oldToken; });
  const calls: { url: string; options: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, options: init });
    if (options.failFetch) throw new Error('private-scoped-bearer transport detail');
    if (options.responseFactory) return options.responseFactory(init);
    const body = options.response ?? (url.endsWith('/metrics/contracts') ? data.metricsContract
      : url.endsWith('/benchmark/contracts') ? data.benchmarkContract : data.run);
    return new Response(options.rawBody ?? JSON.stringify(body), { status: options.status ?? 200,
      headers: { 'content-type': options.contentType ?? 'application/json' } });
  });
  const results = await importP13BenchmarkEvidence(output, { planFile, allowProductionQualification: options.external });
  return { results, output, calls, planFile };
}

test('P13 exact native attachment uses only scoped GETs, preserves details and hashes, and reaches reports', async t => {
  const data = p13Fixture(), { results, output, calls, planFile } = await p13Import(t, data);
  assert(results.every(result => result.passed), JSON.stringify(results));
  assert.deepEqual(calls.map(call => call.url), ['metrics/contracts', 'benchmark/contracts', 'benchmark/records/run-1']
    .map(route => `http://127.0.0.1:3099/api/internal/p13/${route}`));
  for (const call of calls) {
    assert.equal(call.options.method, 'GET'); assert.equal(call.options.redirect, 'error');
    assert.equal((call.options.headers as any)['x-tenant-id'], 'tenant-1');
    assert.equal((call.options.headers as any)['x-study-id'], 'study-1');
    assert.equal((call.options.headers as any).Authorization, 'Bearer private-scoped-bearer');
    assert.equal(call.options.body, undefined);
  }
  const attachment = results[0].responseBody as any;
  assert.deepEqual(attachment.run, data.run);
  assert.equal(attachment.offlineRescored, false); assert.equal(attachment.independentlyValidated, false);
  assert.deepEqual(attachment.metricCoverage, [{ metricId: data.plan.measurements[0].metric_ids[0], nativeStatus: 'passed', denominatorStatus: 'retained' }]);
  for (const [i, entry] of attachment.artifactHashes.entries()) {
    assert.equal(entry.sha256, createHash('sha256').update(JSON.stringify(results[0].relatedEvidence![i].responseBody)).digest('hex'));
  }
  assert.deepEqual(loadEvidence(output, 'p13'), results);
  assert.doesNotMatch(fs.readFileSync(path.join(output, 'evidence/p13/p13-results.json'), 'utf8'), /private-scoped-bearer/);
  assert.equal(loadRunnerEvidence(output).get('P13-NATIVE-METRICS')?.passed, true);
  generate(output, output);
  const doc = fs.readFileSync(path.join(output, '20-test-execution-records.md'), 'utf8');
  assert.match(doc, /P13-NATIVE-ATTACHMENT/); assert.doesNotMatch(doc, /Send ATTACHMENT request/);
  await assert.rejects(importP13BenchmarkEvidence(output, { planFile }), /already exists/);
  assert.equal(calls.length, 3, 'create-only reservation precedes requests');
});

test('P13 parser preserves native rows without fabricating extraction denominators', async t => {
  const { results } = await p13Import(t, p13Fixture('parser'));
  assert(results.every(result => result.passed));
  assert.equal((results[0].responseBody as any).metricCoverage[0].denominatorStatus, 'not_exposed_by_native_contract');
  assert.equal((results[0].responseBody as any).run.terminal.scenario_results[0].metric_results[0].measurement.gold_count, undefined);
});

const p13Invalid: [string, (fixture: any) => void][] = [
  ['wrong tenant', f => { f.run.tenant_id = 'foreign'; }],
  ['wrong study', f => { f.run.study_id = 'foreign'; }],
  ['wrong accepted request', f => { f.run.execution_request.request_hash = 'c'.repeat(64); }],
  ['wrong bundle', f => { f.run.system_version_bundle_id = 'foreign'; }],
  ['wrong corpus', f => { f.run.corpus_commit_hash = 'c'.repeat(64); }],
  ['altered contract threshold', f => { f.metricsContract.thresholds.extraction.recall_floor = 0; }],
  ['altered runner contract', f => { f.benchmarkContract.runners[0].version.content_hash = 'c'.repeat(64); }],
  ['missing terminal', f => { delete f.run.terminal; }],
  ['unfinished execution', f => { f.run.execution_completed = false; }],
  ['unknown scenario', f => { f.run.terminal.scenario_results[0].scenario_id = 'foreign'; }],
  ['duplicate scenario', f => { f.run.terminal.scenario_results.push(f.run.terminal.scenario_results[0]); }],
  ['missing scenario', f => { f.run.terminal.scenario_results = []; }],
  ['missing metric', f => { f.run.terminal.scenario_results[0].metric_results = []; }],
  ['duplicate metric', f => { f.run.terminal.scenario_results[0].metric_results.push(f.run.terminal.scenario_results[0].metric_results[0]); }],
  ['wrong actual source hash', f => { f.run.terminal.scenario_results[0].metric_results[0].measurement.actual_ref.content_hash = 'c'.repeat(64); }],
  ['wrong document', f => { f.run.terminal.scenario_results[0].metric_results[0].measurement.identity.document_version_id = 'foreign'; }],
  ['missing denominator', f => { delete f.run.terminal.scenario_results[0].metric_results[0].measurement.gold_count; }],
  ['negative typed denominator', f => { f.run.terminal.scenario_results[0].metric_results[0].measurement.typed_gold_counts.dose = -1; }],
  ['missing implementation', f => { f.run.terminal.scenario_results[0].executed_implementations = []; }],
  ['missing executed metric implementation', f => { f.run.terminal.scenario_results[0].executed_implementations.splice(1, 1); }],
  ['missing executed policy implementation', f => { f.run.terminal.scenario_results[0].executed_implementations.splice(2, 1); }],
  ['missing terminal evidence census', f => { f.run.terminal.evidence_refs = []; }],
];
for (const [name, mutate] of p13Invalid) test(`P13 refuses ${name} without metric credit`, async t => {
  const data = p13Fixture(); mutate(data);
  const { results } = await p13Import(t, data);
  assert(results.every(result => !result.passed), JSON.stringify(results));
  assert.equal((results[1].responseBody as any).status, 'not_run');
});

for (const status of ['vacuous', 'no_baseline', 'regressed', 'failed']) test(`P13 retains native ${status} status without passing metrics`, async t => {
  const data = p13Fixture(); data.run.terminal.scenario_results[0].metric_results[0].status = status;
  data.run.terminal.promotion_evidence_ready = false;
  const { results } = await p13Import(t, data);
  assert.equal(results[0].passed, true); assert.equal(results[1].passed, false);
  assert.equal((results[0].responseBody as any).run.terminal.scenario_results[0].metric_results[0].status, status);
});

for (const mutate of [
  (f: any) => { f.plan.extra = 'unexpected'; },
  (f: any) => { f.plan.apiBaseUrl = 'https://foreign.example/api'; },
  (f: any) => { f.plan.apiBaseUrl = 'http://127.0.0.1:3099/api?redirect=foreign'; },
  (f: any) => { f.plan.apiBaseUrl = 'http://user:password@127.0.0.1:3099/api'; },
  (f: any) => { f.plan.bearerTokenEnv = 'MISSING_P13_TEST_TOKEN'; },
]) test('P13 invalid or unapproved plan refuses before authority requests', async t => {
  const data = p13Fixture(); mutate(data);
  const { results, calls } = await p13Import(t, data);
  assert.equal(calls.length, 0); assert(results.every(result => !result.passed));
});

test('P13 explicit external HTTPS acknowledgement is separate from the plan', async t => {
  const data = p13Fixture(); data.plan.apiBaseUrl = 'https://qualified.example/api';
  const { results, calls } = await p13Import(t, data, { external: true });
  assert(results.every(result => result.passed)); assert.equal(calls.length, 3);
});

for (const status of [302, 401, 403, 500]) test(`P13 HTTP ${status} is retained as failed retrieval`, async t => {
  const { results, calls } = await p13Import(t, p13Fixture(), { status, response: { error: 'refused' } });
  assert.equal(calls.length, 1); assert(results.every(result => !result.passed));
  assert.equal(results[0].relatedEvidence![0].responseStatus, status);
});

test('P13 transport failure keeps evidence and strips even an echoed bearer value', async t => {
  const { results, output } = await p13Import(t, p13Fixture(), { failFetch: true });
  assert(results.every(result => !result.passed));
  assert.match(results[0].relatedEvidence![0].captureError!, /\[redacted\]/);
  assert.doesNotMatch(fs.readFileSync(path.join(output, 'evidence/p13/p13-results.json'), 'utf8'), /private-scoped-bearer/);
});

for (const rawBody of ['{broken JSON', 'x'.repeat(16 * 1024 * 1024 + 1)]) {
  test('P13 malformed or oversized wire bodies cannot become successful evidence', async t => {
    const { results, calls } = await p13Import(t, p13Fixture(), { rawBody });
    assert.equal(calls.length, 1); assert(results.every(result => !result.passed));
    assert(results[0].relatedEvidence![0].captureError);
  });
}

test('P13 failed terminal retains its complete native findings without metric success', async t => {
  const data = p13Fixture(); data.run.run_status = data.run.terminal.status = 'failed';
  data.run.terminal.promotion_evidence_ready = false;
  data.run.terminal.scenario_results[0].status = 'failed';
  data.run.terminal.scenario_results[0].metric_results[0].status = 'regressed';
  const { results } = await p13Import(t, data);
  assert.equal(results[0].passed, true); assert.equal(results[1].passed, false);
  assert.equal((results[1].responseBody as any).status, 'failed');
  assert.deepEqual((results[0].responseBody as any).run, data.run);
});

test('P13 replay-only complete terminal receives no extraction metric credit', async t => {
  const data = p13Fixture(); data.plan.measurements = [];
  data.plan.expected.execution_request.scenarios[0].runner_type = 'event_replay';
  data.run.execution_request.scenarios[0].runner_type = 'event_replay';
  data.plan.expected.benchmark_contract.runners[0].runner_type = data.benchmarkContract.runners[0].runner_type = 'event_replay';
  data.run.terminal.scenario_results[0].metric_results = [];
  data.run.terminal.promotion_evidence_ready = false;
  const { results } = await p13Import(t, data);
  assert.equal(results[0].passed, true, JSON.stringify(results));
  assert.equal(results[1].passed, false); assert.equal((results[1].responseBody as any).status, 'not_run');
});

test('P13 nonlocal plaintext remains refused even with explicit external acknowledgement', async t => {
  const data = p13Fixture(); data.plan.apiBaseUrl = 'http://qualified.example/api';
  const { results, calls } = await p13Import(t, data, { external: true });
  assert.equal(calls.length, 0); assert(results.every(result => !result.passed));
});

test('P13 never retains an echoed bearer in plan, contracts, refs, reports or result files', async t => {
  const data = p13Fixture();
  data.plan.expected.metrics_contract.diagnostic = data.metricsContract.diagnostic = 'echo private-scoped-bearer';
  for (const ref of [data.plan.measurements[0].actual_ref, data.run.terminal.scenario_results[0].metric_results[0].measurement.actual_ref,
    data.run.terminal.scenario_results[0].metric_results[0].evidence_ref]) ref.uri = 'cas://private-scoped-bearer';
  const { results, output, planFile } = await p13Import(t, data);
  assert(results.every(result => result.passed), JSON.stringify(results));
  const attachment = results[0].responseBody as any;
  const retainedPlan = fs.readFileSync(path.join(output, 'evidence/p13/attachment-plan.json'));
  assert.equal(attachment.inputPlanSha256, createHash('sha256').update(fs.readFileSync(planFile)).digest('hex'));
  assert.equal(attachment.retainedPlanSha256, createHash('sha256').update(retainedPlan).digest('hex'));
  assert.notEqual(attachment.inputPlanSha256, attachment.retainedPlanSha256);
  for (const name of fs.readdirSync(path.join(output, 'evidence/p13'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(output, 'evidence/p13', name), 'utf8'), /private-scoped-bearer/, name);
  }
  for (const [i, entry] of attachment.artifactHashes.entries()) {
    assert.equal(entry.sha256, createHash('sha256').update(JSON.stringify(results[0].relatedEvidence![i].responseBody)).digest('hex'));
  }
});

test('P13 oversized streaming response cancels its reader before requesting another route', async t => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(16 * 1024 * 1024)); controller.enqueue(new Uint8Array(1));
  }, cancel() { cancelled = true; } });
  const { results, calls } = await p13Import(t, p13Fixture(), { responseFactory: () => new Response(stream,
    { headers: { 'content-type': 'application/json' } }) });
  assert.equal(cancelled, true); assert.equal(calls.length, 1);
  assert.match(results[0].relatedEvidence![0].captureError!, /byte limit/);
  assert(results.every(result => !result.passed));
});

for (const options of [{ contentType: 'text/plain', rawBody: '{}' }, { response: [] }, { response: { success: false } }]) {
  test('P13 non-JSON or malformed successful payload never grants evidence credit', async t => {
    const { results, calls } = await p13Import(t, p13Fixture(), options);
    assert.equal(calls.length, 1); assert(results.every(result => !result.passed));
  });
}

test('P13 passes a finite deadline and retains abort without retry or later authority requests', async t => {
  const requested: number[] = [], controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', (ms: number) => { requested.push(ms); return controller.signal; });
  const { results, calls } = await p13Import(t, p13Fixture(), { responseFactory: init => new Promise((_resolve, reject) => {
    assert.equal(init.signal, controller.signal);
    init.signal!.addEventListener('abort', () => reject(new Error('TimeoutError')), { once: true });
    controller.abort();
  }) });
  assert.deepEqual(requested, [30000]); assert.equal(calls.length, 1);
  assert.match(results[0].relatedEvidence![0].captureError!, /TimeoutError/);
  assert(results.every(result => !result.passed));
});

test('P13 redirect rejection from fetch stays failed without forwarding or retry', async t => {
  const { results, calls } = await p13Import(t, p13Fixture(), { responseFactory: init => {
    assert.equal(init.redirect, 'error'); throw new TypeError('unexpected redirect');
  } });
  assert.equal(calls.length, 1); assert(results.every(result => !result.passed));
  assert.match(results[0].relatedEvidence![0].captureError!, /redirect/);
});

for (const token of ['quoted"bearer', 'escaped\\bearer']) test('P13 rejects invalid bearer grammar before requests and retains no escaped secret', async t => {
  const data = p13Fixture(); data.plan.expected.metrics_contract.diagnostic = token;
  const { results, output, calls } = await p13Import(t, data, { token });
  assert.equal(calls.length, 0); assert(results.every(result => !result.passed));
  for (const name of fs.readdirSync(path.join(output, 'evidence/p13'))) {
    const text = fs.readFileSync(path.join(output, 'evidence/p13', name), 'utf8');
    assert.equal(text.includes(token), false); assert.equal(text.includes(JSON.stringify(token).slice(1, -1)), false);
  }
});
