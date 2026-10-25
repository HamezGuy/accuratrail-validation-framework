import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { verifyPackage, DEVELOPMENT_RUN_NOTICE, MANIFEST_FILE, SYNTHETIC_ROOT_MARKER } from '../runners/evidence-package';
import { NOT_RUN_OF_RECORD_LINE, SCRATCH_FILING_LINE, SYNTHETIC_FILING_LINE, TMF_FILING_FILE } from '../generators/helpers/tmf-filing';
import { frameworkCommit } from '../runners/release-identity';
import { commitCheckout, temporaryCheckout, temporaryDirectory } from './generated-documents';
import { ta3PlanJson } from './ta3-plan-fixture';

const root = path.resolve(__dirname, '..');
const API = 'a'.repeat(40), UI = 'b'.repeat(40), CORE = `sha256:${'c'.repeat(64)}`;
const RELEASE = ['--release-api', API, '--release-ui', UI, '--release-core', CORE];
const LIVE_RUNNER_FLAGS = ['--all', '--iq', '--oq', '--pq', '--security', '--dr', '--perf'];
/** Live-runner scenarios run as development runs unless a test states the retention itself. */
const defaultRetention = (flags: string[]) => !flags.includes('--docs-only') && flags.some(flag => LIVE_RUNNER_FLAGS.includes(flag))
  && !flags.includes('--retain-root') && !flags.includes('--no-retain') ? ['--no-retain'] : [];
/** framework: the flags about the framework checkout; by default --allow-dirty-framework, so a scenario
 * does not depend on this checkout's state. frameworkCheckout: the checkout a package reads instead of this one.
 * outputRoot: where a scratch run creates its folder; by default a temporary directory removed after the run,
 * never this checkout's output/. apiCheckout: the API checkout the contract builds are read in, instead of the
 * workspace's. sharedTypesCheckout: the framework checkout whose shared-types build and install the identity records. */
function runCli(scenario: string, flags = ['--all'], baseUrl: string | null = 'https://qualification.invalid', release = RELEASE,
  retention = defaultRetention(flags),
  { framework = ['--allow-dirty-framework'], frameworkCheckout, outputRoot, apiCheckout, sharedTypesCheckout }: {
    framework?: string[]; frameworkCheckout?: string; outputRoot?: string; apiCheckout?: string; sharedTypesCheckout?: string;
  } = {}) {
  const scratchRoot = outputRoot ?? fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'accura-cli-output-'));
  const env = {
    ...(apiCheckout ? { QUALIFICATION_CLI_TEST_API_CHECKOUT: apiCheckout } : {}),
    ...(sharedTypesCheckout ? { QUALIFICATION_CLI_TEST_SHARED_TYPES_CHECKOUT: sharedTypesCheckout } : {}),
  };
  try { return spawnCli(scenario, flags, baseUrl, release, retention, framework, frameworkCheckout, scratchRoot, env); }
  finally { if (!outputRoot) fs.rmSync(scratchRoot, { recursive: true, force: true }); }
}

