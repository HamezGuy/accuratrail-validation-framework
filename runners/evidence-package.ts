import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  canonicalJson, isCredentialKey, isRecord, loadEvidence, setEvidenceMarking, strictObject,
  DEVELOPMENT_RUN_NOTICE, EVIDENCE_CATEGORIES, SYNTHETIC_NOTICE, type EvidenceCategory, type EvidenceResult,
} from './evidence-capture';
import {
  currentReleaseIdentity, frameworkCommit, releaseComponentNames, RELEASE_CONTRACT_V1, RELEASE_CONTRACT_V2, type ReleaseIdentity,
} from './release-identity';
import { BENCHMARK_RUN_FILES } from './benchmark-evidence';
import {
  configurationUnderTest, parseConfigurationUnderTest, parseTargetConfiguration,
  CONFIGURATION_MISMATCH_REQUIRED, CONFIGURATION_UNDER_TEST_REQUIRED, type ConfigurationUnderTest,
} from './target-configuration';
import { parseTa3OqPlan } from './ta3-oq-plan';
import { tmfFilingText, TMF_FILING_FILE } from '../generators/helpers/tmf-filing';

// Retained evidence packages (TA3 plan VAL-1, spec P20 VD-3, 3.2). A package is
// one exclusively created directory holding everything a run writes, sealed at
// the end by package-manifest.json (every file with its byte count and SHA-256,
// and a package hash) and made read-only. This module owns every filesystem
// call packaging needs: generate.ts calls it and makes none of its own, so the
// offline CLI fixture passes this module through to the real filesystem.

// generate.ts reaches the evidence marking, the configuration declaration check and
// the TA3 OQ plan check through this module, because the offline CLI fixture replaces
// every other runner module it requires.
export { DEVELOPMENT_RUN_NOTICE, SYNTHETIC_NOTICE, evidenceNoticeLines } from './evidence-capture';
export { checkTargetConfiguration } from './target-configuration';
export { loadTa3OqPlan as checkTa3OqPlan } from './ta3-oq-plan';

export const PACKAGE_CONTRACT = 'validation-evidence-package/1';
export const MANIFEST_FILE = 'package-manifest.json';
/** The marker file of a synthetic data root (CommandCenter synthetic-trial/lib/paths.mjs). */
export const SYNTHETIC_ROOT_MARKER = 'SYNTHETIC-TRIAL-DATA-ROOT';
/** Where synthetic packages live below the marked root: the existing runs zone. No new zone is created,
 * and the directory name carries no time stamp, so the data root's retention never moves it. */
export const SYNTHETIC_PACKAGE_HOME = ['runs', 'validation-packages'] as const;

/** What a package retains in inputs/<role>.json. ta3-oq-plan is the --ta3-oq-plan file and
 * target-configuration the --target-config declaration; VAL-1/validation-platform adds the
 * producer of platform-evidence-plan. */
export const INPUT_ROLES = [
  'ta3-oq-plan', 'platform-evidence-plan', 'p13-plan', 'training-evidence',
  'benchmark-run-summary', 'benchmark-metrics', 'target-configuration',
] as const;
export type PackageInputRole = typeof INPUT_ROLES[number];

/** Why a package is synthetic. Computed from the run, never chosen (VD-3). */
export const SYNTHETIC_BASES = ['synthetic-qualification', 'benchmark-import', 'p13-import', 'platform-evidence-plan'] as const;
export type SyntheticBasis = typeof SYNTHETIC_BASES[number];

export const APPROVAL_RECORDED_IN = 'eTMF governance decision on the filing of package-manifest.json; this package carries no signature';

/** Required members of package-manifest.json and of its objects; the contract
 * test compares each list with contracts/validation-evidence-package-v1.schema.json. */
export const MANIFEST_REQUIRED = [
  'contract', 'packageId', 'version', 'createdAt', 'sealedAt', 'executed', 'synthetic', 'syntheticBasis',
  'framework', 'releaseUnderTest', 'target', 'configurationUnderTest', 'inputs', 'categories', 'files',
  'approval', 'packageHash',
] as const;
export const MANIFEST_OPTIONAL = ['syntheticNotice'] as const;
export const MANIFEST_MEMBER_REQUIRED = {
  framework: ['commit', 'dirty'],
  target: ['baseUrl', 'observedAt', 'reportedVersion'],
  input: ['role', 'path', 'sha256', 'originalPath'],
  category: ['category', 'total', 'passed', 'failed', 'manual', 'notExecuted'],
  file: ['path', 'bytes', 'sha256'],
  approval: ['state', 'recordedIn'],
  configurationUnderTest: CONFIGURATION_UNDER_TEST_REQUIRED,
  mismatch: CONFIGURATION_MISMATCH_REQUIRED,
} as const;

