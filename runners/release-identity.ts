import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveLibreclinicaApiRoot } from '../collectors/workspace-paths';
import {
  commitFiles, declaredDependency, readVendoredArchive, safeParseJson, sha256, withoutBom, workingTreeFiles, VENDORED_SELECTOR,
  type CheckoutFileReader,
} from './vendored-archive';

/** The release a validation run qualifies. Evidence without it cannot be tied
 * to the system that produced it, so every live run records it. */
export const RELEASE_CONTRACT_V1 = 'validation-release-identity/1';
/** Version 2 adds the training service, whose duty readiness gates every
 * clinical save on a stack with TRAINING_SERVICE_URL set, and lets the UI, core
 * and training be stated as not deployed (`none`). It is emitted only when the
 * operator gives the training release or a `none`; otherwise the identity stays
 * version 1, with the same bytes and hash as before version 2 existed. */
export const RELEASE_CONTRACT_V2 = 'validation-release-identity/2';
export type ReleaseContract = typeof RELEASE_CONTRACT_V1 | typeof RELEASE_CONTRACT_V2;

/** Version 1 components, in hash order. */
export const RELEASE_COMPONENTS_V1 = ['api', 'ui', 'core'] as const;
/** Version 2 components, in hash order: version 1's, then training. */
export const RELEASE_COMPONENTS = ['api', 'ui', 'core', 'training'] as const;
export type ReleaseComponentName = typeof RELEASE_COMPONENTS[number];
type V1ComponentName = typeof RELEASE_COMPONENTS_V1[number];

/** The identity of a component stated as not deployed; it hashes as `name=not-deployed:-`. */
export const NOT_DEPLOYED = '-';

export interface ReleaseComponent {
  /** A full 40-character Git commit, a `sha256:<64 hex>` container image ID, or
   * `-` for a component that is not deployed (version 2; never the API). */
  identity: string;
  kind: 'git-commit' | 'image-id' | 'not-deployed';
  source: 'operator-input' | 'target-version-endpoint';
}

export interface TargetVersionObservation {
  url: string;
  observedAt: string;
  status: number;
  /** Fields the target reported about itself; absent when it reported none. */
  version?: string;
  environment?: string;
  release?: Partial<Record<ReleaseComponentName, string>>;
  error?: string;
}

/** The contract packages whose vendored builds a release identity names (IR-272): the framework
 * checks EDC exports with its shared-types build, and the API runs its shared-types and interop builds. */
export const SHARED_TYPES_PACKAGE = '@accura-trial/shared-types';
export const INTEROP_PACKAGE = '@accura-trial/interop-middleware';
/** A vendored build whose archive has no readable receipt stating its SHA-256. */
export const NO_RECEIPT = 'no receipt';
/** API contract builds that cannot be read at the API release under test. */
export const NOT_RESOLVED = 'not resolved';

/** A contract package as a checkout's package.json installs it. */
export interface VendoredBuild {
  /** The package.json dependency selector (file:vendor/<archive>.tgz); null when package.json names none. */
  selector: string | null;
  /** The vendored archive the selector names, relative to the checkout; null when it names none. */
  archive: string | null;
  /** SHA-256 of the archive's bytes; null when the archive cannot be read. */
  archiveSha256: string | null;
  /** The archive SHA-256 its receipt (`<archive>.json`) states, or `no receipt`. */
  receiptSha256: string;
}

/** The framework's own shared-types build: the vendored build, the release-manifest.json SHA-256
 * its receipt states, and the build installed in node_modules (which the dirty check, ignoring
 * node_modules/, does not cover). A live run refuses an install that is not the receipt's. */
export interface FrameworkSharedTypes extends VendoredBuild {
  receiptManifestSha256: string | null;
  installed: { version: string | null; manifestSha256: string | null };
}

