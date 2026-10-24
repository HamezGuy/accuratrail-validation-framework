import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { verifyPackage, DEVELOPMENT_RUN_NOTICE, MANIFEST_FILE, SYNTHETIC_ROOT_MARKER } from '../runners/evidence-package';
import { SYNTHETIC_FILING_LINE, TMF_FILING_FILE } from '../generators/helpers/tmf-filing';
import { temporaryDirectory } from './generated-documents';

const root = path.resolve(__dirname, '..');
const API = 'a'.repeat(40), UI = 'b'.repeat(40), CORE = `sha256:${'c'.repeat(64)}`;
const RELEASE = ['--release-api', API, '--release-ui', UI, '--release-core', CORE];
const LIVE_RUNNER_FLAGS = ['--all', '--iq', '--oq', '--pq', '--security', '--dr', '--perf'];
/** Live-runner scenarios run as development runs unless a test states the retention itself. */
const defaultRetention = (flags: string[]) => !flags.includes('--docs-only') && flags.some(flag => LIVE_RUNNER_FLAGS.includes(flag))
  && !flags.includes('--retain-root') && !flags.includes('--no-retain') ? ['--no-retain'] : [];
function runCli(scenario: string, flags = ['--all'], baseUrl: string | null = 'https://qualification.invalid', release = RELEASE,
  retention = defaultRetention(flags)) {
  const result = spawnSync(process.execPath, [
    '-r', require.resolve('ts-node/register'),
    '-r', path.join(__dirname, 'fixtures', 'qualification-cli-offline.cjs'),
    path.join(root, 'generate.ts'),
    ...flags, ...(baseUrl === null ? [] : ['--base-url', baseUrl]), ...release, ...retention,
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

/** A temporary synthetic data root; packages go to its runs/validation-packages. */
function markedRoot(t: { after(callback: () => void): void }): string {
  const dataRoot = temporaryDirectory(t, 'accura-cli-package-root-');
  fs.writeFileSync(path.join(dataRoot, SYNTHETIC_ROOT_MARKER), 'Synthetic-trial data root for a CLI contract test.\n');
  return path.join(dataRoot, 'runs', 'validation-packages');
}

test('a live runner with neither --retain-root nor --no-retain is refused before any runner starts', () => {
  for (const flags of [['--iq'], ['--all', '--synthetic-qualification']]) {
    const result = runCli('pass', flags, undefined, undefined, []);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /Live runners require --retain-root <directory> \(a retained, sealed evidence package\) or --no-retain/);
    assert.doesNotMatch(result.output, /OFFLINE_RUNNER /);
  }
  const both = runCli('pass', ['--iq'], undefined, undefined, ['--no-retain', '--retain-root', 'C:/unused']);
  assert.equal(both.status, 1, both.output);
  assert.match(both.output, /Pass --retain-root or --no-retain, not both/);
  const missingValue = runCli('pass', ['--iq', '--retain-root'], undefined, undefined, []);
  assert.equal(missingValue.status, 1, missingValue.output);
  assert.match(missingValue.output, /--retain-root requires a directory/);
  assert.doesNotMatch(both.output + missingValue.output, /OFFLINE_RUNNER /);
});

test('--no-retain runs the live runners and states that nothing is retained', () => {
  const result = runCli('pass', ['--iq'], undefined, undefined, ['--no-retain']);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /OFFLINE_RUNNER \.\/runners\/iq-runner/);
  assert.ok(result.output.includes(`Retention: none. ${DEVELOPMENT_RUN_NOTICE}; nothing from this run is retained.`), result.output);
  assert.doesNotMatch(result.output, /Retained Evidence Package/);
});

test('an evidence import given neither flag still runs into scratch and states that nothing is retained', () => {
  const result = runCli('pass', ['--benchmark-run', 'offline-fixture'], null, []);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /OFFLINE_BENCHMARK offline-fixture/);
  assert.ok(result.output.includes(`Retention: none. ${DEVELOPMENT_RUN_NOTICE}; nothing from this run is retained.`), result.output);
  const documents = runCli('pass', ['--docs-only'], null, []);
  assert.equal(documents.status, 0, documents.output);
  assert.doesNotMatch(documents.output, /Retention:/, 'a documents run without retention flags is plain scratch');
});

