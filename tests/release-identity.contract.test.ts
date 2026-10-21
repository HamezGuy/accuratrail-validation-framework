import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadEvidence, saveEvidence, type EvidenceResult } from '../runners/evidence-capture';
import {
  observeTargetVersion, releaseIdentityFromInputs, setReleaseIdentity, type ReleaseIdentity,
} from '../runners/release-identity';
import { getDocumentMeta, stampDocument } from '../generators/helpers/version-stamper';

const API = '1'.repeat(40), UI = '2'.repeat(40), CORE = `sha256:${'3'.repeat(64)}`;

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