/** The framework checkout that ran. sharedTypes is recorded outside the identity hash. */
export interface FrameworkState { commit?: string; dirty?: boolean; sharedTypes?: FrameworkSharedTypes }

/** The API's shared-types and interop builds, read at the --release-api commit in the API
 * checkout, never at its HEAD; `not resolved`, with the reason, when the release is an image
 * ID or the checkout does not hold the commit. Recorded outside the identity hash. */
export type ApiContractBuilds =
  | { status: 'resolved'; commit: string; sharedTypes: VendoredBuild; interop: VendoredBuild }
  | { status: typeof NOT_RESOLVED; reason: string };

interface ReleaseIdentityFields {
  /** SHA-256 over the canonical component identities, for quick comparison. */
  identityHash: string;
  framework: FrameworkState;
  /** Present when the CLI named the API checkout (releaseIdentityFromInputs' apiCheckout). */
  apiContracts?: ApiContractBuilds;
  target?: TargetVersionObservation;
}

export interface ReleaseIdentityV1 extends ReleaseIdentityFields {
  contract: typeof RELEASE_CONTRACT_V1;
  components: Record<V1ComponentName, ReleaseComponent>;
}

export interface ReleaseIdentityV2 extends ReleaseIdentityFields {
  contract: typeof RELEASE_CONTRACT_V2;
  components: Record<ReleaseComponentName, ReleaseComponent>;
}

export type ReleaseIdentity = ReleaseIdentityV1 | ReleaseIdentityV2;

/** Compact form stamped on every evidence record. */
export interface ReleaseStamp {
  contract: ReleaseContract;
  identityHash: string;
  api: string;
  ui: string;
  core: string;
  /** Version 2 only. */
  training?: string;
  frameworkCommit?: string;
}

const GIT_COMMIT = /^[0-9a-f]{40}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function parseReleaseComponent(
  name: ReleaseComponentName, value: string, source: ReleaseComponent['source'] = 'operator-input',
): ReleaseComponent {
  const identity = value.trim().toLowerCase();
  if (GIT_COMMIT.test(identity)) return { identity, kind: 'git-commit', source };
  if (IMAGE_ID.test(identity)) return { identity, kind: 'image-id', source };
  if (identity === 'none') {
    // The API is the system under test, so it is always deployed.
    if (name === 'api') throw new Error('--release-api cannot be none: the API under test is always deployed.');
    return { identity: NOT_DEPLOYED, kind: 'not-deployed', source };
  }
  throw new Error(name === 'api'
    ? `--release-api must be a full 40-character Git commit or a sha256:<64 hex> image ID, got ${JSON.stringify(value)}.`
    : `--release-${name} must be a full 40-character Git commit, a sha256:<64 hex> image ID or none, got ${JSON.stringify(value)}.`);
}

/** A Git checkout as git reads it: the HEAD commit, the top level git reports for it,
 * and every path (absolute) that differs from HEAD, a modified, staged, deleted or
 * untracked one (an untracked directory is listed once, as the directory). An ignored
 * path (output/, node_modules/) is not listed. Empty when git cannot read the checkout. */
export interface CheckoutState {
  commit?: string;
  root?: string;
  changed?: string[];
}

export function checkoutState(checkout: string): CheckoutState {
  const git = (...args: string[]) => execFileSync('git', ['-C', checkout, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, windowsHide: true });
  try {
    const commit = git('rev-parse', 'HEAD').trim();
    const root = path.resolve(git('rev-parse', '--show-toplevel').trim());
    // -z: paths are not quoted, and each is relative to the top level. A rename or copy entry
    // is followed by its original path, which is listed too: it no longer holds HEAD's bytes.
    const entries = git('status', '--porcelain', '-z', '--untracked-files=normal').split('\0');
    const changed: string[] = [];
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (entry.length < 4) continue;
      changed.push(path.resolve(root, entry.slice(3)));
      if (/^[RC]/.test(entry) && entries[index + 1]) changed.push(path.resolve(root, entries[++index]));
    }
    return { commit, root, changed };
  } catch {
    return {};
  }
}

