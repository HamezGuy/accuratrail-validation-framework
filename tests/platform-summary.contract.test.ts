import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  EDC_WORKSPACE_CANDIDATES, PENDING_VALIDATED_CHANGES, PLATFORM_INVENTORY_VERSION, PLATFORM_SYSTEM_IDS, PLATFORM_SYSTEMS,
  type PlatformSystem,
} from '../config/platform-inventory';
import {
  buildPlatformSummary, evaluateProbe, generate, recordedPqRelease, renderPlatformSummary,
  PLATFORM_SUMMARY_DOCUMENT, PLATFORM_SUMMARY_FILE, PLATFORM_SUMMARY_MEMBERS, PLATFORM_SUMMARY_OPTIONAL, PLATFORM_SUMMARY_REQUIRED,
  PROBE_STATUSES, RELEASE_CONSISTENCY_STATUSES, SYSTEM_STATUSES, type PlatformValidationSummary, type SystemRow,
} from '../generators/22-platform-validation-summary';
import {
  PLATFORM_EVIDENCE_PLAN_CONTRACT, PLATFORM_EVIDENCE_PLAN_MEMBERS, PLATFORM_EVIDENCE_PLAN_REQUIRED, parsePlatformEvidencePlan,
} from '../runners/platform-evidence-plan';
import {
  checkPlatformEvidencePlan, createPackage, sealPackage, MANIFEST_FILE, PLATFORM_EVIDENCE_STATUSES, SYNTHETIC_ROOT_MARKER,
} from '../runners/evidence-package';
import { saveEvidence, setEvidenceMarking, SYNTHETIC_NOTICE, type EvidenceResult } from '../runners/evidence-capture';
import { releaseIdentityFromInputs, setReleaseIdentity } from '../runners/release-identity';
import { E6_R3_SECTION_STATUS, ICH_E6_R3 } from '../config/regulatory-scope';
import { APPROVAL_STATEMENT } from '../generators/helpers/markdown-writer';
import { temporaryCheckout, temporaryDirectory } from './generated-documents';

/** A clean framework checkout the packages here are created from, so no test depends on this checkout's state. */
const FRAMEWORK = temporaryCheckout({ after: callback => { process.once('exit', callback); } }, 'accura-platform-framework-');

// Generator 22 against a temporary fake platform root (VAL-1/validation-platform, spec P20 4.4): two systems
// present, the EDC API as its own git checkout and the semantic layer as a plain folder; every other system absent.

type Context = { after(callback: () => void): void };
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const root = path.resolve(__dirname, '..');
const API_A = 'a'.repeat(40), API_B = 'b'.repeat(40);
const NOW = new Date('2026-10-24T12:00:00.000Z');
const inventory: readonly PlatformSystem[] = PLATFORM_SYSTEMS;
const system = (id: string) => inventory.find(entry => entry.id === id)!;
const edcApi = system('edc-api'), semantic = system('semantic-layer');
const D04 = PENDING_VALIDATED_CHANGES[0];
const D04_CASES = Array.from({ length: 26 }, (_, index) => `OQ-${String(206 + index).padStart(3, '0')}`);

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** The fake estate: the EDC API under its historical folder name (the workspace resolver finds it), committed in a
 * git checkout and then changed in a tracked file; the semantic layer without its statement literal or probe file. */
function fakePlatform(t: Context): { platformRoot: string; api: string; csl: string } {
  const platformRoot = temporaryDirectory(t, 'accura-platform-root-');
  const api = path.join(platformRoot, EDC_WORKSPACE_CANDIDATES[0], 'libreclinicaapi');
  write(path.join(api, edcApi.statement!.file), `# Change Control (synthetic)\n\n${edcApi.statement!.literal}\n\n${D04.category.sop.literal}\n`);
  // Two probes of the EDC API: one literal present (open), one absent (probe not matched).
  write(path.join(api, '.env.production.example'), `# synthetic production profile\r\nNODE_ENV=production\r\n${edcApi.gaps[0].probe!.literal}\r\n`);
  const git = (...args: string[]) => execFileSync('git', ['-C', api, ...args], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true });
  git('init', '--quiet', '--initial-branch=main');
  git('add', '.');
  git('-c', 'user.name=Platform summary test', '-c', 'user.email=synthetic@example.invalid', 'commit', '--quiet', '-m', 'Synthetic EDC API fixture');
  fs.appendFileSync(path.join(api, '.env.production.example'), '# a tracked change\r\n');
  const csl = path.join(platformRoot, 'ClinicalSemanticLayer');
  write(path.join(csl, 'README.md'), '# Semantic layer (synthetic)\n\nNo qualification statement here.\n');
  return { platformRoot, api, csl };
}