export interface PackageInputSource { role: PackageInputRole; file: string }
export interface PackageInput { role: PackageInputRole; path: string; sha256: string; originalPath: string }
export interface PackageCategory {
  category: EvidenceCategory;
  total: number;
  passed: number;
  /** As in the category summary: every result that did not pass; manual and notExecuted are parts of it. */
  failed: number;
  manual: number;
  notExecuted: number;
}
export interface PackageFile { path: string; bytes: number; sha256: string }
export interface PackageTarget { baseUrl: string; observedAt: string | null; reportedVersion: string | null }

export interface PackageManifest {
  contract: typeof PACKAGE_CONTRACT;
  packageId: string;
  version: string;
  createdAt: string;
  sealedAt: string;
  executed: boolean;
  synthetic: boolean;
  syntheticBasis: SyntheticBasis[];
  syntheticNotice?: typeof SYNTHETIC_NOTICE;
  framework: { commit: string | null; dirty: boolean | null };
  releaseUnderTest: ReleaseIdentity | null;
  target: PackageTarget | null;
  /** The retained --target-config declaration (validation-target-configuration/1) with every
   * contradiction IQ-033 and the observing OQ cases recorded; null when the run declared none. */
  configurationUnderTest: ConfigurationUnderTest | null;
  inputs: PackageInput[];
  categories: PackageCategory[];
  files: PackageFile[];
  approval: { state: 'unapproved'; recordedIn: typeof APPROVAL_RECORDED_IN };
  packageHash: string;
}

export interface EvidencePackage {
  readonly dir: string;
  readonly packageId: string;
  readonly version: string;
  readonly createdAt: string;
  /** True when the run selected a live runner or an evidence import; false for a documents package. */
  readonly executed: boolean;
  readonly synthetic: boolean;
  readonly syntheticBasis: readonly SyntheticBasis[];
  readonly inputs: PackageInput[];
  sealed: boolean;
}

export interface PackageOptions {
  retainRoot: string;
  /** The --version label; part of the directory name. */
  version: string;
  executed: boolean;
  syntheticBasis: readonly SyntheticBasis[];
  inputs?: readonly PackageInputSource[];
  /** A fixed clock and package ID, for tests only. */
  now?: Date;
  packageId?: string;
}

const VERSION_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
/** One path segment of a package file; the same characters a test case ID may use. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
/** An input file larger than this is refused rather than read whole. */
const INPUT_BYTE_LIMIT = 64 * 1024 * 1024;
/** A credential-named member may only name the environment variable that holds the secret. */
const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]*$/;
const URL_CREDENTIALS = /[a-z][a-z0-9+.-]*:\/\/[^\s/@]*:[^\s/@]*@/i;
const AUTHORIZATION_VALUE = /^(?:bearer|basic)\s+\S/i;

function packageCheck(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const errorText = (error: unknown) => (error as NodeJS.ErrnoException)?.code ?? (error instanceof Error ? error.message : String(error));

/** The SHA-256 of the canonical JSON of the manifest without its packageHash. */
export function manifestHash(manifest: Omit<PackageManifest, 'packageHash'> | Record<string, unknown>): string {
  return sha256(canonicalJson(manifest, 'Package manifest'));
}

/** The VD-3 rule: synthetic when --synthetic-qualification is given, when an
 * import of synthetic engineering evidence ran (every benchmark import, and the
 * P13 attachment), or when an entry of the platform evidence plan is synthetic. */
export function syntheticBasis(run: {
  syntheticQualification: boolean; benchmarkImport: boolean; p13Import: boolean; platformEvidencePlan?: boolean;
}): SyntheticBasis[] {
  const given: Record<SyntheticBasis, boolean> = {
    'synthetic-qualification': run.syntheticQualification,
    'benchmark-import': run.benchmarkImport,
    'p13-import': run.p13Import,
    'platform-evidence-plan': run.platformEvidencePlan === true,
  };
  return SYNTHETIC_BASES.filter(basis => given[basis]);
}

/** The two files of a scored benchmark run, retained as inputs so the package
 * keeps them when the data root's retention later moves the run. */
export function benchmarkRunInputs(runDir: string): PackageInputSource[] {
  return [
    { role: 'benchmark-run-summary', file: path.join(runDir, BENCHMARK_RUN_FILES.summary) },
    { role: 'benchmark-metrics', file: path.join(runDir, BENCHMARK_RUN_FILES.metrics) },
  ];
}

/** Records and documents of a run that keeps its evidence in output/ scratch say so. */
export function markDevelopmentRun(synthetic: boolean): void {
  setEvidenceMarking({ synthetic, retained: false });
}

function isWithin(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative === '' || (relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative));
}