function spawnCli(scenario: string, flags: string[], baseUrl: string | null, release: string[], retention: string[], framework: string[],
  frameworkCheckout: string | undefined, outputRoot: string, extraEnv: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [
    '-r', require.resolve('ts-node/register'),
    '-r', path.join(__dirname, 'fixtures', 'qualification-cli-offline.cjs'),
    path.join(root, 'generate.ts'),
    ...flags, ...(baseUrl === null ? [] : ['--base-url', baseUrl]), ...release, ...retention, ...framework,
  ], {
    cwd: root,
    env: {
      ...process.env, QUALIFICATION_CLI_TEST_SCENARIO: scenario, QUALIFICATION_CLI_TEST_TARGET: baseUrl ?? '',
      QUALIFICATION_CLI_TEST_OUTPUT_ROOT: outputRoot,
      ...(frameworkCheckout ? { QUALIFICATION_CLI_TEST_FRAMEWORK_CHECKOUT: frameworkCheckout } : {}),
      ...extraEnv,
    },
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
  // Only the collectors a generator reads are loaded, and the line says loaded, not collected (IR-585).
  assert.match(result.output, /--- Collectors ---\r?\n {2}\[OK\] routes loaded\r?\n {2}\[OK\] sops loaded\r?\n\r?\n/);
  // The regulatory map's verification tables read the retained cases, so it is generated again after the runners.
  assert.match(result.output, /regulatory-requirements-map \(refreshed\)/);
  // The protocols name the target the release identity observed, set only once the runners start (RF-009).
  for (const protocol of ['iq-protocol', 'oq-protocol', 'pq-protocol']) assert.match(result.output, new RegExp(`\\[OK\\] ${protocol} \\(refreshed\\)`));
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

/** The folder a scratch run printed as its output. */
function outputFolder(output: string): string {
  const folder = /^Output: (.+)$/m.exec(output)?.[1]?.trim();
  assert.ok(folder, output);
  return folder;
}

test('every scratch run creates a new folder of its own, so a same-day rerun holds nothing of an earlier run (IR-034)', t => {
  const outputRoot = temporaryDirectory(t, 'accura-cli-scratch-');
  const first = runCli('pass', ['--docs-only', '--version', 'scratch-rerun'], null, [], [], { outputRoot });
  assert.equal(first.status, 0, first.output);
  const firstDir = outputFolder(first.output);
  // An earlier run's cases and category, left in its folder.
  fs.mkdirSync(path.join(firstDir, 'evidence', 'iq'), { recursive: true });
  fs.writeFileSync(path.join(firstDir, 'evidence', 'iq', 'iq-results.json'), '[]\n');
  fs.writeFileSync(path.join(firstDir, 'evidence', 'iq', 'IQ-999.json'), '{}\n');
  const second = runCli('pass', ['--docs-only', '--version', 'scratch-rerun'], null, [], [], { outputRoot });
  assert.equal(second.status, 0, second.output);
  const secondDir = outputFolder(second.output);
  assert.notEqual(secondDir, firstDir);
  const folders = fs.readdirSync(outputRoot).sort();
  assert.deepEqual(folders, [path.basename(firstDir), path.basename(secondDir)].sort());
  for (const folder of folders) assert.match(folder, /^\d{8}T\d{6}Z-scratch-rerun-[0-9a-f]{8}$/);
  assert.equal(path.dirname(secondDir), outputRoot);
  // The offline generators write nothing, so the new folder holds its scratch filing alone.
  assert.deepEqual(fs.readdirSync(secondDir), [TMF_FILING_FILE]);
  assert.ok(fs.existsSync(path.join(firstDir, 'evidence', 'iq', 'IQ-999.json')), 'the earlier run is left as it was');
  // A version label is a segment of the folder name, so one that is not a label is refused.
  const traversal = runCli('pass', ['--docs-only', '--version', '../escape'], null, [], [], { outputRoot });
  assert.equal(traversal.status, 1, traversal.output);
  assert.match(traversal.output, /A run needs a --version of 1 to 64 letters/);
  assert.deepEqual(fs.readdirSync(outputRoot).sort(), folders);
});

test('documents, --no-retain and import scratch hold a scratch TMF-FILING.md that says it is never filed or approved (RF-013)', t => {
  const outputRoot = temporaryDirectory(t, 'accura-cli-filing-');
  const filing = (output: string) => fs.readFileSync(path.join(outputFolder(output), TMF_FILING_FILE), 'utf8');
  const documents = runCli('pass', ['--docs-only'], null, [], [], { outputRoot });
  assert.equal(documents.status, 0, documents.output);
  const plain = filing(documents.output);
  assert.ok(plain.startsWith(`${SCRATCH_FILING_LINE}\n\n# Scratch Output `), plain);
  assert.match(plain, /\| Validation evidence package \| no \|/);
  assert.match(plain, /never filed in the eTMF and never approved/);
  assert.match(plain, /Only a run with --retain-root <directory> makes a validation evidence package/);
  assert.ok(!plain.includes(DEVELOPMENT_RUN_NOTICE), 'plain documents scratch is not a development run');
  const live = runCli('pass', ['--iq'], undefined, undefined, ['--no-retain'], { outputRoot });
  const imported = runCli('pass', ['--benchmark-run', 'offline-fixture'], null, [], [], { outputRoot });
  for (const result of [live, imported]) {
    assert.equal(result.status, 0, result.output);
    const text = filing(result.output);
    assert.ok(text.startsWith(`${SCRATCH_FILING_LINE}\n\n`), text);
    assert.ok(text.includes(DEVELOPMENT_RUN_NOTICE), 'development-run scratch says so in its filing');
    assert.equal(fs.existsSync(path.join(outputFolder(result.output), MANIFEST_FILE)), false);
  }
  assert.equal(fs.readdirSync(outputRoot).length, 3);
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
  // A clean framework checkout, so the filing opens with the synthetic line alone.
  const result = runCli('pass', ['--iq', '--synthetic-qualification', '--version', 'cli-package'], undefined, undefined,
    ['--retain-root', home], { frameworkCheckout: temporaryCheckout(t, 'accura-cli-framework-') });
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
  // A run naming no executor prints none and its manifest records none (IR-090).
  assert.doesNotMatch(result.output, /^Executor: /m);
  assert.equal(manifest.executor, undefined);
});

test('a runner that throws or a SIGINT keeps the cases the runner journaled, records the rest RUN_INTERRUPTED and seals the package (IR-166)', t => {
  for (const [scenario, status] of [['journal-throw', 1], ['interrupt', 130]] as const) {
    const home = markedRoot(t);
    const result = runCli(scenario, ['--iq', '--synthetic-qualification', '--version', `cli-${scenario}`], undefined, undefined,
      ['--retain-root', home], { frameworkCheckout: temporaryCheckout(t, 'accura-cli-framework-') });
    assert.equal(result.status, status, result.output);
    assert.match(result.output, scenario === 'interrupt' ? /\[FAIL\] Run interrupted by SIGINT\./
      : /\[FAIL\] IQ Runner: Synthetic runner stopped after a journaled case/);
    assert.match(result.output, /\[FAIL\] IQ evidence recovered from its case journal \(.*\): 3 records, 1 registry case\(s\) not executed\./);
    const dir = path.join(home, fs.readdirSync(home)[0]);
    const verified = verifyPackage(dir);
    assert.deepEqual(verified.problems, [], scenario);
    const iq = JSON.parse(fs.readFileSync(path.join(dir, 'evidence', 'iq', 'iq-results.json'), 'utf8')) as Array<{ testCaseId: string; outcomeCode?: string; synthetic?: true }>;
    assert.deepEqual(iq.map(row => [row.testCaseId, row.outcomeCode ?? null, row.synthetic]),
      [['IQ-001', null, true], ['IQ-002', 'RUN_INTERRUPTED', true], ['IQ-RUN-INTERRUPTED', 'RUN_INTERRUPTED', true]], scenario);
    assert.equal(fs.existsSync(path.join(dir, 'evidence', 'iq', 'iq-journal.jsonl')), false, scenario);
    assert.equal(verified.manifest!.categories.find(category => category.category === 'iq')?.notExecuted, 2, scenario);
  }
});

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** A synthetic checkout whose package.json installs shared types (with a receipt naming `manifestSha256`)
 * and interop (without one) from vendor/ archives: the files keyed by path (IR-272). */
function contractCheckoutFiles(manifestSha256 = 'e'.repeat(64)): { files: Record<string, string>; sharedTypes: string; interop: string } {
  const sharedTypes = 'vendor/accura-trial-shared-types-0.2.0.6666666666666666.tgz';
  const interop = 'vendor/accura-trial-interop-middleware-0.3.0.6666666666666666.tgz';
  const bytes = 'synthetic shared-types archive for a CLI contract test\n';
  return {
    sharedTypes, interop,
    files: {
      'package.json': JSON.stringify({ dependencies: {
        '@accura-trial/shared-types': `file:${sharedTypes}`, '@accura-trial/interop-middleware': `file:${interop}` } }),
      [sharedTypes]: bytes,
      [`${sharedTypes}.json`]: JSON.stringify({ sha256: sha256(bytes), manifestSha256 }),
      [interop]: 'synthetic interop archive for a CLI contract test\n',
    },
  };
}

test('a live run reads the API contract builds at --release-api in the API checkout and records them in the manifest (IR-272)', t => {
  const home = markedRoot(t);
  const api = temporaryDirectory(t, 'accura-cli-api-');
  const checkout = contractCheckoutFiles();
  commitCheckout(api, checkout.files);
  const commit = frameworkCommit(api).commit!;
  const result = runCli('pass', ['--iq', '--synthetic-qualification', '--version', 'cli-contracts'], undefined,
    ['--release-api', commit, '--release-ui', UI, '--release-core', CORE], ['--retain-root', home],
    { frameworkCheckout: temporaryCheckout(t, 'accura-cli-framework-'), apiCheckout: api });
  assert.equal(result.status, 0, result.output);
  const verified = verifyPackage(path.join(home, fs.readdirSync(home)[0]));
  assert.deepEqual(verified.problems, []);
  const sharedSha = sha256(checkout.files[checkout.sharedTypes]);
  assert.deepEqual(verified.manifest!.releaseUnderTest?.apiContracts, {
    status: 'resolved', commit,
    sharedTypes: { selector: `file:${checkout.sharedTypes}`, archive: checkout.sharedTypes, archiveSha256: sharedSha, receiptSha256: sharedSha },
    interop: { selector: `file:${checkout.interop}`, archive: checkout.interop,
      archiveSha256: sha256(checkout.files[checkout.interop]), receiptSha256: 'no receipt' },
  });
});

test('a live run refuses a shared-types install that is not the build its receipt names, before any runner starts (IR-272)', t => {
  const manifest = '{"synthetic":"release manifest"}\n';
  const framework = temporaryDirectory(t, 'accura-cli-shared-types-');
  commitCheckout(framework, contractCheckoutFiles(sha256(manifest)).files);
  const installed = path.join(framework, 'node_modules', '@accura-trial', 'shared-types');
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, 'release-manifest.json'), '{"synthetic":"another build"}\n');
  const stale = runCli('pass', ['--iq'], undefined, undefined, undefined, { sharedTypesCheckout: framework });
  assert.equal(stale.status, 1, stale.output);
  assert.match(stale.output, /The installed @accura-trial\/shared-types is not the vendored build .*Reinstall with npm install --offline before a live run\./);
  assert.doesNotMatch(stale.output, /OFFLINE_RUNNER /);
  // A documents run names the release without running the validators, so it is not refused.
  assert.equal(runCli('pass', ['--docs-only', '--all'], null, undefined, undefined, { sharedTypesCheckout: framework }).status, 0);
  // Only a stale install is refused: the build the receipt names runs.
  fs.writeFileSync(path.join(installed, 'release-manifest.json'), manifest);
  const current = runCli('pass', ['--iq'], undefined, undefined, undefined, { sharedTypesCheckout: framework });
  assert.equal(current.status, 0, current.output);
  assert.match(current.output, /OFFLINE_RUNNER \.\/runners\/iq-runner/);
});