test('a synthetic package is refused outside a marked data root, and a package that is not synthetic inside one', t => {
  const unmarked = temporaryDirectory(t, 'accura-cli-unmarked-');
  const refused = runCli('pass', ['--iq', '--synthetic-qualification'], undefined, undefined, ['--retain-root', unmarked]);
  assert.equal(refused.status, 1, refused.output);
  assert.match(refused.output, /A synthetic package is retained only under a synthetic data root/);
  assert.doesNotMatch(refused.output, /OFFLINE_RUNNER /);
  assert.deepEqual(fs.readdirSync(unmarked), [], 'nothing is created');
  const home = markedRoot(t);
  const real = runCli('pass', ['--iq'], undefined, undefined, ['--retain-root', home]);
  assert.equal(real.status, 1, real.output);
  assert.match(real.output, /A package that is not synthetic is never retained inside the synthetic data root/);
  assert.doesNotMatch(real.output, /OFFLINE_RUNNER /);
  assert.equal(fs.existsSync(home), false);
});

test('--retain-root under a marked data root creates, seals and verifies a package and prints its manifest hash', t => {
  const home = markedRoot(t);
  const result = runCli('pass', ['--iq', '--synthetic-qualification', '--version', 'cli-package'], undefined, undefined,
    ['--retain-root', home]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /OFFLINE_RUNNER \.\/runners\/iq-runner/);
  assert.match(result.output, /Retention: sealed evidence package \(synthetic engineering evidence\)/);
  const created = fs.readdirSync(home);
  assert.equal(created.length, 1);
  assert.match(created[0], /^\d{8}T\d{6}Z-cli-package-[0-9a-f]{8}$/);
  const dir = path.join(home, created[0]);
  const printed = /package-manifest\.json SHA-256: ([0-9a-f]{64})/.exec(result.output)?.[1];
  assert.equal(printed, createHash('sha256').update(fs.readFileSync(path.join(dir, MANIFEST_FILE))).digest('hex'));
  const verified = verifyPackage(dir);
  assert.deepEqual(verified.problems, []);
  assert.equal(verified.manifestSha256, printed);
  const manifest = verified.manifest!;
  assert.deepEqual([manifest.executed, manifest.synthetic, manifest.syntheticBasis, manifest.version],
    [true, true, ['synthetic-qualification'], 'cli-package']);
  assert.equal(manifest.releaseUnderTest?.components.api.identity, API);
  // The offline fetch refuses /health, so the observation records the attempt and no reported version.
  assert.deepEqual({ ...manifest.target, observedAt: typeof manifest.target?.observedAt },
    { baseUrl: 'https://qualification.invalid', observedAt: 'string', reportedVersion: null });
  assert.ok(fs.readFileSync(path.join(dir, TMF_FILING_FILE), 'utf8').startsWith(SYNTHETIC_FILING_LINE));
});

