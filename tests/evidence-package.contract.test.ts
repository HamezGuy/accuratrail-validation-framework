import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  canonicalJson, currentEvidenceMarking, loadEvidence, saveEvidence, setEvidenceMarking,
  DEVELOPMENT_RUN_NOTICE, EVIDENCE_CATEGORIES, SYNTHETIC_NOTICE, type EvidenceResult,
} from '../runners/evidence-capture';
import {
  createPackage, manifestHash, markDevelopmentRun, retainInput, sealPackage, syntheticBasis, verifyPackage,
  APPROVAL_RECORDED_IN, INPUT_ROLES, MANIFEST_FILE, MANIFEST_MEMBER_REQUIRED, MANIFEST_OPTIONAL, MANIFEST_REQUIRED,
  QA_RETENTION_ROOT_MARKER, SYNTHETIC_BASES, SYNTHETIC_ROOT_MARKER, type PackageOptions,
} from '../runners/evidence-package';
import { documentHeader } from '../generators/helpers/markdown-writer';
import { getDocumentMeta, stampDocument } from '../generators/helpers/version-stamper';
import {
  tmfFilingText, NOT_RUN_OF_RECORD_LINE, SYNTHETIC_FILING_LINE, TMF_FILING_FILE, VALIDATION_PACKAGE_REQUIREMENT,
} from '../generators/helpers/tmf-filing';
import { generateAllDocuments, temporaryCheckout, temporaryDirectory } from './generated-documents';

type Context = { after(callback: () => void): void };
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const SYNTHETIC_LINE = `> **${SYNTHETIC_NOTICE}**`;

/** A temporary synthetic data root (its marker file) and the package home in its runs zone. */
function markedRoot(t: Context): { dataRoot: string; home: string } {
  const dataRoot = temporaryDirectory(t, 'accura-package-root-');
  fs.writeFileSync(path.join(dataRoot, SYNTHETIC_ROOT_MARKER), 'Synthetic-trial data root for a contract test.\n');
  t.after(() => setEvidenceMarking(undefined));
  return { dataRoot, home: path.join(dataRoot, 'runs', 'validation-packages') };
}

/** A clean framework checkout every package here is created from, so no test depends on this checkout's state. */
const FRAMEWORK = temporaryCheckout({ after: callback => { process.once('exit', callback); } }, 'accura-package-framework-');

const syntheticPackage = (home: string, extra: Partial<PackageOptions> = {}): PackageOptions => ({
  retainRoot: home, version: 'test-v1', executed: true, syntheticBasis: ['synthetic-qualification'], frameworkCheckout: FRAMEWORK, ...extra,
});

const record = (testCaseId: string, overrides: Partial<EvidenceResult> = {}): EvidenceResult => ({
  testCaseId, timestamp: '2026-10-24T00:00:00Z', endpoint: '/synthetic', method: 'GET',
  responseStatus: 200, responseBody: { ok: true }, passed: true, notes: 'Offline synthetic evidence', ...overrides,
});

const header = (title: string) => documentHeader({
  title, documentId: 'TST-001', version: '1.0', date: '2026-10-24', system: 'Synthetic test system', classification: 'Test',
});

const read = (directory: string, relative: string) => fs.readFileSync(path.join(directory, ...relative.split('/')), 'utf8');

test('canonical JSON sorts keys by code units and refuses what JSON cannot carry exactly', () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, 'x'], B: { z: 0, é: 1, Z: 2 } }, 'Test'),
    '{"B":{"Z":2,"z":0,"é":1},"a":[true,null,"x"],"b":1}');
  assert.throws(() => canonicalJson({ a: -0 }, 'Test'), /^Error: Test contains a number requiring exact source custody\.$/);
  assert.throws(() => canonicalJson({ a: 2 ** 53 }, 'Test'), /exact source custody/);
  assert.throws(() => canonicalJson({ a: undefined }, 'Test'), /Test is not finite JSON data/);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic, 'Test'), /not finite JSON data/);
  assert.throws(() => canonicalJson([1, , 3], 'Test'), /Test contains a sparse or extended array/);
});

test('a package directory is created exclusively under its UTC time, version and package ID, and never reused', t => {
  const { home } = markedRoot(t);
  const fixed = { now: new Date('2026-10-24T01:02:03.456Z'), packageId: '0123abcd-1111-4222-8333-444455556666' };
  const first = createPackage(syntheticPackage(home, fixed));
  assert.equal(path.basename(first.dir), '20261024T010203Z-test-v1-0123abcd');
  assert.equal(path.dirname(first.dir), path.resolve(home));
  assert.equal(first.createdAt, '2026-10-24T01:02:03.456Z');
  assert.throws(() => createPackage(syntheticPackage(home, fixed)), /already exists; a retained package is never overwritten/);
  assert.deepEqual(fs.readdirSync(home), [path.basename(first.dir)]);
  assert.throws(() => createPackage(syntheticPackage(home, { version: '../escape' })), /needs a --version of 1 to 64 letters/);
  assert.throws(() => createPackage(syntheticPackage(home, { packageId: 'not-a-uuid' })), /is not a UUID v4/);
});