test('--executor is parsed and recorded in the package manifest with the OS account, and in a development run (IR-090)', t => {
  const home = markedRoot(t);
  const result = runCli('pass', ['--iq', '--synthetic-qualification', '--version', 'cli-executor', '--executor', 'Synthetic Tester'],
    undefined, undefined, ['--retain-root', home], { frameworkCheckout: temporaryCheckout(t, 'accura-cli-framework-') });
  assert.equal(result.status, 0, result.output);
  const account = (() => { try { return os.userInfo().username; } catch { return null; } })();
  assert.ok(result.output.includes(`Executor: Synthetic Tester${account ? ` (OS account ${account})` : ''}; attribution only, nothing is signed`), result.output);
  const [created] = fs.readdirSync(home);
  const verified = verifyPackage(path.join(home, created));
  assert.deepEqual(verified.problems, []);
  assert.deepEqual(verified.manifest?.executor, { name: 'Synthetic Tester', osAccount: account });
  const live = runCli('pass', ['--iq', '--executor', 'Synthetic Tester'], undefined, undefined, ['--no-retain']);
  assert.equal(live.status, 0, live.output);
  assert.match(live.output, /^Executor: Synthetic Tester; attribution only, nothing is signed$/m);
});

test('an empty, padded or missing --executor, or one on a documents run without --retain-root, is refused before any runner starts (IR-090)', t => {
  for (const [value, expected] of [
    ['', /--executor names the person who ran the run: 1 to 200 printable characters, not starting or ending with a space; got ""/],
    [' Synthetic Tester', /--executor names the person who ran the run/],
    ['a'.repeat(201), /--executor names the person who ran the run/],
  ] as const) {
    const refused = runCli('pass', ['--iq', '--executor', value], undefined, undefined, ['--no-retain']);
    assert.equal(refused.status, 1, refused.output);
    assert.match(refused.output, expected);
    assert.doesNotMatch(refused.output, /OFFLINE_RUNNER /);
  }
  // The next argument is a flag, so the name is missing.
  const missing = runCli('pass', ['--iq', '--executor'], undefined, undefined, ['--no-retain']);
  assert.equal(missing.status, 1, missing.output);
  assert.match(missing.output, /--executor requires the name of the person running the CLI/);
  assert.doesNotMatch(missing.output, /OFFLINE_RUNNER /);
  const outputRoot = temporaryDirectory(t, 'accura-cli-executor-docs-');
  const documents = runCli('pass', ['--docs-only', '--executor', 'Synthetic Tester'], null, [], [], { outputRoot });
  assert.equal(documents.status, 1, documents.output);
  assert.match(documents.output, /a documents run without --retain-root records neither/);
  assert.deepEqual(fs.readdirSync(outputRoot), [], 'nothing is created');
});

