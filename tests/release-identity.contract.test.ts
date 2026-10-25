import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadEvidence, saveEvidence, type EvidenceResult } from '../runners/evidence-capture';
import {
  contractBuildRows, frameworkCommit, frameworkSharedTypes, frameworkState, isReleaseStamp, observeTargetVersion, parseReleaseComponent,
  releaseIdentityFromInputs, releaseIndexCells, releaseStamp, releaseSummary, requireInstalledSharedTypes, requireTrainingRelease,
  setReleaseIdentity, NO_RECEIPT, RELEASE_CONTRACT_V2, type ReleaseIdentity,
} from '../runners/release-identity';
import { getDocumentMeta, stampDocument } from '../generators/helpers/version-stamper';
import { commitCheckout, temporaryCheckout, temporaryDirectory } from './generated-documents';

const API = '1'.repeat(40), UI = '2'.repeat(40), CORE = `sha256:${'3'.repeat(64)}`;
const TRAINING = '4'.repeat(40);
/** The version 1 identity hash of API, UI and CORE, computed by the framework before version 2 existed (9e80dfe). */
const V1_HASH = '31f32e0777883bc2a414e47b1e529c0842311b6cc14f9402e991b1a11da0f2f7';
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function workspace(t: { after(callback: () => void): void }): string {
  const root = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(root, 'accura-release-identity-'));
  t.after(() => {
    setReleaseIdentity(undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

const record = (testCaseId: string): EvidenceResult => ({
  testCaseId, timestamp: '2026-10-21T00:00:00Z', endpoint: '/synthetic', method: 'GET',
  responseStatus: 200, responseBody: { ok: true }, passed: true, notes: 'Offline synthetic evidence',
});

const health = (body: unknown, status = 200): typeof fetch => (async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;

test('every component is an explicit full commit or image ID', () => {
  assert.throws(() => releaseIdentityFromInputs({ api: API }), /pass --release-ui, --release-core/);
  assert.throws(() => releaseIdentityFromInputs({ api: 'abc1234', ui: UI, core: CORE }), /--release-api must be a full/);
  const identity = releaseIdentityFromInputs({ api: API.toUpperCase(), ui: UI, core: CORE });
  assert.equal(identity.components.api.identity, API);
  assert.deepEqual([identity.components.api.kind, identity.components.core.kind], ['git-commit', 'image-id']);
  assert.match(identity.identityHash, /^[0-9a-f]{64}$/);
  assert.notEqual(identity.identityHash, releaseIdentityFromInputs({ api: API, ui: UI, core: `sha256:${'4'.repeat(64)}` }).identityHash);
  assert.match(identity.framework.commit ?? '', /^[0-9a-f]{40}$/);
});

test('saved evidence records, summary and report carry the release under test', t => {
  const directory = workspace(t);
  const identity = releaseIdentityFromInputs({ api: API, ui: UI, core: CORE });
  setReleaseIdentity(identity);
  saveEvidence(directory, 'oq', [record('OQ-001'), record('OQ-002')]);
  const loaded = loadEvidence(directory, 'oq');
  for (const item of loaded) {
    assert.deepEqual(item.releaseUnderTest, {
      contract: 'validation-release-identity/1', identityHash: identity.identityHash,
      api: API, ui: UI, core: CORE, frameworkCommit: identity.framework.commit,
    });
  }
  const single = JSON.parse(fs.readFileSync(path.join(directory, 'evidence', 'oq', 'OQ-002.json'), 'utf8'));
  assert.equal(single.releaseUnderTest.identityHash, identity.identityHash);
  const summary = JSON.parse(fs.readFileSync(path.join(directory, 'evidence', 'oq', 'oq-summary.json'), 'utf8'));
  assert.deepEqual(summary.releaseUnderTest, identity);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'evidence', 'oq', 'release-identity.json'), 'utf8')), identity);
  const report = fs.readFileSync(path.join(directory, 'evidence', 'oq', 'oq-execution-report.md'), 'utf8');
  assert.match(report, new RegExp(`\\| Release API \\| git-commit ${API} \\(operator-input\\) \\|`));
  assert.match(report, new RegExp(`\\| Release CORE \\| image-id sha256:3{64} \\(operator-input\\) \\|`));

  const document = stampDocument('# Synthetic', getDocumentMeta(directory));
  assert.match(document, new RegExp(`\\| Release Identity \\| ${identity.identityHash} \\|`));
  assert.match(document, /\| Framework Commit \| [0-9a-f]{40} \|/);
});