test('a dirty or unreadable framework checkout is refused before anything is created (IR-056)', t => {
  const { home } = markedRoot(t);
  const dirty = temporaryCheckout(t, 'accura-package-dirty-');
  fs.writeFileSync(path.join(dirty, 'scratch-runner.mjs'), 'an untracked scratch runner\n');
  assert.throws(() => createPackage(syntheticPackage(home, { frameworkCheckout: dirty })),
    /The framework checkout has uncommitted or untracked files at [0-9a-f]{40}; .*pass --allow-dirty-framework/);
  assert.throws(() => createPackage(syntheticPackage(home, { frameworkCheckout: temporaryDirectory(t, 'accura-package-no-git-') })),
    /The framework checkout's commit cannot be read; .*Pass --allow-dirty-framework/);
  assert.equal(fs.existsSync(home), false, 'a refusal creates nothing');
  assert.equal(currentEvidenceMarking(), undefined, 'and marks nothing');
});

test('an allowed dirty run, or a checkout that changes during the run, is sealed and marked not a run of record', t => {
  const { home } = markedRoot(t);
  const manifestKeys = (sealed: { manifestPath: string }) => Object.keys(JSON.parse(fs.readFileSync(sealed.manifestPath, 'utf8')));
  const dirty = temporaryCheckout(t, 'accura-package-dirty-');
  fs.writeFileSync(path.join(dirty, 'scratch-runner.mjs'), 'an untracked scratch runner\n');
  const allowed = createPackage(syntheticPackage(home, { frameworkCheckout: dirty, allowDirtyFramework: true, version: 'dirty-v1' }));
  saveEvidence(allowed.dir, 'iq', [record('IQ-001')]);
  const sealed = sealPackage(allowed);
  assert.equal(sealed.notRunOfRecord, NOT_RUN_OF_RECORD_LINE);
  assert.ok(read(allowed.dir, TMF_FILING_FILE).startsWith(`${NOT_RUN_OF_RECORD_LINE}\n\n${SYNTHETIC_FILING_LINE}\n`));
  const verified = verifyPackage(allowed.dir);
  assert.deepEqual([verified.ok, verified.notRunOfRecord, verified.manifest?.framework.dirty], [true, NOT_RUN_OF_RECORD_LINE, true]);
  assert.deepEqual(manifestKeys(sealed), [...MANIFEST_REQUIRED.slice(0, 8), 'syntheticNotice', ...MANIFEST_REQUIRED.slice(8)], 'no manifest member is added');

  // Clean when created, dirty when sealed: the manifest records the seal, the filing says it changed.
  const changing = temporaryCheckout(t, 'accura-package-changing-');
  const changed = createPackage(syntheticPackage(home, { frameworkCheckout: changing, version: 'changed-v1' }));
  fs.appendFileSync(path.join(changing, 'tracked.txt'), 'edited during the run\n');
  assert.equal(sealPackage(changed).notRunOfRecord, NOT_RUN_OF_RECORD_LINE);
  assert.ok(read(changed.dir, TMF_FILING_FILE).startsWith(`${NOT_RUN_OF_RECORD_LINE}\n`));
  assert.equal(verifyPackage(changed.dir).notRunOfRecord, NOT_RUN_OF_RECORD_LINE);

  // A clean run, the flag given or not, is a run of record.
  for (const allowDirtyFramework of [false, true]) {
    const clean = createPackage(syntheticPackage(home, { allowDirtyFramework, version: `clean-${allowDirtyFramework}` }));
    const result = sealPackage(clean);
    assert.equal(result.notRunOfRecord, undefined);
    assert.ok(read(clean.dir, TMF_FILING_FILE).startsWith(`${SYNTHETIC_FILING_LINE}\n`));
    assert.deepEqual([verifyPackage(clean.dir).ok, verifyPackage(clean.dir).notRunOfRecord], [true, undefined]);
  }
});

test('a sealed package verifies, lists every other file with its byte count and SHA-256, and is read-only', t => {
  const { home } = markedRoot(t);
  const evidencePackage = createPackage(syntheticPackage(home));
  assert.deepEqual(currentEvidenceMarking(), { synthetic: true, retained: true });
  saveEvidence(evidencePackage.dir, 'oq', [
    record('OQ-001'),
    record('OQ-002', { passed: false, notes: 'Synthetic failure' }),
    record('OQ-003', { method: 'MANUAL', passed: false, notes: 'Manual verification required: synthetic' }),
    record('OQ-206', { method: 'CONTRACT', passed: false, outcomeCode: 'NO_TA3_PLAN', notes: 'Not executed: no TA3 plan' }),
  ]);
  fs.writeFileSync(path.join(evidencePackage.dir, '12-validation-summary.md'), header('Validation Summary'));
  const sealed = sealPackage(evidencePackage);
  assert.equal(currentEvidenceMarking(), undefined, 'sealing ends the package marking');

  const manifestBytes = fs.readFileSync(sealed.manifestPath);
  assert.equal(sealed.manifestSha256, sha256(manifestBytes));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.deepEqual(Object.keys(manifest), [...MANIFEST_REQUIRED.slice(0, 8), 'syntheticNotice', ...MANIFEST_REQUIRED.slice(8)]);
  assert.equal(manifest.contract, 'validation-evidence-package/1');
  assert.equal(manifest.packageId, evidencePackage.packageId);
  assert.deepEqual([manifest.executed, manifest.synthetic, manifest.syntheticBasis, manifest.syntheticNotice],
    [true, true, ['synthetic-qualification'], SYNTHETIC_NOTICE]);
  assert.match(manifest.framework.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual([manifest.releaseUnderTest, manifest.target, manifest.configurationUnderTest, manifest.inputs], [null, null, null, []]);
  assert.deepEqual(manifest.categories, [{ category: 'oq', total: 4, passed: 1, failed: 3, manual: 1, notExecuted: 1 }]);
  assert.deepEqual(manifest.approval, { state: 'unapproved', recordedIn: APPROVAL_RECORDED_IN });

  const listed = manifest.files.map((file: { path: string }) => file.path);
  assert.deepEqual(listed, [...listed].sort(), 'files are in code-unit order');
  assert.ok(!listed.includes(MANIFEST_FILE));
  for (const expected of [TMF_FILING_FILE, '12-validation-summary.md', 'evidence/oq/oq-results.json', 'evidence/oq/OQ-206.json']) {
    assert.ok(listed.includes(expected), expected);
  }
  for (const file of manifest.files) {
    const full = path.join(evidencePackage.dir, ...file.path.split('/'));
    const bytes = fs.readFileSync(full);
    assert.deepEqual([bytes.length, sha256(bytes)], [file.bytes, file.sha256], file.path);
    assert.equal(fs.statSync(full).mode & 0o222, 0, `${file.path} is read-only`);
  }
  assert.equal(fs.statSync(sealed.manifestPath).mode & 0o222, 0, 'the manifest is read-only');

  const { packageHash, ...body } = manifest;
  assert.equal(packageHash, sha256(canonicalJson(body, 'Test')));
  assert.equal(manifestHash(body), packageHash);
  assert.equal(sealed.packageHash, packageHash);
  const verified = verifyPackage(evidencePackage.dir);
  assert.deepEqual(verified.problems, []);
  assert.equal(verified.ok, true);
  assert.equal(verified.manifestSha256, sealed.manifestSha256);
  assert.throws(() => sealPackage(evidencePackage), /already sealed/);
});

test('a changed, extra or missing file, or an edited manifest, fails verification', t => {
  const { home } = markedRoot(t);
  const evidencePackage = createPackage(syntheticPackage(home));
  saveEvidence(evidencePackage.dir, 'iq', [record('IQ-001'), record('IQ-002')]);
  sealPackage(evidencePackage);
  const dir = evidencePackage.dir;
  const problems = () => verifyPackage(dir).problems.join('\n');
  assert.equal(problems(), '');

  const target = path.join(dir, 'evidence', 'iq', 'IQ-001.json');
  const original = fs.readFileSync(target);
  fs.chmodSync(target, 0o644);
  fs.writeFileSync(target, Buffer.concat([original.subarray(0, -1), Buffer.from(original.at(-1) === 0x7d ? ' ' : '}')]));
  assert.match(problems(), /evidence\/iq\/IQ-001\.json does not match its SHA-256/);
  fs.appendFileSync(target, ' ');
  assert.match(problems(), /evidence\/iq\/IQ-001\.json has \d+ bytes, not \d+/);
  fs.writeFileSync(target, original);
  assert.equal(problems(), '');

  fs.writeFileSync(path.join(dir, 'evidence', 'iq', 'extra.json'), '{}');
  assert.match(problems(), /evidence\/iq\/extra\.json is not listed in the manifest/);
  fs.unlinkSync(path.join(dir, 'evidence', 'iq', 'extra.json'));

  fs.renameSync(target, `${target}.moved`);
  assert.match(problems(), /evidence\/iq\/IQ-001\.json is missing/);
  fs.renameSync(`${target}.moved`, target);
  assert.equal(problems(), '');

  const manifestPath = path.join(dir, MANIFEST_FILE);
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  fs.chmodSync(manifestPath, 0o644);
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: 'other-v1' }));
  assert.match(problems(), /packageHash does not recompute from the manifest/);
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, extra: true }));
  assert.match(problems(), /has unknown member extra/);
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, categories: [] }));
  assert.match(problems(), /evidence category iq is not counted/);
  fs.unlinkSync(manifestPath);
  assert.match(problems(), /package-manifest\.json cannot be read .*the package is not sealed/);
  fs.writeFileSync(manifestPath, manifestBytes);
  assert.equal(problems(), '');
});