function markedHome(t: Context): string {
  const dataRoot = temporaryDirectory(t, 'accura-platform-packages-');
  fs.writeFileSync(path.join(dataRoot, SYNTHETIC_ROOT_MARKER), 'Synthetic-trial data root for a contract test.\n');
  t.after(() => { setEvidenceMarking(undefined); setReleaseIdentity(undefined); });
  return path.join(dataRoot, 'runs', 'validation-packages');
}

const record = (testCaseId: string, overrides: Partial<EvidenceResult> = {}): EvidenceResult => ({
  testCaseId, timestamp: '2026-10-24T00:00:00Z', endpoint: '/synthetic', method: 'GET', responseStatus: 200,
  responseBody: { ok: true }, passed: true, notes: 'Offline synthetic evidence', ...overrides,
});

/** A sealed synthetic OQ package against EDC API release `api`: the D-04 cases, all but the last two passed. */
function oqPackage(home: string, api: string, version = 'oq-v1'): { dir: string; manifestSha256: string } {
  setReleaseIdentity(releaseIdentityFromInputs({ api, ui: 'none', core: 'none', training: 'none' }));
  const evidencePackage = createPackage({ retainRoot: home, version, executed: true, syntheticBasis: ['synthetic-qualification'], frameworkCheckout: FRAMEWORK });
  saveEvidence(evidencePackage.dir, 'oq', D04_CASES.map((id, index) => record(id, index >= 24 ? { passed: false, outcomeCode: 'FEATURE_ABSENT_AT_RELEASE' } : {})));
  const sealed = sealPackage(evidencePackage, { baseUrl: 'http://127.0.0.1:3000' });
  setReleaseIdentity(undefined);
  return { dir: sealed.dir, manifestSha256: sealed.manifestSha256 };
}

/** A sealed O-7 import: benchmark evidence whose PQT-005 states `release` (none when undefined). */
function o7Package(home: string, release: string | undefined, version = 'o7-v1'): { dir: string; manifestSha256: string } {
  const evidencePackage = createPackage({ retainRoot: home, version, executed: true, syntheticBasis: ['benchmark-import'], frameworkCheckout: FRAMEWORK });
  saveEvidence(evidencePackage.dir, 'benchmark', [
    record('BENCHMARK-RECONSTRUCTION', { method: 'OFFLINE', responseStatus: 0 }),
    record('PQT-005', release === undefined
      ? { method: 'OFFLINE', responseStatus: 0, passed: false, outcomeCode: 'RELEASE_NOT_RECORDED', responseBody: {} }
      : { method: 'OFFLINE', responseStatus: 0, responseBody: { release: { api: release } } }),
  ]);
  const sealed = sealPackage(evidencePackage);
  return { dir: sealed.dir, manifestSha256: sealed.manifestSha256 };
}

function planFile(directory: string, systems: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  const file = path.join(directory, `plan-${sha256(JSON.stringify([systems, extra])).slice(0, 8)}.json`);
  fs.writeFileSync(file, JSON.stringify({ contract: PLATFORM_EVIDENCE_PLAN_CONTRACT, preparedBy: 'Validation lead (synthetic)', systems, ...extra }, null, 2));
  return file;
}

const packageEntry = (cited: { dir: string; manifestSha256: string }, synthetic = true, at = cited.dir) =>
  ({ kind: 'validation-evidence-package/1', path: at, sha256: cited.manifestSha256, synthetic });

const row = (summary: PlatformValidationSummary, id: string): SystemRow => summary.systems.find(entry => entry.id === id)!;

