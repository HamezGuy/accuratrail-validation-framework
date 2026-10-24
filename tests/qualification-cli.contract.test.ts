import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const root = path.resolve(__dirname, '..');
const API = 'a'.repeat(40), UI = 'b'.repeat(40), CORE = `sha256:${'c'.repeat(64)}`;
const RELEASE = ['--release-api', API, '--release-ui', UI, '--release-core', CORE];
function runCli(scenario: string, flags = ['--all'], baseUrl: string | null = 'https://qualification.invalid', release = RELEASE) {
  const result = spawnSync(process.execPath, [
    '-r', require.resolve('ts-node/register'),
    '-r', path.join(__dirname, 'fixtures', 'qualification-cli-offline.cjs'),
    path.join(root, 'generate.ts'),
    ...flags, ...(baseUrl === null ? [] : ['--base-url', baseUrl]), ...release,
  ], {
    cwd: root,
    env: { ...process.env, QUALIFICATION_CLI_TEST_SCENARIO: scenario, QUALIFICATION_CLI_TEST_TARGET: baseUrl ?? '' },
    encoding: 'utf8',
    timeout: 20_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return { status: result.status, output: result.stdout + result.stderr };
}

for (const scenario of ['failed-result', 'throw', 'undefined', 'empty', 'malformed']) {
  test(`qualification CLI fails for ${scenario} while retaining later runner evidence`, () => {
    const result = runCli(scenario);
    assert.match(result.output, /OFFLINE_RUNNER \.\/runners\/iq-runner/);
    assert.match(result.output, /OFFLINE_RUNNER \.\/runners\/performance-runner/);
    assert.match(result.output, /test-execution-records \(refreshed\)/);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /\[FAIL\] IQ Runner/);
  });
}

test('a failed evidence-dependent refresh cannot report a successful command', () => {
  const result = runCli('refresh-failure');
  assert.match(result.output, /Synthetic evidence refresh failure/);
  assert.equal(result.status, 1, result.output);
});

test('a required collector exception cannot become a successful partial report', () => {
  const result = runCli('collector-failure');
  assert.match(result.output, /Synthetic required collector failure/);
  assert.match(result.output, /test-execution-records \(refreshed\)/);
  assert.equal(result.status, 1, result.output);
});

test('all six selected runner results and document refreshes can succeed', () => {
  const result = runCli('pass');
  assert.equal((result.output.match(/OFFLINE_RUNNER /g) || []).length, 6);
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /\[FAIL\]/);
});

test('docs-only does not import or execute a live runner even with --all', () => {
  const result = runCli('throw', ['--all', '--docs-only']);
  assert.doesNotMatch(result.output, /OFFLINE_RUNNER /);
  assert.equal(result.status, 0, result.output);
});

test('explicit benchmark-only evidence refreshes reports and propagates failure', () => {
  for (const scenario of ['pass', 'failed-result']) {
    const result = runCli(scenario, ['--benchmark-run', 'offline-fixture']);
    assert.match(result.output, /OFFLINE_BENCHMARK offline-fixture/);
    assert.match(result.output, /test-execution-records \(refreshed\)/);
    assert.equal(result.status, scenario === 'pass' ? 0 : 1, result.output);
    assert.doesNotMatch(result.output, /OFFLINE_RUNNER /);
  }
});

test('docs-only does not import benchmark evidence or silently consume missing path arguments', () => {
  const result = runCli('throw', ['--docs-only', '--benchmark-run', 'offline-fixture']);
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /OFFLINE_BENCHMARK/);
  assert.equal(runCli('pass', ['--benchmark-run']).status, 1);
  assert.equal(runCli('pass', ['--benchmark-evaluator-root', 'archived-evaluator']).status, 1);
});

test('synthetic qualification switches reach each selected runner without inferred acknowledgments', () => {
  const explicit = runCli('pass', ['--pq', '--synthetic-qualification', '--allow-production-qualification', '--acknowledge-ungoverned']);
  assert.equal(explicit.status, 0, explicit.output);
  assert.match(explicit.output, /QUALIFICATION_FLAGS --synthetic-qualification,--allow-production-qualification,--acknowledge-ungoverned/);
  assert.doesNotMatch(explicit.output, /acknowledge-incomplete/);
});

test('P13-only collection is explicit, refreshes reports and propagates incomplete native evidence', () => {
  for (const scenario of ['pass', 'failed-result']) {
    const result = runCli(scenario, ['--p13-plan', 'scoped-plan.json']);
    assert.match(result.output, /OFFLINE_P13 scoped-plan.json external=false/);
    assert.match(result.output, /test-execution-records \(refreshed\)/);
    assert.equal(result.status, scenario === 'pass' ? 0 : 1, result.output);
    assert.doesNotMatch(result.output, /OFFLINE_RUNNER |OFFLINE_BENCHMARK/);
  }
  const external = runCli('pass', ['--p13-plan', 'scoped-plan.json', '--allow-production-qualification']);
  assert.match(external.output, /external=true/);
  assert.equal(external.status, 0, external.output);
});

test('P13 docs-only performs no retrieval and a missing plan argument fails', () => {
  const result = runCli('throw', ['--docs-only', '--p13-plan', 'scoped-plan.json']);
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /OFFLINE_P13/);
  assert.equal(runCli('pass', ['--p13-plan']).status, 1);
});