/** The nearest directory at or above `start` holding the synthetic data root marker. */
export function markedDataRoot(start: string): string | undefined {
  const isFile = (file: string) => {
    try { return fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true; } catch { return false; }
  };
  for (let current = path.resolve(start); ; current = path.dirname(current)) {
    if (isFile(path.join(current, SYNTHETIC_ROOT_MARKER))) return current;
    if (path.dirname(current) === current) return undefined;
  }
}

function enclosingCheckout(start: string): string | undefined {
  for (let current = path.resolve(start); ; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    if (path.dirname(current) === current) return undefined;
  }
}

/** A synthetic package lives only under the marked data root's runs/validation-packages;
 * a package that is not synthetic never lives in a marked tree. Neither is written
 * into a git checkout: executed evidence is never kept in a repository. */
function retentionRoot(retainRoot: string, synthetic: boolean): string {
  const root = path.resolve(retainRoot);
  const checkout = enclosingCheckout(root);
  packageCheck(!checkout, `--retain-root ${root} is inside the git checkout ${checkout}; executed evidence is never retained in a repository.`);
  const marked = markedDataRoot(root);
  if (synthetic) {
    packageCheck(marked, `A synthetic package is retained only under a synthetic data root (a directory tree holding `
      + `${SYNTHETIC_ROOT_MARKER}), and ${root} is not in one; use C:/Projects/.synthetic-trial-data/runs/validation-packages.`);
    const home = path.join(marked, ...SYNTHETIC_PACKAGE_HOME);
    packageCheck(isWithin(home, root), `A synthetic package is retained under ${home}, the data root's runs zone, not ${root}.`);
  } else {
    packageCheck(!marked, `A package that is not synthetic is never retained inside the synthetic data root ${marked}; `
      + 'use a retention root QA names.');
  }
  return root;
}

/** The first credential in a parsed input: a credential-named member that holds
 * anything but an environment variable name, a URL with a user and password, or
 * an authorization header value. */