test('the inventory lists fourteen systems with unique ids, unique gap ids and the D-04 change', () => {
  assert.equal(PLATFORM_SYSTEMS.length, 14);
  assert.deepEqual(PLATFORM_SYSTEM_IDS, [
    'edc-api', 'edc-ui', 'libreclinica-core', 'training-service', 'interop-bridge', 'shared-types', 'auth-core',
    'intelligence-layer', 'semantic-layer', 'command-center', 'workbench', 'data-manager-tools', 'openstudybuilder', 'validation-framework',
  ]);
  for (const entry of inventory) {
    assert.equal(new Set(entry.gaps.map(gap => gap.id)).size, entry.gaps.length, entry.id);
    assert.ok(entry.gaps.length > 0 && entry.ta3Uses.length > 0, `${entry.id} names its TA3 uses and gaps`);
    for (const gap of entry.gaps) assert.ok(gap.item.trim() && gap.text.trim(), `${entry.id} ${gap.id}`);
  }
  assert.deepEqual([D04.id, D04.system, D04.status, [...D04.flags]],
    ['D-04', 'edc-api', 'no-change-control-record', ['ENABLE_DEVIATION_ENGINE', 'ENABLE_DOMAIN_EVENTS', 'ENABLE_DEVIATION_DECISIONS']]);
});