test('live runners have no default target and refuse to start without --base-url', () => {
  const result = runCli('pass', ['--oq'], null);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Live runners require an explicit --base-url/);
  assert.doesNotMatch(result.output, /OFFLINE_RUNNER |api\.accuratrials\.com/);
  const missingValue = runCli('pass', ['--oq', '--base-url'], null);
  assert.equal(missingValue.status, 1, missingValue.output);
  assert.match(missingValue.output, /--base-url requires a URL/);
});

test('documents and offline evidence need no target', () => {
  assert.equal(runCli('pass', ['--docs-only', '--all'], null).status, 0);
  const benchmark = runCli('pass', ['--benchmark-run', 'offline-fixture'], null);
  assert.equal(benchmark.status, 0, benchmark.output);
});

for (const target of ['https://api.accuratrials.com', 'https://app.accuratrials.com/', 'https://API.AccuraTrials.com:443', 'https://www.acuratrials.com']) {
  test(`production host ${target} is refused without the explicit production flag`, () => {
    const refused = runCli('pass', ['--all', '--synthetic-qualification', '--allow-production-qualification'], target);
    assert.equal(refused.status, 1, refused.output);
    assert.match(refused.output, /Refusing production host .*--allow-production-target/);
    assert.doesNotMatch(refused.output, /OFFLINE_RUNNER /);
  });
}

test('the explicit production flag reaches the runners with the given target only', () => {
  const allowed = runCli('pass', ['--iq', '--allow-production-target'], 'https://api.accuratrials.com');
  assert.equal(allowed.status, 0, allowed.output);
  assert.match(allowed.output, /OFFLINE_TARGET https:\/\/api\.accuratrials\.com/);
});

test('a staging or local target is accepted without the production flag', () => {
  for (const target of ['https://staging-api.accuratrials.com', 'http://localhost:3000']) {
    const result = runCli('pass', ['--iq'], target);
    assert.equal(result.status, 0, result.output);
    assert.ok(result.output.includes(`OFFLINE_TARGET ${target}`), result.output);
  }
  const invalid = runCli('pass', ['--iq'], 'ftp://localhost');
  assert.equal(invalid.status, 1, invalid.output);
  assert.match(invalid.output, /must use http or https/);
});

test('live runners require the API, UI and core release under test', () => {
  const missing = runCli('pass', ['--oq'], undefined, ['--release-api', API]);
  assert.equal(missing.status, 1, missing.output);
  assert.match(missing.output, /require the release under test: pass --release-ui, --release-core/);
  assert.doesNotMatch(missing.output, /OFFLINE_RUNNER /);
  const short = runCli('pass', ['--oq'], undefined, ['--release-api', 'abc1234', '--release-ui', UI, '--release-core', CORE]);
  assert.equal(short.status, 1, short.output);
  assert.match(short.output, /--release-api must be a full 40-character Git commit/);
  assert.equal(runCli('pass', ['--docs-only', '--all'], null, []).status, 0);
});

test('the run reports the release under test and records an unreachable version endpoint', () => {
  const result = runCli('pass', ['--iq']);
  assert.equal(result.status, 0, result.output);
  assert.ok(result.output.includes(`Release under test: api ${API}, ui ${UI}, core ${CORE}`), result.output);
  assert.match(result.output, /Target version endpoint unavailable \(Offline CLI test attempted network access\)/);
});

test('--release-training and none reach the release under test as identity version 2', () => {
  const TRAINING = 'd'.repeat(40);
  const trained = runCli('pass', ['--iq'], undefined, [...RELEASE, '--release-training', TRAINING]);
  assert.equal(trained.status, 0, trained.output);
  assert.ok(trained.output.includes(`Release under test: api ${API}, ui ${UI}, core ${CORE}, training ${TRAINING} (`), trained.output);
  const undeployed = runCli('pass', ['--oq'], undefined,
    ['--release-api', API, '--release-ui', 'none', '--release-core', 'none', '--release-training', 'none']);
  assert.equal(undeployed.status, 0, undeployed.output);
  assert.ok(undeployed.output.includes(`Release under test: api ${API}, ui not deployed, core not deployed, training not deployed (`),
    undeployed.output);
  assert.match(undeployed.output, /OFFLINE_RUNNER \.\/runners\/oq-runner/);
});

test('none is refused for the API, and a none needs the training release stated before any runner starts', () => {
  const api = runCli('pass', ['--oq'], undefined, ['--release-api', 'none', '--release-ui', UI, '--release-core', CORE]);
  assert.equal(api.status, 1, api.output);
  assert.match(api.output, /--release-api cannot be none: the API under test is always deployed/);
  assert.doesNotMatch(api.output, /OFFLINE_RUNNER /);
  const untrained = runCli('pass', ['--oq'], undefined, ['--release-api', API, '--release-ui', 'none', '--release-core', CORE]);
  assert.equal(untrained.status, 1, untrained.output);
  assert.match(untrained.output, /require the release under test: pass --release-training \(/);
  assert.doesNotMatch(untrained.output, /OFFLINE_RUNNER /);
  const missingValue = runCli('pass', ['--oq'], undefined, [...RELEASE, '--release-training']);
  assert.equal(missingValue.status, 1, missingValue.output);
  assert.match(missingValue.output, /--release-training requires a Git commit or image ID, or none/);
  assert.doesNotMatch(missingValue.output, /OFFLINE_RUNNER /);
});
