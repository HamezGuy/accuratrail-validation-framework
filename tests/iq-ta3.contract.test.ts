import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { SYSTEM_INFO } from '../config/system-info';
import { defaultWorkspaceRoot, resolveFrontendRoot, resolveLibreclinicaApiRoot, resolveSharedTypesRoot } from '../collectors/workspace-paths';
import { collectSharedTypes } from '../collectors/shared-types-collector';
import { collectFrontend } from '../collectors/frontend-collector';
import { collectSOPs } from '../collectors/sop-collector';
import {
  checkConfigurationUnderTest, checkDeadSettings, checkSharedTypesInstallation, checkSoftwareInstallation, checkVendoredReceipts,
  declaredMajor, readVendoredArchive, run as runIq,
  IQ_CASE_COUNT, LIVE_PRODUCTION_STATEMENT, PRODUCTION_EXAMPLE, SHARED_TYPES_VERIFIER, type SharedTypesConsumer,
} from '../runners/iq-runner';
import {
  composeServiceEnvironment, configurationMismatches, dotenvEnvironment, effectiveFlagValue, parseTargetConfiguration, sourceFlagValue,
  NODE_ENVIRONMENTS, TARGET_CONFIGURATION_FLAGS, TARGET_CONFIGURATION_FLAG_NAMES, TARGET_CONFIGURATION_REQUIRED,
  TARGET_CONFIGURATION_SOURCE_REQUIRED, type ConfigurationMismatch,
} from '../runners/target-configuration';
import type { EvidenceResult } from '../runners/evidence-capture';
import { generate as generateIqProtocol } from '../generators/07-iq-protocol';
import { generateAllDocuments, temporaryDirectory } from './generated-documents';

// IQ corrections and additions (TA3 plan VAL-1, spec P20 3.9). Every consumer,
// archive and declaration here is synthetic and built in a temporary directory;
// only the EDC's own consumer verifier is read from the sibling libreclinicaapi.

type Context = { after(callback: () => void): void };
const PACKAGE = '@accura-trial/shared-types';
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const sha512 = (bytes: Buffer) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const verifier = path.join(resolveLibreclinicaApiRoot(defaultWorkspaceRoot()), SHARED_TYPES_VERIFIER);

