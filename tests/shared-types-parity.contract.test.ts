import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { frameworkSharedTypes, requireInstalledSharedTypes } from '../runners/release-identity';

const root = path.resolve(__dirname, '..');
const PACKAGE = '@accura-trial/shared-types';
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const sha512 = (bytes: Buffer) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const selector: string = readJson(path.join(root, 'package.json')).dependencies[PACKAGE];
const archive = path.join(root, selector.replace(/^file:/, ''));

test('the framework vendors exactly one shared-types build, beside its receipt', () => {
  assert.match(selector, /^file:vendor\/accura-trial-shared-types-[^/]+\.tgz$/);
  const archives = fs.readdirSync(path.join(root, 'vendor')).filter(name => /^accura-trial-shared-types-.+\.tgz$/.test(name));
  assert.deepEqual(archives, [path.basename(archive)]);
  assert.ok(fs.existsSync(`${archive}.json`), 'the receipt sits beside the archive');
});

test('the vendored archive hashes to its receipt and to its content-hashed name', () => {
  const bytes = fs.readFileSync(archive);
  const receipt = readJson(`${archive}.json`);
  assert.equal(receipt.contract, 'edc-study-contract-package/1');
  assert.equal(receipt.packageName, PACKAGE);
  assert.equal(receipt.filename, path.basename(archive));
  assert.equal(receipt.byteLength, bytes.length);
  assert.equal(receipt.sha256, sha256(bytes));
  assert.equal(receipt.integrity, sha512(bytes));
  const build = /\.([0-9a-f]{16})\.tgz$/.exec(archive)?.[1];
  assert.ok(build && receipt.sha256.startsWith(build), 'the name carries the first 16 hex digits of the archive SHA-256');
});

test('package.json, the lockfile and the installed package name exactly that archive', () => {
  const receipt = readJson(`${archive}.json`);
  const lock = readJson(path.join(root, 'package-lock.json'));
  assert.equal(lock.packages[''].dependencies[PACKAGE], selector);
  const locked = lock.packages[`node_modules/${PACKAGE}`];
  assert.equal(locked.resolved, selector);
  assert.equal(locked.integrity, receipt.integrity);
  assert.equal(locked.version, receipt.version);
  // The helper the release identity records and a live run's refusal of a stale install reads (IR-272).
  const build = frameworkSharedTypes(root);
  assert.ok(build);
  assert.deepEqual([build.selector, build.archive, build.archiveSha256, build.receiptSha256, build.receiptManifestSha256],
    [selector, selector.replace(/^file:/, ''), sha256(fs.readFileSync(archive)), receipt.sha256, receipt.manifestSha256]);
  assert.equal(build.installed.version, receipt.version);
  assert.equal(build.installed.manifestSha256, receipt.manifestSha256, 'node_modules holds another build: reinstall with npm install --offline');
  assert.doesNotThrow(() => requireInstalledSharedTypes(build));
});