test('every repository path comes through collectors/workspace-paths.ts: the inventory is data and the generator names no repository', () => {
  const inventorySource = fs.readFileSync(path.join(root, 'config', 'platform-inventory.ts'), 'utf8');
  assert.doesNotMatch(inventorySource, /from '(?:node:)?(?:path|fs)'|require\(|path\.(?:join|resolve)/, 'config/platform-inventory.ts resolves no path');
  const generatorSource = fs.readFileSync(path.join(root, 'generators', '22-platform-validation-summary.ts'), 'utf8');
  const names = new Set<string>([...EDC_WORKSPACE_CANDIDATES,
    'libreclinica-api', 'libreclinicaapi', 'EDCProjectCompliant', 'ElectronicDataCaptureReal', 'accura-training-module', 'training-module',
    'accuratrial-interop-middleware', 'interop-middleware', 'accuratrial-shared-types']);
  for (const entry of inventory) {
    const location = entry.location;
    for (const candidate of 'platformCandidates' in location ? location.platformCandidates : 'workspaceCandidates' in location ? location.workspaceCandidates : []) {
      names.add(candidate);
      for (const part of candidate.split('/')) names.add(part);
    }
  }
  for (const name of names) assert.equal(generatorSource.includes(`'${name}'`), false, `generator 22 joins no repository name (${name})`);
  assert.match(generatorSource, /from '\.\.\/collectors\/workspace-paths'/);
});

test('a fake platform root: statements quoted with hash and line, stale inventory, probes open, not matched and missing, git state', t => {
  const { platformRoot, api } = fakePlatform(t);
  const summary = buildPlatformSummary(path.join(platformRoot, 'EDCProject'), { platformRoot, now: NOW });
  assert.equal(summary.systems.length, 14);
  assert.deepEqual(summary.systems.map(entry => entry.id), PLATFORM_SYSTEM_IDS, 'inventory order');
  assert.equal(summary.platformRoot, path.resolve(platformRoot));

  const edc = row(summary, 'edc-api');
  assert.equal(edc.repo, 'EDCProject/libreclinicaapi', 'found by the workspace resolver under its historical name');
  assert.match(edc.head!, /^[0-9a-f]{40}$/);
  assert.equal(edc.dirty, true, 'a tracked file differs from HEAD');
  const statementFile = fs.readFileSync(path.join(api, edcApi.statement!.file));
  assert.deepEqual(edc.statement, { file: edcApi.statement!.file, line: 3, text: edcApi.statement!.literal, fileSha256: sha256(statementFile) });
  const [flags, documents, release] = edc.gaps;
  assert.deepEqual(flags.probe, { file: '.env.production.example', rule: 'contains', literal: 'ENABLE_DOMAIN_EVENTS=false', status: 'open', line: 3 });
  assert.equal(documents.probe?.status, 'probe-not-matched');
  assert.equal(documents.probe?.line, undefined);
  assert.equal(release.probe, null, 'a stated gap has no probe');

  const csl = row(summary, 'semantic-layer');
  assert.deepEqual([csl.repo, csl.head, csl.dirty], ['ClinicalSemanticLayer', null, null], 'a folder that is not its own checkout');
  assert.deepEqual(csl.statement, { status: 'not-found', detail: 'statement not found in README.md: inventory stale' });
  assert.equal(csl.gaps.find(gap => gap.id === 'governance-packages-not-production-eligible')?.probe?.status, 'file-missing');

  const absent = row(summary, 'command-center');
  assert.deepEqual([absent.repo, absent.head, absent.dirty, absent.statement], [null, null, null,
    { status: 'not-found', detail: 'repository not found under the platform root' }]);
  assert.ok(absent.gaps.every(gap => gap.probe === null || gap.probe.status === 'file-missing'));
  assert.deepEqual(row(summary, 'libreclinica-core').statement, { status: 'not-stated' });
  for (const entry of summary.systems) {
    assert.equal(entry.status, 'gap', `${entry.id}: no evidence plan, so every system shows its gap`);
    assert.deepEqual(entry.evidence, []);
  }
  assert.equal(summary.evidencePlan, null);
  assert.deepEqual(summary.e6r3, { citation: ICH_E6_R3.citation, sectionVerification: 'pending-qa', sectionStatus: E6_R3_SECTION_STATUS });
  assert.equal(summary.inventoryVersion, PLATFORM_INVENTORY_VERSION);
  assert.equal(summary.releaseConsistency.status, 'not-comparable');

  // The D-04 change: the production profile read as the EDC reads it, the cases it needs, the SOP row quoted.
  const [change] = summary.pendingValidatedChanges;
  const profile = fs.readFileSync(path.join(api, '.env.production.example'));
  assert.deepEqual(change.flags, [
    { flag: 'ENABLE_DEVIATION_ENGINE', file: '.env.production.example', fileSha256: sha256(profile), line: null, value: false },
    { flag: 'ENABLE_DOMAIN_EVENTS', file: '.env.production.example', fileSha256: sha256(profile), line: 3, value: false },
    { flag: 'ENABLE_DEVIATION_DECISIONS', file: '.env.production.example', fileSha256: sha256(profile), line: null, value: false },
  ]);
  assert.deepEqual(change.oqCases, D04_CASES);
  assert.deepEqual(change.oqEvidence, []);
  assert.deepEqual(change.category.sop, { file: D04.category.sop.file, line: 5, text: D04.category.sop.literal, fileSha256: sha256(statementFile) });
  assert.deepEqual([change.status, change.category.name], ['no-change-control-record', 'Critical']);
});

test('probe rules: contains is open while the literal is present, absent while it is absent', t => {
  const directory = temporaryDirectory(t, 'accura-platform-probe-');
  write(path.join(directory, 'file.txt'), 'first\nliteral here\n');
  const probe = (rule: 'contains' | 'absent', literal: string) => evaluateProbe(directory, { file: 'file.txt', rule, literal }).status;
  assert.deepEqual([probe('contains', 'literal'), probe('contains', 'gone'), probe('absent', 'gone'), probe('absent', 'literal')],
    ['open', 'probe-not-matched', 'open', 'probe-not-matched']);
  assert.equal(evaluateProbe(directory, { file: 'missing.txt', rule: 'absent', literal: 'x' }).status, 'file-missing');
  assert.equal(evaluateProbe(null, { file: 'file.txt', rule: 'contains', literal: 'literal' }).status, 'file-missing');
  assert.deepEqual(evaluateProbe(directory, { file: 'file.txt', rule: 'absent', literal: 'literal' }).line, 2);
});

test('evidence admitted only by hash: a verified package, a mismatch and an unreadable one; files by hash, mismatched and missing', t => {
  const { platformRoot } = fakePlatform(t);
  const home = markedHome(t);
  const oq = oqPackage(home, API_A);
  const sources = temporaryDirectory(t, 'accura-platform-sources-');
  const report = path.join(sources, 'csl-test-report.json');
  fs.writeFileSync(report, '{"synthetic":true,"suite":"semantic contract tests"}\n');
  const plan = planFile(sources, {
    'edc-api': { evidence: [
      packageEntry(oq),
      { ...packageEntry(oq), path: path.join(oq.dir, MANIFEST_FILE), sha256: 'f'.repeat(64) },
      packageEntry({ dir: path.join(home, 'absent-package'), manifestSha256: 'e'.repeat(64) }),
    ] },
    'semantic-layer': { evidence: [
      { kind: 'csl-test-report/1', path: report, sha256: sha256(fs.readFileSync(report)), synthetic: true, note: 'synthetic run' },
      { kind: 'csl-test-report/1', path: path.join(sources, 'other.json'), sha256: 'd'.repeat(64), synthetic: false },
      { kind: 'csl-test-report/1', path: sources, sha256: 'c'.repeat(64), synthetic: false },
    ] },
  });
  fs.writeFileSync(path.join(sources, 'other.json'), 'different bytes');
  const summary = buildPlatformSummary(path.join(platformRoot, 'EDCProject'), { platformRoot, platformEvidencePlan: plan, now: NOW });
  const edc = row(summary, 'edc-api');
  assert.deepEqual(edc.evidence.map(entry => entry.status), ['verified', 'mismatch', 'unreadable']);
  assert.match(edc.evidence[0].detail, /files verified \(package [0-9a-f-]{36}, executed, oq\)/);
  assert.match(edc.evidence[1].detail, new RegExp(`package-manifest\\.json SHA-256 is ${oq.manifestSha256}, the plan states f{64}`));
  assert.match(edc.evidence[2].detail, /package-manifest\.json cannot be read \(ENOENT\); the package is not sealed/);
  assert.deepEqual(edc.evidence.map(entry => entry.synthetic), [true, true, true]);
  assert.equal(edc.status, 'evidence-present-unapproved');
  const csl = row(summary, 'semantic-layer');
  assert.deepEqual(csl.evidence.map(entry => [entry.status, entry.synthetic]), [['hash-only', true], ['mismatch', false], ['unreadable', false]]);
  assert.equal(csl.evidence[0].note, 'synthetic run');
  assert.match(csl.evidence[2].detail, /is not a file$/);
  assert.equal(csl.status, 'evidence-present-unapproved', 'a file matched by hash counts as present evidence');
  assert.ok(summary.systems.filter(entry => !['edc-api', 'semantic-layer'].includes(entry.id)).every(entry => entry.status === 'gap'));
  assert.deepEqual(summary.evidencePlan, { path: plan, sha256: sha256(fs.readFileSync(plan)), preparedBy: 'Validation lead (synthetic)' });

  // The D-04 change counts the needed cases in the verified OQ package only.
  assert.deepEqual(summary.pendingValidatedChanges[0].oqEvidence, [
    { path: oq.dir, manifestSha256: oq.manifestSha256, synthetic: true, api: `git-commit ${API_A}`, passed: 24, notPassed: 2, notRecorded: 0 },
  ]);
  // The plan check reports the same statuses and finds a synthetic entry.
  const checked = checkPlatformEvidencePlan(plan);
  assert.deepEqual(checked.entries.map(entry => entry.status), [...edc.evidence, ...csl.evidence].map(entry => entry.status));
  assert.equal(checked.synthetic, true);
  assert.ok(checked.entries.every(entry => (PLATFORM_EVIDENCE_STATUSES as readonly string[]).includes(entry.status)));
});

test('a plan is refused for a system the inventory lacks, an entry it does not admit, or a synthetic flag the package contradicts', t => {
  const home = markedHome(t);
  const oq = oqPackage(home, API_A);
  const sources = temporaryDirectory(t, 'accura-platform-refusals-');
  const file = path.join(sources, 'record.json');
  fs.writeFileSync(file, '{}');
  const hashOnly = { kind: 'bw-formal-qualification/1', path: file, sha256: sha256('{}'), synthetic: false };
  for (const [label, systems, extra, expected] of [
    ['an unknown system', { 'unknown-system': { evidence: [hashOnly] } }, {}, /names "unknown-system", which is not a system of the platform inventory/],
    ['no system', {}, {}, /systems names no system/],
    ['a hash-only entry for the EDC API', { 'edc-api': { evidence: [hashOnly] } }, {}, /by hash only, which the inventory does not admit for edc-api/],
    ['a package for the LibreClinica core', { 'libreclinica-core': { evidence: [packageEntry(oq)] } }, {}, /does not admit for libreclinica-core/],
    ['a package for the training service', { 'training-service': { evidence: [packageEntry(oq)] } }, {}, /validation-evidence-package\/1, which the inventory does not admit for training-service/],
    ['a declaration the manifest contradicts', { 'edc-api': { evidence: [packageEntry(oq, false)] } }, {}, /declares synthetic false, but the package .* states synthetic true; correct the plan/],
    ['an IL package without P13 evidence', { 'intelligence-layer': { evidence: [packageEntry(oq)] } }, {}, /holds no p13 evidence; the inventory admits a package for intelligence-layer only with it/],
    ['a relative path', { workbench: { evidence: [{ ...hashOnly, path: 'record.json' }] } }, {}, /path must be an absolute path/],
    ['a repeated path', { workbench: { evidence: [hashOnly, hashOnly] } }, {}, /repeats an entry of workbench/],
    ['an unknown member', { workbench: { evidence: [{ ...hashOnly, secretValue: 'x' }] } }, {}, /has unknown member secretValue/],
    ['an unknown top-level member', { workbench: { evidence: [hashOnly] } }, { approvedBy: 'QA' }, /has unknown member approvedBy/],
    ['a malformed hash', { workbench: { evidence: [{ ...hashOnly, sha256: 'ABC' }] } }, {}, /sha256 must be 64 lower-case hex digits/],
  ] as const) {
    const plan = planFile(sources, systems as Record<string, unknown>, extra);
    assert.throws(() => checkPlatformEvidencePlan(plan), expected, label);
  }
  assert.throws(() => checkPlatformEvidencePlan(path.join(sources, 'absent.json')), /The platform evidence plan .*absent\.json cannot be read \(ENOENT\)/);
  fs.writeFileSync(path.join(sources, 'text.json'), 'not json');
  assert.throws(() => checkPlatformEvidencePlan(path.join(sources, 'text.json')), /is not JSON/);
  assert.equal(parsePlatformEvidencePlan({ contract: PLATFORM_EVIDENCE_PLAN_CONTRACT, preparedBy: 'x', systems: { workbench: { evidence: [hashOnly] } } }).preparedBy, 'x');
});

test('release consistency: the OQ package against the release the O-7 import recorded in PQT-005', t => {
  const { platformRoot } = fakePlatform(t);
  const home = markedHome(t);
  const sources = temporaryDirectory(t, 'accura-platform-release-');
  const oq = oqPackage(home, API_A);
  const consistency = (o7: { dir: string; manifestSha256: string } | undefined) => buildPlatformSummary(path.join(platformRoot, 'EDCProject'), {
    platformRoot, now: NOW,
    platformEvidencePlan: planFile(sources, { 'edc-api': { evidence: [packageEntry(oq)] }, ...(o7 ? { 'command-center': { evidence: [packageEntry(o7)] } } : {}) }),
  });
  const same = consistency(o7Package(home, API_A, 'o7-same'));
  assert.equal(same.releaseConsistency.status, 'same');
  assert.deepEqual(same.releaseConsistency.oq.map(side => side.api), [{ kind: 'git-commit', identity: API_A }]);
  assert.ok(!row(same, 'edc-api').gaps.some(gap => gap.id === 'RELEASE_MISMATCH'));
  assert.equal(row(same, 'command-center').status, 'evidence-present-unapproved');

  const mismatch = consistency(o7Package(home, API_B, 'o7-mismatch'));
  assert.equal(mismatch.releaseConsistency.status, 'RELEASE_MISMATCH');
  const gap = row(mismatch, 'edc-api').gaps.find(entry => entry.id === 'RELEASE_MISMATCH')!;
  assert.equal(gap.item, 'VAL-1');
  assert.ok(gap.text.includes(`qualified git-commit ${API_A}`) && gap.text.includes(`recorded git-commit ${API_B}`), gap.text);

  const unrecorded = consistency(o7Package(home, undefined, 'o7-unrecorded'));
  assert.equal(unrecorded.releaseConsistency.status, 'not-comparable');
  assert.match(unrecorded.releaseConsistency.o7[0].detail, /PQT-005 records no EDC API release \(RELEASE_NOT_RECORDED\)/);
  const none = consistency(undefined);
  assert.equal(none.releaseConsistency.status, 'not-comparable');
  assert.match(none.releaseConsistency.detail, /no verified package with an O-7 import/);
  assert.deepEqual(RELEASE_CONSISTENCY_STATUSES, ['same', 'RELEASE_MISMATCH', 'not-comparable']);
  assert.deepEqual(recordedPqRelease({ passed: true, responseBody: { release: { api: `SHA256:${'C'.repeat(64)}` } } }), { kind: 'image-id', identity: `sha256:${'c'.repeat(64)}` });
  assert.equal(recordedPqRelease({ passed: true, responseBody: { release: { api: 'abc' } } }), null);
  assert.equal(recordedPqRelease({ passed: false, responseBody: { release: { api: API_A } } }), null);
});

test('the document and the JSON: deterministic, schema-shaped, no "qualified" status, and synthetic when the run is', t => {
  const { platformRoot } = fakePlatform(t);
  const workspace = path.join(platformRoot, 'EDCProject');
  const first = buildPlatformSummary(workspace, { platformRoot, now: NOW });
  assert.equal(JSON.stringify(buildPlatformSummary(workspace, { platformRoot, now: NOW })), JSON.stringify(first), 'deterministic');

  const output = temporaryDirectory(t, 'accura-platform-output-');
  generate(output, workspace, { platformRoot });
  const json = JSON.parse(fs.readFileSync(path.join(output, PLATFORM_SUMMARY_FILE), 'utf8')) as PlatformValidationSummary;
  const document = fs.readFileSync(path.join(output, PLATFORM_SUMMARY_DOCUMENT), 'utf8');
  assert.deepEqual(Object.keys(json), [...PLATFORM_SUMMARY_REQUIRED], 'an unmarked run has exactly the required members, in order');
  assert.deepEqual(Object.keys(json.systems[0]), [...PLATFORM_SUMMARY_MEMBERS.system.required]);
  assert.deepEqual(Object.keys(json.pendingValidatedChanges[0]), [...PLATFORM_SUMMARY_MEMBERS.pendingChange.required]);
  for (const entry of json.systems) {
    assert.ok((SYSTEM_STATUSES as readonly string[]).includes(entry.status));
    for (const gap of entry.gaps) if (gap.probe) assert.ok((PROBE_STATUSES as readonly string[]).includes(gap.probe.status));
  }
  const statuses = JSON.stringify([json.systems.map(entry => entry.status), json.releaseConsistency.status, json.pendingValidatedChanges.map(change => change.status)]);
  assert.doesNotMatch(statuses, /qualified/i, 'no status is ever qualified');
  const tableStatus = document.split('\n').filter(line => line.startsWith('| ') && line.includes('(edc-api)')).map(line => line.split('|').at(-2)!.trim());
  assert.deepEqual(tableStatus, ['Gap']);
  assert.doesNotMatch(document.split('\n').filter(line => line.startsWith('- **Status:**')).join('\n'), /qualified/i);
  for (const expected of [
    '# Platform Validation Summary', `| ${ICH_E6_R3.citation} Section References | ${E6_R3_SECTION_STATUS} |`, '## System Table', '## Gaps by Plan Item',
    '### D-04', '## Release Consistency', '## Validated Changes Awaiting Change Control', '## ICH E6(R3) References: Pending QA Verification',
    APPROVAL_STATEMENT, '```text\n| Status | DRAFT |\n```', 'stated; re-verify at review', 'statement not found in README.md: inventory stale',
  ]) assert.ok(document.includes(expected), expected);
  assert.doesNotMatch(document, /_{3,}|\| Signature \|/, 'no signature lines');
  assert.doesNotMatch(document, /[\u2013\u2014]/, 'no en or em dashes in the generated text');
  assert.doesNotMatch(document, /SYNTHETIC ENGINEERING EVIDENCE/);

  // A synthetic run says so in the document and in the JSON.
  setEvidenceMarking({ synthetic: true, retained: true });
  t.after(() => setEvidenceMarking(undefined));
  const synthetic = buildPlatformSummary(workspace, { platformRoot, now: NOW });
  assert.deepEqual([synthetic.synthetic, synthetic.syntheticNotice, synthetic.retention], [true, SYNTHETIC_NOTICE, undefined]);
  assert.ok(renderPlatformSummary(synthetic).startsWith(`> **${SYNTHETIC_NOTICE}**\n\n# Platform Validation Summary`));
  setEvidenceMarking(undefined);
  assert.throws(() => buildPlatformSummary(workspace, { platformRoot: path.join(platformRoot, 'absent') }), /The platform root .*absent is not a directory/);
});

test('the summary and plan schemas require exactly what the generator writes and the parser requires', () => {
  const contracts = path.join(root, 'contracts');
  const summarySchema = JSON.parse(fs.readFileSync(path.join(contracts, 'platform-validation-summary-v1.schema.json'), 'utf8'));
  assert.equal(summarySchema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(summarySchema.title, 'platform-validation-summary/1');
  assert.deepEqual(summarySchema.required, [...PLATFORM_SUMMARY_REQUIRED]);
  assert.deepEqual(Object.keys(summarySchema.properties).sort(), [...PLATFORM_SUMMARY_REQUIRED, ...PLATFORM_SUMMARY_OPTIONAL].sort());
  for (const [name, { required, optional }] of Object.entries(PLATFORM_SUMMARY_MEMBERS)) {
    const definition = summarySchema.definitions[name];
    assert.ok(definition, `the schema defines ${name}`);
    assert.deepEqual(definition.required, [...required], name);
    assert.deepEqual(Object.keys(definition.properties).sort(), [...required, ...optional].sort(), name);
    assert.equal(definition.additionalProperties, false, name);
  }
  assert.deepEqual(summarySchema.definitions.system.properties.status.enum, [...SYSTEM_STATUSES]);
  assert.deepEqual(summarySchema.definitions.probe.properties.status.enum, [...PROBE_STATUSES]);
  assert.deepEqual(summarySchema.definitions.evidence.properties.status.enum, [...PLATFORM_EVIDENCE_STATUSES]);
  assert.deepEqual(summarySchema.definitions.releaseConsistency.properties.status.enum, [...RELEASE_CONSISTENCY_STATUSES]);
  assert.equal(summarySchema.properties.syntheticNotice.const, SYNTHETIC_NOTICE);

  const planSchema = JSON.parse(fs.readFileSync(path.join(contracts, 'platform-validation-evidence-plan-v1.schema.json'), 'utf8'));
  assert.equal(planSchema.title, PLATFORM_EVIDENCE_PLAN_CONTRACT);
  assert.deepEqual(planSchema.required, [...PLATFORM_EVIDENCE_PLAN_REQUIRED]);
  assert.deepEqual(Object.keys(planSchema.properties.systems.properties), [...PLATFORM_SYSTEM_IDS], 'the schema names the inventory systems, in order');
  for (const [name, { required, optional }] of Object.entries(PLATFORM_EVIDENCE_PLAN_MEMBERS)) {
    assert.deepEqual(planSchema.definitions[name].required, [...required], name);
    assert.deepEqual(Object.keys(planSchema.definitions[name].properties).sort(), [...required, ...optional].sort(), name);
    assert.equal(planSchema.definitions[name].additionalProperties, false, name);
  }
});

test('release consistency is same only when every OQ and O-7 pair compares', t => {
  const { platformRoot } = fakePlatform(t);
  const home = markedHome(t);
  const sources = temporaryDirectory(t, 'accura-platform-pairs-');
  const oq = oqPackage(home, API_A);
  const comparing = o7Package(home, API_A, 'o7-comparing');
  const silent = o7Package(home, undefined, 'o7-silent');
  const summary = buildPlatformSummary(path.join(platformRoot, 'EDCProject'), {
    platformRoot, now: NOW,
    platformEvidencePlan: planFile(sources, { 'edc-api': { evidence: [packageEntry(oq)] }, 'command-center': { evidence: [packageEntry(comparing), packageEntry(silent)] } }),
  });
  assert.equal(summary.releaseConsistency.status, 'not-comparable');
  assert.match(summary.releaseConsistency.detail, /^1 of 2 OQ package and O-7 import pairs cannot be compared: .*; the 1 pairs that compare state the same release \(git-commit a{40}\)\.$/);
});

test('a hash-only entry that is a package manifest must declare the synthetic flag the manifest states', t => {
  const home = markedHome(t);
  const sources = temporaryDirectory(t, 'accura-platform-hash-manifest-');
  const oq = oqPackage(home, API_A);
  const manifest = path.join(oq.dir, MANIFEST_FILE);
  const entry = (synthetic: boolean) => ({ kind: 'bw-formal-qualification/1', path: manifest, sha256: oq.manifestSha256, synthetic });
  assert.throws(() => checkPlatformEvidencePlan(planFile(sources, { workbench: { evidence: [entry(false)] } })),
    /declares synthetic false, but the package manifest .*package-manifest\.json it cites by hash states synthetic true; correct the plan/);
  const checked = checkPlatformEvidencePlan(planFile(sources, { workbench: { evidence: [entry(true)] } }));
  assert.deepEqual(checked.entries.map(item => [item.status, item.synthetic]), [['hash-only', true]]);
  assert.equal(checked.synthetic, true);
});

test('the Workbench printed-name gap states what the Workbench records, TA2 decision authorizations included', () => {
  const gap = system('workbench').gaps.find(entry => entry.id === 'printed-name-optional')!;
  assert.doesNotMatch(gap.text, /records none/);
  assert.match(gap.text, /only when an administrator recorded one, and requires it only under BW_REQUIRE_PRINTED_NAME=true \(off by default\), TA2 decision authorizations included/);
  assert.deepEqual(gap.probe, { file: 'src/storage.ts', rule: 'contains', literal: 'process.env.BW_REQUIRE_PRINTED_NAME!==\'true\'' });
});
