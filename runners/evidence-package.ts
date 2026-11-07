import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  canonicalJson, checkExecutorName, currentEvidenceMarking, isCredentialKey, isInside, isRecord, isWithin, loadEvidence, setEvidenceMarking, strictObject,
  DECLARED_PUBLIC_DATA_NOTICE, DEVELOPMENT_RUN_NOTICE, EVIDENCE_CATEGORIES, SHA256_HEX, SYNTHETIC_NOTICE, type EvidenceCategory, type EvidenceResult,
} from './evidence-capture';
import {
  currentReleaseIdentity, frameworkCommit, frameworkSharedTypes, releaseComponentNames, NO_RECEIPT, NOT_RESOLVED, RELEASE_CONTRACT_V1,
  RELEASE_CONTRACT_V2, type FrameworkSharedTypes, type ReleaseIdentity,
} from './release-identity';
import {
  citedRunFile, pilotRowRunFiles, publicDataAdmissionOf, publicDataClaim, BENCHMARK_RUN_FILES, PUBLIC_DATA_EVIDENCE_LEVEL,
  type PublicDataAdmission, type RecordedRunFile,
} from './benchmark-evidence';
import { PILOT_IMPORT_SWITCH, PILOT_PUBLIC_DATA_SWITCH } from '../config/ta3-pq-cases';
import {
  configurationUnderTest, parseConfigurationUnderTest, parseTargetConfiguration,
  CONFIGURATION_MISMATCH_REQUIRED, CONFIGURATION_UNDER_TEST_REQUIRED, type ConfigurationUnderTest,
} from './target-configuration';
import { parseTa3OqPlan } from './ta3-oq-plan';
import {
  loadPlatformEvidencePlan, parsePlatformEvidencePlan, planEntries, PACKAGE_EVIDENCE_KIND,
  type PlatformEvidenceEntry, type PlatformEvidencePlan,
} from './platform-evidence-plan';
import { PLATFORM_SYSTEMS, type EvidenceAdmission, type PlatformSystemId } from '../config/platform-inventory';
import {
  isTrainingCaptureFile, scratchFilingText, tmfFilingText, NOT_RUN_OF_RECORD_LINE, RESTRICTED_FILING_LINE, TMF_FILING_FILE,
} from '../generators/helpers/tmf-filing';

// Retained evidence packages (TA3 plan VAL-1, spec P20 VD-3, 3.2). A package is
// one exclusively created directory holding everything a run writes, sealed at
// the end by package-manifest.json (every file with its byte count and SHA-256,
// and a package hash) and made read-only. This module owns every filesystem
// call packaging needs: generate.ts calls it and makes none of its own, so the
// offline CLI fixture passes this module through to the real filesystem.

// generate.ts reaches the evidence marking, the executor name check, the configuration
// declaration check, the TA3 OQ plan check and the platform evidence plan check
// (checkPlatformEvidencePlan, below) through this module, because the offline CLI
// fixture replaces every other runner module it requires.
export { DEVELOPMENT_RUN_NOTICE, SYNTHETIC_NOTICE, checkExecutorName, evidenceNoticeLines } from './evidence-capture';
export { checkTargetConfiguration } from './target-configuration';
export { loadTa3OqPlan as checkTa3OqPlan } from './ta3-oq-plan';

export const PACKAGE_CONTRACT = 'validation-evidence-package/1';
export const MANIFEST_FILE = 'package-manifest.json';
/** The marker file of a synthetic data root (CommandCenter synthetic-trial/lib/paths.mjs). */
export const SYNTHETIC_ROOT_MARKER = 'SYNTHETIC-TRIAL-DATA-ROOT';
/** Where synthetic packages live below the marked root: the existing runs zone. No new zone is created,
 * and the directory name carries no time stamp, so the data root's retention never moves it. */
export const SYNTHETIC_PACKAGE_HOME = ['runs', 'validation-packages'] as const;
/** The marker file QA places at the retention root it names for packages that are not synthetic.
 * No code creates it: without it such a package is refused (RF-070). */
export const QA_RETENTION_ROOT_MARKER = 'QA-RETENTION-ROOT';
/** Where a package keeps the byte copy of the filed declared-public-data basis it was admitted under (D-LE-14). Listed
 * in the manifest like every other file; no manifest member or input role changes (validation-evidence-package/1). */
export const PUBLIC_DATA_BASIS_FILE = 'evidence/public-data-basis.json';
/** The platform summary a package holds (generators/22-platform-validation-summary.ts): the document, and its
 * platform-validation-summary/1 JSON, whose evidence entries carry declaredPublicData for a cited package admitted under
 * that basis. A package holding such an entry carries the declared public data notice; verifyPackage reads that from the
 * JSON, never from the document's words. */
export const PLATFORM_SUMMARY_DOCUMENT = '22-platform-validation-summary.md';
export const PLATFORM_SUMMARY_FILE = 'platform-validation-summary.json';
/** The words a citing evidence row's detail carries for the reader of the document. */
const PUBLIC_DATA_CITATION = 'declared public data under the filed basis';

/** What a package retains in inputs/<role>.json. ta3-oq-plan is the --ta3-oq-plan file,
 * target-configuration the --target-config declaration and platform-evidence-plan the
 * --platform-evidence plan of the platform summary. */
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
export const MANIFEST_OPTIONAL = ['syntheticNotice', 'executor'] as const;
export const MANIFEST_MEMBER_REQUIRED = {
  framework: ['commit', 'dirty'],
  executor: ['name', 'osAccount'],
  target: ['baseUrl', 'observedAt', 'reportedVersion'],
  input: ['role', 'path', 'sha256', 'originalPath'],
  category: ['category', 'total', 'passed', 'failed', 'manual', 'notExecuted'],
  file: ['path', 'bytes', 'sha256'],
  approval: ['state', 'recordedIn'],
  configurationUnderTest: CONFIGURATION_UNDER_TEST_REQUIRED,
  mismatch: CONFIGURATION_MISMATCH_REQUIRED,
} as const;
/** Optional members of the manifest's objects: the framework's shared-types build (IR-272), present
 * when the framework checkout's package.json names one, so a package from another checkout keeps its bytes. */
export const MANIFEST_MEMBER_OPTIONAL: Partial<Record<keyof typeof MANIFEST_MEMBER_REQUIRED, readonly string[]>> = {
  framework: ['sharedTypes'],
};
/** Members of a vendored contract build and of the framework's shared-types build (release-identity.ts). */
export const VENDORED_BUILD_REQUIRED = ['selector', 'archive', 'archiveSha256', 'receiptSha256'] as const;
export const FRAMEWORK_SHARED_TYPES_REQUIRED = [...VENDORED_BUILD_REQUIRED, 'receiptManifestSha256', 'installed'] as const;

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
/** Who ran the CLI (IR-090): the --executor name and the operating system account the run was
 * started from (os.userInfo, null when it cannot be read). Attribution only: nothing is signed (D-21). */