/** The framework checkout that ran (this checkout unless another is named): its
 * commit and whether it differs from it. A modified tracked file or an untracked
 * file makes it dirty, since either can change what runs; an ignored file (output/,
 * node_modules/) does not (IR-585). Recorded in every release identity and every
 * sealed evidence package; empty when git cannot read the checkout. */
export function frameworkCommit(checkout = path.resolve(__dirname, '..')): { commit?: string; dirty?: boolean } {
  const state = checkoutState(checkout);
  return state.commit ? { commit: state.commit, dirty: state.changed!.length > 0 } : {};
}

/** A contract package as package.json names it in the checkout at `root`, read through `files`
 * (the working tree, or a commit's files), with the receipt it read. */
function vendoredBuild(root: string, packageName: string, files: CheckoutFileReader): VendoredBuild & { receipt: Record<string, unknown> | null } {
  let pkg: Record<string, unknown> | null;
  try { pkg = safeParseJson(withoutBom(files(path.join(root, 'package.json')).toString('utf-8'))); }
  catch { pkg = null; }
  const selector = declaredDependency(pkg, packageName) || null;
  // Only file:vendor/<archive>.tgz names a vendored archive; file:../shared-types or a nested
  // vendor/ path names none, and is recorded as its selector alone.
  if (!selector || !VENDORED_SELECTOR.test(selector)) {
    return { selector, archive: null, archiveSha256: null, receiptSha256: NO_RECEIPT, receipt: null };
  }
  const vendored = readVendoredArchive(root, packageName, selector, files);
  const stated = vendored.receipt?.sha256;
  return {
    selector,
    archive: path.relative(root, vendored.archive).split(path.sep).join('/'),
    archiveSha256: vendored.sha256,
    receiptSha256: typeof stated === 'string' && SHA256_HEX.test(stated) ? stated : NO_RECEIPT,
    receipt: vendored.receipt,
  };
}

/** The framework's shared-types build (IR-272): the selector, archive and receipt its package.json
 * names, and the build installed in its node_modules. Undefined when package.json names no
 * shared-types dependency (a checkout that is not the framework's). The parity contract test and
 * the live-run refusal (requireInstalledSharedTypes) both read it. */
export function frameworkSharedTypes(checkout = path.resolve(__dirname, '..')): FrameworkSharedTypes | undefined {
  const { receipt, ...build } = vendoredBuild(checkout, SHARED_TYPES_PACKAGE, workingTreeFiles);
  if (build.selector === null) return undefined;
  const installed = path.join(checkout, 'node_modules', ...SHARED_TYPES_PACKAGE.split('/'));
  let version: string | null;
  try {
    const stated = safeParseJson(withoutBom(fs.readFileSync(path.join(installed, 'package.json'), 'utf-8')))?.version;
    version = typeof stated === 'string' ? stated : null;
  } catch { version = null; }
  let manifestSha256: string | null;
  try { manifestSha256 = sha256(fs.readFileSync(path.join(installed, 'release-manifest.json'))); }
  catch { manifestSha256 = null; }
  const statedManifest = receipt?.manifestSha256;
  return {
    ...build,
    receiptManifestSha256: typeof statedManifest === 'string' && SHA256_HEX.test(statedManifest) ? statedManifest : null,
    installed: { version, manifestSha256 },
  };
}

/** Whether node_modules holds the build the receipt names: its release-manifest.json SHA-256 is
 * the receipt's manifestSha256. */
export function installedSharedTypesCurrent(build: FrameworkSharedTypes | undefined): boolean {
  return Boolean(build?.receiptManifestSha256 && build.installed.manifestSha256 === build.receiptManifestSha256);
}

/** A live run checks EDC exports with the installed shared-types build, so it refuses an install
 * that is not the build the framework's receipt names (a stale node_modules). */