function credentialAt(value: unknown, at: string): string | undefined {
  if (typeof value === 'string') return URL_CREDENTIALS.test(value) || AUTHORIZATION_VALUE.test(value) ? at : undefined;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = credentialAt(item, `${at}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const [key, item] of Object.entries(value)) {
    const where = `${at}.${key}`;
    if (isCredentialKey(key) && item !== null && item !== '' && !(typeof item === 'string' && ENVIRONMENT_NAME.test(item))) return where;
    const found = credentialAt(item, where);
    if (found) return found;
  }
  return undefined;
}

interface PreparedInput extends PackageInput { bytes: Buffer }

/** Reads and checks one input: its exact bytes are kept, so its SHA-256 equals the
 * original's. Inputs are JSON; one that holds a secret is refused, never redacted. */
function prepareInput(source: PackageInputSource): PreparedInput {
  packageCheck((INPUT_ROLES as readonly string[]).includes(source.role), `Unknown package input role ${JSON.stringify(source.role)}.`);
  const originalPath = path.resolve(source.file);
  let bytes: Buffer;
  try {
    const stat = fs.statSync(originalPath);
    packageCheck(stat.isFile(), `Package input ${source.role} at ${originalPath} is not a file.`);
    packageCheck(stat.size <= INPUT_BYTE_LIMIT, `Package input ${source.role} (${originalPath}) is larger than ${INPUT_BYTE_LIMIT} bytes.`);
    bytes = fs.readFileSync(originalPath);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Package input ')) throw error;
    throw new Error(`Package input ${source.role} cannot be read at ${originalPath} (${errorText(error)}).`);
  }
  packageCheck(bytes.length <= INPUT_BYTE_LIMIT, `Package input ${source.role} (${originalPath}) is larger than ${INPUT_BYTE_LIMIT} bytes.`);
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw new Error(`Package input ${source.role} (${originalPath}) is not JSON.`); }
  const credential = credentialAt(parsed, '$');
  packageCheck(!credential, `Package input ${source.role} (${originalPath}) holds a credential at ${credential}; `
    + 'inputs name the environment variables that hold secrets, never the secrets.');
  INPUT_CONTRACTS[source.role]?.(parsed, `Package input ${source.role} (${originalPath})`);
  return { role: source.role, path: `inputs/${source.role}.json`, sha256: sha256(bytes), originalPath, bytes };
}

/** Inputs whose contract this framework owns are read strictly before they are retained,
 * so a declaration with a key off its allowlist never enters a package. */
const INPUT_CONTRACTS: Partial<Record<PackageInputRole, (value: unknown, at: string) => void>> = {
  'target-configuration': (value, at) => { parseTargetConfiguration(value, at); },
  'ta3-oq-plan': (value, at) => { parseTa3OqPlan(value, at); },
};

function writeInput(evidencePackage: EvidencePackage, input: PreparedInput): PackageInput {
  packageCheck(!evidencePackage.sealed, `Package ${evidencePackage.dir} is sealed; nothing more is retained in it.`);
  packageCheck(!evidencePackage.inputs.some(entry => entry.role === input.role), `Package input ${input.role} is already retained.`);
  fs.mkdirSync(path.join(evidencePackage.dir, 'inputs'), { recursive: true });
  fs.writeFileSync(path.join(evidencePackage.dir, ...input.path.split('/')), input.bytes, { flag: 'wx' });
  const { bytes: _bytes, ...entry } = input;
  evidencePackage.inputs.push(entry);
  return entry;
}

/** Creates <retainRoot>/<yyyymmddTHHMMSSZ>-<version>-<first 8 hex of the package ID>/
 * exclusively (the leaf is never created recursively, so an existing one is
 * refused, never reused) and copies the inputs into it. The inputs are read and
 * checked first, so a refused input leaves nothing behind. From here until the
 * package is sealed, saveEvidence and the document helpers mark what the run
 * writes as this package's evidence. */
export function createPackage(options: PackageOptions): EvidencePackage {
  packageCheck(VERSION_LABEL.test(options.version), 'A retained package needs a --version of 1 to 64 letters, digits, dots, '
    + `underscores or hyphens, starting with a letter or digit; got ${JSON.stringify(options.version)}.`);
  packageCheck(options.syntheticBasis.every(basis => (SYNTHETIC_BASES as readonly string[]).includes(basis)), 'Unknown synthetic basis.');
  const basis = SYNTHETIC_BASES.filter(item => options.syntheticBasis.includes(item));
  const synthetic = basis.length > 0;
  const root = retentionRoot(options.retainRoot, synthetic);
  const prepared = (options.inputs ?? []).map(prepareInput);
  packageCheck(new Set(prepared.map(input => input.role)).size === prepared.length, 'Each package input role is retained once.');
  const packageId = options.packageId ?? randomUUID();
  packageCheck(UUID_V4.test(packageId), `Package ID ${JSON.stringify(packageId)} is not a UUID v4.`);
  const createdAt = (options.now ?? new Date()).toISOString();
  const stamp = `${createdAt.slice(0, 19).replace(/[-:]/g, '')}Z`;
  const dir = path.join(root, `${stamp}-${options.version}-${packageId.slice(0, 8)}`);
  fs.mkdirSync(root, { recursive: true });
  try { fs.mkdirSync(dir); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Retained package ${dir} already exists; a retained package is never overwritten.`);
    throw error;
  }
  const evidencePackage: EvidencePackage = {
    dir, packageId, version: options.version, createdAt, executed: options.executed, synthetic, syntheticBasis: basis, inputs: [], sealed: false,
  };
  for (const input of prepared) writeInput(evidencePackage, input);
  setEvidenceMarking({ synthetic, retained: true });
  return evidencePackage;
}

/** Copies and hashes one more plan or declaration into inputs/<role>.json. */
export function retainInput(evidencePackage: EvidencePackage, role: PackageInputRole, file: string): PackageInput {
  packageCheck(!evidencePackage.sealed, `Package ${evidencePackage.dir} is sealed; nothing more is retained in it.`);
  return writeInput(evidencePackage, prepareInput({ role, file }));
}

const resultsFile = (category: EvidenceCategory) => `evidence/${category}/${category}-results.json`;

function categoryCounts(category: EvidenceCategory, results: EvidenceResult[]): PackageCategory {
  return {
    category,
    total: results.length,
    passed: results.filter(result => result.passed).length,
    failed: results.filter(result => !result.passed).length,
    manual: results.filter(result => result.method === 'MANUAL').length,
    // A not-executed case is a failed CONTRACT row, as the evidence linker reads it.
    notExecuted: results.filter(result => !result.passed && result.method === 'CONTRACT').length,
  };
}

/** Every file of a package as a posix path relative to it, in code-unit order;
 * an entry that is neither a regular file nor a directory, or an unsafe name, is a problem. */