test('a synthetic package needs the marked data root\'s package home, and a package that is not synthetic stays out of it', t => {
  const { dataRoot, home } = markedRoot(t);
  const plain = temporaryDirectory(t, 'accura-package-plain-');
  assert.throws(() => createPackage(syntheticPackage(plain)), /retained only under a synthetic data root/);
  assert.throws(() => createPackage(syntheticPackage(path.join(dataRoot, 'staging', 'packages'))), /retained under .*validation-packages/);
  assert.throws(() => createPackage(syntheticPackage(path.join(dataRoot, 'runs'))), /retained under .*validation-packages/);
  assert.throws(() => createPackage(syntheticPackage(home, { syntheticBasis: [] })), /never retained inside the synthetic data root/);
  const inRepository = path.join(__dirname, '..', 'output', 'retained-package-contract-test');
  assert.throws(() => createPackage(syntheticPackage(inRepository, { syntheticBasis: [] })), /inside the git checkout/);
  assert.equal(fs.existsSync(inRepository), false);
  assert.equal(fs.existsSync(home), false, 'a refusal creates nothing');

  // A package that is not synthetic needs a root QA marked (RF-070); a documents package here.
  assert.throws(() => createPackage({ retainRoot: plain, version: 'docs-v1', executed: false, syntheticBasis: [], frameworkCheckout: FRAMEWORK }),
    new RegExp(`retained only under a retention root QA names: a directory tree holding ${QA_RETENTION_ROOT_MARKER}`));
  assert.deepEqual(fs.readdirSync(plain), []);
  fs.writeFileSync(path.join(plain, QA_RETENTION_ROOT_MARKER), 'Retention root for a contract test.\n');
  assert.throws(() => createPackage(syntheticPackage(plain)), /retained only under a synthetic data root/);
  const documents = createPackage({ retainRoot: plain, version: 'docs-v1', executed: false, syntheticBasis: [], frameworkCheckout: FRAMEWORK });
  assert.equal(currentEvidenceMarking()?.synthetic, false);
  fs.writeFileSync(path.join(documents.dir, '12-validation-summary.md'), header('Validation Summary'));
  const manifest = JSON.parse(fs.readFileSync(sealPackage(documents).manifestPath, 'utf8'));
  assert.deepEqual([manifest.synthetic, manifest.syntheticBasis, 'syntheticNotice' in manifest, manifest.executed], [false, [], false, false]);
  assert.equal(verifyPackage(documents.dir).ok, true);
  const filing = read(documents.dir, TMF_FILING_FILE);
  assert.ok(filing.startsWith('# eTMF Filing of Validation Evidence Package'), filing.slice(0, 200));
  assert.match(filing, /Only a package that is not synthetic is filed in the platform's production TMF/);
  assert.doesNotMatch(read(documents.dir, '12-validation-summary.md'), /SYNTHETIC/);
});

test('whether a package is synthetic is computed from the run, documents packages included', t => {
  const none = { syntheticQualification: false, benchmarkImport: false, p13Import: false };
  assert.deepEqual(syntheticBasis(none), []);
  assert.deepEqual(syntheticBasis({ syntheticQualification: true, benchmarkImport: true, p13Import: true }),
    ['synthetic-qualification', 'benchmark-import', 'p13-import']);
  // A documents package whose platform evidence plan cites a synthetic package is synthetic; one citing none is not.
  const citing = syntheticBasis({ ...none, platformEvidencePlan: true });
  assert.deepEqual(citing, ['platform-evidence-plan']);
  const { home } = markedRoot(t);
  const documents = createPackage({ retainRoot: home, version: 'platform-v1', executed: false, syntheticBasis: citing, frameworkCheckout: FRAMEWORK });
  assert.equal(documents.synthetic, true);
  const manifest = JSON.parse(fs.readFileSync(sealPackage(documents).manifestPath, 'utf8'));
  assert.deepEqual([manifest.synthetic, manifest.syntheticBasis, manifest.executed], [true, ['platform-evidence-plan'], false]);
  assert.equal(verifyPackage(documents.dir).ok, true);
  assert.throws(() => createPackage({ retainRoot: home, version: 'platform-v1', executed: false, syntheticBasis: syntheticBasis(none), frameworkCheckout: FRAMEWORK }),
    /never retained inside the synthetic data root/);
});

test('every record and summary of a synthetic package carries synthetic: true and every document opens with the notice', t => {
  const { home } = markedRoot(t);
  const evidencePackage = createPackage(syntheticPackage(home));
  saveEvidence(evidencePackage.dir, 'pq', [record('PQ-001'), record('PQ-002', { passed: false })]);
  const documents = generateAllDocuments(evidencePackage.dir);
  assert.ok(documents.size >= 23, `${documents.size} documents`);
  sealPackage(evidencePackage);
  const verified = verifyPackage(evidencePackage.dir);
  assert.deepEqual(verified.problems, []);
  for (const result of loadEvidence(evidencePackage.dir, 'pq')) assert.equal(result.synthetic, true, result.testCaseId);
  assert.equal(JSON.parse(read(evidencePackage.dir, 'evidence/pq/PQ-001.json')).synthetic, true);
  const summary = JSON.parse(read(evidencePackage.dir, 'evidence/pq/pq-summary.json'));
  assert.deepEqual([summary.synthetic, summary.syntheticNotice], [true, SYNTHETIC_NOTICE]);
  const markdown = verified.manifest!.files.map(file => file.path).filter(file => file.endsWith('.md'));
  assert.ok(markdown.includes('evidence/pq/pq-execution-report.md') && markdown.includes(TMF_FILING_FILE));
  for (const file of markdown) {
    const text = read(evidencePackage.dir, file);
    if (file === TMF_FILING_FILE) assert.ok(text.startsWith(`${SYNTHETIC_FILING_LINE}\n\n${SYNTHETIC_LINE}\n`), text.slice(0, 300));
    else assert.ok(text.startsWith(`${SYNTHETIC_LINE}\n\n# `), `${file} opens with ${text.slice(0, 120)}`);
    assert.equal(text.includes(DEVELOPMENT_RUN_NOTICE), false, file);
  }
  // The stamped protocol metadata states the classification and the retention too.
  assert.match(documents.get('08-oq-protocol.md')!, new RegExp(`\\| Evidence Classification \\| ${SYNTHETIC_NOTICE.replace(/\./g, '\\.')} \\|`));
  assert.match(documents.get('08-oq-protocol.md')!, /\| Retention \| Retained evidence package, sealed by its package-manifest\.json \|/);
});

test('inputs are byte copies with their hashes, and a refused input leaves no package behind', t => {
  const { home } = markedRoot(t);
  const sources = temporaryDirectory(t, 'accura-package-inputs-');
  const plan = path.join(sources, 'p13-plan.json');
  // Environment variable names are allowed where a credential would be; the bytes, BOM and CRLF included, are kept.
  const planBytes = Buffer.from('\uFEFF{"contract":"p13-qualification-attachment/1","bearerTokenEnv":"P13_TOKEN",'
    + '"accounts":{"operator":{"username":"OQ_USERNAME","password":"OQ_PASSWORD"}}}\r\n', 'utf8');
  fs.writeFileSync(plan, planBytes);
  const evidencePackage = createPackage(syntheticPackage(home, { inputs: [{ role: 'p13-plan', file: plan }] }));
  assert.deepEqual(evidencePackage.inputs,
    [{ role: 'p13-plan', path: 'inputs/p13-plan.json', sha256: sha256(planBytes), originalPath: path.resolve(plan) }]);
  assert.deepEqual(fs.readFileSync(path.join(evidencePackage.dir, 'inputs', 'p13-plan.json')), planBytes);
  assert.throws(() => retainInput(evidencePackage, 'p13-plan', plan), /already retained/);
  const capture = path.join(sources, 'training.json');
  fs.writeFileSync(capture, '{"schemaVersion":"training-inspection-evidence/1","authorityHash":"a"}');
  retainInput(evidencePackage, 'training-evidence', capture);
  const manifest = JSON.parse(fs.readFileSync(sealPackage(evidencePackage).manifestPath, 'utf8'));
  assert.deepEqual(manifest.inputs.map((input: { role: string }) => input.role), ['p13-plan', 'training-evidence']);
  assert.equal(verifyPackage(evidencePackage.dir).ok, true);
  assert.throws(() => retainInput(evidencePackage, 'ta3-oq-plan', capture), /is sealed/);

  for (const [label, content, at] of [
    ['a password', '{"accounts":{"operator":{"username":"OQ_USERNAME","password":"synthetic-secret"}}}', '$.accounts.operator.password'],
    ['a token', '{"session":{"token":"abc.def"}}', '$.session.token'],
    ['URL credentials', '{"apiBaseUrl":"https://user:secret@127.0.0.1:3000/api"}', '$.apiBaseUrl'],
    ['an authorization value', '{"headers":["Bearer abc123"]}', '$.headers[0]'],
  ]) {
    const file = path.join(sources, 'holds-secret.json');
    fs.writeFileSync(file, content);
    assert.throws(() => createPackage(syntheticPackage(home, { inputs: [{ role: 'ta3-oq-plan', file }] })),
      (error: Error) => error.message.includes(`holds a credential at ${at};`), label);
  }
  assert.throws(() => createPackage(syntheticPackage(home, { inputs: [{ role: 'p13-plan', file: path.join(sources, 'absent.json') }] })),
    /Package input p13-plan cannot be read at .*absent\.json \(ENOENT\)/);
  fs.writeFileSync(path.join(sources, 'text.json'), 'not json');
  assert.throws(() => createPackage(syntheticPackage(home, { inputs: [{ role: 'p13-plan', file: path.join(sources, 'text.json') }] })),
    /is not JSON/);
  assert.deepEqual(fs.readdirSync(home), [path.basename(evidencePackage.dir)], 'a refused input leaves no package behind');
});

test('a development run marks every record, summary and document as not retained, and a package refuses such records', t => {
  const directory = temporaryDirectory(t, 'accura-development-run-');
  t.after(() => setEvidenceMarking(undefined));
  markDevelopmentRun(true);
  saveEvidence(directory, 'iq', [record('IQ-001')]);
  const [saved] = loadEvidence(directory, 'iq');
  assert.deepEqual([saved.synthetic, saved.retention], [true, DEVELOPMENT_RUN_NOTICE]);
  const summary = JSON.parse(read(directory, 'evidence/iq/iq-summary.json'));
  assert.deepEqual([summary.synthetic, summary.retention], [true, DEVELOPMENT_RUN_NOTICE]);
  const notices = `${SYNTHETIC_LINE}\n>\n> **${DEVELOPMENT_RUN_NOTICE}**\n\n`;
  assert.ok(read(directory, 'evidence/iq/iq-execution-report.md').startsWith(`${notices}# IQ Test Execution Report`));
  assert.ok(header('Synthetic Document').startsWith(`${notices}# Synthetic Document`));
  assert.match(stampDocument('# Protocol', getDocumentMeta(directory)), new RegExp(`\\| Retention \\| ${DEVELOPMENT_RUN_NOTICE} \\|`));

  // Development-run records inside a package make it fail verification.
  const { home } = markedRoot(t);
  const evidencePackage = createPackage(syntheticPackage(home));
  setEvidenceMarking({ synthetic: true, retained: false });
  saveEvidence(evidencePackage.dir, 'iq', [record('IQ-001')]);
  setEvidenceMarking({ synthetic: true, retained: true });
  assert.throws(() => sealPackage(evidencePackage), /does not verify: .*records marked as a development run/);
  assert.equal(verifyPackage(evidencePackage.dir).ok, false);
});

test('unmarked evidence keeps its record and summary shape; outcome codes and markings are validated', t => {
  const directory = temporaryDirectory(t, 'accura-evidence-marking-');
  t.after(() => setEvidenceMarking(undefined));
  setEvidenceMarking(undefined);
  saveEvidence(directory, 'oq', [record('OQ-206', { passed: false, method: 'CONTRACT', outcomeCode: 'NO_TA3_PLAN' })]);
  const [saved] = loadEvidence(directory, 'oq');
  assert.equal(saved.outcomeCode, 'NO_TA3_PLAN');
  assert.deepEqual([saved.synthetic, saved.retention], [undefined, undefined]);
  const summary = JSON.parse(read(directory, 'evidence/oq/oq-summary.json'));
  assert.deepEqual(Object.keys(summary),
    ['category', 'executedAt', 'executionEnvironment', 'releaseUnderTest', 'total', 'passed', 'failed', 'manual', 'passRate', 'results']);
  assert.equal(summary.results[0].outcomeCode, 'NO_TA3_PLAN');
  const report = read(directory, 'evidence/oq/oq-execution-report.md');
  assert.ok(report.startsWith('# OQ Test Execution Report'));
  assert.match(report, /\*\*Outcome Code:\*\* NO_TA3_PLAN/);
  assert.ok(header('Plain').startsWith('# Plain\n'));

  for (const malformed of [{ outcomeCode: 'not a code' }, { outcomeCode: 'AB' }, { synthetic: false as unknown as true },
    { retention: 'retained' as unknown as typeof DEVELOPMENT_RUN_NOTICE }]) {
    assert.throws(() => saveEvidence(directory, 'pq', [record('PQ-001', malformed)]), /malformed outcome code or marking/);
  }
  setEvidenceMarking({ synthetic: false, retained: true });
  assert.throws(() => saveEvidence(directory, 'pq', [record('PQ-001', { synthetic: true })]), /is marked synthetic, which this run is not/);
  assert.throws(() => saveEvidence(directory, 'pq', [record('PQ-001', { retention: DEVELOPMENT_RUN_NOTICE })]),
    /is marked not retained, which this run is not/);
});

test('the filing instructions name the requirement, the bytes check and the people, without provenance or a signature', () => {
  const filing = (synthetic: boolean) => tmfFilingText({ packageId: '0123abcd-1111-4222-8333-444455556666', version: 'filing-v1', synthetic });
  const synthetic = filing(true), real = filing(false);
  assert.ok(synthetic.startsWith(`${SYNTHETIC_FILING_LINE}\n`));
  assert.ok(!real.includes('SYNTHETIC'));
  for (const text of [synthetic, real]) {
    for (const expected of [
      'Package ID | 0123abcd-1111-4222-8333-444455556666', 'Version | filing-v1', 'npm run verify:package',
      'document kind REGULATORY', 'Never use kind OTHER', 'at platform scope', `requirementId | ${VALIDATION_PACKAGE_REQUIREMENT.requirementId}`,
      'title | Computerised system validation package', 'scope | {"level":"platform"}', 'externalOriginRequired | false',
      'expiryRequired | false', 'without `provenance`', 'intelligence-tmf-source-reconciliation/1', 'IL_TMF_SIGNATURE=required',
      '**Do not start an extraction run on these documents.**', 'a different person who holds the IL REVIEWER role',
      'The proposer and the uploader cannot decide', 'No file in this package carries a signature',
    ]) assert.ok(text.includes(expected), expected);
    assert.doesNotMatch(text, /[\u2013\u2014]/, 'no en or em dashes');
    assert.doesNotMatch(text, /_{3,}/, 'no signature lines');
  }
});

/** A synthetic validation-target-configuration/1 declaration file. */
function declarationFile(directory: string, flags: Record<string, unknown>, extra: Record<string, unknown> = {}): { file: string; bytes: Buffer } {
  const bytes = Buffer.from(JSON.stringify({
    contract: 'validation-target-configuration/1', target: 'http://127.0.0.1:3000',
    source: { path: path.join(directory, 'compose.yaml'), sha256: sha256('synthetic compose') },
    declaredBy: 'evidence package contract test (synthetic)', declaredAt: '2026-10-24T00:00:00Z', flags, ...extra,
  }, null, 2));
  const file = path.join(directory, `declaration-${sha256(bytes).slice(0, 8)}.json`);
  fs.writeFileSync(file, bytes);
  return { file, bytes };
}

test('a package with a retained declaration records the configuration under test and what the run contradicted', t => {
  const { home } = markedRoot(t);
  const sources = temporaryDirectory(t, 'accura-package-declaration-');
  const flags = { ENABLE_DEVIATION_ENGINE: true, ENABLE_DEVIATION_DECISIONS: false, INSPECTION_COPY_TA3_INVENTORY: true,
    ENABLE_SEGMENTED_INSPECTION_EXPORT: false, ENABLE_DOMAIN_EVENTS: false, TRAINING_SERVICE_URL: 'set' };
  const { file, bytes } = declarationFile(sources, flags);
  const evidencePackage = createPackage(syntheticPackage(home, { inputs: [{ role: 'target-configuration', file }] }));
  saveEvidence(evidencePackage.dir, 'iq', [record('IQ-033', {
    passed: false, notes: 'Synthetic source cross-check',
    responseBody: { source: { mismatches: [{ flag: 'TRAINING_SERVICE_URL', declared: 'set', observed: 'unset', observedBy: 'IQ-033' }] } },
  })]);
  saveEvidence(evidencePackage.dir, 'oq', [
    // Declared on, answered disabled.
    record('OQ-206', { passed: false, responseStatus: 503, outcomeCode: 'ENGINE_DISABLED', notes: 'Engine answered 503' }),
    // Declared off, answered enabled (the case passed).
    record('OQ-221', { notes: 'Assessment refusals observed' }),
    // Declared on, but the release lacks W-1: no observation of the flag.
    record('OQ-241', { passed: false, outcomeCode: 'FEATURE_ABSENT_AT_RELEASE', notes: 'No TA3 table' }),
    // The case itself observed the contradiction.
    record('OQ-242', { passed: false, outcomeCode: 'CONFIGURATION_MISMATCH', notes: 'Segmented copy generated although declared off' }),
    // Not an observing case, and not executed.
    record('OQ-219', { notes: 'Ungated list read' }),
    record('OQ-222', { passed: false, method: 'CONTRACT', outcomeCode: 'NO_TA3_PLAN', notes: 'Not executed: no TA3 plan' }),
  ]);
  const manifest = JSON.parse(fs.readFileSync(sealPackage(evidencePackage).manifestPath, 'utf8'));
  assert.deepEqual(manifest.configurationUnderTest, {
    contract: 'validation-target-configuration/1', sha256: sha256(bytes), flags,
    mismatches: [
      { flag: 'TRAINING_SERVICE_URL', declared: 'set', observed: 'unset', observedBy: 'IQ-033' },
      { flag: 'ENABLE_DEVIATION_ENGINE', declared: true, observed: false, observedBy: 'OQ-206' },
      { flag: 'ENABLE_DEVIATION_DECISIONS', declared: false, observed: true, observedBy: 'OQ-221' },
      { flag: 'ENABLE_SEGMENTED_INSPECTION_EXPORT', declared: false, observed: true, observedBy: 'OQ-242' },
    ],
  });
  assert.deepEqual(manifest.inputs.map((input: { role: string; sha256: string }) => [input.role, input.sha256]), [['target-configuration', sha256(bytes)]]);
  assert.deepEqual(verifyPackage(evidencePackage.dir).problems, []);

  // The recorded configuration is bound to the retained declaration.
  const manifestPath = path.join(evidencePackage.dir, MANIFEST_FILE);
  fs.chmodSync(manifestPath, 0o644);
  const rewrite = (configurationUnderTest: unknown) => {
    const { packageHash: _hash, ...body } = { ...manifest, configurationUnderTest };
    fs.writeFileSync(manifestPath, JSON.stringify({ ...body, packageHash: manifestHash(body) }));
    return verifyPackage(evidencePackage.dir).problems.join('\n');
  };
  assert.match(rewrite({ ...manifest.configurationUnderTest, flags: { ...flags, ENABLE_DEVIATION_ENGINE: false } }),
    /configurationUnderTest is not the retained declaration inputs\/target-configuration\.json/);
  assert.match(rewrite(null), /configurationUnderTest must be recorded exactly when a target-configuration input is retained/);
  assert.match(rewrite({ ...manifest.configurationUnderTest, mismatches: [{ flag: 'NODE_ENV', declared: 'test', observed: 'test', observedBy: 'OQ-206' }] }),
    /mismatches\[0\] must hold two different values of NODE_ENV/);
  assert.match(rewrite({ ...manifest.configurationUnderTest, flags: { SECRET: 'x' } }), /flags names "SECRET", which is not on the allowlist/);
  assert.equal(rewrite(manifest.configurationUnderTest), '');
});

test('a declaration that breaks its contract is refused before the package exists', t => {
  const { home } = markedRoot(t);
  const sources = temporaryDirectory(t, 'accura-package-bad-declaration-');
  for (const [label, flags, extra, expected] of [
    ['a flag off the allowlist', { DATABASE_URL: true }, {}, /names "DATABASE_URL", which is not on the allowlist/],
    ['a URL for TRAINING_SERVICE_URL', { TRAINING_SERVICE_URL: 'https://training.invalid' }, {}, /TRAINING_SERVICE_URL must be set or unset/],
    ['a string boolean', { ENABLE_DEVIATION_ENGINE: 'true' }, {}, /ENABLE_DEVIATION_ENGINE must be true or false/],
    ['no flag', {}, {}, /flags declares no flag/],
    ['an unknown member', { ENABLE_DEVIATION_ENGINE: true }, { notes: 'x' }, /has unknown member notes/],
    ['a relative source path', { ENABLE_DEVIATION_ENGINE: true }, { source: { path: 'compose.yaml', sha256: sha256('x') } }, /source\.path must be an absolute path/],
    ['credentials in the target', { ENABLE_DEVIATION_ENGINE: true }, { target: 'http://user:pass@127.0.0.1:3000' }, /holds a credential at \$\.target|target must be an http or https URL with no credentials/],
  ] as const) {
    const { file } = declarationFile(sources, flags, extra);
    assert.throws(() => createPackage(syntheticPackage(home, { inputs: [{ role: 'target-configuration', file }] })), expected, label);
  }
  assert.equal(fs.existsSync(home), false, 'a refused declaration leaves no package behind');
});

test('the package manifest schema requires exactly what the validator requires', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'validation-evidence-package-v1.schema.json'), 'utf8'));
  assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.equal(schema.title, 'validation-evidence-package/1');
  assert.deepEqual(schema.required, [...MANIFEST_REQUIRED]);
  assert.deepEqual(Object.keys(schema.properties).sort(), [...MANIFEST_REQUIRED, ...MANIFEST_OPTIONAL].sort());
  for (const [name, required] of Object.entries(MANIFEST_MEMBER_REQUIRED)) {
    assert.deepEqual(schema.definitions[name].required, [...required], name);
    assert.deepEqual(Object.keys(schema.definitions[name].properties).sort(), [...required].sort(), name);
    assert.equal(schema.definitions[name].additionalProperties, false, name);
  }
  assert.deepEqual(schema.definitions.input.properties.role.enum, [...INPUT_ROLES]);
  assert.deepEqual(schema.properties.syntheticBasis.items.enum, [...SYNTHETIC_BASES]);
  assert.deepEqual(schema.definitions.category.properties.category.enum, [...EVIDENCE_CATEGORIES]);
  assert.equal(schema.properties.syntheticNotice.const, SYNTHETIC_NOTICE);
  assert.equal(schema.definitions.approval.properties.recordedIn.const, APPROVAL_RECORDED_IN);
});