test('evidence from another release is refused and absent identity stays visibly unrecorded', t => {
  const directory = workspace(t);
  setReleaseIdentity(releaseIdentityFromInputs({ api: API, ui: UI, core: CORE }));
  const foreign = { ...record('OQ-003'), releaseUnderTest: {
    contract: 'validation-release-identity/1' as const, identityHash: 'f'.repeat(64), api: API, ui: UI, core: CORE } };
  assert.throws(() => saveEvidence(directory, 'oq', [foreign]), /produced against release f{64}/);
  setReleaseIdentity(undefined);
  saveEvidence(directory, 'pq', [record('PQ-001')]);
  assert.equal(loadEvidence(directory, 'pq')[0].releaseUnderTest, undefined);
  assert.match(fs.readFileSync(path.join(directory, 'evidence', 'pq', 'pq-execution-report.md'), 'utf8'),
    /\| Release Identity \| not recorded/);
  assert.match(stampDocument('# Synthetic', getDocumentMeta(directory)), /\| Release Identity \| not recorded/);
});

test('the target version endpoint is recorded and must agree with the operator input', async () => {
  const identity: ReleaseIdentity = releaseIdentityFromInputs({ api: API, ui: UI, core: CORE });
  const plain = await observeTargetVersion(identity, 'http://127.0.0.1:1/', health({ status: 'healthy', version: '0.1.0', environment: 'development' }));
  assert.deepEqual({ ...plain.target, observedAt: 'x' },
    { url: 'http://127.0.0.1:1/health', observedAt: 'x', status: 200, version: '0.1.0', environment: 'development' });
  assert.equal(plain.identityHash, identity.identityHash);
  const agreeing = await observeTargetVersion(identity, 'http://127.0.0.1:1', health({ release: { api: API, core: CORE } }));
  assert.deepEqual(agreeing.target?.release, { api: API, core: CORE });
  await assert.rejects(observeTargetVersion(identity, 'http://127.0.0.1:1', health({ release: { ui: '9'.repeat(40) } })),
    /target reports ui 9{40}, but --release-ui is 2{40}/);
  const down = await observeTargetVersion(identity, 'http://127.0.0.1:1', (async () => { throw new Error('connection refused'); }) as typeof fetch);
  assert.equal(down.target?.error, 'connection refused');
  assert.equal(down.target?.status, 0);
});

test('version 1 keeps its bytes and hash when only api, ui and core are given', () => {
  const identity = releaseIdentityFromInputs({ api: API, ui: UI, core: CORE });
  assert.equal(identity.identityHash, V1_HASH);
  assert.equal(identity.identityHash, sha256(`api=git-commit:${API}\nui=git-commit:${UI}\ncore=image-id:${CORE}`));
  assert.equal(JSON.stringify({ ...identity, framework: null }), '{"contract":"validation-release-identity/1","components":{'
    + `"api":{"identity":"${API}","kind":"git-commit","source":"operator-input"},`
    + `"ui":{"identity":"${UI}","kind":"git-commit","source":"operator-input"},`
    + `"core":{"identity":"${CORE}","kind":"image-id","source":"operator-input"}},"identityHash":"${V1_HASH}","framework":null}`);
  assert.deepEqual(Object.keys(releaseStamp(identity)), ['contract', 'identityHash', 'api', 'ui', 'core', 'frameworkCommit']);
});

test('version 2 adds the training release and hashes the four lines in order', () => {
  const identity = releaseIdentityFromInputs({ api: API, ui: UI, core: CORE, training: TRAINING.toUpperCase() });
  assert.ok(identity.contract === RELEASE_CONTRACT_V2);
  assert.deepEqual(Object.keys(identity.components), ['api', 'ui', 'core', 'training']);
  assert.deepEqual(identity.components.training, { identity: TRAINING, kind: 'git-commit', source: 'operator-input' });
  assert.equal(identity.identityHash,
    sha256(`api=git-commit:${API}\nui=git-commit:${UI}\ncore=image-id:${CORE}\ntraining=git-commit:${TRAINING}`));
  assert.notEqual(identity.identityHash, V1_HASH);
  const stamp = releaseStamp(identity);
  assert.deepEqual(Object.keys(stamp), ['contract', 'identityHash', 'api', 'ui', 'core', 'training', 'frameworkCommit']);
  assert.deepEqual(stamp, {
    contract: 'validation-release-identity/2', identityHash: identity.identityHash,
    api: API, ui: UI, core: CORE, training: TRAINING, frameworkCommit: identity.framework.commit,
  });
});