function write(file: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const writeJson = (file: string, value: unknown) => write(file, `${JSON.stringify(value, null, 2)}\n`);

/** A minimal synthetic consumer of a synthetic shared types build: the vendored archive
 * and its receipt, the package.json and lockfile pins, and the installed package with
 * its release-manifest.json and one runtime file. Every hash is computed here. */
function syntheticConsumer(root: string, build: string): { archive: string; runtime: string; lockfile: string } {
  const archiveBytes = Buffer.from(`SYNTHETIC shared types archive, build ${build}; not a real package.\n`);
  const filename = `accura-trial-shared-types-0.2.0.${sha256(archiveBytes).slice(0, 16)}.tgz`;
  const runtimeBytes = Buffer.from(`// SYNTHETIC runtime file of build ${build}\nmodule.exports = {};\n`);
  const runtimeFiles = [{ path: 'dist/index.js', byteLength: runtimeBytes.length, sha256: sha256(runtimeBytes) }];
  const sourceFiles = [{ path: 'src/index.ts', byteLength: 9, sha256: sha256('synthetic') }];
  const manifestBytes = Buffer.from(JSON.stringify({
    contract: 'edc-study-contract-release/1', packageName: PACKAGE, version: '0.2.0',
    sourceTreeSha256: sha256(JSON.stringify(sourceFiles)), sourceFiles,
    runtimeTreeSha256: sha256(JSON.stringify(runtimeFiles)), runtimeFiles,
  }, null, 2));
  const selector = `file:vendor/${filename}`;
  write(path.join(root, 'vendor', filename), archiveBytes);
  writeJson(path.join(root, 'vendor', `${filename}.json`), {
    contract: 'edc-study-contract-package/1', packageName: PACKAGE, version: '0.2.0', filename,
    byteLength: archiveBytes.length, sha256: sha256(archiveBytes), integrity: sha512(archiveBytes),
    sourceTreeSha256: sha256(JSON.stringify(sourceFiles)), runtimeTreeSha256: sha256(JSON.stringify(runtimeFiles)),
    manifestSha256: sha256(manifestBytes),
  });
  writeJson(path.join(root, 'package.json'), { name: `synthetic-consumer-${build}`, version: '0.0.0', dependencies: { [PACKAGE]: selector } });
  writeJson(path.join(root, 'package-lock.json'), {
    name: `synthetic-consumer-${build}`, lockfileVersion: 3,
    packages: {
      '': { dependencies: { [PACKAGE]: selector } },
      [`node_modules/${PACKAGE}`]: { version: '0.2.0', resolved: selector, integrity: sha512(archiveBytes) },
    },
  });
  const installed = path.join(root, 'node_modules', ...PACKAGE.split('/'));
  writeJson(path.join(installed, 'package.json'), { name: PACKAGE, version: '0.2.0' });
  write(path.join(installed, 'release-manifest.json'), manifestBytes);
  write(path.join(installed, 'dist', 'index.js'), runtimeBytes);
  return { archive: path.join(root, 'vendor', filename), runtime: path.join(installed, 'dist', 'index.js'), lockfile: path.join(root, 'package-lock.json') };
}

function flipLastByte(file: string): void {
  const bytes = fs.readFileSync(file);
  bytes[bytes.length - 1] ^= 0x01;
  fs.writeFileSync(file, bytes);
}

/** Every string in a record, so a test can show which paths a check read. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

const byId = (results: EvidenceResult[], id: string) => {
  const result = results.find(entry => entry.testCaseId === id);
  assert.ok(result, `${id} is recorded`);
  return result;
};

/** Two consumers on the same synthetic build, plus a third on another build. */
function consumers(t: Context): { base: string; list: SharedTypesConsumer[]; api: ReturnType<typeof syntheticConsumer> } {
  const base = temporaryDirectory(t, 'accura-iq-consumers-');
  const api = syntheticConsumer(path.join(base, 'api'), 'synthetic-a');
  syntheticConsumer(path.join(base, 'framework'), 'synthetic-a');
  syntheticConsumer(path.join(base, 'ui'), 'synthetic-b');
  return {
    base, api,
    list: [
      { name: 'api', root: path.join(base, 'api') },
      { name: 'ui', root: path.join(base, 'ui') },
      { name: 'validation-framework', root: path.join(base, 'framework') },
    ],
  };
}

const SAME_BUILD = { consumer: 'validation-framework', reference: 'api' };

test('IQ-008 verifies synthetic consumers with the EDC\'s own verifier and records different builds without failing', t => {
  assert.ok(fs.existsSync(verifier), `IQ-008 needs the EDC verifier ${verifier}, which is missing`);
  const { list } = consumers(t);
  const result = checkSharedTypesInstallation(verifier, list, SAME_BUILD);
  assert.equal(result.passed, true, result.notes);
  assert.equal(result.testCaseId, 'IQ-008');
  const body = result.responseBody as { consumers: Array<{ name: string; verified: boolean; build: string; runtimeFilesVerified: number }> };
  assert.deepEqual(body.consumers.map(entry => [entry.name, entry.verified, entry.runtimeFilesVerified]),
    [['api', true, 1], ['ui', true, 1], ['validation-framework', true, 1]]);
  const builds = new Set(body.consumers.map(entry => entry.build));
  assert.equal(builds.size, 2, 'the ui consumer runs another build and is recorded, not failed');
  assert.match(result.notes, /different builds per consumer are recorded, not failed/);
});

test('IQ-008 fails naming the file for a changed archive byte, a changed installed runtime byte and a lock integrity mismatch', t => {
  for (const [label, mutate, expected] of [
    ['archive', (api: ReturnType<typeof syntheticConsumer>) => flipLastByte(api.archive), (api: ReturnType<typeof syntheticConsumer>) => [
      /api: Vendored package bytes mismatch: api/, api.archive]],
    ['runtime file', (api: ReturnType<typeof syntheticConsumer>) => flipLastByte(api.runtime), () => [
      /api: Installed runtime differs from release: api\/dist\/index\.js/]],
    ['lock integrity', (api: ReturnType<typeof syntheticConsumer>) => {
      const lock = JSON.parse(fs.readFileSync(api.lockfile, 'utf8'));
      lock.packages[`node_modules/${PACKAGE}`].integrity = sha512(Buffer.from('another synthetic archive'));
      writeJson(api.lockfile, lock);
    }, (api: ReturnType<typeof syntheticConsumer>) => [/api: Package\/lock release mismatch: api/, api.lockfile]],
  ] as const) {
    const { list, api } = consumers(t);
    mutate(api);
    const result = checkSharedTypesInstallation(verifier, list, SAME_BUILD);
    assert.equal(result.passed, false, label);
    for (const pattern of expected(api)) {
      if (typeof pattern === 'string') assert.ok(result.notes.includes(pattern), `${label}: ${result.notes} names ${pattern}`);
      else assert.match(result.notes, pattern, label);
    }
    assert.doesNotMatch(result.notes, /\b(?:ui|validation-framework): /, `${label}: only the changed consumer fails`);
  }
});

test('IQ-008 fails when the framework does not run the API\'s build, and when the verifier is missing', t => {
  const { base, list } = consumers(t);
  const elsewhere = path.join(base, 'framework-b');
  syntheticConsumer(elsewhere, 'synthetic-b');
  const mismatched = checkSharedTypesInstallation(verifier,
    list.map(entry => entry.name === 'validation-framework' ? { ...entry, root: elsewhere } : entry), SAME_BUILD);
  assert.equal(mismatched.passed, false);
  assert.match(mismatched.notes, /the validation-framework archive \([0-9a-f]{64}\) is not the build of the api receipt \([0-9a-f]{64}\)/);
  const missing = path.join(base, 'no-edc', SHARED_TYPES_VERIFIER);
  const unverified = checkSharedTypesInstallation(missing, list, SAME_BUILD);
  assert.equal(unverified.passed, false);
  assert.ok(unverified.notes.includes(`the EDC verifier ${missing} is missing`), unverified.notes);
  const noReceipt = path.join(base, 'framework');
  fs.rmSync(`${readVendoredArchive(noReceipt, PACKAGE, JSON.parse(fs.readFileSync(path.join(noReceipt, 'package.json'), 'utf8')).dependencies[PACKAGE]).archive}.json`);
  const withoutReceipt = checkSharedTypesInstallation(verifier, list, SAME_BUILD);
  assert.equal(withoutReceipt.passed, false);
  assert.match(withoutReceipt.notes, /validation-framework: no receipt .*\.tgz\.json/);
});

test('IQ-005 compares the frontend Angular major with the system description, and the old folder names are never read', t => {
  const workspace = temporaryDirectory(t, 'accura-iq-workspace-');
  const api = path.join(workspace, 'libreclinicaapi');
  writeJson(path.join(api, 'package.json'), { name: 'synthetic-api', version: '0.0.1', devDependencies: { typescript: '^5.6.3' } });
  // Decoys in the retired layout that would pass both checks if they were read.
  writeJson(path.join(workspace, 'ElectronicDataCaptureReal', 'package.json'),
    { dependencies: { '@angular/core': `^${SYSTEM_INFO.architecture.frontend.version}.0.0` }, devDependencies: { typescript: '~5.9.3' } });
  writeJson(path.join(workspace, 'shared-types', 'package.json'), { devDependencies: { typescript: '^5.4.0' } });
  write(path.join(workspace, 'shared-types', 'dist', 'index.js'), '// decoy\n');
  const frontend = path.join(workspace, 'EDCProjectCompliant', 'package.json');
  writeJson(frontend, { dependencies: { '@angular/core': '^19.2.14' }, devDependencies: { typescript: '~4.9.5' } });
  assert.equal(resolveFrontendRoot(workspace), path.join(workspace, 'EDCProjectCompliant'));

  const results = checkSoftwareInstallation(workspace, api);
  const angular = byId(results, 'IQ-005');
  assert.equal(angular.passed, false);
  assert.match(angular.notes, new RegExp(`@angular/core="\\^19\\.2\\.14"; the system description states Angular ${SYSTEM_INFO.architecture.frontend.version}`));
  assert.equal((angular.responseBody as { path: string }).path, frontend);
  const typescript = byId(results, 'IQ-006');
  assert.equal(typescript.passed, false);
  assert.ok(typescript.notes.includes(`${frontend}: typescript="~4.9.5"`), typescript.notes);
  for (const retired of [path.join(workspace, 'ElectronicDataCaptureReal'), path.join(workspace, 'shared-types')]) {
    for (const result of results) {
      assert.ok(!strings(result).some(text => text.includes(retired)), `${result.testCaseId} never reads ${retired}`);
    }
  }

  writeJson(frontend, { dependencies: { '@angular/core': `^${SYSTEM_INFO.architecture.frontend.version}.3.27` }, devDependencies: { typescript: '~5.9.3' } });
  const corrected = checkSoftwareInstallation(workspace, api);
  assert.equal(byId(corrected, 'IQ-005').passed, true, byId(corrected, 'IQ-005').notes);
  assert.equal(byId(corrected, 'IQ-006').passed, true, byId(corrected, 'IQ-006').notes);
  assert.match(byId(corrected, 'IQ-008').notes, /the EDC verifier .*verify-study-contract-consumers\.cjs is missing/,
    'IQ-008 fails naming the verifier this synthetic API lacks');
});

test('a declared major is read from the range forms package.json uses', () => {
  for (const [range, major] of [['^20.3.27', 20], ['~5.9.3', 5], ['20.1.0', 20], ['20.x', 20], ['>=20 <21', 20], ['v19.0.0', 19], ['20', 20]] as const) {
    assert.equal(declaredMajor(range), major, range);
  }
  for (const range of ['', 'latest', 'workspace:*', 'file:vendor/x.tgz', '*']) assert.equal(declaredMajor(range), undefined, range);
});

test('the collectors read the installed shared types build and the frontend checkout, never the retired folders', t => {
  const workspace = temporaryDirectory(t, 'accura-iq-collectors-');
  const installed = path.join(workspace, 'libreclinicaapi', 'node_modules', ...PACKAGE.split('/'));
  write(path.join(installed, 'dist', 'alpha.types.d.ts'),
    'export interface Alpha {\n  id: string;\n}\nexport type Beta = \'b\';\nexport declare enum Gamma {\n  G = 0\n}\nexport declare const DELTA: string;\n');
  write(path.join(installed, 'dist', 'unlisted.d.ts'), 'export interface Unlisted {}\n');
  writeJson(path.join(installed, 'release-manifest.json'), { runtimeFiles: [
    { path: 'dist/alpha.types.d.ts' }, { path: 'dist/alpha.types.js' }, { path: 'dist/nested/deep.d.ts' },
  ] });
  write(path.join(workspace, 'shared-types', 'src', 'decoy.ts'), 'export interface Decoy {}\n');
  write(path.join(workspace, 'EDCProjectCompliant', 'src', 'app', 'services', 'study.service.ts'),
    'export class StudyService {\n  loadStudies(): void {}\n}\n');
  write(path.join(workspace, 'ElectronicDataCaptureReal', 'src', 'app', 'services', 'decoy.service.ts'), 'export class DecoyService {}\n');
  write(path.join(workspace, 'EDCProjectCompliant', 'SOPs_For_Email', 'SOP-015_User_Management.md'), '# SOP-015 User Management\n');
  write(path.join(workspace, 'ElectronicDataCaptureReal', 'SOPs_For_Email', 'SOP-099_Decoy.md'), '# SOP-099 Decoy\n');

  assert.deepEqual(collectSharedTypes(workspace).map(entry => [entry.file, entry.kind, entry.name]), [
    ['dist/alpha.types.d.ts', 'interface', 'Alpha'], ['dist/alpha.types.d.ts', 'type', 'Beta'], ['dist/alpha.types.d.ts', 'enum', 'Gamma'],
  ]);
  assert.deepEqual(collectFrontend(workspace).services.map(entry => entry.className), ['StudyService']);
  assert.deepEqual(collectSOPs(workspace).map(entry => entry.file), ['EDCProjectCompliant/SOPs_For_Email/SOP-015_User_Management.md']);
  assert.equal(resolveSharedTypesRoot(workspace), path.join(workspace, 'shared-types'));
});

test('the IQ protocol and the other documents state the corrected checks and no retired layout', t => {
  const documents = generateAllDocuments(temporaryDirectory(t, 'accura-iq-documents-'));
  const major = SYSTEM_INFO.architecture.frontend.version;
  for (const [name, content] of documents) {
    assert.doesNotMatch(content, /ElectronicDataCaptureReal|compiled and symlinked|shared-types\/dist/, name);
    for (const match of content.matchAll(/Angular (\d+)/g)) assert.equal(match[1], major, `${name} names Angular ${match[1]}`);
  }
  const iq = documents.get('07-iq-protocol.md')!;
  assert.match(iq, /### IQ-005: Angular version matches the system description\n/);
  assert.ok(iq.includes(`Verify its major version is ${major}, the frontend version in config/system-info.ts.`));
  assert.match(iq, /### IQ-006: TypeScript version matches the system description\n/);
  assert.match(iq, /### IQ-008: Shared types installed from the vendored release\n/);
  assert.ok(iq.includes('verifyPinnedStudyContract'));
  const installation = iq.slice(iq.indexOf('### IQ-001:'), iq.indexOf('### IQ-009:'));
  for (const fact of [SYSTEM_INFO.environments.production.apiUrl, SYSTEM_INFO.environments.production.frontendUrl]) {
    assert.equal(installation.includes(fact), false, `the installation cases name the target, not ${fact}`);
  }
});

// ---------------------------------------------------------------------------
// IQ-033: the configuration under test
// ---------------------------------------------------------------------------

const TARGET = 'http://127.0.0.1:3000';
const COMPOSE = [
  'name: synthetic-stack',
  'services:',
  '  edc-db:',
  '    environment:',
  '      ENABLE_DEVIATION_ENGINE: "false"   # another service: never read',
  '  core-api:',
  '    image: synthetic-core-api',
  '    environment:',
  '      # A synthetic test stack.',
  '      NODE_ENV: development',
  '      ENABLE_DEVIATION_ENGINE: "true"',
  '      ENABLE_M2M_API_KEYS: \'true\' # quoted with a comment',
  '      ENABLE_DEVIATION_DECISIONS: ${SYNTHETIC_DECISIONS:-false}',
  '      TRAINING_SERVICE_URL: http://127.0.0.1:3002/',
  '      JWT_SECRET: ${SYNTHETIC_JWT:?set it}',
  '    healthcheck:',
  '      test: ["CMD", "true"]',
  'volumes:',
  '  data:',
  '',
].join('\n');
const PRODUCTION = ['NODE_ENV=production', '# ENABLE_DEVIATION_ENGINE=true is a comment, not a setting', 'ENABLE_DOMAIN_EVENTS=false',
  'ENABLE_M2M_API_KEYS=true', ''].join('\n');

/** A synthetic workspace (the API's production example) and a declaration whose source is a compose file. */
function configuration(t: Context, flags: Record<string, unknown>, options: { compose?: string; source?: string; target?: string } = {}) {
  const workspace = temporaryDirectory(t, 'accura-iq-configuration-');
  const apiRoot = path.join(workspace, 'libreclinicaapi');
  write(path.join(apiRoot, PRODUCTION_EXAMPLE), PRODUCTION);
  const compose = path.join(workspace, 'stack', 'compose.yaml');
  write(compose, options.compose ?? COMPOSE);
  const file = path.join(workspace, 'target-configuration.json');
  writeJson(file, {
    contract: 'validation-target-configuration/1', target: options.target ?? TARGET,
    source: { path: options.source ?? compose, sha256: sha256(fs.readFileSync(compose)) },
    declaredBy: 'IQ contract test (synthetic)', declaredAt: '2026-10-24T00:00:00Z', flags,
  });
  return { workspace, apiRoot, compose, file };
}

const DECLARED = { NODE_ENV: 'development', ENABLE_DEVIATION_ENGINE: true, ENABLE_M2M_API_KEYS: true, ENABLE_DEVIATION_DECISIONS: true,
  TRAINING_SERVICE_URL: 'set', ENABLE_STUDY_TASK_CRON: true, ENABLE_DOMAIN_EVENTS: false };

test('IQ-033 without a declaration is not executed: NO_TARGET_CONFIGURATION', t => {
  const workspace = temporaryDirectory(t, 'accura-iq-no-configuration-');
  const result = checkConfigurationUnderTest(undefined, TARGET, path.join(workspace, 'libreclinicaapi'));
  assert.deepEqual([result.testCaseId, result.method, result.passed, result.outcomeCode], ['IQ-033', 'CONTRACT', false, 'NO_TARGET_CONFIGURATION']);
  assert.match(result.notes, /No --target-config declaration \(validation-target-configuration\/1\) was given/);
});

test('IQ-033 verifies the source hash, cross-checks the core-api environment and states the production delta', t => {
  const { apiRoot, compose, file } = configuration(t, DECLARED);
  const result = checkConfigurationUnderTest(file, `${TARGET}/`, apiRoot);
  assert.equal(result.passed, true, result.notes);
  const body = result.responseBody as {
    sha256: string; source: { verified: boolean; crossCheck: string; mismatches: ConfigurationMismatch[]; undetermined: string[] };
    productionExample: { delta: Array<{ flag: string; declared: unknown; productionExample: unknown; setIn: string }> }; liveProduction: string;
  };
  assert.equal(body.sha256, sha256(fs.readFileSync(file)));
  assert.deepEqual([body.source.verified, body.source.crossCheck, body.source.mismatches], [true, 'the core-api service environment', []]);
  // The interpolated decision flag is set where the stack starts, so it is undetermined, not failed.
  assert.deepEqual(body.source.undetermined, ['ENABLE_DEVIATION_DECISIONS']);
  assert.deepEqual(body.productionExample.delta, [
    { flag: 'NODE_ENV', declared: 'development', productionExample: 'production', setIn: 'line 1' },
    { flag: 'ENABLE_DEVIATION_ENGINE', declared: true, productionExample: false, setIn: 'not set, so the code default' },
    { flag: 'ENABLE_DEVIATION_DECISIONS', declared: true, productionExample: false, setIn: 'not set, so the code default' },
    { flag: 'TRAINING_SERVICE_URL', declared: 'set', productionExample: 'unset', setIn: 'not set, so the code default' },
  ]);
  assert.equal(body.liveProduction, LIVE_PRODUCTION_STATEMENT);
  assert.ok(result.notes.includes(LIVE_PRODUCTION_STATEMENT));
  assert.ok(result.notes.includes(`source ${compose} has the declared SHA-256 and was cross-checked against the core-api service environment: 0 mismatch(es)`));
});

test('IQ-033 fails on a source that contradicts the declaration, a changed source and another target, and passes an absent source', t => {
  const contradicted = configuration(t, { ...DECLARED, ENABLE_DOMAIN_EVENTS: true, NODE_ENV: 'test' });
  const result = checkConfigurationUnderTest(contradicted.file, TARGET, contradicted.apiRoot);
  assert.equal(result.passed, false);
  const mismatches = (result.responseBody as { source: { mismatches: ConfigurationMismatch[] } }).source.mismatches;
  assert.deepEqual(mismatches, [
    { flag: 'NODE_ENV', declared: 'test', observed: 'development', observedBy: 'IQ-033' },
    { flag: 'ENABLE_DOMAIN_EVENTS', declared: true, observed: false, observedBy: 'IQ-033' },
  ]);
  assert.match(result.notes, /the source sets ENABLE_DOMAIN_EVENTS to false where the declaration states true/);
  // The sealed package carries the same contradictions, observed by IQ-033.
  const declared = parseTargetConfiguration(JSON.parse(fs.readFileSync(contradicted.file, 'utf8'))).flags;
  assert.deepEqual(configurationMismatches(declared, { iq: [result], oq: [] }), mismatches);

  const changed = configuration(t, DECLARED);
  fs.appendFileSync(changed.compose, '# edited after the declaration\n');
  const edited = checkConfigurationUnderTest(changed.file, TARGET, changed.apiRoot);
  assert.equal(edited.passed, false);
  assert.match(edited.notes, /does not match its declared SHA-256, so it is not the declared source/);

  const elsewhere = configuration(t, DECLARED, { target: 'http://127.0.0.1:3999' });
  assert.match(checkConfigurationUnderTest(elsewhere.file, TARGET, elsewhere.apiRoot).notes,
    /the declaration describes target http:\/\/127\.0\.0\.1:3999, not the run's target http:\/\/127\.0\.0\.1:3000/);

  const absent = configuration(t, DECLARED, { source: path.join(path.parse(process.cwd()).root, 'no-such-dir', 'compose.yaml') });
  const unseen = checkConfigurationUnderTest(absent.file, TARGET, absent.apiRoot);
  assert.equal(unseen.passed, true, unseen.notes);
  assert.match(unseen.notes, /compose\.yaml is not present here, so its hash is not verified/);

  const noExample = configuration(t, DECLARED);
  fs.rmSync(path.join(noExample.apiRoot, PRODUCTION_EXAMPLE));
  assert.match(checkConfigurationUnderTest(noExample.file, TARGET, noExample.apiRoot).notes, /\.env\.production\.example is not found, so no production delta is stated/);
});

test('the environment readers follow compose map and list forms, env files and the EDC\'s reading of each flag', () => {
  const map = composeServiceEnvironment(COMPOSE, 'core-api')!;
  assert.equal(map.complete, true);
  assert.deepEqual([...map.entries].map(([key, entry]) => [key, entry.value, entry.line]), [
    ['NODE_ENV', 'development', 10], ['ENABLE_DEVIATION_ENGINE', 'true', 11], ['ENABLE_M2M_API_KEYS', 'true', 12],
    ['ENABLE_DEVIATION_DECISIONS', undefined, 13], ['TRAINING_SERVICE_URL', 'http://127.0.0.1:3002/', 14], ['JWT_SECRET', undefined, 15],
  ]);
  assert.equal(composeServiceEnvironment(COMPOSE, 'training'), undefined);
  const list = composeServiceEnvironment(['services:', '  core-api:', '    env_file: [.env]', '    environment:',
    '      - ENABLE_DEVIATION_ENGINE=true', '      - "ENABLE_DOMAIN_EVENTS=false"', '      - TRAINING_SERVICE_URL', ''].join('\n'), 'core-api')!;
  assert.equal(list.complete, false, 'env_file may set what the environment leaves out');
  assert.deepEqual([...list.entries].map(([key, entry]) => [key, entry.value]),
    [['ENABLE_DEVIATION_ENGINE', 'true'], ['ENABLE_DOMAIN_EVENTS', 'false'], ['TRAINING_SERVICE_URL', undefined]]);
  assert.equal(sourceFlagValue(list, 'ESIG_ACKNOWLEDGEMENT_ENFORCED'), undefined, 'absent from an incomplete environment: undetermined');
  assert.equal(sourceFlagValue(map, 'ESIG_ACKNOWLEDGEMENT_ENFORCED'), false, 'absent from a complete environment: the code default');
  const merged = composeServiceEnvironment(['services:', '  core-api:', '    environment:', '      <<: *common', '      NODE_ENV: test', ''].join('\n'), 'core-api')!;
  assert.equal(merged.complete, false);
  const env = dotenvEnvironment(['export NODE_ENV=production', 'ENABLE_DATA_CLEANING= "true" # quoted', 'TRAINING_SERVICE_URL=',
    'PROTOCOL_SOURCE_URL=${CONTROL}/il', '#ENABLE_DEVIATION_ENGINE=true', ''].join('\r\n'));
  assert.deepEqual([...env.entries].map(([key, entry]) => [key, entry.value, entry.line]),
    [['NODE_ENV', 'production', 1], ['ENABLE_DATA_CLEANING', 'true', 2], ['TRAINING_SERVICE_URL', '', 3], ['PROTOCOL_SOURCE_URL', undefined, 4]]);
  assert.equal(sourceFlagValue(env, 'TRAINING_SERVICE_URL'), 'unset');
  for (const [flag, raw, value] of [
    ['ENABLE_DEVIATION_ENGINE', undefined, false], ['ENABLE_DEVIATION_ENGINE', 'TRUE', false], ['ENABLE_DEVIATION_ENGINE', 'true', true],
    ['ENABLE_STUDY_TASK_CRON', undefined, true], ['ENABLE_STUDY_TASK_CRON', 'TRUE', true], ['ENABLE_STUDY_TASK_CRON', 'false', false],
    ['ENABLE_DATA_CLEANING', undefined, true], ['ENABLE_DATA_CLEANING', '', false], ['ENABLE_DATA_CLEANING', 'true', true],
    ['NODE_ENV', 'production', 'production'], ['NODE_ENV', 'qa', undefined], ['NODE_ENV', undefined, undefined],
    ['TRAINING_SERVICE_URL', 'https://training.invalid', 'set'], ['TRAINING_SERVICE_URL', undefined, 'unset'],
  ] as const) {
    assert.equal(effectiveFlagValue(flag, raw), value, `${flag}=${String(raw)}`);
  }
});

test('the declaration schema requires exactly what the validator requires and allows only the allowlisted flags', () => {
  const contracts = path.resolve(__dirname, '..', 'contracts');
  const schema = JSON.parse(fs.readFileSync(path.join(contracts, 'validation-target-configuration-v1.schema.json'), 'utf8'));
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(schema.title, 'validation-target-configuration/1');
  assert.deepEqual(schema.required, [...TARGET_CONFIGURATION_REQUIRED]);
  assert.deepEqual(Object.keys(schema.properties).sort(), [...TARGET_CONFIGURATION_REQUIRED].sort());
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.definitions.source.required, [...TARGET_CONFIGURATION_SOURCE_REQUIRED]);
  const flags = schema.definitions.flags;
  assert.deepEqual([flags.additionalProperties, flags.minProperties], [false, 1]);
  assert.deepEqual(Object.keys(flags.properties), TARGET_CONFIGURATION_FLAG_NAMES);
  for (const name of TARGET_CONFIGURATION_FLAG_NAMES) {
    const kind = TARGET_CONFIGURATION_FLAGS[name].kind;
    assert.deepEqual(flags.properties[name], kind === 'boolean' ? { type: 'boolean' }
      : { enum: kind === 'node-env' ? [...NODE_ENVIRONMENTS] : ['set', 'unset'] }, name);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(contracts, 'validation-evidence-package-v1.schema.json'), 'utf8'));
  assert.equal(manifest.definitions.configurationUnderTest.properties.flags.$ref, `${schema.$id}#/definitions/flags`);
  assert.deepEqual(manifest.definitions.mismatch.properties.flag.enum, TARGET_CONFIGURATION_FLAG_NAMES);
  assert.deepEqual(manifest.definitions.flagValue.oneOf[1].enum, [...NODE_ENVIRONMENTS, 'set', 'unset']);
});

test('the IQ runner records exactly the protocol\'s cases, IQ-033 with the declaration it was given', async t => {
  const server = http.createServer((request, response) => {
    const authenticated = request.url === '/health';
    response.writeHead(authenticated ? 200 : 401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(authenticated ? { status: 'ok', version: '0.0.0-synthetic' } : { success: false }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { workspace, file } = configuration(t, { ENABLE_DEVIATION_ENGINE: true }, { target: baseUrl });
  const output = temporaryDirectory(t, 'accura-iq-run-');
  const results = await runIq(output, baseUrl, workspace, [], { targetConfigFile: file });
  const expected = Array.from({ length: IQ_CASE_COUNT }, (_, index) => `IQ-${String(index + 1).padStart(3, '0')}`);
  assert.deepEqual(results.map(result => result.testCaseId), expected);
  assert.deepEqual([byId(results, 'IQ-001').passed, byId(results, 'IQ-002').passed, byId(results, 'IQ-031').passed], [true, true, true]);
  assert.equal((byId(results, 'IQ-033').responseBody as { path: string }).path, file);
  assert.ok(fs.existsSync(path.join(output, 'evidence', 'iq', 'IQ-033.json')));
  generateIqProtocol(output, output);
  const protocol = fs.readFileSync(path.join(output, '07-iq-protocol.md'), 'utf8');
  assert.deepEqual([...protocol.matchAll(/^### (IQ-\d{3}):/gm)].map(match => match[1]), expected);
  assert.ok(protocol.includes(`**Total test cases:** ${IQ_CASE_COUNT}`));
});

// ---------------------------------------------------------------------------
// IQ-034 dead or misnamed settings, IQ-035 vendored package receipts
// ---------------------------------------------------------------------------

test('IQ-034 lists every production setting with no reader in EDC src, where it is set, and the name read instead', t => {
  const workspace = temporaryDirectory(t, 'accura-iq-settings-');
  const api = path.join(workspace, 'libreclinicaapi');
  const ui = path.join(workspace, 'EDCProjectCompliant');
  write(path.join(api, PRODUCTION_EXAMPLE), ['# synthetic production example', 'NODE_ENV=production', 'STRICT_VALIDATION_RULE_SIGNATURES=true',
    'BACKUP_ENABLED=true', 'AWS_ACCESS_KEY_ID=', 'READ_BY_HELPER=5', 'READ_BY_PARAMETER=on', 'READ_IN_TEST_ONLY=1', ''].join('\n'));
  write(path.join(api, 'src', 'config', 'environment.ts'),
    'export const mode = process.env.NODE_ENV;\nexport const backups = process.env[\'BACKUP_SCHEDULER_ENABLED\'];\n'
    + '// STRICT_VALIDATION_RULE_SIGNATURES is named in a comment only.\n');
  write(path.join(api, 'src', 'config', 'guards.ts'), 'export function guard(env = process.env) { return env.READ_BY_PARAMETER; }\n');
  write(path.join(api, 'src', 'services', 'queue.ts'), 'declare function numberSetting(name: string): number;\nexport const limit = numberSetting(\'READ_BY_HELPER\');\n');
  write(path.join(api, 'src', 'services', 'queue.test.ts'), 'process.env.READ_IN_TEST_ONLY;\n');
  write(path.join(api, 'src', '__tests__', 'fixture.ts'), 'process.env.READ_IN_TEST_ONLY;\n');
  const compose = path.join(ui, 'docker-compose.production.yml');
  write(compose, ['services:', '  db:', '    environment:', '      ORPHAN_IN_ANOTHER_SERVICE: "x"', '  core-api:', '    environment:',
    '      NODE_ENV: production', '      DISABLE_SOAP: "false"', '      TZ: UTC', ''].join('\n'));

  const result = checkDeadSettings(api, ui, workspace);
  assert.equal(result.passed, false);
  const body = result.responseBody as { srcFilesScanned: number; deadKeys: Array<{ key: string; setIn: string[]; readUnder?: string }> };
  assert.equal(body.srcFilesScanned, 3, 'test files are not readers');
  assert.deepEqual(body.deadKeys, [
    { key: 'STRICT_VALIDATION_RULE_SIGNATURES', setIn: ['libreclinicaapi/.env.production.example:3'] },
    { key: 'BACKUP_ENABLED', setIn: ['libreclinicaapi/.env.production.example:4'], readUnder: 'BACKUP_SCHEDULER_ENABLED' },
    { key: 'READ_IN_TEST_ONLY', setIn: ['libreclinicaapi/.env.production.example:8'] },
    { key: 'DISABLE_SOAP', setIn: ['EDCProjectCompliant/docker-compose.production.yml:8'] },
  ]);
  assert.match(result.notes, /4 of 9 settings set in the production example and the production compose file have no reader in libreclinicaapi\/src/);
  assert.match(result.notes, /BACKUP_ENABLED \(libreclinicaapi\/\.env\.production\.example:4; the code reads BACKUP_SCHEDULER_ENABLED\)/);

  write(path.join(api, 'src', 'config', 'readers.ts'),
    'export const read = [process.env.STRICT_VALIDATION_RULE_SIGNATURES, process.env.BACKUP_ENABLED, process.env.READ_IN_TEST_ONLY, process.env.DISABLE_SOAP];\n');
  const clean = checkDeadSettings(api, ui, workspace);
  assert.equal(clean.passed, true, clean.notes);
  fs.rmSync(compose);
  const missing = checkDeadSettings(api, ui, workspace);
  assert.equal(missing.passed, false);
  assert.ok(missing.notes.includes(`${compose} is not found`), missing.notes);
});

test('IQ-035 fails a vendored archive without a matching receipt or not the one the lockfile installed', t => {
  const api = temporaryDirectory(t, 'accura-iq-receipts-');
  const archive = (name: string) => Buffer.from(`SYNTHETIC vendored archive ${name}; not a real package.\n`);
  const receipt = (name: string, bytes: Buffer, overrides: Record<string, unknown> = {}) => writeJson(path.join(api, 'vendor', `${name}.tgz.json`), {
    contract: 'accura-local-package-release/1', packageName: `@accura-trial/${name}`, version: '0.1.0', filename: `${name}.tgz`,
    byteLength: bytes.length, sha256: sha256(bytes), integrity: sha512(bytes), ...overrides,
  });
  const lock = (integrities: Record<string, string>) => writeJson(path.join(api, 'package-lock.json'), {
    lockfileVersion: 3, packages: Object.fromEntries(Object.entries(integrities).map(([name, integrity]) => [`node_modules/@accura-trial/${name}`, { integrity }])),
  });
  for (const name of ['alpha', 'beta']) write(path.join(api, 'vendor', `${name}.tgz`), archive(name));
  writeJson(path.join(api, 'package.json'), { name: 'synthetic-api', version: '0.0.1', dependencies: {
    '@accura-trial/alpha': 'file:vendor/alpha.tgz', '@accura-trial/beta': 'file:vendor/beta.tgz', 'left-pad': '^1.3.0' } });
  receipt('alpha', archive('alpha'));
  lock({ alpha: sha512(archive('alpha')), beta: sha512(archive('beta')) });

  const unreceipted = checkVendoredReceipts(api);
  assert.equal(unreceipted.passed, false);
  assert.match(unreceipted.notes, /1 of 2 vendored archives fail: @accura-trial\/beta: no receipt .*beta\.tgz\.json/);
  receipt('beta', archive('beta'), { sha256: sha256('another archive') });
  assert.match(checkVendoredReceipts(api).notes, /beta\.tgz does not match its receipt's SHA-256/);
  receipt('beta', archive('beta'));
  lock({ alpha: sha512(Buffer.from('another archive')), beta: sha512(archive('beta')) });
  assert.match(checkVendoredReceipts(api).notes, /does not install @accura-trial\/alpha from this archive \(its integrity is another archive's\)/);
  lock({ alpha: sha512(archive('alpha')), beta: sha512(archive('beta')) });
  const verified = checkVendoredReceipts(api);
  assert.equal(verified.passed, true, verified.notes);
  assert.match(verified.notes, /2 vendored archives each match their receipt and the lockfile/);
  writeJson(path.join(api, 'package.json'), { name: 'synthetic-api', version: '0.0.1', dependencies: { 'left-pad': '^1.3.0' } });
  assert.match(checkVendoredReceipts(api).notes, /declares no file:vendor dependency, so no receipt is verified/);
});