export interface PackageExecutor { name: string; osAccount: string | null }
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
  /** Present only when the run named its executor; every record then carries executedBy equal to its name. */
  executor?: PackageExecutor;
  framework: { commit: string | null; dirty: boolean | null; sharedTypes?: FrameworkSharedTypes };
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
  /** The person who ran the CLI, when --executor named one. */
  readonly executor?: PackageExecutor;
  /** The framework checkout read when the package was created, and what it was then. */
  readonly frameworkCheckout?: string;
  readonly frameworkAtStart: { commit?: string; dirty?: boolean };
  /** The filed basis the package was admitted under; absent for every package but an admitted R2 import (D-LE-14). */
  readonly declaredPublicData?: { basisRef: string; basisSha256: string };
  /** A package that is not synthetic and whose platform evidence plan cites a package admitted under that basis. */
  readonly citesDeclaredPublicData?: true;
  sealed: boolean;
}

export interface PackageOptions {
  retainRoot: string;
  /** The --version label; part of the directory name. */
  version: string;
  executed: boolean;
  syntheticBasis: readonly SyntheticBasis[];
  inputs?: readonly PackageInputSource[];
  /** An admission from admitPublicDataRun. Required for a package that imports a run and is not synthetic. */
  publicData?: PublicDataAdmission;
  /** The platform evidence plan cites a package admitted under the declared-public-data basis (checkPlatformEvidencePlan):
   * a package that is not synthetic then carries the notice and the intended-use limit too. */
  citesDeclaredPublicData?: boolean;
  /** generate.ts --allow-dirty-framework: retain a run from a framework checkout that is
   * dirty or unreadable; its TMF-FILING.md then says it is not a run of record. */
  allowDirtyFramework?: boolean;
  /** generate.ts --executor: the person running the CLI, recorded in the manifest and on every
   * record. Required for an executed package that is not synthetic (IR-090). */
  executor?: string;
  /** The framework checkout to read; this checkout when absent. For tests only. */
  frameworkCheckout?: string;
  /** A fixed clock and package ID, for tests only. */
  now?: Date;
  packageId?: string;
}

const VERSION_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
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
/** A JSON Web Token anywhere in a string: a base64url JSON header ("eyJ"), a payload and a signature part. */
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/;
/** A PEM block (a private key, a certificate or any other) anywhere in a string. */
const PEM_VALUE = /-----BEGIN [A-Z0-9 ]+-----/;