test('none states a UI, core or training service that is not deployed and is refused for the API', () => {
  const identity = releaseIdentityFromInputs({ api: API, ui: 'none', core: ' NONE ', training: 'None' });
  assert.ok(identity.contract === RELEASE_CONTRACT_V2);
  for (const name of ['ui', 'core', 'training'] as const) {
    assert.deepEqual(identity.components[name], { identity: '-', kind: 'not-deployed', source: 'operator-input' });
  }
  assert.equal(identity.identityHash,
    sha256(`api=git-commit:${API}\nui=not-deployed:-\ncore=not-deployed:-\ntraining=not-deployed:-`));
  assert.deepEqual(releaseStamp(identity), {
    contract: 'validation-release-identity/2', identityHash: identity.identityHash,
    api: API, ui: '-', core: '-', training: '-', frameworkCommit: identity.framework.commit,
  });
  // A none makes the identity version 2, so every component, training included, is then stated.
  assert.throws(() => releaseIdentityFromInputs({ api: API, ui: 'none', core: CORE }), /pass --release-training \(/);
  assert.throws(() => releaseIdentityFromInputs({ api: API, training: TRAINING }), /pass --release-ui, --release-core \(/);
  assert.throws(() => releaseIdentityFromInputs({ api: 'none', ui: UI, core: CORE }), /--release-api cannot be none/);
  assert.throws(() => releaseIdentityFromInputs({ api: 'none', ui: 'none', core: 'none', training: 'none' }), /--release-api cannot be none/);
  assert.throws(() => parseReleaseComponent('api', 'NONE', 'target-version-endpoint'), /--release-api cannot be none/);
  assert.throws(() => releaseIdentityFromInputs({ api: API, ui: UI, core: CORE, training: 'abc1234' }),
    /--release-training must be a full 40-character Git commit, a sha256:<64 hex> image ID or none, got "abc1234"/);
  assert.throws(() => releaseIdentityFromInputs({ api: API, ui: 'not-deployed', core: CORE, training: TRAINING }),
    /--release-ui must be a full 40-character Git commit, a sha256:<64 hex> image ID or none/);
});

test('saved version 2 evidence names the training and not-deployed components in records, reports and documents', t => {
  const directory = workspace(t);
  const identity = releaseIdentityFromInputs({ api: API, ui: 'none', core: CORE, training: TRAINING });
  setReleaseIdentity(identity);
  saveEvidence(directory, 'oq', [record('OQ-001')]);
  assert.deepEqual(loadEvidence(directory, 'oq')[0].releaseUnderTest, {
    contract: 'validation-release-identity/2', identityHash: identity.identityHash,
    api: API, ui: '-', core: CORE, training: TRAINING, frameworkCommit: identity.framework.commit,
  });
  const evidence = (file: string) => fs.readFileSync(path.join(directory, 'evidence', 'oq', file), 'utf8');
  assert.deepEqual(JSON.parse(evidence('release-identity.json')), identity);
  assert.deepEqual(JSON.parse(evidence('oq-summary.json')).releaseUnderTest, identity);
  const report = evidence('oq-execution-report.md');
  assert.match(report, /\| Release UI \| not deployed \(operator-input\) \|/);
  assert.match(report, new RegExp(`\\| Release TRAINING \\| git-commit ${TRAINING} \\(operator-input\\) \\|`));
  const document = stampDocument('# Synthetic', getDocumentMeta(directory));
  assert.match(document, /\| Release UI \| not deployed \|/);
  assert.match(document, new RegExp(`\\| Release TRAINING \\| git-commit ${TRAINING} \\|`));
});

test('a version 1 identity shows the training release as not recorded', t => {
  const directory = workspace(t);
  setReleaseIdentity(releaseIdentityFromInputs({ api: API, ui: UI, core: CORE }));
  saveEvidence(directory, 'oq', [record('OQ-001')]);
  assert.match(fs.readFileSync(path.join(directory, 'evidence', 'oq', 'oq-execution-report.md'), 'utf8'),
    /\| Release CORE \| [^\n]+\|\n\| Release TRAINING \| not recorded \|\n/);
  assert.match(stampDocument('# Synthetic', getDocumentMeta(directory)), /\| Release TRAINING \| not recorded \|/);
});

test('a mismatch between evidence records is still refused, also across versions', t => {
  const directory = workspace(t);
  const v1 = releaseIdentityFromInputs({ api: API, ui: UI, core: CORE });
  const v2 = releaseIdentityFromInputs({ api: API, ui: UI, core: CORE, training: TRAINING });
  setReleaseIdentity(v2);
  assert.throws(() => saveEvidence(directory, 'oq', [{ ...record('OQ-004'), releaseUnderTest: releaseStamp(v1) }]),
    new RegExp(`produced against release ${v1.identityHash}, not ${v2.identityHash}`));
  setReleaseIdentity(v1);
  assert.throws(() => saveEvidence(directory, 'pq', [{ ...record('PQ-002'), releaseUnderTest: releaseStamp(v2) }]),
    new RegExp(`produced against release ${v2.identityHash}, not ${v1.identityHash}`));
  saveEvidence(directory, 'iq', [{ ...record('IQ-001'), releaseUnderTest: releaseStamp(v1) }]);
  assert.equal(loadEvidence(directory, 'iq')[0].releaseUnderTest?.identityHash, v1.identityHash);
});

test('evidence readers accept version 1 and 2 stamps and refuse any other', t => {
  const directory = workspace(t);
  const v1 = releaseStamp(releaseIdentityFromInputs({ api: API, ui: UI, core: CORE }));
  const v2 = releaseStamp(releaseIdentityFromInputs({ api: API, ui: 'none', core: CORE, training: 'none' }));
  const results = path.join(directory, 'evidence', 'oq', 'oq-results.json');
  fs.mkdirSync(path.dirname(results), { recursive: true });
  const retain = (stamp: unknown) => fs.writeFileSync(results, JSON.stringify([{ ...record('OQ-001'), releaseUnderTest: stamp }]));
  for (const stamp of [v1, v2]) {
    assert.ok(isReleaseStamp(stamp));
    retain(stamp);
    assert.deepEqual(loadEvidence(directory, 'oq')[0].releaseUnderTest, stamp);
  }
  for (const stamp of [
    { ...v2, contract: 'validation-release-identity/3' }, { ...v2, training: undefined }, { ...v1, training: TRAINING },
    { ...v1, identityHash: 'abc' }, { ...v1, core: undefined }, [v1], 'validation-release-identity/1',
  ]) {
    assert.equal(isReleaseStamp(stamp), false, JSON.stringify(stamp));
    retain(stamp);
    assert.throws(() => loadEvidence(directory, 'oq'), /malformed release identity at index 0/);
  }
});

test('the target must agree with a version 2 identity, a stated none and the training release included', async () => {
  const identity = releaseIdentityFromInputs({ api: API, ui: 'none', core: CORE, training: TRAINING });
  const agreeing = await observeTargetVersion(identity, 'http://127.0.0.1:1', health({ release: { api: API, ui: 'none', training: TRAINING } }));
  assert.deepEqual(agreeing.target?.release, { api: API, ui: 'none', training: TRAINING });
  assert.equal(agreeing.identityHash, identity.identityHash);
  await assert.rejects(observeTargetVersion(identity, 'http://127.0.0.1:1', health({ release: { training: '5'.repeat(40) } })),
    /target reports training 5{40}, but --release-training is 4{40}/);
  await assert.rejects(observeTargetVersion(identity, 'http://127.0.0.1:1', health({ release: { ui: UI } })),
    /target reports ui 2{40}, but --release-ui is none/);
  // Version 1 names no training release, so a reported one is not read, as before version 2.
  const v1 = releaseIdentityFromInputs({ api: API, ui: UI, core: CORE });
  const unread = await observeTargetVersion(v1, 'http://127.0.0.1:1', health({ release: { api: API, training: '5'.repeat(40) } }));
  assert.deepEqual(unread.target?.release, { api: API });
});

test('a run that selects the TA3 suites must state the training release', () => {
  const selection = 'OQ suites 13 to 18';
  assert.throws(() => requireTrainingRelease(undefined, selection),
    /^Error: OQ suites 13 to 18 require the training release under test: pass --release-training/);
  assert.throws(() => requireTrainingRelease(releaseIdentityFromInputs({ api: API, ui: UI, core: CORE }), selection), /pass --release-training/);
  requireTrainingRelease(releaseIdentityFromInputs({ api: API, ui: UI, core: CORE, training: TRAINING }), selection);
  requireTrainingRelease(releaseIdentityFromInputs({ api: API, ui: 'none', core: 'none', training: 'none' }), selection);
});

test('the console line and the master index cells name every recorded component', () => {
  const v1 = releaseIdentityFromInputs({ api: API, ui: UI, core: CORE });
  assert.equal(releaseSummary(v1), `api ${API}, ui ${UI}, core ${CORE}`);
  assert.deepEqual(releaseIndexCells(v1), [V1_HASH, API, UI, CORE, 'not recorded']);
  const v2 = releaseIdentityFromInputs({ api: API, ui: 'none', core: CORE, training: TRAINING });
  assert.equal(releaseSummary(v2), `api ${API}, ui not deployed, core ${CORE}, training ${TRAINING}`);
  assert.deepEqual(releaseIndexCells(v2), [v2.identityHash, API, 'not deployed', CORE, TRAINING]);
  assert.throws(() => releaseIndexCells({ ...v1, contract: 'validation-release-identity/3' } as unknown as ReleaseIdentity),
    /Unsupported release identity contract "validation-release-identity\/3"/);
});

test('the framework checkout is dirty with a modified tracked file or an untracked file, never an ignored one (IR-585)', t => {
  const checkout = temporaryCheckout(t, 'accura-framework-checkout-');
  const clean = frameworkCommit(checkout);
  assert.match(clean.commit ?? '', /^[0-9a-f]{40}$/);
  assert.equal(clean.dirty, false);
  fs.mkdirSync(path.join(checkout, 'output'));
  fs.writeFileSync(path.join(checkout, 'output', 'scratch.md'), 'ignored scratch\n');
  assert.deepEqual(frameworkCommit(checkout), clean, 'an ignored file leaves the checkout clean');
  fs.writeFileSync(path.join(checkout, 'scratch-runner.mjs'), 'untracked\n');
  assert.deepEqual(frameworkCommit(checkout), { commit: clean.commit, dirty: true }, 'an untracked file makes it dirty');
  fs.rmSync(path.join(checkout, 'scratch-runner.mjs'));
  fs.appendFileSync(path.join(checkout, 'tracked.txt'), 'modified\n');
  assert.deepEqual(frameworkCommit(checkout), { commit: clean.commit, dirty: true }, 'a modified tracked file makes it dirty');
  assert.deepEqual(frameworkCommit(temporaryDirectory(t, 'accura-no-checkout-')), {}, 'no checkout, no commit');
  assert.match(frameworkCommit().commit ?? '', /^[0-9a-f]{40}$/, 'this checkout by default');
});

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A synthetic package.json installing shared types (with a receipt) and interop (without one) from
 * vendor/ archives named by `build`: the files of the checkout keyed by path (IR-272). */
function vendoredCheckout(build: string, manifestSha256 = 'e'.repeat(64)): { files: Record<string, string>; sharedTypes: string; interop: string } {
  const sharedTypes = `vendor/accura-trial-shared-types-0.2.0.${build}.tgz`;
  const interop = `vendor/accura-trial-interop-middleware-0.3.0.${build}.tgz`;
  const sharedBytes = `synthetic shared-types archive ${build}\n`;
  return {
    sharedTypes, interop,
    files: {
      'package.json': JSON.stringify({ name: 'synthetic', dependencies: {
        '@accura-trial/shared-types': `file:${sharedTypes}`, '@accura-trial/interop-middleware': `file:${interop}` } }),
      [sharedTypes]: sharedBytes,
      [`${sharedTypes}.json`]: JSON.stringify({ packageName: '@accura-trial/shared-types', filename: path.basename(sharedTypes),
        byteLength: sharedBytes.length, sha256: sha256(sharedBytes), manifestSha256 }),
      [interop]: `synthetic interop archive ${build}\n`,
    },
  };
}

test('the API contract builds are read at the --release-api commit, never at the API checkout HEAD (IR-272)', t => {
  const api = temporaryDirectory(t, 'accura-api-contracts-');
  const first = vendoredCheckout('1111111111111111');
  commitCheckout(api, first.files);
  const released = frameworkCommit(api).commit!;
  // The checkout moves on to another build, and its working tree changes too: neither is read.
  commitCheckout(api, vendoredCheckout('2222222222222222').files);
  assert.notEqual(frameworkCommit(api).commit, released);
  fs.writeFileSync(path.join(api, 'package.json'), '{"dependencies":{}}');

  const identity = releaseIdentityFromInputs({ api: released, ui: UI, core: CORE }, { apiCheckout: api });
  const sharedSha = sha256(first.files[first.sharedTypes]);
  assert.deepEqual(identity.apiContracts, {
    status: 'resolved', commit: released,
    sharedTypes: { selector: `file:${first.sharedTypes}`, archive: first.sharedTypes, archiveSha256: sharedSha, receiptSha256: sharedSha },
    interop: { selector: `file:${first.interop}`, archive: first.interop, archiveSha256: sha256(first.files[first.interop]), receiptSha256: NO_RECEIPT },
  });
  // Outside the hash and the stamp: the same release with and without the builds compares equal.
  const plain = releaseIdentityFromInputs({ api: released, ui: UI, core: CORE });
  assert.equal(plain.apiContracts, undefined);
  assert.equal(identity.identityHash, plain.identityHash);
  assert.deepEqual(releaseStamp(identity), releaseStamp(plain));
  const rows = new Map(contractBuildRows(identity));
  assert.equal(rows.get('API shared types'),
    `${first.sharedTypes} (archive SHA-256 ${sharedSha}; receipt SHA-256 ${sharedSha}) at API commit ${released}`);
  assert.equal(rows.get('API interop'),
    `${first.interop} (archive SHA-256 ${sha256(first.files[first.interop])}; no receipt) at API commit ${released}`);
});

test('an absent commit, an image ID or a folder git does not read as its own records the API builds not resolved, with the hash unchanged', t => {
  const api = temporaryDirectory(t, 'accura-api-unresolved-');
  commitCheckout(api, vendoredCheckout('3333333333333333').files);
  const head = frameworkCommit(api).commit!;
  const absent = releaseIdentityFromInputs({ api: API, ui: UI, core: CORE }, { apiCheckout: api });
  assert.deepEqual(absent.apiContracts, { status: 'not resolved', reason: `the API checkout ${api} does not hold commit ${API}` });
  assert.equal(absent.identityHash, V1_HASH, 'version 1 keeps its hash');
  assert.deepEqual(Object.keys(releaseStamp(absent)), ['contract', 'identityHash', 'api', 'ui', 'core', 'frameworkCommit']);
  assert.ok(!JSON.stringify(absent.apiContracts).includes(head), 'never the checkout HEAD');
  const image = releaseIdentityFromInputs({ api: CORE, ui: UI, core: CORE, training: TRAINING }, { apiCheckout: api });
  assert.deepEqual(image.apiContracts, { status: 'not resolved',
    reason: `the API release under test is image-id ${CORE}, which names no commit to read the API's package.json at` });
  assert.equal(image.identityHash, sha256(`api=image-id:${CORE}\nui=git-commit:${UI}\ncore=image-id:${CORE}\ntraining=git-commit:${TRAINING}`));
  const nested = path.join(api, 'vendor');
  assert.match((releaseIdentityFromInputs({ api: head, ui: UI, core: CORE }, { apiCheckout: nested }).apiContracts as { reason: string }).reason,
    /is not the top level of a git checkout/);
  const none = temporaryDirectory(t, 'accura-api-none-');
  assert.deepEqual(releaseIdentityFromInputs({ api: head, ui: UI, core: CORE }, { apiCheckout: none }).apiContracts,
    { status: 'not resolved', reason: `the API checkout ${none} cannot be read by git` });
  assert.equal(new Map(contractBuildRows(absent)).get('API shared types'), `not resolved: the API checkout ${api} does not hold commit ${API}`);
});

test('the framework records its shared-types build and installed build outside the hash, and a live run refuses a stale install (IR-272)', t => {
  const checkout = temporaryDirectory(t, 'accura-framework-shared-types-');
  const manifest = '{"synthetic":"release manifest"}\n';
  const vendored = vendoredCheckout('4444444444444444', sha256(manifest));
  commitCheckout(checkout, vendored.files);
  const installed = path.join(checkout, 'node_modules', '@accura-trial', 'shared-types');
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, 'package.json'), '{"name":"@accura-trial/shared-types","version":"0.2.0"}');
  fs.writeFileSync(path.join(installed, 'release-manifest.json'), manifest);
  const archiveSha = sha256(vendored.files[vendored.sharedTypes]);
  const current = frameworkSharedTypes(checkout)!;
  assert.deepEqual(current, {
    selector: `file:${vendored.sharedTypes}`, archive: vendored.sharedTypes, archiveSha256: archiveSha, receiptSha256: archiveSha,
    receiptManifestSha256: sha256(manifest), installed: { version: '0.2.0', manifestSha256: sha256(manifest) },
  });
  requireInstalledSharedTypes(current);
  assert.deepEqual(frameworkState(checkout), { ...frameworkCommit(checkout), sharedTypes: current });

  const other = '{"synthetic":"another build"}\n';
  fs.writeFileSync(path.join(installed, 'release-manifest.json'), other);
  const stale = frameworkSharedTypes(checkout)!;
  assert.throws(() => requireInstalledSharedTypes(stale), new RegExp(`installed @accura-trial/shared-types is not the vendored build ${escaped(vendored.sharedTypes)}: `
    + `.*release-manifest\\.json SHA-256 is ${sha256(other)}, its receipt states ${sha256(manifest)}\\. Reinstall`));
  const staleIdentity: ReleaseIdentity = { ...releaseIdentityFromInputs({ api: API, ui: UI, core: CORE }), framework: { sharedTypes: stale } };
  assert.match(new Map(contractBuildRows(staleIdentity)).get('Framework shared types')!,
    new RegExp(`; installed 0\\.2\\.0, release-manifest\\.json SHA-256 ${sha256(other)} \\(not the build its receipt names\\)$`));
  fs.rmSync(path.join(checkout, 'node_modules'), { recursive: true });
  assert.throws(() => requireInstalledSharedTypes(frameworkSharedTypes(checkout)), /SHA-256 is unreadable/);
  assert.throws(() => requireInstalledSharedTypes(undefined), /names no @accura-trial\/shared-types build/);
  // A checkout whose package.json names no shared-types build records none: its state is its commit alone.
  const plain = temporaryCheckout(t, 'accura-framework-plain-');
  assert.equal(frameworkSharedTypes(plain), undefined);
  assert.deepEqual(frameworkState(plain), frameworkCommit(plain));

  // This checkout: the identity names the build package.json pins, outside the hash.
  const identity = releaseIdentityFromInputs({ api: API, ui: UI, core: CORE });
  const pinned = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).dependencies['@accura-trial/shared-types'];
  assert.equal(identity.framework.sharedTypes?.selector, pinned);
  assert.equal(identity.identityHash, V1_HASH);
});

