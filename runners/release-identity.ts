import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as path from 'node:path';

/** The release a validation run qualifies. Evidence without it cannot be tied
 * to the system that produced it, so every live run records it. */
export const RELEASE_COMPONENTS = ['api', 'ui', 'core'] as const;
export type ReleaseComponentName = typeof RELEASE_COMPONENTS[number];

export interface ReleaseComponent {
  /** A full 40-character Git commit or a `sha256:<64 hex>` container image ID. */
  identity: string;
  kind: 'git-commit' | 'image-id';
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

export interface ReleaseIdentity {
  contract: 'validation-release-identity/1';
  components: Record<ReleaseComponentName, ReleaseComponent>;
  /** SHA-256 over the canonical component identities, for quick comparison. */
  identityHash: string;
  framework: { commit?: string; dirty?: boolean };
  target?: TargetVersionObservation;
}

/** Compact form stamped on every evidence record. */
export interface ReleaseStamp {
  contract: 'validation-release-identity/1';
  identityHash: string;
  api: string;
  ui: string;
  core: string;
  frameworkCommit?: string;
}

const GIT_COMMIT = /^[0-9a-f]{40}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;

export function parseReleaseComponent(
  name: ReleaseComponentName, value: string, source: ReleaseComponent['source'] = 'operator-input',
): ReleaseComponent {
  const identity = value.trim().toLowerCase();
  if (GIT_COMMIT.test(identity)) return { identity, kind: 'git-commit', source };
  if (IMAGE_ID.test(identity)) return { identity, kind: 'image-id', source };
  throw new Error(`--release-${name} must be a full 40-character Git commit or a sha256:<64 hex> image ID, got ${JSON.stringify(value)}.`);
}

function frameworkCommit(): { commit?: string; dirty?: boolean } {
  const cwd = path.resolve(__dirname, '..');
  const git = (...args: string[]) => execFileSync('git', ['-C', cwd, ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, windowsHide: true }).trim();
  try {
    const commit = git('rev-parse', 'HEAD');
    return { commit, dirty: git('status', '--porcelain', '--untracked-files=no').length > 0 };
  } catch {
    return {};
  }
}

function hashComponents(components: Record<ReleaseComponentName, ReleaseComponent>): string {
  const canonical = RELEASE_COMPONENTS.map(name => `${name}=${components[name].kind}:${components[name].identity}`).join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

/** Builds the identity from explicit operator inputs. Every component is
 * required; nothing is inferred from the framework checkout. */
export function releaseIdentityFromInputs(
  inputs: Partial<Record<ReleaseComponentName, string>>,
): ReleaseIdentity {
  const missing = RELEASE_COMPONENTS.filter(name => !inputs[name]);
  if (missing.length) {
    throw new Error(`Live runners require the release under test: pass ${missing.map(name => `--release-${name}`).join(', ')} `
      + '(full Git commit or sha256 image ID of each deployed component).');
  }
  const components = Object.fromEntries(RELEASE_COMPONENTS.map(name => [name, parseReleaseComponent(name, inputs[name]!)])) as
    Record<ReleaseComponentName, ReleaseComponent>;
  return { contract: 'validation-release-identity/1', components, identityHash: hashComponents(components), framework: frameworkCommit() };
}

/** Reads the target's own `/health` report. A component the target names must
 * equal the operator's input; an unreachable or silent endpoint is recorded,
 * never filled in. */
export async function observeTargetVersion(
  identity: ReleaseIdentity, baseUrl: string, fetchImpl: typeof fetch = fetch,
): Promise<ReleaseIdentity> {
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
      for (const name of RELEASE_COMPONENTS) {
        const value = (release as Record<string, unknown>)[name];
        if (typeof value === 'string') observation.release[name] = value;
      }
    }
  } catch (error) {
    observation.error = error instanceof Error ? error.message : String(error);
  }
  for (const name of RELEASE_COMPONENTS) {
    const reported = observation.release?.[name];
    if (reported === undefined) continue;
    const parsed = parseReleaseComponent(name, reported, 'target-version-endpoint');
    if (parsed.identity !== identity.components[name].identity) {
      throw new Error(`The target reports ${name} ${parsed.identity}, but --release-${name} is ${identity.components[name].identity}. `
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
    ...(identity.framework.commit ? { frameworkCommit: identity.framework.commit } : {}),
  };
}