/** A synthetic validation-target-configuration/1 declaration of the offline target, with its source file. */
function declaration(t: { after(callback: () => void): void }, overrides: Record<string, unknown> = {}): { file: string; bytes: Buffer } {
  const directory = temporaryDirectory(t, 'accura-cli-declaration-');
  const source = path.join(directory, 'compose.yaml');
  fs.writeFileSync(source, 'services:\n  core-api:\n    environment:\n      ENABLE_DEVIATION_ENGINE: "true"\n');
  const bytes = Buffer.from(JSON.stringify({
    contract: 'validation-target-configuration/1', target: 'https://qualification.invalid',
    source: { path: source, sha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex') },
    declaredBy: 'CLI contract test (synthetic)', declaredAt: '2026-10-24T00:00:00Z', flags: { ENABLE_DEVIATION_ENGINE: true },
    ...overrides,
  }));
  const file = path.join(directory, 'target-configuration.json');
  fs.writeFileSync(file, bytes);
  return { file, bytes };
}

test('--target-config reaches the IQ runner only, and the run names the declaration', t => {
  const { file, bytes } = declaration(t);
  const result = runCli('pass', ['--all', '--target-config', file]);
  assert.equal(result.status, 0, result.output);
  assert.ok(result.output.includes(`RUNNER_OPTIONS ./runners/iq-runner ${JSON.stringify({ targetConfigFile: file })}`), result.output);
  assert.equal((result.output.match(/RUNNER_OPTIONS /g) || []).length, 1, 'no other runner receives runner options');
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.ok(result.output.includes(`Configuration under test: ${file} (validation-target-configuration/1, SHA-256 ${digest.slice(0, 12)})`), result.output);
  assert.doesNotMatch(runCli('pass', ['--iq']).output, /RUNNER_OPTIONS|Configuration under test/, 'no declaration, no options');
});

test('a declaration for another target, off its allowlist or without a live runner is refused before any runner starts', t => {
  for (const [overrides, expected, secret] of [
    [{ target: 'http://localhost:3000' }, /describes target http:\/\/localhost:3000, not the run's --base-url https:\/\/qualification\.invalid/, undefined],
    [{ flags: { SYNTHETIC_SECRET_KEY: true } }, /flags names "SYNTHETIC_SECRET_KEY", which is not on the allowlist/, undefined],
    [{ flags: { TRAINING_SERVICE_URL: 'https://training.invalid/synthetic-secret' } }, /flags\.TRAINING_SERVICE_URL must be set or unset/, 'synthetic-secret'],
    [{ apiToken: 'synthetic-secret' }, /has unknown member apiToken/, 'synthetic-secret'],
  ] as const) {
    const { file } = declaration(t, overrides);
    const result = runCli('pass', ['--iq', '--target-config', file]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, expected);
    assert.doesNotMatch(result.output, /OFFLINE_RUNNER /);
    if (secret) assert.equal(result.output.includes(secret), false, 'a refusal never prints a value the file held');
  }
  const missing = runCli('pass', ['--iq', '--target-config', path.join(temporaryDirectory(t, 'accura-cli-absent-'), 'absent.json')]);
  assert.equal(missing.status, 1, missing.output);
  assert.match(missing.output, /The configuration declaration .*absent\.json cannot be read \(ENOENT\)/);
  const { file } = declaration(t);
  const imported = runCli('pass', ['--benchmark-run', 'offline-fixture', '--target-config', file], null, []);
  assert.equal(imported.status, 1, imported.output);
  assert.match(imported.output, /--target-config declares the configuration of the live runners' target; select a live runner/);
  assert.doesNotMatch(imported.output, /OFFLINE_BENCHMARK/);
  assert.equal(runCli('pass', ['--docs-only', '--all', '--target-config', 'absent.json'], null, []).status, 0, 'a documents run reads no declaration');
  assert.match(runCli('pass', ['--iq', '--target-config']).output, /--target-config requires a path/);
});

test('a retained package keeps the declaration as an input, hands that copy to IQ and records the configuration under test', t => {
  const { file, bytes } = declaration(t);
  const home = markedRoot(t);
  const result = runCli('pass', ['--iq', '--synthetic-qualification', '--target-config', file, '--version', 'cli-config'], undefined, undefined,
    ['--retain-root', home]);
  assert.equal(result.status, 0, result.output);
  const dir = path.join(home, fs.readdirSync(home)[0]);
  const retained = path.join(dir, 'inputs', 'target-configuration.json');
  assert.ok(result.output.includes(`RUNNER_OPTIONS ./runners/iq-runner ${JSON.stringify({ targetConfigFile: retained })}`), result.output);
  assert.deepEqual(fs.readFileSync(retained), bytes);
  const verified = verifyPackage(dir);
  assert.deepEqual(verified.problems, []);
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.deepEqual(verified.manifest!.inputs, [{ role: 'target-configuration', path: 'inputs/target-configuration.json', sha256: digest, originalPath: file }]);
  assert.deepEqual(verified.manifest!.configurationUnderTest,
    { contract: 'validation-target-configuration/1', sha256: digest, flags: { ENABLE_DEVIATION_ENGINE: true }, mismatches: [] });
});
