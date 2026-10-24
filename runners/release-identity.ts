import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as path from 'node:path';

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

interface ReleaseIdentityFields {
  /** SHA-256 over the canonical component identities, for quick comparison. */
  identityHash: string;
  framework: { commit?: string; dirty?: boolean };
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

/** The framework checkout that ran (this checkout unless another is named): its
 * commit and whether it differs from it. A modified tracked file or an untracked
 * file makes it dirty, since either can change what runs; an ignored file (output/,
 * node_modules/) does not (IR-585). Recorded in every release identity and every
 * sealed evidence package; empty when git cannot read the checkout. */
export function frameworkCommit(checkout = path.resolve(__dirname, '..')): { commit?: string; dirty?: boolean } {
  const git = (...args: string[]) => execFileSync('git', ['-C', checkout, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, windowsHide: true }).trim();
  try {
    const commit = git('rev-parse', 'HEAD');
    return { commit, dirty: git('status', '--porcelain', '--untracked-files=normal').length > 0 };
  } catch {
    return {};
  }
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
 * so a component that is not deployed is stated as `none`. */
export function releaseIdentityFromInputs(
  inputs: Partial<Record<ReleaseComponentName, string>>,
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
  if (!v2) {
    const v1 = components as Record<V1ComponentName, ReleaseComponent>;
    return { contract: RELEASE_CONTRACT_V1, components: v1, identityHash: hashComponents(names, v1), framework: frameworkCommit() };
  }
  const v2Components = components as Record<ReleaseComponentName, ReleaseComponent>;
  return { contract: RELEASE_CONTRACT_V2, components: v2Components, identityHash: hashComponents(names, v2Components), framework: frameworkCommit() };
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