test('an input is refused for a key ending in token, secret or private key, a JSON Web Token or a PEM block (RF-069)', t => {
  const { home } = markedRoot(t);
  const sources = temporaryDirectory(t, 'accura-package-credentials-');
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"sub":"synthetic"}').toString('base64url')}.c2lnbmF0dXJl`;
  for (const [label, content, at] of [
    ['a key ending in token', '{"github":{"githubToken":"ghp_synthetic"}}', '$.github.githubToken'],
    ['a key ending in secret', '{"oauth":{"client_secret":"synthetic"}}', '$.oauth.client_secret'],
    ['a key ending in private key', '{"sshPrivateKey":"synthetic"}', '$.sshPrivateKey'],
    ['a JSON Web Token under any key', `{"notes":["session ${jwt}"]}`, '$.notes[0]'],
    ['a PEM block under any key', '{"material":"-----BEGIN PRIVATE KEY-----\\nMIIB\\n-----END PRIVATE KEY-----"}', '$.material'],
  ]) {
    const file = path.join(sources, 'holds-secret.json');
    fs.writeFileSync(file, content);
    assert.throws(() => createPackage(syntheticPackage(home, { inputs: [{ role: 'ta3-oq-plan', file }] })),
      (error: Error) => error.message.includes(`holds a credential at ${at};`), label);
  }
  // A key ending in Env names the environment variable, and an environment variable name is allowed where a secret would be.
  const allowed = path.join(sources, 'p13-plan.json');
  fs.writeFileSync(allowed, '{"tokenEnv":"P13_TOKEN","clientSecretEnv":"OAUTH_SECRET","githubToken":"GITHUB_TOKEN","revision":"r1"}');
  const evidencePackage = createPackage(syntheticPackage(home, { inputs: [{ role: 'p13-plan', file: allowed }] }));
  assert.deepEqual(evidencePackage.inputs.map(input => input.role), ['p13-plan']);
  sealPackage(evidencePackage);
});