export function requireInstalledSharedTypes(build: FrameworkSharedTypes | undefined): void {
  if (installedSharedTypesCurrent(build)) return;
  if (!build) throw new Error(`The framework's package.json names no ${SHARED_TYPES_PACKAGE} build; a live run checks EDC exports with it.`);
  throw new Error(`The installed ${SHARED_TYPES_PACKAGE} is not the vendored build ${build.archive ?? build.selector}: `
    + `node_modules/${SHARED_TYPES_PACKAGE}/release-manifest.json SHA-256 is ${build.installed.manifestSha256 ?? 'unreadable'}, `
    + `its receipt states ${build.receiptManifestSha256 ?? 'none'}. Reinstall with npm install --offline before a live run.`);
}

/** The framework checkout's commit and dirty state (frameworkCommit) and its shared-types build. */
export function frameworkState(checkout = path.resolve(__dirname, '..')): FrameworkState {
  const sharedTypes = frameworkSharedTypes(checkout);
  return { ...frameworkCommit(checkout), ...(sharedTypes ? { sharedTypes } : {}) };
}

/** The API checkout of the EDC workspace, which the CLI reads the API's contract builds in. */
export function workspaceApiCheckout(workspaceRoot: string): string {
  return resolveLibreclinicaApiRoot(workspaceRoot);
}

/** The API's shared-types and interop builds at the API release under test (IR-272): package.json
 * and the receipts beside the archives it names, read with git show at the --release-api commit in
 * the API checkout. Never the checkout's HEAD or working tree: an image ID, a folder that is not
 * its git top level, or a checkout that does not hold the commit records `not resolved` and why. */
export function apiContractBuilds(api: ReleaseComponent, apiCheckout: string): ApiContractBuilds {
  if (api.kind !== 'git-commit') {
    return { status: NOT_RESOLVED, reason: `the API release under test is ${api.kind} ${api.identity}, which names no commit to read the API's package.json at` };
  }
  const git = (...args: string[]) => execFileSync('git', ['-C', apiCheckout, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, windowsHide: true }).trim();
  let root: string;
  try { root = git('rev-parse', '--show-toplevel'); }
  catch { return { status: NOT_RESOLVED, reason: `the API checkout ${apiCheckout} cannot be read by git` }; }
  const real = (file: string) => { try { return fs.realpathSync.native(file); } catch { return path.resolve(file); } };
  if (path.relative(real(root), real(apiCheckout)) !== '') {
    return { status: NOT_RESOLVED, reason: `the API folder ${apiCheckout} is not the top level of a git checkout (git reads ${root})` };
  }
  try { git('cat-file', '-e', `${api.identity}^{commit}`); }
  catch { return { status: NOT_RESOLVED, reason: `the API checkout ${apiCheckout} does not hold commit ${api.identity}` }; }
  const files = commitFiles(apiCheckout, api.identity);
  const build = (name: string): VendoredBuild => {
    const { receipt: _receipt, ...read } = vendoredBuild(apiCheckout, name, files);
    return read;
  };
  return { status: 'resolved', commit: api.identity, sharedTypes: build(SHARED_TYPES_PACKAGE), interop: build(INTEROP_PACKAGE) };
}

/** The components an identity records, in hash order. */
export function releaseComponentNames(identity: Pick<ReleaseIdentity, 'contract'>): readonly ReleaseComponentName[] {
  return identity.contract === RELEASE_CONTRACT_V2 ? RELEASE_COMPONENTS : RELEASE_COMPONENTS_V1;
}

/** A component of either version; undefined for training in version 1. */
export function releaseComponent(identity: ReleaseIdentity, name: ReleaseComponentName): ReleaseComponent | undefined {
  return (identity.components as Partial<Record<ReleaseComponentName, ReleaseComponent>>)[name];
}

