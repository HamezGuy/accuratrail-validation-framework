import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SYSTEM_INFO } from '../config/system-info';
import { defaultWorkspaceRoot, resolveFrontendRoot, resolveLibreclinicaApiRoot, resolveSharedTypesRoot } from '../collectors/workspace-paths';
import { collectSharedTypes } from '../collectors/shared-types-collector';
import { collectFrontend } from '../collectors/frontend-collector';
import { collectSOPs } from '../collectors/sop-collector';
import {
  checkSharedTypesInstallation, checkSoftwareInstallation, declaredMajor, readVendoredArchive, SHARED_TYPES_VERIFIER,
  type SharedTypesConsumer,
} from '../runners/iq-runner';
import type { EvidenceResult } from '../runners/evidence-capture';
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