function packageEntries(dir: string): { files: string[]; problems: string[] } {
  const files: string[] = [], problems: string[] = [];
  const walk = (current: string, prefix: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!SAFE_SEGMENT.test(entry.name)) problems.push(`${relative} has a name a package file may not have`);
      else if (entry.isDirectory()) walk(path.join(current, entry.name), relative);
      else if (entry.isFile()) files.push(relative);
      else problems.push(`${relative} is not a regular file or directory`);
    }
  };
  walk(dir, '');
  return { files: files.sort(), problems };
}

export interface SealOptions {
  /** The target live runners used; recorded with what /health reported. */
  baseUrl?: string;
  now?: Date;
}

export interface SealedPackage {
  dir: string;
  manifestPath: string;
  /** The SHA-256 of package-manifest.json's bytes: the contentHash the eTMF must show. */
  manifestSha256: string;
  packageHash: string;
  files: number;
}

/** Writes TMF-FILING.md, hashes every file, writes package-manifest.json last,
 * makes every file read-only and verifies the result. Called at the end of a run
 * whatever its outcome, so a failed run is retained too. */
export function sealPackage(evidencePackage: EvidencePackage, options: SealOptions = {}): SealedPackage {
  packageCheck(!evidencePackage.sealed, `Package ${evidencePackage.dir} is already sealed.`);
  evidencePackage.sealed = true;
  const { dir } = evidencePackage;
  const manifestPath = path.join(dir, MANIFEST_FILE);
  try {
    packageCheck(!fs.existsSync(manifestPath), `Package ${dir} already holds ${MANIFEST_FILE}.`);
    fs.writeFileSync(path.join(dir, TMF_FILING_FILE), tmfFilingText({
      packageId: evidencePackage.packageId, version: evidencePackage.version, synthetic: evidencePackage.synthetic,
    }), { flag: 'wx' });
    const categories = EVIDENCE_CATEGORIES.filter(category => fs.existsSync(path.join(dir, ...resultsFile(category).split('/'))))
      .map(category => categoryCounts(category, loadEvidence(dir, category)));
    const entries = packageEntries(dir);
    packageCheck(!entries.problems.length, `Package ${dir} cannot be sealed: ${entries.problems.join('; ')}.`);
    const files = entries.files.map((relative): PackageFile => {
      const file = path.join(dir, ...relative.split('/'));
      fs.chmodSync(file, 0o444);
      const bytes = fs.readFileSync(file);
      return { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
    });
    const identity = currentReleaseIdentity();
    const framework = frameworkCommit();
    const declaration = evidencePackage.inputs.find(input => input.role === 'target-configuration');
    const body: Omit<PackageManifest, 'packageHash'> = {
      contract: PACKAGE_CONTRACT,
      packageId: evidencePackage.packageId,
      version: evidencePackage.version,
      createdAt: evidencePackage.createdAt,
      sealedAt: (options.now ?? new Date()).toISOString(),
      executed: evidencePackage.executed,
      synthetic: evidencePackage.synthetic,
      syntheticBasis: [...evidencePackage.syntheticBasis],
      ...(evidencePackage.synthetic ? { syntheticNotice: SYNTHETIC_NOTICE } : {}),
      framework: { commit: framework.commit ?? null, dirty: framework.dirty ?? null },
      // A plain JSON copy: the identity object may hold members JSON leaves out.
      releaseUnderTest: identity ? JSON.parse(JSON.stringify(identity)) as ReleaseIdentity : null,
      target: options.baseUrl
        ? { baseUrl: options.baseUrl, observedAt: identity?.target?.observedAt ?? null, reportedVersion: identity?.target?.version ?? null }
        : null,
      // The retained declaration with what IQ-033 and the observing OQ cases contradicted (spec P20 3.9).
      configurationUnderTest: declaration
        ? configurationUnderTest(fs.readFileSync(path.join(dir, ...declaration.path.split('/'))),
          { iq: loadEvidence(dir, 'iq'), oq: loadEvidence(dir, 'oq') })
        : null,
      inputs: evidencePackage.inputs.map(input => ({ ...input })),
      categories,
      files,
      approval: { state: 'unapproved', recordedIn: APPROVAL_RECORDED_IN },
    };
    const packageHash = manifestHash(body);
    const manifestBytes = Buffer.from(`${JSON.stringify({ ...body, packageHash }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(manifestPath, manifestBytes, { flag: 'wx' });
    fs.chmodSync(manifestPath, 0o444);
    const verified = verifyPackage(dir);
    packageCheck(verified.ok, `Package ${dir} was sealed but does not verify: ${verified.problems.join('; ')}.`);
    return { dir, manifestPath, manifestSha256: sha256(manifestBytes), packageHash, files: files.length };
  } finally {
    // Nothing more is written as this package's evidence.
    setEvidenceMarking(undefined);
  }
}

function manifestText(value: unknown, at: string): string {
  packageCheck(typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value), `${at} must be text`);
  return value;
}
function manifestPattern(value: unknown, at: string, pattern: RegExp): string {
  packageCheck(typeof value === 'string' && pattern.test(value), `${at} is malformed`);
  return value;
}
function manifestCount(value: unknown, at: string): number {
  packageCheck(Number.isSafeInteger(value) && Number(value) >= 0, `${at} must be a count`);
  return Number(value);
}
function manifestArray(value: unknown, at: string): unknown[] {
  packageCheck(Array.isArray(value), `${at} must be an array`);
  return value;
}
const oneOf = <T extends string>(value: unknown, at: string, allowed: readonly T[]): T => {
  packageCheck(typeof value === 'string' && (allowed as readonly string[]).includes(value), `${at} must be one of ${allowed.join(', ')}`);
  return value as T;
};

function releaseIdentityShape(value: unknown, at: string): void {
  const identity = strictObject(value, at, ['contract', 'components', 'identityHash', 'framework'], ['target']);
  const contract = oneOf(identity.contract, `${at}.contract`, [RELEASE_CONTRACT_V1, RELEASE_CONTRACT_V2]);
  manifestPattern(identity.identityHash, `${at}.identityHash`, SHA256_HEX);
  const names = releaseComponentNames({ contract });
  const components = strictObject(identity.components, `${at}.components`, names);
  for (const name of names) {
    const component = strictObject(components[name], `${at}.components.${name}`, ['identity', 'kind', 'source']);
    manifestText(component.identity, `${at}.components.${name}.identity`);
    oneOf(component.kind, `${at}.components.${name}.kind`, ['git-commit', 'image-id', 'not-deployed']);
    oneOf(component.source, `${at}.components.${name}.source`, ['operator-input', 'target-version-endpoint']);
  }
  strictObject(identity.framework, `${at}.framework`, [], ['commit', 'dirty']);
  if (identity.target !== undefined) packageCheck(isRecord(identity.target), `${at}.target must be an object`);
}

/** Strict reading of package-manifest.json: every member of the contract and nothing else. */
export function parseManifest(value: unknown): PackageManifest {
  const at = MANIFEST_FILE;
  const manifest = strictObject(value, at, MANIFEST_REQUIRED, MANIFEST_OPTIONAL);
  packageCheck(manifest.contract === PACKAGE_CONTRACT, `${at} contract must be ${PACKAGE_CONTRACT}`);
  manifestPattern(manifest.packageId, `${at} packageId`, UUID_V4);
  manifestPattern(manifest.version, `${at} version`, VERSION_LABEL);
  manifestPattern(manifest.createdAt, `${at} createdAt`, INSTANT);
  manifestPattern(manifest.sealedAt, `${at} sealedAt`, INSTANT);
  packageCheck(Date.parse(String(manifest.sealedAt)) >= Date.parse(String(manifest.createdAt)), `${at} sealedAt precedes createdAt`);
  packageCheck(typeof manifest.executed === 'boolean', `${at} executed must be a boolean`);
  packageCheck(typeof manifest.synthetic === 'boolean', `${at} synthetic must be a boolean`);
  const basis = manifestArray(manifest.syntheticBasis, `${at} syntheticBasis`).map((item, index) => oneOf(item, `${at} syntheticBasis[${index}]`, SYNTHETIC_BASES));
  packageCheck(new Set(basis).size === basis.length, `${at} syntheticBasis repeats a basis`);
  packageCheck(manifest.synthetic === basis.length > 0, `${at} synthetic must be true exactly when syntheticBasis names a basis`);
  packageCheck(manifest.synthetic ? manifest.syntheticNotice === SYNTHETIC_NOTICE : manifest.syntheticNotice === undefined,
    `${at} syntheticNotice must be the synthetic notice exactly when the package is synthetic`);
  const framework = strictObject(manifest.framework, `${at} framework`, MANIFEST_MEMBER_REQUIRED.framework);
  packageCheck(framework.commit === null || (typeof framework.commit === 'string' && GIT_COMMIT.test(framework.commit)), `${at} framework.commit is malformed`);
  packageCheck(framework.dirty === null || typeof framework.dirty === 'boolean', `${at} framework.dirty must be a boolean or null`);
  if (manifest.releaseUnderTest !== null) releaseIdentityShape(manifest.releaseUnderTest, `${at} releaseUnderTest`);
  if (manifest.target !== null) {
    const target = strictObject(manifest.target, `${at} target`, MANIFEST_MEMBER_REQUIRED.target);
    let url: URL | undefined;
    try { url = new URL(manifestText(target.baseUrl, `${at} target.baseUrl`)); } catch { url = undefined; }
    packageCheck(url && ['http:', 'https:'].includes(url.protocol), `${at} target.baseUrl must be an http or https URL`);
    packageCheck(target.observedAt === null || (typeof target.observedAt === 'string' && Number.isFinite(Date.parse(target.observedAt))),
      `${at} target.observedAt must be an instant or null`);
    if (target.reportedVersion !== null) manifestText(target.reportedVersion, `${at} target.reportedVersion`);
  }
  if (manifest.configurationUnderTest !== null) parseConfigurationUnderTest(manifest.configurationUnderTest, `${at} configurationUnderTest`);
  const roles = manifestArray(manifest.inputs, `${at} inputs`).map((item, index) => {
    const input = strictObject(item, `${at} inputs[${index}]`, MANIFEST_MEMBER_REQUIRED.input);
    const role = oneOf(input.role, `${at} inputs[${index}].role`, INPUT_ROLES);
    packageCheck(input.path === `inputs/${role}.json`, `${at} inputs[${index}].path must be inputs/${role}.json`);
    manifestPattern(input.sha256, `${at} inputs[${index}].sha256`, SHA256_HEX);
    manifestText(input.originalPath, `${at} inputs[${index}].originalPath`);
    return role;
  });
  packageCheck(new Set(roles).size === roles.length, `${at} inputs repeat a role`);
  const categories = manifestArray(manifest.categories, `${at} categories`).map((item, index) => {
    const entry = strictObject(item, `${at} categories[${index}]`, MANIFEST_MEMBER_REQUIRED.category);
    const category = oneOf(entry.category, `${at} categories[${index}].category`, EVIDENCE_CATEGORIES);
    const [total, passed, failed, manual, notExecuted] = (['total', 'passed', 'failed', 'manual', 'notExecuted'] as const)
      .map(key => manifestCount(entry[key], `${at} categories[${index}].${key}`));
    packageCheck(passed + failed === total && manual + notExecuted <= failed, `${at} categories[${index}] counts do not add up`);
    return category;
  });
  packageCheck(new Set(categories).size === categories.length, `${at} categories repeat a category`);
  packageCheck(manifest.executed || categories.length === 0, `${at} is a documents package but lists evidence categories`);
  let previous = '';
  for (const [index, item] of manifestArray(manifest.files, `${at} files`).entries()) {
    const file = strictObject(item, `${at} files[${index}]`, MANIFEST_MEMBER_REQUIRED.file);
    const filePath = manifestText(file.path, `${at} files[${index}].path`);
    packageCheck(filePath.split('/').every(segment => SAFE_SEGMENT.test(segment)) && filePath !== MANIFEST_FILE,
      `${at} files[${index}].path is not a package file path`);
    // Code-unit order, the default string comparison, never localeCompare.
    packageCheck(filePath > previous, `${at} files are not unique and in code-unit order at ${filePath}`);
    previous = filePath;
    manifestCount(file.bytes, `${at} files[${index}].bytes`);
    manifestPattern(file.sha256, `${at} files[${index}].sha256`, SHA256_HEX);
  }
  const approval = strictObject(manifest.approval, `${at} approval`, MANIFEST_MEMBER_REQUIRED.approval);
  packageCheck(approval.state === 'unapproved' && approval.recordedIn === APPROVAL_RECORDED_IN,
    `${at} approval must state that approval is recorded in the eTMF, not in the package`);
  manifestPattern(manifest.packageHash, `${at} packageHash`, SHA256_HEX);
  return manifest as unknown as PackageManifest;
}

export interface PackageVerification {
  ok: boolean;
  dir: string;
  problems: string[];
  /** The SHA-256 of package-manifest.json's bytes, the contentHash filed in the eTMF. */
  manifestSha256?: string;
  manifest?: PackageManifest;
}

/** Verifies a sealed package: every listed file is present with its byte count
 * and SHA-256, no unlisted file exists and the package hash recomputes. It also
 * checks what sealing promises: inputs and evidence counts match their files, a
 * synthetic package marks every record and document, and no record or document
 * of a package claims to be a development run. */
export function verifyPackage(directory: string): PackageVerification {
  const dir = path.resolve(directory);
  let manifestBytes: Buffer;
  try { manifestBytes = fs.readFileSync(path.join(dir, MANIFEST_FILE)); }
  catch (error) { return { ok: false, dir, problems: [`${MANIFEST_FILE} cannot be read (${errorText(error)}); the package is not sealed`] }; }
  const manifestSha256 = sha256(manifestBytes);
  let manifest: PackageManifest;
  try { manifest = parseManifest(JSON.parse(manifestBytes.toString('utf8'))); }
  catch (error) { return { ok: false, dir, problems: [error instanceof SyntaxError ? `${MANIFEST_FILE} is not JSON` : errorText(error)], manifestSha256 }; }
  const problems: string[] = [];
  const { packageHash, ...body } = manifest;
  if (manifestHash(body) !== packageHash) problems.push('packageHash does not recompute from the manifest');

  const entries = packageEntries(dir);
  problems.push(...entries.problems);
  const listed = new Map(manifest.files.map(file => [file.path, file]));
  for (const file of entries.files) {
    if (file !== MANIFEST_FILE && !listed.has(file)) problems.push(`${file} is not listed in the manifest`);
  }
  const contents = new Map<string, Buffer>();
  for (const file of manifest.files) {
    let bytes: Buffer;
    try { bytes = fs.readFileSync(path.join(dir, ...file.path.split('/'))); }
    catch { problems.push(`${file.path} is missing`); continue; }
    if (bytes.length !== file.bytes) problems.push(`${file.path} has ${bytes.length} bytes, not ${file.bytes}`);
    else if (sha256(bytes) !== file.sha256) problems.push(`${file.path} does not match its SHA-256`);
    else contents.set(file.path, bytes);
  }

  for (const input of manifest.inputs) {
    if (listed.get(input.path)?.sha256 !== input.sha256) problems.push(`input ${input.role} is not the listed ${input.path}`);
  }
  // The configuration under test is the retained declaration's; its mismatches are what the run recorded.
  const declaration = manifest.inputs.find(input => input.role === 'target-configuration');
  const recorded = manifest.configurationUnderTest;
  if (Boolean(declaration) !== (recorded !== null)) {
    problems.push('configurationUnderTest must be recorded exactly when a target-configuration input is retained');
  } else if (declaration && recorded) {
    const bytes = contents.get(declaration.path);
    let flags: string | undefined;
    try { flags = bytes ? canonicalJson(parseTargetConfiguration(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))).flags, 'Declared flags') : undefined; }
    catch (error) { problems.push(`the retained declaration ${declaration.path} cannot be read (${errorText(error)})`); }
    if (recorded.sha256 !== declaration.sha256 || (flags !== undefined && flags !== canonicalJson(recorded.flags, 'Declared flags'))) {
      problems.push(`configurationUnderTest is not the retained declaration ${declaration.path}`);
    }
  }
  const counted = new Set(manifest.categories.map(entry => entry.category));
  for (const category of EVIDENCE_CATEGORIES) {
    if (listed.has(resultsFile(category)) && !counted.has(category)) problems.push(`evidence category ${category} is not counted`);
  }
  for (const entry of manifest.categories) {
    if (!contents.has(resultsFile(entry.category))) {
      problems.push(`evidence category ${entry.category} has no verified ${resultsFile(entry.category)}`);
      continue;
    }
    let results: EvidenceResult[];
    try { results = loadEvidence(dir, entry.category); }
    catch (error) { problems.push(errorText(error)); continue; }
    const recount = categoryCounts(entry.category, results);
    if ((['total', 'passed', 'failed', 'manual', 'notExecuted'] as const).some(key => recount[key] !== entry[key])) {
      problems.push(`evidence category ${entry.category} counts differ from ${resultsFile(entry.category)}`);
    }
    if (results.some(result => (result.synthetic === true) !== manifest.synthetic)) {
      problems.push(`evidence category ${entry.category} has records whose synthetic marking differs from the package`);
    }
    if (results.some(result => result.retention !== undefined)) {
      problems.push(`evidence category ${entry.category} has records marked as a development run`);
    }
  }
  for (const [file, bytes] of contents) {
    if (!file.endsWith('.md')) continue;
    const text = bytes.toString('utf8');
    if (manifest.synthetic && !text.includes(SYNTHETIC_NOTICE)) problems.push(`${file} lacks the synthetic notice`);
    if (text.includes(DEVELOPMENT_RUN_NOTICE)) problems.push(`${file} is marked as a development run`);
  }
  return { ok: problems.length === 0, dir, problems, manifestSha256, manifest };
}