function hashComponents(
  names: readonly ReleaseComponentName[], components: Partial<Record<ReleaseComponentName, ReleaseComponent>>,
): string {
  const canonical = names.map(name => `${name}=${components[name]!.kind}:${components[name]!.identity}`).join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

/** Builds the identity from explicit operator inputs. Every component its
 * version names is required; nothing is inferred from the framework checkout,
 * so a component that is not deployed is stated as `none`. The framework's
 * shared-types build is recorded in `framework`, and with `apiCheckout` the API's
 * contract builds at --release-api in `apiContracts`; neither enters the hash. */
export function releaseIdentityFromInputs(
  inputs: Partial<Record<ReleaseComponentName, string>>, options: { apiCheckout?: string } = {},
): ReleaseIdentity {
  const v2 = inputs.training !== undefined
    || (['ui', 'core'] as const).some(name => inputs[name]?.trim().toLowerCase() === 'none');
  const names: readonly ReleaseComponentName[] = v2 ? RELEASE_COMPONENTS : RELEASE_COMPONENTS_V1;
  const missing = names.filter(name => !inputs[name]);
  if (missing.length) {
    throw new Error(`Live runners require the release under test: pass ${missing.map(name => `--release-${name}`).join(', ')} `
      + '(full Git commit or sha256 image ID of each deployed component; none for a UI, core or training service that is not deployed).');
  }
  const components = Object.fromEntries(names.map(name => [name, parseReleaseComponent(name, inputs[name]!)]));
  const recorded = (api: ReleaseComponent) => ({
    framework: frameworkState(),
    ...(options.apiCheckout ? { apiContracts: apiContractBuilds(api, options.apiCheckout) } : {}),
  });
  if (!v2) {
    const v1 = components as Record<V1ComponentName, ReleaseComponent>;
    return { contract: RELEASE_CONTRACT_V1, components: v1, identityHash: hashComponents(names, v1), ...recorded(v1.api) };
  }
  const v2Components = components as Record<ReleaseComponentName, ReleaseComponent>;
  return { contract: RELEASE_CONTRACT_V2, components: v2Components, identityHash: hashComponents(names, v2Components), ...recorded(v2Components.api) };
}

/** OQ suites 13 to 18 exercise the TA3 uses by saving forms on a stack whose
 * training service decides every clinical save (TRAINING_SERVICE_URL set). The
 * code that selects them calls this before any runner starts, so such a run
 * states the training release: a commit, an image ID or none. */
export function requireTrainingRelease(identity: ReleaseIdentity | undefined, selection: string): void {
  if (identity?.contract === RELEASE_CONTRACT_V2) return;
  throw new Error(`${selection} require the training release under test: pass --release-training `
    + '(full Git commit or sha256 image ID of the training service, or none when it is not deployed).');
}

/** How the operator states a component: its identity, or `none`. */
function statedAs(component: ReleaseComponent): string {
  return component.kind === 'not-deployed' ? 'none' : component.identity;
}

/** Reads the target's own `/health` report. A component the target names must
 * equal the operator's input; an unreachable or silent endpoint is recorded,
 * never filled in. Only the components the identity records are read. */
export async function observeTargetVersion(
  identity: ReleaseIdentity, baseUrl: string, fetchImpl: typeof fetch = fetch,
): Promise<ReleaseIdentity> {
  const names = releaseComponentNames(identity);
  const url = `${baseUrl.replace(/\/$/, '')}/health`;
  const observation: TargetVersionObservation = { url, observedAt: new Date().toISOString(), status: 0 };
  try {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    observation.status = response.status;
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.version === 'string') observation.version = body.version;
    if (typeof body.environment === 'string') observation.environment = body.environment;
    const release = body.release;
    if (release && typeof release === 'object' && !Array.isArray(release)) {
      observation.release = {};
      for (const name of names) {
        const value = (release as Record<string, unknown>)[name];
        if (typeof value === 'string') observation.release[name] = value;
      }
    }
  } catch (error) {
    observation.error = error instanceof Error ? error.message : String(error);
  }
  for (const name of names) {
    const reported = observation.release?.[name];
    if (reported === undefined) continue;
    const parsed = parseReleaseComponent(name, reported, 'target-version-endpoint');
    const stated = releaseComponent(identity, name)!;
    if (parsed.identity !== stated.identity) {
      throw new Error(`The target reports ${name} ${statedAs(parsed)}, but --release-${name} is ${statedAs(stated)}. `
        + 'Qualify the release that is actually deployed.');
    }
  }
  return { ...identity, target: observation };
}