test('a dirty framework checkout refuses --retain-root before any runner starts, and --allow-dirty-framework marks the package', t => {
  const dirty = temporaryCheckout(t, 'accura-cli-dirty-');
  fs.writeFileSync(path.join(dirty, 'scratch-runner.mjs'), 'an untracked scratch runner\n');
  const home = markedRoot(t);
  const flags = ['--iq', '--synthetic-qualification', '--version', 'cli-dirty'];
  const refused = runCli('pass', flags, undefined, undefined, ['--retain-root', home], { framework: [], frameworkCheckout: dirty });
  assert.equal(refused.status, 1, refused.output);
  assert.match(refused.output, /The framework checkout has uncommitted or untracked files at [0-9a-f]{40}/);
  assert.doesNotMatch(refused.output, /OFFLINE_RUNNER /);
  assert.equal(fs.existsSync(home), false, 'nothing is created');
  // --no-retain keeps its scratch run: only a retained package is refused.
  assert.equal(runCli('pass', ['--iq'], undefined, undefined, ['--no-retain'], { framework: [], frameworkCheckout: dirty }).status, 0);

  const allowed = runCli('pass', flags, undefined, undefined, ['--retain-root', home], { frameworkCheckout: dirty });
  assert.equal(allowed.status, 0, allowed.output);
  assert.ok(allowed.output.includes(`=== Retained Evidence Package ===\n  ${NOT_RUN_OF_RECORD_LINE}\n`), allowed.output);
  const [created] = fs.readdirSync(home);
  const dir = path.join(home, created);
  assert.ok(fs.readFileSync(path.join(dir, TMF_FILING_FILE), 'utf8').startsWith(`${NOT_RUN_OF_RECORD_LINE}\n\n${SYNTHETIC_FILING_LINE}\n`));
  const verify = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register'), path.join(root, 'scripts', 'verify-package.ts'), dir],
    { cwd: root, encoding: 'utf8', timeout: 20_000 });
  assert.equal(verify.status, 0, verify.stdout + verify.stderr);
  assert.ok(verify.stdout.startsWith(`Package verified: ${dir}\n  ${NOT_RUN_OF_RECORD_LINE}\n`), verify.stdout);
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

const TA3_RELEASE = [...RELEASE, '--release-training', 'd'.repeat(40)];
/** A synthetic ta3-oq-plan/1 file in a test's own temporary directory. */
function ta3Plan(t: { after(callback: () => void): void }, overrides: Record<string, unknown> = {}): { file: string; bytes: Buffer } {
  const directory = temporaryDirectory(t, 'accura-cli-ta3-plan-');
  const bytes = Buffer.from(JSON.stringify(ta3PlanJson(overrides)));
  const file = path.join(directory, 'ta3-oq-plan.json');
  fs.writeFileSync(file, bytes);
  return { file, bytes };
}

test('--ta3-oq-plan and --oq-suites reach the OQ runner only, after the plan is checked', t => {
  const { file, bytes } = ta3Plan(t);
  const result = runCli('pass', ['--oq', '--synthetic-qualification', '--ta3-oq-plan', file, '--oq-suites', '13-18'], undefined, TA3_RELEASE);
  assert.equal(result.status, 0, result.output);
  assert.ok(result.output.includes(`RUNNER_OPTIONS ./runners/oq-runner ${JSON.stringify({ ta3PlanFile: file, suites: { base: false, ta3: [13, 14, 15, 16, 17, 18] } })}`), result.output);
  assert.equal((result.output.match(/RUNNER_OPTIONS /g) || []).length, 1, 'the security runner that --oq also selects receives no OQ option');
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.ok(result.output.includes(`TA3 OQ plan: ${file} (ta3-oq-plan/1, study 100, OQ site 101, SHA-256 ${digest.slice(0, 12)})`), result.output);
  const suitesOnly = runCli('pass', ['--oq', '--oq-suites', '1-12']);
  assert.equal(suitesOnly.status, 0, suitesOnly.output);
  assert.ok(suitesOnly.output.includes(`RUNNER_OPTIONS ./runners/oq-runner ${JSON.stringify({ suites: { base: true, ta3: [] } })}`), suitesOnly.output);
  assert.doesNotMatch(runCli('pass', ['--oq']).output, /RUNNER_OPTIONS|TA3 OQ plan/, 'no plan and no selection, no options');
});

test('a TA3 plan without --oq, synthetic qualification or the training release, or one that breaks its contract, is refused before any runner', t => {
  const { file } = ta3Plan(t);
  for (const [flags, release, expected] of [
    [['--iq', '--synthetic-qualification', '--ta3-oq-plan', file], TA3_RELEASE, /--ta3-oq-plan is an option of the OQ runner; select --oq or --all/],
    [['--iq', '--oq-suites', '13'], RELEASE, /--oq-suites is an option of the OQ runner; select --oq or --all/],
    [['--oq', '--ta3-oq-plan', file], TA3_RELEASE, /write owned synthetic records .*; pass --synthetic-qualification/],
    [['--oq', '--synthetic-qualification', '--ta3-oq-plan', file], RELEASE, /OQ suites 13 to 18 require the training release under test: pass --release-training/],
    [['--oq', '--oq-suites', '1-5'], RELEASE, /suites 1 to 12 together or not at all/],
    [['--oq', '--oq-suites'], RELEASE, /--oq-suites requires a list of suites/],
    [['--oq', '--synthetic-qualification', '--ta3-oq-plan'], TA3_RELEASE, /--ta3-oq-plan requires a path/],
  ] as const) {
    const result = runCli('pass', [...flags], undefined, [...release]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, expected);
    assert.doesNotMatch(result.output, /OFFLINE_RUNNER /);
  }
  const accounts = ta3PlanJson().accounts as Record<string, Record<string, string>>;
  const literal = ta3Plan(t, { accounts: { ...accounts, reviewer: { ...accounts.reviewer, password: 'synthetic-literal-secret' } } });
  const refused = runCli('pass', ['--oq', '--synthetic-qualification', '--ta3-oq-plan', literal.file], undefined, TA3_RELEASE);
  assert.equal(refused.status, 1, refused.output);
  assert.match(refused.output, /accounts\.reviewer\.password must be the name of the environment variable that holds it/);
  assert.equal(refused.output.includes('synthetic-literal-secret'), false, 'a refusal never prints a value the plan held');
  assert.doesNotMatch(refused.output, /OFFLINE_RUNNER /);
  assert.equal(runCli('pass', ['--docs-only', '--oq', '--ta3-oq-plan', 'absent.json'], null, []).status, 0, 'a documents run reads no plan');
});

test('a retained package keeps the TA3 plan as an input and hands the OQ runner the retained plan and declaration', t => {
  const { file, bytes } = ta3Plan(t);
  const config = declaration(t);
  const home = markedRoot(t);
  const result = runCli('pass', ['--oq', '--synthetic-qualification', '--ta3-oq-plan', file, '--target-config', config.file, '--version', 'cli-ta3'],
    undefined, TA3_RELEASE, ['--retain-root', home]);
  assert.equal(result.status, 0, result.output);
  const dir = path.join(home, fs.readdirSync(home)[0]);
  const retainedPlan = path.join(dir, 'inputs', 'ta3-oq-plan.json'), retainedConfig = path.join(dir, 'inputs', 'target-configuration.json');
  assert.ok(result.output.includes(`RUNNER_OPTIONS ./runners/oq-runner ${JSON.stringify({ ta3PlanFile: retainedPlan, targetConfigFile: retainedConfig })}`), result.output);
  assert.deepEqual(fs.readFileSync(retainedPlan), bytes);
  const verified = verifyPackage(dir);
  assert.deepEqual(verified.problems, []);
  assert.deepEqual(verified.manifest!.inputs.find(input => input.role === 'ta3-oq-plan'),
    { role: 'ta3-oq-plan', path: 'inputs/ta3-oq-plan.json', sha256: createHash('sha256').update(bytes).digest('hex'), originalPath: file });
});

/** A synthetic platform-validation-evidence-plan/1 citing one Workbench record by its SHA-256. */
function platformPlan(t: { after(callback: () => void): void }, synthetic = false, systems?: Record<string, unknown>): { file: string; bytes: Buffer } {
  const directory = temporaryDirectory(t, 'accura-cli-platform-plan-');
  const record = path.join(directory, 'formal-qualification.json');
  fs.writeFileSync(record, '{"synthetic":true,"record":"formal qualification"}');
  const bytes = Buffer.from(JSON.stringify({
    contract: 'platform-validation-evidence-plan/1', preparedBy: 'CLI contract test (synthetic)',
    systems: systems ?? { workbench: { evidence: [{
      kind: 'bw-formal-qualification/1', path: record, sha256: createHash('sha256').update(fs.readFileSync(record)).digest('hex'), synthetic,
    }] } },
  }));
  const file = path.join(directory, 'platform-evidence-plan.json');
  fs.writeFileSync(file, bytes);
  return { file, bytes };
}

test('--platform-evidence and --platform-root reach the platform summary only, after the plan is checked', t => {
  const { file, bytes } = platformPlan(t);
  const result = runCli('pass', ['--docs-only', '--platform-evidence', file, '--platform-root', 'C:/synthetic-estate'], null, []);
  assert.equal(result.status, 0, result.output);
  assert.ok(result.output.includes(`GENERATOR_OPTIONS ./generators/22-platform-validation-summary ${JSON.stringify({ platformEvidencePlan: file, platformRoot: 'C:/synthetic-estate' })}`), result.output);
  assert.equal((result.output.match(/GENERATOR_OPTIONS /g) || []).length, 1, 'no other generator receives options');
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.ok(result.output.includes(`Platform evidence plan: ${file} (platform-validation-evidence-plan/1, 0 verified, 1 hash-only, 0 mismatch, 0 unreadable, SHA-256 ${digest.slice(0, 12)})`), result.output);
  assert.doesNotMatch(result.output, /Retention:/, 'a documents run citing no synthetic evidence stays plain scratch');
  // With a live runner the summary is generated and refreshed, both times with the plan.
  const live = runCli('pass', ['--iq', '--platform-evidence', file]);
  assert.equal(live.status, 0, live.output);
  assert.equal((live.output.match(/GENERATOR_OPTIONS \.\/generators\/22-platform-validation-summary /g) || []).length, 2, live.output);
  assert.match(live.output, /platform-validation-summary \(refreshed\)/);
  assert.doesNotMatch(runCli('pass', ['--docs-only'], null, []).output, /GENERATOR_OPTIONS|Platform evidence plan/, 'no plan and no root, no options');
});

test('a documents package citing synthetic evidence is synthetic, retains the plan and hands the platform summary the retained copy', t => {
  const { file, bytes } = platformPlan(t, true);
  const home = markedRoot(t);
  const result = runCli('pass', ['--docs-only', '--platform-evidence', file, '--version', 'cli-platform'], null, [], ['--retain-root', home]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /cites synthetic evidence/);
  assert.match(result.output, /Retention: sealed evidence package \(synthetic engineering evidence\)/);
  const dir = path.join(home, fs.readdirSync(home)[0]);
  const retained = path.join(dir, 'inputs', 'platform-evidence-plan.json');
  assert.ok(result.output.includes(`GENERATOR_OPTIONS ./generators/22-platform-validation-summary ${JSON.stringify({ platformEvidencePlan: retained })}`), result.output);
  assert.deepEqual(fs.readFileSync(retained), bytes);
  const verified = verifyPackage(dir);
  assert.deepEqual(verified.problems, []);
  const manifest = verified.manifest!;
  assert.deepEqual([manifest.executed, manifest.synthetic, manifest.syntheticBasis], [false, true, ['platform-evidence-plan']]);
  assert.deepEqual(manifest.inputs, [{ role: 'platform-evidence-plan', path: 'inputs/platform-evidence-plan.json',
    sha256: createHash('sha256').update(bytes).digest('hex'), originalPath: file }]);
  // Without a retain root the same run is scratch that says it is synthetic and not retained.
  const scratch = runCli('pass', ['--docs-only', '--platform-evidence', file], null, []);
  assert.equal(scratch.status, 0, scratch.output);
  assert.ok(scratch.output.includes(`Retention: none. ${DEVELOPMENT_RUN_NOTICE}; nothing from this run is retained.`), scratch.output);
  // A plan citing no synthetic evidence makes a package that is not synthetic, refused inside the marked data root.
  const real = runCli('pass', ['--docs-only', '--platform-evidence', platformPlan(t).file], null, [], ['--retain-root', home]);
  assert.equal(real.status, 1, real.output);
  assert.match(real.output, /A package that is not synthetic is never retained inside the synthetic data root/);
  assert.deepEqual(fs.readdirSync(home), [path.basename(dir)]);
});

test('a platform evidence plan that breaks its contract is refused before any document is generated', t => {
  const unknown = platformPlan(t, false, { 'unknown-system': { evidence: [] } });
  const result = runCli('pass', ['--docs-only', '--platform-evidence', unknown.file], null, []);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /names "unknown-system", which is not a system of the platform inventory/);
  assert.doesNotMatch(result.output, /--- Generators ---/);
  assert.match(runCli('pass', ['--docs-only', '--platform-evidence'], null, []).output, /--platform-evidence requires a path/);
  assert.match(runCli('pass', ['--docs-only', '--platform-root'], null, []).output, /--platform-root requires a directory/);
});