function packageCheck(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const errorText = (error: unknown) => (error as NodeJS.ErrnoException)?.code ?? (error instanceof Error ? error.message : String(error));

/** The SHA-256 of the canonical JSON of the manifest without its packageHash. */
export function manifestHash(manifest: Omit<PackageManifest, 'packageHash'> | Record<string, unknown>): string {
  return sha256(canonicalJson(manifest, 'Package manifest'));
}

/** The VD-3 rule: synthetic when --synthetic-qualification is given, when an
 * import of synthetic engineering evidence ran (every benchmark import but an
 * admitted one, see admitPublicDataRun, and the P13 attachment), or when an entry
 * of the platform evidence plan is synthetic. */
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

/** Records and documents of a run that keeps its evidence in output/ scratch say so; its records
 * name the executor when one is given. */
export function markDevelopmentRun(synthetic: boolean, executor?: string): void {
  setEvidenceMarking({ synthetic, retained: false, ...(executor !== undefined ? { executor: checkExecutorName(executor) } : {}) });
}

/** The operating system account the CLI runs under, or null when it cannot be read. */
function osAccount(): string | null {
  try {
    const name = os.userInfo().username;
    return typeof name === 'string' && name.length > 0 && name.length <= 4096 && !/[\x00-\x1f\x7f]/.test(name) ? name : null;
  } catch {
    return null;
  }
}

const isFile = (file: string) => {
  try { return fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true; } catch { return false; }
};

/** The nearest directory at or above `start` holding the synthetic data root marker. */
export function markedDataRoot(start: string): string | undefined {
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

/** The nearest directory at or above `start` holding the QA retention root marker. */
export function qaRetentionRoot(start: string): string | undefined {
  for (let current = path.resolve(start); ; current = path.dirname(current)) {
    if (isFile(path.join(current, QA_RETENTION_ROOT_MARKER))) return current;
    if (path.dirname(current) === current) return undefined;
  }
}

/** The D-LE-14 decision on an imported run, taken before the package exists. A package that imports a run is synthetic
 * engineering evidence unless this admits it, and it admits only: both switches exactly 'true' (D-P13), no other synthetic
 * basis, a retain root inside a tree QA marked and outside any synthetic data root, and an R2 pilot summary classified
 * declared-public-data whose basisRef is a file QA filed inside that tree (a relative path, links resolved) with the
 * SHA-256 the summary states, in the basis contract, filed before the run started. The rule itself is
 * publicDataAdmissionOf, which the package verifier recomputes from the retained bytes. Reads files; writes nothing. */
export function admitPublicDataRun(options: {
  runDir: string;
  retainRoot?: string;
  otherSyntheticBases?: readonly SyntheticBasis[];
  /** The two switches; by default their environment variables, on only when exactly 'true'. */
  pilotImport?: boolean;
  publicDataSwitch?: boolean;
}): PublicDataAdmission {
  const refused = (code: string, reason: string): PublicDataAdmission => ({ admitted: false, claimed: true, code, reason });
  let summary: Buffer;
  try { summary = fs.readFileSync(path.join(path.resolve(options.runDir), BENCHMARK_RUN_FILES.summary)); }
  catch { return { admitted: false, claimed: false, code: 'PUBLIC_DATA_NOT_CLAIMED', reason: `${BENCHMARK_RUN_FILES.summary} cannot be read` }; }
  const claim = publicDataClaim(summary);
  if (!claim.claimed) return { admitted: false, claimed: false, code: 'PUBLIC_DATA_NOT_CLAIMED', reason: 'the run summary claims no declared-public-data basis' };
  if ('refusal' in claim) return claim.refusal;
  const pilotImport = options.pilotImport ?? process.env[PILOT_IMPORT_SWITCH] === 'true';
  const admission = options.publicDataSwitch ?? process.env[PILOT_PUBLIC_DATA_SWITCH] === 'true';
  if (!pilotImport || !admission) return refused('PUBLIC_DATA_ADMISSION_OFF', `${PILOT_IMPORT_SWITCH} and ${PILOT_PUBLIC_DATA_SWITCH} must both be exactly 'true'`);
  if (options.otherSyntheticBases?.length) return refused('PUBLIC_DATA_OTHER_SYNTHETIC_BASIS', `this run is also synthetic by ${options.otherSyntheticBases.join(', ')}`);
  if (!options.retainRoot) return refused('PUBLIC_DATA_NOT_RETAINED', 'an admitted package is retained under a QA retention root; this run has no --retain-root');
  const root = path.resolve(options.retainRoot);
  const qaRoot = qaRetentionRoot(root);
  if (!qaRoot) return refused('PUBLIC_DATA_NO_QA_ROOT', `${root} is in no tree holding ${QA_RETENTION_ROOT_MARKER}, which QA places`);
  const dataRoot = markedDataRoot(root);
  if (dataRoot) return refused('PUBLIC_DATA_NO_QA_ROOT', `${root} is inside the synthetic data root ${dataRoot}`);
  const segments = claim.basisRef.split('/');
  if (!claim.basisRef.endsWith('.json') || !segments.every(segment => SAFE_SEGMENT.test(segment))) {
    return refused('PUBLIC_DATA_BASIS_NOT_FILED', `basisRef ${JSON.stringify(claim.basisRef)} is not a relative path of a .json file inside the QA retention root`);
  }
  const target = path.join(qaRoot, ...segments);
  let bytes: Buffer;
  try {
    // A link inside the QA root that resolves outside it is not filed there.
    if (!isInside(fs.realpathSync(qaRoot), fs.realpathSync(target))) {
      return refused('PUBLIC_DATA_BASIS_NOT_FILED', `basisRef ${claim.basisRef} resolves outside the QA retention root ${qaRoot}`);
    }
    bytes = fs.readFileSync(target);
  } catch (error) {
    return refused('PUBLIC_DATA_BASIS_NOT_FILED', `basisRef ${claim.basisRef} is not a file in the QA retention root ${qaRoot} (${errorText(error)})`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { parsed = undefined; }
  const credential = parsed === undefined ? undefined : credentialAt(parsed, '$');
  if (credential) return refused('PUBLIC_DATA_BASIS_UNSUPPORTED', `the filed basis holds a credential at ${credential}`);
  return publicDataAdmissionOf(summary, bytes);
}

/** A synthetic package lives only under the marked data root's runs/validation-packages;
 * a package that is not synthetic lives only in a tree QA marked as its retention root
 * (QA_RETENTION_ROOT_MARKER), never in a synthetic data root (RF-070). Neither is written
 * into a git checkout: executed evidence is never kept in a repository. */
function retentionRoot(retainRoot: string, synthetic: boolean): string {
  const root = path.resolve(retainRoot);
  const checkout = enclosingCheckout(root);
  packageCheck(!checkout, `--retain-root ${root} is inside the git checkout ${checkout}; executed evidence is never retained in a repository.`);
  const marked = markedDataRoot(root);
  const qaRoot = qaRetentionRoot(root);
  if (synthetic) {
    packageCheck(marked, `A synthetic package is retained only under a synthetic data root (a directory tree holding `
      + `${SYNTHETIC_ROOT_MARKER}), and ${root} is not in one; use C:/Projects/.synthetic-trial-data/runs/validation-packages.`);
    const home = path.join(marked, ...SYNTHETIC_PACKAGE_HOME);
    packageCheck(isWithin(home, root), `A synthetic package is retained under ${home}, the data root's runs zone, not ${root}.`);
    packageCheck(!qaRoot, `A synthetic package is never retained in the QA retention root ${qaRoot}.`);
  } else {
    packageCheck(!marked, `A package that is not synthetic is never retained inside the synthetic data root ${marked}; `
      + 'use a retention root QA names.');
    packageCheck(qaRoot, `A package that is not synthetic is retained only under a retention root QA names: a directory tree `
      + `holding ${QA_RETENTION_ROOT_MARKER}, which QA places; ${root} is not in one.`);
  }
  return root;
}

/** A member name that holds a credential in a package input: the redaction list
 * (isCredentialKey) and, wider than it, any name ending in token, secret or private
 * key (githubToken, client_secret, sshPrivateKey). A name ending in Env names the
 * environment variable instead and is not one (RF-069). */
function credentialNamed(key: string): boolean {
  const normal = key.replace(/[-_]/g, '').toLowerCase();
  return isCredentialKey(key) || (!normal.endsWith('env') && /(?:token|secret|privatekey)$/.test(normal));
}

/** The first credential in a parsed input: a credential-named member that holds
 * anything but an environment variable name, a URL with a user and password, an
 * authorization header value, a JSON Web Token or a PEM block. */
function credentialAt(value: unknown, at: string): string | undefined {
  if (typeof value === 'string') {
    return URL_CREDENTIALS.test(value) || AUTHORIZATION_VALUE.test(value) || JWT_VALUE.test(value) || PEM_VALUE.test(value) ? at : undefined;
  }
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
    if (credentialNamed(key) && item !== null && item !== '' && !(typeof item === 'string' && ENVIRONMENT_NAME.test(item))) return where;
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
  'platform-evidence-plan': (value, at) => { parsePlatformEvidencePlan(value, at); },
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

function checkVersionLabel(what: string, version: string): void {
  packageCheck(VERSION_LABEL.test(version), `${what} needs a --version of 1 to 64 letters, digits, dots, `
    + `underscores or hyphens, starting with a letter or digit; got ${JSON.stringify(version)}.`);
}

/** Creates <root>/<yyyymmddTHHMMSSZ>-<version>-<first 8 hex of the ID>/ exclusively: the
 * leaf is never created recursively, so an existing one is refused, never reused. */
function createRunDirectory(root: string, version: string, id: string, createdAt: string, existsMessage: (dir: string) => string): string {
  const stamp = `${createdAt.slice(0, 19).replace(/[-:]/g, '')}Z`;
  const dir = path.join(root, `${stamp}-${version}-${id.slice(0, 8)}`);
  fs.mkdirSync(root, { recursive: true });
  try { fs.mkdirSync(dir); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(existsMessage(dir));
    throw error;
  }
  return dir;
}

/** Creates <retainRoot>/<yyyymmddTHHMMSSZ>-<version>-<first 8 hex of the package ID>/
 * exclusively (the leaf is never created recursively, so an existing one is
 * refused, never reused) and copies the inputs into it. The inputs are read and
 * checked first, so a refused input leaves nothing behind. From here until the
 * package is sealed, saveEvidence and the document helpers mark what the run
 * writes as this package's evidence. */
export function createPackage(options: PackageOptions): EvidencePackage {
  checkVersionLabel('A retained package', options.version);
  packageCheck(options.syntheticBasis.every(basis => (SYNTHETIC_BASES as readonly string[]).includes(basis)), 'Unknown synthetic basis.');
  const basis = SYNTHETIC_BASES.filter(item => options.syntheticBasis.includes(item));
  const synthetic = basis.length > 0;
  const executorName = options.executor === undefined ? undefined : checkExecutorName(options.executor);
  const root = retentionRoot(options.retainRoot, synthetic);
  // Executed evidence that is not synthetic names the person who ran it (IR-090, Part 11 attribution).
  packageCheck(executorName || !options.executed || synthetic, 'An executed package that is not synthetic names the person '
    + 'running the CLI: pass --executor <name>.');
  // A retained package is executed evidence of one framework commit: an unknown or dirty
  // checkout is refused before anything is created, unless the operator allows it (IR-056).
  const frameworkAtStart = frameworkCommit(options.frameworkCheckout);
  packageCheck(options.allowDirtyFramework || (frameworkAtStart.commit && frameworkAtStart.dirty === false),
    frameworkAtStart.commit
      ? `The framework checkout has uncommitted or untracked files at ${frameworkAtStart.commit}; a retained package is the run `
        + 'of one commit. Commit or remove them, or pass --allow-dirty-framework for a package that is not a run of record.'
      : 'The framework checkout\'s commit cannot be read; a retained package is the run of one commit. Pass '
        + '--allow-dirty-framework for a package that is not a run of record.');
  const prepared = (options.inputs ?? []).map(prepareInput);
  packageCheck(new Set(prepared.map(input => input.role)).size === prepared.length, 'Each package input role is retained once.');
  // Only the D-LE-14 admission makes an imported run a package that is not synthetic, and only for the summary it read.
  const admitted = options.publicData?.admitted ? options.publicData : undefined;
  const importedSummary = prepared.find(input => input.role === 'benchmark-run-summary');
  packageCheck(!admitted || !synthetic, 'A package admitted under the declared-public-data basis is not synthetic; this run is.');
  packageCheck(!admitted || importedSummary?.sha256 === admitted.summarySha256, 'The run summary changed after the declared-public-data admission read it.');
  packageCheck(synthetic || !importedSummary || admitted, 'A package that imports a run is synthetic unless the run is admitted under its filed '
    + 'declared-public-data basis (D-LE-14).');
  const citing = !synthetic && !admitted && options.citesDeclaredPublicData === true;
  const packageId = options.packageId ?? randomUUID();
  packageCheck(UUID_V4.test(packageId), `Package ID ${JSON.stringify(packageId)} is not a UUID v4.`);
  const createdAt = (options.now ?? new Date()).toISOString();
  const dir = createRunDirectory(root, options.version, packageId, createdAt,
    existing => `Retained package ${existing} already exists; a retained package is never overwritten.`);
  const evidencePackage: EvidencePackage = {
    dir, packageId, version: options.version, createdAt, executed: options.executed, synthetic, syntheticBasis: basis, inputs: [],
    ...(executorName ? { executor: { name: executorName, osAccount: osAccount() } } : {}),
    ...(options.frameworkCheckout ? { frameworkCheckout: options.frameworkCheckout } : {}), frameworkAtStart,
    ...(admitted ? { declaredPublicData: { basisRef: admitted.basisRef, basisSha256: admitted.basisSha256 } } : {}),
    ...(citing ? { citesDeclaredPublicData: true as const } : {}), sealed: false,
  };
  for (const input of prepared) writeInput(evidencePackage, input);
  if (admitted) {
    const copy = path.join(dir, ...PUBLIC_DATA_BASIS_FILE.split('/'));
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.writeFileSync(copy, admitted.bytes, { flag: 'wx' });
  }
  setEvidenceMarking({ synthetic, retained: true, ...(executorName ? { executor: executorName } : {}), ...(admitted || citing ? { declaredPublicData: true } : {}) });
  return evidencePackage;
}

export interface ScratchRunOptions {
  /** The git-ignored output/ folder of the framework checkout. */
  outputRoot: string;
  /** The --version label; part of the folder name. */
  version: string;
  /** A fixed clock and run ID, for tests only. */
  now?: Date;
  runId?: string;
}

export interface ScratchRun {
  readonly dir: string;
  readonly runId: string;
  readonly createdAt: string;
}

/** Creates the scratch folder of a run that retains nothing (a documents run, --no-retain, or an
 * evidence import given neither flag): <outputRoot>/<yyyymmddTHHMMSSZ>-<version>-<first 8 hex of
 * the run ID>/, exclusively as createPackage does, so a rerun never replaces an earlier run's
 * results or mixes its leftover cases and categories in (IR-034). It writes the scratch
 * TMF-FILING.md the documents' approval blocks name, which says the folder is never filed or
 * approved (RF-013). Call it after the run's evidence marking is set, so the file carries it. */
export function createScratchRun(options: ScratchRunOptions): ScratchRun {
  checkVersionLabel('A run', options.version);
  const runId = options.runId ?? randomUUID();
  packageCheck(UUID_V4.test(runId), `Run ID ${JSON.stringify(runId)} is not a UUID v4.`);
  const createdAt = (options.now ?? new Date()).toISOString();
  const dir = createRunDirectory(options.outputRoot, options.version, runId, createdAt,
    existing => `Scratch folder ${existing} already exists; a run never writes into an earlier run's folder.`);
  fs.writeFileSync(path.join(dir, TMF_FILING_FILE), scratchFilingText({
    folder: path.basename(dir), runId, version: options.version, marking: currentEvidenceMarking(),
  }), { flag: 'wx' });
  return { dir, runId, createdAt };
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
  /** Set when the package is not a run of record (its TMF-FILING.md opens with the line). */
  notRunOfRecord?: typeof NOT_RUN_OF_RECORD_LINE;
  /** Set when the package retains the privileged training capture (its TMF-FILING.md opens with the line). */
  restricted?: typeof RESTRICTED_FILING_LINE;
}

/** A package is not a run of record when the framework checkout was dirty or unreadable
 * when it was created (allowed by --allow-dirty-framework), or when it is dirty,
 * unreadable or at another commit when it is sealed. */
function notRunOfRecord(start: { commit?: string; dirty?: boolean }, end: { commit?: string; dirty?: boolean }): boolean {
  return !start.commit || start.dirty !== false || !end.commit || end.dirty !== false || end.commit !== start.commit;
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
    const framework = frameworkCommit(evidencePackage.frameworkCheckout);
    const sharedTypes = frameworkSharedTypes(evidencePackage.frameworkCheckout);
    // The privileged training capture stays with the package and is never uploaded (IR-453).
    const restricted = packageEntries(dir).files.some(isTrainingCaptureFile);
    fs.writeFileSync(path.join(dir, TMF_FILING_FILE), tmfFilingText({
      packageId: evidencePackage.packageId, version: evidencePackage.version, synthetic: evidencePackage.synthetic,
      ...(evidencePackage.declaredPublicData ? { declaredPublicData: evidencePackage.declaredPublicData } : {}),
      ...(evidencePackage.citesDeclaredPublicData ? { citesDeclaredPublicData: true } : {}),
      ...(notRunOfRecord(evidencePackage.frameworkAtStart, framework) ? { notRunOfRecord: true } : {}),
      ...(restricted ? { restricted: true } : {}),
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
      // Only when --executor named one, so a package naming none keeps its manifest bytes (IR-090).
      ...(evidencePackage.executor ? { executor: { ...evidencePackage.executor } } : {}),
      framework: { commit: framework.commit ?? null, dirty: framework.dirty ?? null, ...(sharedTypes ? { sharedTypes } : {}) },
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
    return {
      dir, manifestPath, manifestSha256: sha256(manifestBytes), packageHash, files: files.length,
      ...(verified.notRunOfRecord ? { notRunOfRecord: verified.notRunOfRecord } : {}),
      ...(verified.restricted ? { restricted: verified.restricted } : {}),
    };
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

const nullOr = (value: unknown, at: string, check: (value: unknown, at: string) => unknown) => {
  if (value !== null) check(value, at);
};

/** A vendored contract build (release-identity.ts VendoredBuild): its selector, archive path,
 * archive SHA-256 and the SHA-256 its receipt states, or `no receipt`. */
function vendoredBuildShape(value: unknown, at: string, members: readonly string[] = VENDORED_BUILD_REQUIRED): Record<string, unknown> {
  const build = strictObject(value, at, members);
  nullOr(build.selector, `${at}.selector`, manifestText);
  nullOr(build.archive, `${at}.archive`, (item, where) => manifestPattern(item, where, /^vendor\/[A-Za-z0-9._-]+\.tgz$/));
  nullOr(build.archiveSha256, `${at}.archiveSha256`, (item, where) => manifestPattern(item, where, SHA256_HEX));
  packageCheck(build.receiptSha256 === NO_RECEIPT || (typeof build.receiptSha256 === 'string' && SHA256_HEX.test(build.receiptSha256)),
    `${at}.receiptSha256 must be a SHA-256 or ${NO_RECEIPT}`);
  return build;
}

/** The framework's shared-types build with the build installed in its node_modules. */
function frameworkSharedTypesShape(value: unknown, at: string): void {
  const build = vendoredBuildShape(value, at, FRAMEWORK_SHARED_TYPES_REQUIRED);
  nullOr(build.receiptManifestSha256, `${at}.receiptManifestSha256`, (item, where) => manifestPattern(item, where, SHA256_HEX));
  const installed = strictObject(build.installed, `${at}.installed`, ['version', 'manifestSha256']);
  nullOr(installed.version, `${at}.installed.version`, manifestText);
  nullOr(installed.manifestSha256, `${at}.installed.manifestSha256`, (item, where) => manifestPattern(item, where, SHA256_HEX));
}

/** The API's contract builds at the API release under test, or `not resolved` with the reason. */
function apiContractsShape(value: unknown, at: string): void {
  packageCheck(isRecord(value), `${at} must be an object`);
  if (value.status === NOT_RESOLVED) {
    const unresolved = strictObject(value, at, ['status', 'reason']);
    manifestText(unresolved.reason, `${at}.reason`);
    return;
  }
  const resolved = strictObject(value, at, ['status', 'commit', 'sharedTypes', 'interop']);
  packageCheck(resolved.status === 'resolved', `${at}.status must be resolved or ${NOT_RESOLVED}`);
  manifestPattern(resolved.commit, `${at}.commit`, GIT_COMMIT);
  vendoredBuildShape(resolved.sharedTypes, `${at}.sharedTypes`);
  vendoredBuildShape(resolved.interop, `${at}.interop`);
}

function releaseIdentityShape(value: unknown, at: string): void {
  const identity = strictObject(value, at, ['contract', 'components', 'identityHash', 'framework'], ['apiContracts', 'target']);
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
  const framework = strictObject(identity.framework, `${at}.framework`, [], ['commit', 'dirty', 'sharedTypes']);
  if (framework.sharedTypes !== undefined) frameworkSharedTypesShape(framework.sharedTypes, `${at}.framework.sharedTypes`);
  if (identity.apiContracts !== undefined) apiContractsShape(identity.apiContracts, `${at}.apiContracts`);
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
  if (manifest.executor !== undefined) {
    const executor = strictObject(manifest.executor, `${at} executor`, MANIFEST_MEMBER_REQUIRED.executor);
    checkExecutorName(executor.name, `${at} executor.name`);
    if (executor.osAccount !== null) manifestText(executor.osAccount, `${at} executor.osAccount`);
  }
  const framework = strictObject(manifest.framework, `${at} framework`, MANIFEST_MEMBER_REQUIRED.framework, MANIFEST_MEMBER_OPTIONAL.framework);
  if (framework.sharedTypes !== undefined) frameworkSharedTypesShape(framework.sharedTypes, `${at} framework.sharedTypes`);
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
  /** NOT_RUN_OF_RECORD_LINE when the verified TMF-FILING.md opens with it, or the manifest
   * records a framework checkout that was dirty or unreadable at the seal. */
  notRunOfRecord?: typeof NOT_RUN_OF_RECORD_LINE;
  /** RESTRICTED_FILING_LINE when the manifest lists a training capture file (IR-453). */
  restricted?: typeof RESTRICTED_FILING_LINE;
  /** Set when the manifest lists a training capture but TMF-FILING.md does not open with
   * RESTRICTED_FILING_LINE (a package sealed before the notice). ok is unchanged. */
  restrictedNoticeMissing?: true;
}

/** What D-LE-14 requires of a package that imports a run and is not synthetic, recomputed from the bytes it retains (so
 * no manifest member is needed): the retained summary and the retained basis satisfy publicDataAdmissionOf, every
 * benchmark record states the declared-public-data level and that basis, and the package sits in a tree QA marked and
 * outside any synthetic data root. */
function publicDataPackageProblems(dir: string, manifest: PackageManifest, contents: ReadonlyMap<string, Buffer>): string[] {
  const at = 'a package that imports a run and is not synthetic';
  const problems: string[] = [];
  const input = manifest.inputs.find(entry => entry.role === 'benchmark-run-summary');
  const summary = input ? contents.get(input.path) : undefined;
  const basis = contents.get(PUBLIC_DATA_BASIS_FILE);
  if (!summary) problems.push(`${at} needs its verified benchmark-run-summary input`);
  if (!basis) problems.push(`${at} needs its verified ${PUBLIC_DATA_BASIS_FILE}`);
  if (summary && basis) {
    const admission = publicDataAdmissionOf(summary, basis);
    if (!admission.admitted) problems.push(`${at} must be admitted under its filed basis (D-LE-14): ${admission.code}: ${admission.reason}`);
  }
  let records: EvidenceResult[] = [];
  try { records = loadEvidence(dir, 'benchmark'); } catch { records = []; }
  // A run stopped before the import saved its category is sealed with no benchmark row, as the synthetic path does: it
  // is retained, it passes nothing, and the import can run again from the retained summary and the run directory.
  if (contents.has(resultsFile('benchmark')) && !records.some(record => record.testCaseId === 'BENCHMARK-RECONSTRUCTION')) problems.push(`${at} records no BENCHMARK-RECONSTRUCTION`);
  for (const record of records) {
    const body = isRecord(record.responseBody) ? record.responseBody : undefined;
    if (body?.evidenceLevel !== undefined && body.evidenceLevel !== PUBLIC_DATA_EVIDENCE_LEVEL) {
      problems.push(`benchmark record ${record.testCaseId} states evidence level ${JSON.stringify(body.evidenceLevel)}, not ${PUBLIC_DATA_EVIDENCE_LEVEL}`);
    }
    if (record.testCaseId === 'BENCHMARK-RECONSTRUCTION' && basis
      && !(isRecord(body?.publicDataBasis) && body.publicDataBasis.basisSha256 === sha256(basis))) {
      problems.push(`benchmark record ${record.testCaseId} does not state the retained basis ${sha256(basis)}`);
    }
  }
  if (!qaRetentionRoot(dir)) problems.push(`${at} is retained only under a tree holding ${QA_RETENTION_ROOT_MARKER}; ${dir} is not in one`);
  const dataRoot = markedDataRoot(dir);
  if (dataRoot) problems.push(`${at} is never retained inside the synthetic data root ${dataRoot}`);
  return problems;
}

/** Whether a retained platform-validation-summary/1 cites a package admitted under the declared-public-data basis: an
 * evidence entry of a system holding declaredPublicData true. A summary that cannot be read that way is a problem. */
function summaryCitesPublicData(bytes: Buffer): { cites: boolean } | { problem: string } {
  let summary: unknown;
  try { summary = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { return { problem: `${PLATFORM_SUMMARY_FILE} is not JSON` }; }
  const systems = isRecord(summary) ? summary.systems : undefined;
  if (!Array.isArray(systems) || !systems.every(system => isRecord(system) && Array.isArray(system.evidence) && system.evidence.every(isRecord))) {
    return { problem: `${PLATFORM_SUMMARY_FILE} holds no systems with evidence lists` };
  }
  return { cites: systems.some(system => (system.evidence as Record<string, unknown>[]).some(entry => entry.declaredPublicData === true)) };
}

/** Verifies a sealed package: every listed file is present with its byte count
 * and SHA-256, no unlisted file exists and the package hash recomputes. It also
 * checks what sealing promises: inputs and evidence counts match their files, a
 * synthetic package marks every record and document, and no record or document
 * of a package claims to be a development run. A package that imports a run and
 * is not synthetic must also satisfy the D-LE-14 admission from its retained bytes. */
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
    // The mismatches are recomputed from the retained IQ and OQ records, so a manifest cannot drop or add one (RF-077).
    if (bytes && flags !== undefined) {
      try {
        const recomputed = configurationUnderTest(bytes, { iq: loadEvidence(dir, 'iq'), oq: loadEvidence(dir, 'oq') }).mismatches;
        if (canonicalJson(recomputed, 'Configuration mismatches') !== canonicalJson(recorded.mismatches, 'Configuration mismatches')) {
          problems.push(`configurationUnderTest.mismatches differ from those the retained IQ and OQ records give (${recomputed.length} recomputed, ${recorded.mismatches.length} recorded)`);
        }
      } catch (error) {
        problems.push(`configurationUnderTest.mismatches cannot be recomputed from the retained records (${errorText(error)})`);
      }
    }
  }
  // A benchmark record states the SHA-256 of the run summary and metrics it reconstructed; the retained inputs
  // must be those bytes, so a package cannot pair an import's records with another run's files (RF-071).
  const benchmarkInputs = { summarySha256: 'benchmark-run-summary', metricsSha256: 'benchmark-metrics' } as const;
  if (listed.has(resultsFile('benchmark'))) {
    let records: EvidenceResult[] = [];
    try { records = loadEvidence(dir, 'benchmark'); } catch { records = []; }
    for (const record of records) {
      const body = isRecord(record.responseBody) ? record.responseBody : undefined;
      for (const [member, role] of Object.entries(benchmarkInputs)) {
        const stated = body?.[member];
        if (typeof stated !== 'string') continue;
        const input = manifest.inputs.find(entry => entry.role === role);
        if (!input) problems.push(`benchmark record ${record.testCaseId} states ${member} ${stated}, but the package retains no ${role} input`);
        else if (input.sha256 !== stated) problems.push(`benchmark record ${record.testCaseId} states ${member} ${stated}, not the retained ${role} input ${input.sha256}`);
      }
    }
  }
  // An imported run in a package that is not synthetic is only the R2 pilot run admitted under its filed basis (D-LE-14).
  const importsRun = manifest.inputs.some(input => input.role === 'benchmark-run-summary') || listed.has(resultsFile('benchmark'));
  const admittedPackage = !manifest.synthetic && importsRun;
  if (admittedPackage) problems.push(...publicDataPackageProblems(dir, manifest, contents));
  else if (listed.has(PUBLIC_DATA_BASIS_FILE)) problems.push(`${PUBLIC_DATA_BASIS_FILE} is held by a package that was not admitted under it`);
  // Executed evidence that is not synthetic names who ran it (IR-090).
  if (manifest.executed && !manifest.synthetic && !manifest.executor) problems.push('an executed package that is not synthetic names no executor');
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
    // Every record names the package's executor, and none names one when the package records none.
    if (results.some(result => result.executedBy !== manifest.executor?.name)) {
      problems.push(manifest.executor
        ? `evidence category ${entry.category} has records whose executedBy is not the package executor ${JSON.stringify(manifest.executor.name)}`
        : `evidence category ${entry.category} has records naming an executor the manifest does not record`);
    }
  }
  // A package that is not synthetic and cites an admitted package carries its notice too: read from its own platform summary's JSON.
  const summaryBytes = manifest.synthetic ? undefined : contents.get(PLATFORM_SUMMARY_FILE);
  const citation = summaryBytes ? summaryCitesPublicData(summaryBytes) : { cites: false };
  if ('problem' in citation) problems.push(citation.problem);
  const citesPublicData = 'cites' in citation && citation.cites;
  for (const [file, bytes] of contents) {
    if (!file.endsWith('.md')) continue;
    const text = bytes.toString('utf8');
    if (manifest.synthetic && !text.includes(SYNTHETIC_NOTICE)) problems.push(`${file} lacks the synthetic notice`);
    if ((admittedPackage || citesPublicData) && !text.includes(DECLARED_PUBLIC_DATA_NOTICE)) problems.push(`${file} lacks the declared public data notice`);
    if (text.includes(DEVELOPMENT_RUN_NOTICE)) problems.push(`${file} is marked as a development run`);
  }
  const filing = contents.get(TMF_FILING_FILE)?.toString('utf8');
  // The not-run-of-record line opens the filing, or follows the restricted notice.
  const opening = filing?.split(/\r?\n/, 3) ?? [];
  const notRecord = (opening[0] === RESTRICTED_FILING_LINE ? opening[2] : opening[0]) === NOT_RUN_OF_RECORD_LINE
    || manifest.framework.commit === null || manifest.framework.dirty !== false;
  const restricted = manifest.files.some(file => isTrainingCaptureFile(file.path));
  return { ok: problems.length === 0, dir, problems, manifestSha256, manifest, ...(notRecord ? { notRunOfRecord: NOT_RUN_OF_RECORD_LINE } : {}),
    ...(restricted ? { restricted: RESTRICTED_FILING_LINE } : {}),
    ...(restricted && opening[0] !== RESTRICTED_FILING_LINE ? { restrictedNoticeMissing: true as const } : {}) };
}

/** Rechecks what a sealed import recorded about the run directory kept beside it (npm run verify:package -- <package>
 * --run-dir <dir>): the run summary and the metrics by SHA-256, and each file a pilot row recorded in the state it recorded
 * (pilotRowRunFiles): a verified file, and a mismatched one, re-hashed to the bytes the import found; a missing file still
 * absent; a path still outside the directory. A package keeps those hashes, never the cited files, so this is what ties a
 * retained run directory to a filed package years later, the directory of a failed run included. */
export function verifyCitedRunFiles(packageDirectory: string, runDirectory: string): { checked: number; rehashed: number; problems: string[] } {
  const runDir = path.resolve(runDirectory);
  const recorded = new Map<string, RecordedRunFile>();
  const problems: string[] = [];
  const record = (file: RecordedRunFile) => {
    const known = recorded.get(file.path);
    if (!known) { recorded.set(file.path, file); return; }
    if (known.state === 'bytes' && file.state === 'bytes' && known.sha256 !== file.sha256) problems.push(`${file.path} is cited with two SHA-256 values`);
    else if (known.state !== file.state) problems.push(`${file.path} is recorded both ${known.state} and ${file.state}`);
  };
  let records: EvidenceResult[];
  try { records = loadEvidence(path.resolve(packageDirectory), 'benchmark'); }
  catch (error) { return { checked: 0, rehashed: 0, problems: [`the package's benchmark records cannot be read (${errorText(error)})`] }; }
  if (!records.length) return { checked: 0, rehashed: 0, problems: ['the package holds no benchmark record, so it cites no run directory'] };
  for (const result of records) {
    const body = isRecord(result.responseBody) ? result.responseBody : undefined;
    if (!body) continue;
    if (typeof body.summarySha256 === 'string') record({ path: BENCHMARK_RUN_FILES.summary, state: 'bytes', sha256: body.summarySha256 });
    if (typeof body.metricsSha256 === 'string') record({ path: BENCHMARK_RUN_FILES.metrics, state: 'bytes', sha256: body.metricsSha256 });
    const cited = pilotRowRunFiles(body);
    problems.push(...cited.problems.map(problem => `benchmark record ${result.testCaseId}: ${problem}`));
    cited.files.forEach(record);
  }
  let rehashed = 0;
  for (const file of recorded.values()) {
    const target = citedRunFile(runDir, file.path);
    if (file.state === 'outside') {
      if (target) problems.push(`${file.path} was recorded outside the run directory and is inside it`);
      continue;
    }
    if (!target) { problems.push(`${file.path} is outside the run directory`); continue; }
    const actual = fileSha256(target);
    if (file.state === 'absent') {
      if (!('error' in actual)) problems.push(`${file.path} was recorded missing and the run directory holds it (${actual.sha256})`);
      continue;
    }
    rehashed++;
    if ('error' in actual) problems.push(`${file.path} ${actual.error}`);
    else if (actual.sha256 !== file.sha256) problems.push(`${file.path} is ${actual.sha256}, the package records ${file.sha256}`);
  }
  return { checked: recorded.size, rehashed, problems };
}

// ---------------------------------------------------------------------------
// The platform evidence plan (spec P20 3.3, 3.7): every entry checked by hash
// ---------------------------------------------------------------------------

/** verified: a sealed package whose manifest SHA-256 is the plan's and whose files verify;
 * hash-only: a file whose SHA-256 is the plan's, admitted by hash alone; mismatch: bytes
 * that are not what the plan or the package manifest states; unreadable: nothing to hash. */
export const PLATFORM_EVIDENCE_STATUSES = ['verified', 'hash-only', 'mismatch', 'unreadable'] as const;
export type PlatformEvidenceStatus = typeof PLATFORM_EVIDENCE_STATUSES[number];

export interface CheckedPlatformEvidence {
  system: PlatformSystemId;
  entry: PlatformEvidenceEntry;
  status: PlatformEvidenceStatus;
  detail: string;
  /** The verified manifest's flag for a package whose manifest could be read, else the plan's declaration. */
  synthetic: boolean;
  /** A cited package whose manifest could be read; its files verified only when status is verified. */
  package?: { dir: string; manifestSha256: string; manifest: PackageManifest };
  /** The cited manifest lists the retained declared-public-data basis: not synthetic, but not a real trial's data either. */
  declaredPublicData?: true;
}

export interface CheckedPlatformEvidencePlan {
  /** The absolute path read. */
  file: string;
  /** SHA-256 of the plan's bytes. */
  sha256: string;
  plan: PlatformEvidencePlan;
  /** In inventory order, then plan order. */
  entries: CheckedPlatformEvidence[];
  /** True when an entry is synthetic, which makes a documents package synthetic (VD-3). */
  synthetic: boolean;
  /** True when an entry cites a package admitted under the declared-public-data basis, whose notice the citing package carries. */
  declaredPublicData: boolean;
}

/** The SHA-256 of a file read in slices, so a large evidence file is never held whole. */
function fileSha256(file: string): { sha256: string } | { error: string } {
  let descriptor: number | undefined;
  try {
    if (!fs.statSync(file).isFile()) return { error: 'is not a file' };
    descriptor = fs.openSync(file, 'r');
    const hash = createHash('sha256');
    const slice = Buffer.alloc(1024 * 1024);
    for (let read = fs.readSync(descriptor, slice, 0, slice.length, null); read > 0; read = fs.readSync(descriptor, slice, 0, slice.length, null)) {
      hash.update(slice.subarray(0, read));
    }
    return { sha256: hash.digest('hex') };
  } catch (error) {
    return { error: `cannot be read (${errorText(error)})` };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

/** The manifest a hash-only entry names when the file is a package-manifest.json that reads as one
 * (at most 16 MiB); undefined for any other file. */
function citedManifest(file: string): PackageManifest | undefined {
  if (path.basename(file) !== MANIFEST_FILE) return undefined;
  try {
    if (fs.statSync(file).size > 16 * 1024 * 1024) return undefined;
    const text = fs.readFileSync(file, 'utf8');
    return parseManifest(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
  } catch {
    return undefined;
  }
}

/** The words and the flag a citing row carries for a package admitted under the declared-public-data basis (D-LE-14). */
function publicDataCitationOf(manifest: PackageManifest | undefined): { words: string; flag: { declaredPublicData?: true } } {
  const basis = manifest?.files.find(file => file.path === PUBLIC_DATA_BASIS_FILE);
  return basis ? { words: `; ${PUBLIC_DATA_CITATION}, SHA-256 ${basis.sha256}`, flag: { declaredPublicData: true } } : { words: '', flag: {} };
}

/** A plan entry checked against the bytes it names. */
function checkPlatformEvidence(system: PlatformSystemId, entry: PlatformEvidenceEntry, at: string): CheckedPlatformEvidence {
  if (entry.kind !== PACKAGE_EVIDENCE_KIND) {
    const hashed = fileSha256(entry.path);
    if ('error' in hashed) return { system, entry, status: 'unreadable', detail: `${entry.path} ${hashed.error}`, synthetic: entry.synthetic };
    // A package manifest cited by hash alone still states whether its package is synthetic, and the plan must say the same.
    const cited = citedManifest(entry.path);
    packageCheck(!cited || cited.synthetic === entry.synthetic, `${at} declares synthetic ${entry.synthetic}, but the package manifest `
      + `${entry.path} it cites by hash states synthetic ${cited?.synthetic}; correct the plan`);
    const hashCitation = publicDataCitationOf(cited);
    return hashed.sha256 === entry.sha256
      ? { system, entry, status: 'hash-only', detail: `SHA-256 matches; admitted by hash only, not verified as a package${hashCitation.words}`, synthetic: entry.synthetic, ...hashCitation.flag }
      : { system, entry, status: 'mismatch', detail: `SHA-256 is ${hashed.sha256}, the plan states ${entry.sha256}${hashCitation.words}`, synthetic: entry.synthetic, ...hashCitation.flag };
  }
  // A package is cited by its directory or by its package-manifest.json.
  const citesManifest = path.basename(entry.path) === MANIFEST_FILE && isFile(entry.path);
  const verified = verifyPackage(citesManifest ? path.dirname(entry.path) : entry.path);
  if (!verified.manifestSha256) return { system, entry, status: 'unreadable', detail: verified.problems.join('; '), synthetic: entry.synthetic };
  const { manifest, manifestSha256 } = verified;
  // The declaration must be the manifest's whenever the manifest can be read, so no plan can make a package look real.
  packageCheck(!manifest || manifest.synthetic === entry.synthetic, `${at} declares synthetic ${entry.synthetic}, but the package `
    + `${verified.dir} states synthetic ${manifest?.synthetic}; correct the plan`);
  const cited = manifest ? { package: { dir: verified.dir, manifestSha256, manifest } } : {};
  const citation = publicDataCitationOf(manifest);
  if (manifestSha256 !== entry.sha256) {
    return { system, entry, status: 'mismatch', detail: `${MANIFEST_FILE} SHA-256 is ${manifestSha256}, the plan states ${entry.sha256}${citation.words}`, synthetic: manifest?.synthetic ?? entry.synthetic, ...cited, ...citation.flag };
  }
  if (!verified.ok || !manifest) {
    return { system, entry, status: 'mismatch', detail: `the package does not verify: ${verified.problems.slice(0, 5).join('; ')}${citation.words}`, synthetic: manifest?.synthetic ?? entry.synthetic, ...cited, ...citation.flag };
  }
  // A system that admits packages only for a category (the IL's p13, the Command Center's benchmark) needs one.
  const admitted: EvidenceAdmission = PLATFORM_SYSTEMS.find(item => item.id === system)!.evidence;
  const categories = admitted.package?.categories;
  packageCheck(!categories || manifest.categories.some(item => categories.includes(item.category)),
    `${at} cites the package ${verified.dir} for ${system}, which holds no ${categories?.join(' or ')} evidence; the inventory admits a package for ${system} only with it`);
  return {
    system, entry, status: 'verified', synthetic: manifest.synthetic, ...cited, ...citation.flag,
    detail: `${manifest.files.length} files verified (package ${manifest.packageId}, ${manifest.executed ? 'executed' : 'documents only'}`
      + `${manifest.categories.length ? `, ${manifest.categories.map(item => item.category).join(', ')}` : ''}${citation.words})`,
  };
}

/** Reads a platform-validation-evidence-plan/1 strictly and checks every entry against the bytes
 * it names: a cited package with verifyPackage and its manifest SHA-256, any other file by its
 * SHA-256. A system the inventory lacks, an entry it does not admit, a synthetic declaration that
 * differs from the cited manifest, or a package without the category its system needs refuses
 * the plan. Hashes that do not match are reported, not refused: the summary shows them. */
export function checkPlatformEvidencePlan(file: string): CheckedPlatformEvidencePlan {
  const loaded = loadPlatformEvidencePlan(file);
  const entries = planEntries(loaded.plan).map(({ system, index, entry }) =>
    checkPlatformEvidence(system, entry, `The platform evidence plan ${loaded.file} systems.${system}.evidence[${index}]`));
  return { ...loaded, entries, synthetic: entries.some(entry => entry.synthetic), declaredPublicData: entries.some(entry => entry.declaredPublicData === true) };
}