let current: ReleaseIdentity | undefined;

/** Set once by the CLI before any live runner; saveEvidence stamps it. */
export function setReleaseIdentity(identity: ReleaseIdentity | undefined): void {
  current = identity;
}

export function currentReleaseIdentity(): ReleaseIdentity | undefined {
  return current;
}

export function releaseStamp(identity: ReleaseIdentity): ReleaseStamp {
  return {
    contract: identity.contract,
    identityHash: identity.identityHash,
    api: identity.components.api.identity,
    ui: identity.components.ui.identity,
    core: identity.components.core.identity,
    ...(identity.contract === RELEASE_CONTRACT_V2 ? { training: identity.components.training.identity } : {}),
    ...(identity.framework.commit ? { frameworkCommit: identity.framework.commit } : {}),
  };
}

/** Evidence readers accept a stamp of version 1 or 2 carrying every component
 * its version names, and nothing else. */
export function isReleaseStamp(value: unknown): value is ReleaseStamp {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const stamp = value as Record<string, unknown>;
  if (stamp.contract !== RELEASE_CONTRACT_V1 && stamp.contract !== RELEASE_CONTRACT_V2) return false;
  return typeof stamp.identityHash === 'string' && SHA256_HEX.test(stamp.identityHash)
    && releaseComponentNames({ contract: stamp.contract }).every(name => typeof stamp[name] === 'string')
    && (stamp.contract === RELEASE_CONTRACT_V2 || stamp.training === undefined);
}

/** A component as reports and documents print it: `<kind> <identity>` (or the
 * identity alone), "not deployed", or "not recorded" for the training release of
 * a version 1 identity, which names none. */
export function releaseComponentText(component: ReleaseComponent | undefined, form: 'kind' | 'identity' = 'kind'): string {
  if (!component) return 'not recorded';
  if (component.kind === 'not-deployed') return 'not deployed';
  return form === 'kind' ? `${component.kind} ${component.identity}` : component.identity;
}

/** The console line naming each component the identity records. */
export function releaseSummary(identity: ReleaseIdentity): string {
  return releaseComponentNames(identity)
    .map(name => `${name} ${releaseComponentText(releaseComponent(identity, name), 'identity')}`).join(', ');
}

/** The master evidence index cells for a category's release-identity.json: the
 * identity hash, then the API, UI, core and training identities. Anything but
 * version 1 or 2 is refused, so the index shows it as unreadable. */
export function releaseIndexCells(identity: ReleaseIdentity): string[] {
  if (identity.contract !== RELEASE_CONTRACT_V1 && identity.contract !== RELEASE_CONTRACT_V2) {
    throw new Error(`Unsupported release identity contract ${JSON.stringify((identity as { contract?: unknown }).contract)}.`);
  }
  return [identity.identityHash, ...RELEASE_COMPONENTS.map(name => releaseComponentText(releaseComponent(identity, name), 'identity'))];
}

/** A vendored build as reports print it. */
function vendoredBuildText(build: VendoredBuild): string {
  if (build.selector === null) return 'not named in package.json';
  if (build.archive === null) return `${build.selector} (not a vendored archive)`;
  return `${build.archive} (archive SHA-256 ${build.archiveSha256 ?? 'unreadable'}; `
    + `${build.receiptSha256 === NO_RECEIPT ? NO_RECEIPT : `receipt SHA-256 ${build.receiptSha256}`})`;
}