test('the validation summary and the execution records name the contract builds of the release identity (IR-272)', t => {
  const directory = workspace(t);
  const render = () => {
    for (const generator of ['12-validation-summary', '20-test-execution-records']) {
      (require(path.join(__dirname, '..', 'generators', generator)) as { generate(outputDir: string, workspaceRoot: string): void })
        .generate(directory, directory);
    }
    return ['12-validation-summary.md', '20-test-execution-records.md'].map(file => fs.readFileSync(path.join(directory, file), 'utf8'));
  };
  setReleaseIdentity(undefined);
  const [summaryNone, recordsNone] = render();
  assert.match(summaryNone, /^\| API interop \| not recorded: no release identity was supplied \|$/m);
  assert.match(recordsNone, /^- \*\*Framework shared types:\*\* not recorded: no release identity was supplied$/m);
  const api = temporaryDirectory(t, 'accura-api-none-');
  setReleaseIdentity(releaseIdentityFromInputs({ api: API, ui: UI, core: CORE }, { apiCheckout: api }));
  const [summary, records] = render();
  assert.match(summary, /^### Contract Builds Under Test$/m);
  assert.match(summary, /^\| Framework shared types \| vendor\/accura-trial-shared-types-\S+\.tgz \(archive SHA-256 [0-9a-f]{64}; receipt SHA-256 [0-9a-f]{64}\); installed /m);
  assert.match(summary, new RegExp(`^\\| API shared types \\| not resolved: the API checkout ${escaped(api)} cannot be read by git \\|$`, 'm'));
  assert.match(records, new RegExp(`^- \\*\\*API interop:\\*\\* not resolved: the API checkout ${escaped(api)} cannot be read by git$`, 'm'));
});
