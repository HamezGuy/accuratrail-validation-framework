import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const root = path.resolve(__dirname, '..');
function runCli(scenario: string, flags = ['--all']) {
  const result = spawnSync(process.execPath, [
    '-r', require.resolve('ts-node/register'),
    '-r', path.join(__dirname, 'fixtures', 'qualification-cli-offline.cjs'),
    path.join(root, 'generate.ts'),
    ...flags, '--base-url', 'https://qualification.invalid',
  ], {
    cwd: root,
    env: { ...process.env, QUALIFICATION_CLI_TEST_SCENARIO: scenario },
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