/** The contract builds an identity records (IR-272), as label and text on one line with no table
 * cell separator: the framework's shared-types build with its installed build, and the API's
 * shared-types and interop builds at the API release under test. The master evidence index, 12
 * and 20 print them; an identity recorded before them reads "not recorded". */
export function contractBuildRows(identity: ReleaseIdentity | undefined): Array<[string, string]> {
  const labels = ['Framework shared types', 'API shared types', 'API interop'] as const;
  if (!identity) return labels.map(label => [label, 'not recorded: no release identity was supplied']);
  const framework = identity.framework?.sharedTypes;
  const frameworkText = framework
    ? `${vendoredBuildText(framework)}; installed ${framework.installed.version ?? 'version unreadable'}, release-manifest.json SHA-256 `
      + `${framework.installed.manifestSha256 ?? 'unreadable'} (${installedSharedTypesCurrent(framework) ? 'the build its receipt names' : 'not the build its receipt names'})`
    : 'not recorded';
  const api = identity.apiContracts;
  const apiText = (pick: 'sharedTypes' | 'interop') => {
    if (!api) return 'not recorded';
    if (api.status !== 'resolved') return `${NOT_RESOLVED}: ${api.reason}`;
    return `${vendoredBuildText(api[pick])} at API commit ${api.commit}`;
  };
  const texts = [frameworkText, apiText('sharedTypes'), apiText('interop')];
  return labels.map((label, index): [string, string] => [label, texts[index].replace(/[|\s]+/g, ' ').trim()]);
}

/** The master evidence index's Release Under Test and Contract Builds sections: for each category
 * under `evidenceBase` that holds its summary, the release identity it recorded (release-identity.json)
 * and the contract builds that identity names, outside its identity hash (IR-272). A category with no
 * identity reads "not recorded", and one whose identity cannot be read reads "unreadable". */
export function releaseIndexSections(evidenceBase: string, categories: readonly string[]): string[] {
  const lines = ['## Release Under Test', '', '| Category | Release Identity | API | UI | Core | Training |', '| --- | --- | --- | --- | --- | --- |'];
  const identities = new Set<string>();
  const buildLines: string[] = [];
  for (const cat of categories) {
    const identityPath = path.join(evidenceBase, cat, 'release-identity.json');
    if (!fs.existsSync(path.join(evidenceBase, cat, `${cat}-summary.json`))) continue;
    if (!fs.existsSync(identityPath)) {
      lines.push(`| ${cat.toUpperCase()} | not recorded | | | | |`);
      buildLines.push(`| ${cat.toUpperCase()} | not recorded | | |`);
      continue;
    }
    try {
      // Version 1 or 2; a version 1 identity's training cell reads "not recorded".
      const identity = JSON.parse(fs.readFileSync(identityPath, 'utf-8')) as ReleaseIdentity;
      const cells = releaseIndexCells(identity);
      const builds = contractBuildRows(identity).map(([, text]) => text);
      identities.add(identity.identityHash);
      lines.push(`| ${cat.toUpperCase()} | ${cells.join(' | ')} |`);
      buildLines.push(`| ${cat.toUpperCase()} | ${builds.join(' | ')} |`);
    } catch {
      lines.push(`| ${cat.toUpperCase()} | unreadable | | | | |`);
      buildLines.push(`| ${cat.toUpperCase()} | unreadable | | |`);
    }
  }
  if (identities.size > 1) {
    lines.push('', '**The categories above were produced against different releases; they do not qualify one release together.**');
  }
  return [...lines, '', '## Contract Builds', '', `| Category | ${contractBuildRows(undefined).map(([label]) => label).join(' | ')} |`,
    '| --- | --- | --- | --- |', ...buildLines];
}