test('verification recomputes the configuration mismatches and binds the benchmark inputs to the records (RF-077, RF-071)', t => {
  const { home } = markedRoot(t);
  const sources = temporaryDirectory(t, 'accura-package-recompute-');
  const { file } = declarationFile(sources, { ENABLE_DEVIATION_ENGINE: true });
  const evidencePackage = createPackage(syntheticPackage(home, { inputs: [{ role: 'target-configuration', file }] }));
  saveEvidence(evidencePackage.dir, 'oq', [record('OQ-206', { passed: false, outcomeCode: 'ENGINE_DISABLED', notes: 'Engine answered 503' })]);
  const manifest = JSON.parse(fs.readFileSync(sealPackage(evidencePackage).manifestPath, 'utf8'));
  assert.equal(manifest.configurationUnderTest.mismatches.length, 1);
  const manifestPath = path.join(evidencePackage.dir, MANIFEST_FILE);
  fs.chmodSync(manifestPath, 0o644);
  const { packageHash: _hash, ...body } = { ...manifest, configurationUnderTest: { ...manifest.configurationUnderTest, mismatches: [] } };
  fs.writeFileSync(manifestPath, JSON.stringify({ ...body, packageHash: manifestHash(body) }));
  assert.match(verifyPackage(evidencePackage.dir).problems.join('\n'),
    /configurationUnderTest\.mismatches differ from those the retained IQ and OQ records give \(1 recomputed, 0 recorded\)/);

  // A benchmark record that names other run files than the retained inputs does not verify.
  const run = temporaryDirectory(t, 'accura-package-benchmark-run-');
  const summary = Buffer.from('{"localEngineering":"passed"}');
  const metrics = Buffer.from('{"metrics":[]}');
  fs.writeFileSync(path.join(run, 'run-summary.json'), summary);
  fs.writeFileSync(path.join(run, 'metrics.json'), metrics);
  const bench = (version: string, summarySha256: string) => {
    const imported = createPackage({ retainRoot: home, version, executed: true, syntheticBasis: ['benchmark-import'], frameworkCheckout: FRAMEWORK,
      inputs: [{ role: 'benchmark-run-summary', file: path.join(run, 'run-summary.json') }, { role: 'benchmark-metrics', file: path.join(run, 'metrics.json') }] });
    saveEvidence(imported.dir, 'benchmark', [record('BENCHMARK-RECONSTRUCTION', {
      method: 'OFFLINE', responseStatus: 0, responseBody: { summarySha256, metricsSha256: sha256(metrics) } })]);
    try { sealPackage(imported); return ''; } catch (error) { return (error as Error).message; }
  };
  assert.equal(bench('bench-same', sha256(summary)), '');
  assert.match(bench('bench-other', 'f'.repeat(64)),
    new RegExp(`benchmark record BENCHMARK-RECONSTRUCTION states summarySha256 f{64}, not the retained benchmark-run-summary input ${sha256(summary)}`));
});
