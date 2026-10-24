import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadEvidence, saveEvidence, type EvidenceResult } from '../runners/evidence-capture';
import {
  frameworkCommit, isReleaseStamp, observeTargetVersion, parseReleaseComponent, releaseIdentityFromInputs, releaseIndexCells, releaseStamp,
  releaseSummary, requireTrainingRelease, setReleaseIdentity, RELEASE_CONTRACT_V2, type ReleaseIdentity,
} from '../runners/release-identity';
import { getDocumentMeta, stampDocument } from '../generators/helpers/version-stamper';
import { temporaryCheckout, temporaryDirectory } from './generated-documents';

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
