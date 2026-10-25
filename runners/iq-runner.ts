/**
 * IQ Runner — Installation Qualification test execution.
 * Covers every IQ test case of the IQ protocol (IQ_CASE_COUNT).
 * Groups: Software Installation, Database Schema, Configuration, Security & Backup.
 * Sibling checkouts resolve through collectors/workspace-paths.ts; shared types are
 * checked where consumers install them (vendored archives), never in a source folder.
 * Records that read the API checkout are bound to the API release under test (bindApiSourceToRelease).
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  EvidenceResult,
  captureWithExpectedStatus,
  captureWithValidator,
  isRecord,
  saveEvidence,
  appendCaseJournal,
} from './evidence-capture';
import { defaultWorkspaceRoot, resolveFrontendRoot, resolveLibreclinicaApiRoot } from '../collectors/workspace-paths';
import { SYSTEM_INFO } from '../config/system-info';
import {
  composeServiceEnvironment, dotenvEnvironment, readTargetConfiguration, sameTarget, sourceFlagValue,
  CORE_API_SERVICE, TARGET_CONFIGURATION_CONTRACT,
  type ConfigurationMismatch, type DeclaredConfiguration, type FlagValue, type SourceEnvironment, type TargetConfigurationFlag,
} from './target-configuration';
import { checkoutState, currentReleaseIdentity, type CheckoutState, type ReleaseComponent } from './release-identity';
import {
  declaredDependency, errorText, readVendoredArchive, safeParseJson, sha256, VENDORED_SELECTOR,
} from './vendored-archive';

export { readVendoredArchive, type VendoredArchive } from './vendored-archive';

/** The IQ protocol's cases, IQ-001 to IQ-035; the runner records a result for each. */
export const IQ_CASE_COUNT = 35;
export const IQ_CASE_IDS: readonly string[] = Array.from({ length: IQ_CASE_COUNT }, (_, index) => `IQ-${String(index + 1).padStart(3, '0')}`);

export interface IqRunOptions {
  /** The validation-target-configuration/1 declaration IQ-029 and IQ-033 read (--target-config);
   * without one both are not executed (NO_TARGET_CONFIGURATION). */
  targetConfigFile?: string;
}

/** The EDC's committed production example, which IQ-033 states its production delta against. */
export const PRODUCTION_EXAMPLE = '.env.production.example';
export const LIVE_PRODUCTION_STATEMENT = 'Live production values are not visible to the framework: the delta is stated against '
  + `libreclinicaapi/${PRODUCTION_EXAMPLE}, not the deployed task definition.`;

/** The validation framework checkout, itself a shared types consumer IQ-008 verifies. */
const FRAMEWORK_ROOT = path.resolve(__dirname, '..');
const SHARED_TYPES = '@accura-trial/shared-types';
/** The EDC's own check of a consumer installation against its receipt (libreclinicaapi). */
export const SHARED_TYPES_VERIFIER = path.join('scripts', 'verify-study-contract-consumers.cjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ts(): string {
  return new Date().toISOString();
}

/** A file system record. `filePath` is the file the record names; a check that reads more files
 * (or a directory) lists every one it read in `extra.readPaths`, so bindApiSourceToRelease checks each. */
function fileResult(
  id: string,
  label: string,
  passed: boolean,
  detail: string,
  filePath: string,
  extra?: Record<string, unknown>,
): EvidenceResult {
  return {
    testCaseId: id,
    timestamp: ts(),
    endpoint: 'File system check',
    method: 'FS',
    responseStatus: passed ? 200 : 404,
    responseBody: { path: filePath, ...extra },
    passed,
    notes: `${label} — ${detail}`,
  };
}

function safeReadFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function countMatches(content: string, pattern: RegExp): number {
  const matches = content.match(pattern);
  return matches ? matches.length : 0;
}

function readPackageJson(filePath: string): Record<string, unknown> | null {
  const content = safeReadFile(filePath);
  return content ? safeParseJson(content) : null;
}

/** The major version a package.json range names: ^20.3.27, ~5.9.3, 20.1.0, 20.x or >=20. */
export function declaredMajor(range: string): number | undefined {
  const match = /^\s*(?:[\^~]|[<>]=?|=)?\s*v?(\d+)(?:[.\s]|$)/.exec(range);
  return match ? Number(match[1]) : undefined;
}

/** IQ-035: every `file:vendor/*.tgz` dependency of the API has a receipt beside its
 * archive (`<archive>.tgz.json`) that describes the archive's bytes, and the lockfile
 * installed that archive (its integrity is the archive's). Shared types are verified
 * in full by IQ-008; an archive without a receipt fails the case. */
export function checkVendoredReceipts(apiRoot: string): EvidenceResult {
  const label = 'Vendored package receipts';
  const packageFile = path.join(apiRoot, 'package.json');
  const pkg = readPackageJson(packageFile);
  if (!pkg) return fileResult('IQ-035', label, false, 'package.json not found or not JSON', packageFile);
  const vendored = ['dependencies', 'devDependencies', 'optionalDependencies']
    .flatMap(group => (isRecord(pkg[group]) ? Object.entries(pkg[group] as Record<string, unknown>) : []))
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].startsWith('file:vendor/'));
  if (!vendored.length) {
    return fileResult('IQ-035', label, false, 'package.json declares no file:vendor dependency, so no receipt is verified', packageFile);
  }
  const lockFile = path.join(apiRoot, 'package-lock.json');
  const lock = readPackageJson(lockFile);
  const lockPackages = isRecord(lock?.packages) ? lock.packages as Record<string, unknown> : {};
  const archives = vendored.map(([name, selector]) => {
    const archive = readVendoredArchive(apiRoot, name, selector);
    const locked = lockPackages[`node_modules/${name}`];
    const lockedIntegrity = isRecord(locked) && typeof locked.integrity === 'string' ? locked.integrity : null;
    if (archive.integrity && lockedIntegrity !== archive.integrity) {
      archive.problems.push(`${lockFile} does not install ${name} from this archive (its integrity is ${lockedIntegrity ? 'another archive\'s' : 'missing'})`);
    }
    return archive;
  });
  const failing = archives.filter(archive => archive.problems.length);
  const passed = failing.length === 0;
  return fileResult('IQ-035', label, passed,
    passed
      ? `${archives.length} vendored archives each match their receipt and the lockfile: `
        + archives.map(archive => `${archive.packageName} (${String(archive.receipt?.contract)})`).join(', ')
      : `${failing.length} of ${archives.length} vendored archives fail: `
        + failing.map(archive => `${archive.packageName}: ${archive.problems.join('; ')}`).join('; '),
    packageFile, {
      // readVendoredArchive reads an archive and its receipt only for a vendored selector.
      readPaths: [packageFile, lockFile, ...archives.filter(archive => VENDORED_SELECTOR.test(archive.selector))
        .flatMap(archive => [archive.archive, archive.receiptPath])],
      archives: archives.map(archive => ({
        packageName: archive.packageName, selector: archive.selector, archive: archive.archive, receipt: archive.receiptPath,
        receiptContract: typeof archive.receipt?.contract === 'string' ? archive.receipt.contract : null,
        sha256: archive.sha256, problems: archive.problems,
      })),
    });
}

/** Settings the Node.js runtime or a library the EDC uses reads, not its src. */
export const RUNTIME_READERS: Readonly<Record<string, string>> = {
  NODE_OPTIONS: 'the Node.js runtime',
  NODE_EXTRA_CA_CERTS: 'the Node.js runtime',
  TZ: 'the Node.js runtime',
  // The EDC creates S3Client with a region only (src/services/backup/cloud-storage.service.ts),
  // so the AWS SDK's default credential chain reads these.
  AWS_ACCESS_KEY_ID: 'the AWS SDK default credential chain',
  AWS_SECRET_ACCESS_KEY: 'the AWS SDK default credential chain',
  AWS_SESSION_TOKEN: 'the AWS SDK default credential chain',
};

/** Settings the production files name that the code reads under another name
 * (map/repo-runtime.md 5.4); IQ-034 states the other name only when it has a reader. */
const READ_UNDER_ANOTHER_NAME: Readonly<Record<string, string>> = {
  BACKUP_ENABLED: 'BACKUP_SCHEDULER_ENABLED',
  BACKUP_S3_BUCKET: 'AWS_S3_BUCKET',
  SOAP_URL: 'LIBRECLINICA_SOAP_URL',
  EMAIL_FROM: 'SMTP_FROM_EMAIL',
  LIBRECLINICA_DB_POOL_MAX: 'LIBRECLINICA_DB_MAX_CONNECTIONS',
};

/** The settings EDC src reads: process.env.KEY, an environment parameter's env.KEY or
 * env['KEY'] (as src/config/production-guards.ts reads them), or the key as a whole
 * string literal, the form helpers that read process.env[name] take. Test files are
 * not readers. */
export function settingsReadBy(srcRoot: string): { names: Set<string>; files: number } {
  const names = new Set<string>();
  let files = 0;
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '__tests__') walk(full);
        continue;
      }
      if (!entry.isFile() || !/\.(?:ts|js|cjs|mjs)$/.test(entry.name) || /\.(?:test|spec)\.[cm]?[jt]s$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf-8');
      files++;
      for (const match of text.matchAll(/\benv\s*(?:\.\s*([A-Za-z_][A-Za-z0-9_]*)|\[\s*(['"`])([A-Za-z_][A-Za-z0-9_]*)\2\s*\])/g)) {
        names.add(match[1] ?? match[3]);
      }
      for (const match of text.matchAll(/(['"`])([A-Z][A-Z0-9_]*)\1/g)) names.add(match[2]);
    }
  };
  walk(srcRoot);
  return { names, files };
}

/** IQ-034: every key the EDC production example sets, and every key the core-api
 * service environment of the frontend's production compose file sets, has a reader
 * in EDC src (settingsReadBy) or in the runtime (RUNTIME_READERS). The case lists
 * the dead keys, with where each is set, and fails while any exist (RT-20). */
export function checkDeadSettings(apiRoot: string, frontendRoot: string, workspaceRoot: string): EvidenceResult {
  const label = 'Dead or misnamed settings';
  const shown = (file: string) => path.relative(workspaceRoot, file).split(path.sep).join('/');
  const srcRoot = path.join(apiRoot, 'src');
  const exampleFile = path.join(apiRoot, PRODUCTION_EXAMPLE);
  const composeFile = path.join(frontendRoot, 'docker-compose.production.yml');
  const problems: string[] = [];
  const setIn = new Map<string, string[]>();
  const sources: Array<{ file: string; keys: number }> = [];
  for (const [file, parse] of [
    [exampleFile, (text: string) => dotenvEnvironment(text)],
    [composeFile, (text: string) => composeServiceEnvironment(text, CORE_API_SERVICE)],
  ] as const) {
    const text = safeReadFile(file);
    const environment = text === null ? undefined : parse(text);
    if (!environment) {
      problems.push(text === null ? `${file} is not found` : `${file} has no ${CORE_API_SERVICE} service environment`);
      continue;
    }
    sources.push({ file, keys: environment.entries.size });
    for (const [key, entry] of environment.entries) setIn.set(key, [...(setIn.get(key) ?? []), `${shown(file)}:${entry.line}`]);
  }
  let read: { names: Set<string>; files: number } = { names: new Set(), files: 0 };
  try { read = settingsReadBy(srcRoot); }
  catch (error) { problems.push(`${srcRoot} cannot be read (${(error as NodeJS.ErrnoException).code ?? errorText(error)})`); }
  if (!read.files && !problems.length) problems.push(`${srcRoot} holds no source file`);
  const deadKeys = [...setIn].filter(([key]) => !read.names.has(key) && !RUNTIME_READERS[key]).map(([key, places]) => {
    const other = READ_UNDER_ANOTHER_NAME[key];
    return { key, setIn: places, ...(other && read.names.has(other) ? { readUnder: other } : {}) };
  });
  const passed = problems.length === 0 && deadKeys.length === 0;
  const listed = deadKeys.map(dead => `${dead.key} (${dead.setIn.join(', ')}${dead.readUnder ? `; the code reads ${dead.readUnder}` : ''})`);
  return fileResult('IQ-034', label, passed,
    [
      ...problems,
      deadKeys.length
        ? `${deadKeys.length} of ${setIn.size} settings set in the production example and the production compose file have no reader in ${shown(srcRoot)}: ${listed.join('; ')}`
        : `every one of ${setIn.size} settings set in the production example and the production compose file has a reader in ${shown(srcRoot)} (${read.files} files) or the runtime`,
    ].join('; '),
    exampleFile, { readPaths: [srcRoot, exampleFile, composeFile], sources, srcRoot, srcFilesScanned: read.files, deadKeys });
}

/** The files a refusal of the EDC's verifier concerns, by its message, relative to
 * the consumer root, so a failed IQ-008 names the file and not only the consumer. */
const VERIFIER_REFUSAL_FILES: ReadonlyArray<[string, (archive: string) => string[]]> = [
  ['Unsupported shared contract receipt', archive => [`${archive}.json`]],
  ['Shared contract installation is not a real directory', () => ['node_modules/@accura-trial/shared-types']],
  ['Package/lock release mismatch', () => ['package.json', 'package-lock.json']],
  ['Invalid local release artifact', archive => [archive]],
  ['Vendored package bytes mismatch', archive => [archive]],
  ['Installed package identity mismatch', () => ['node_modules/@accura-trial/shared-types/package.json']],
  ['Installed release manifest mismatch', () => ['node_modules/@accura-trial/shared-types/release-manifest.json']],
];

export interface SharedTypesConsumer {
  /** Name the record and the verifier's messages use (api, ui, validation-framework). */
  name: string;
  root: string;
}

type PinnedContractVerifier = (root: string, lockedArtifact: string, receipt: Record<string, unknown>, name?: string) => {
  manifest?: { runtimeFiles?: unknown[] };
};

/** Loads verifyPinnedStudyContract from the EDC's script, read-only: requiring it
 * defines the function and runs nothing (the CLI body runs only as the main module). */
function loadPinnedContractVerifier(verifierFile: string): PinnedContractVerifier | string {
  if (!fs.existsSync(verifierFile)) return `the EDC verifier ${verifierFile} is missing`;
  let loaded: unknown;
  try { loaded = require(verifierFile); }
  catch (error) { return `the EDC verifier ${verifierFile} cannot be loaded (${errorText(error)})`; }
  const verifier = isRecord(loaded) ? loaded.verifyPinnedStudyContract : undefined;
  return typeof verifier === 'function' ? verifier as PinnedContractVerifier
    : `the EDC verifier ${verifierFile} does not export verifyPinnedStudyContract`;
}

/** IQ-008: each consumer installed @accura-trial/shared-types from its vendored
 * release, as the EDC's own verifyPinnedStudyContract checks it (the package.json
 * and lockfile pins, the lock integrity, the archive bytes against the receipt,
 * the installed package.json and release-manifest.json, every runtime file, and no
 * retired public contract), and `sameBuild.consumer`'s archive is the build of
 * `sameBuild.reference`'s receipt. Consumers on different builds are recorded,
 * not failed. A missing verifier fails the case naming its path. */
export function checkSharedTypesInstallation(
  verifierFile: string,
  consumers: readonly SharedTypesConsumer[],
  sameBuild: { consumer: string; reference: string },
): EvidenceResult {
  const label = 'Shared types installed from the vendored release';
  const problems: string[] = [];
  const verifier = loadPinnedContractVerifier(verifierFile);
  if (typeof verifier === 'string') problems.push(verifier);
  const installs = consumers.map(consumer => {
    const packageFile = path.join(consumer.root, 'package.json');
    const pkg = readPackageJson(packageFile);
    const selector = declaredDependency(pkg, SHARED_TYPES);
    const vendored = readVendoredArchive(consumer.root, SHARED_TYPES, selector);
    const receiptSha256 = typeof vendored.receipt?.sha256 === 'string' ? vendored.receipt.sha256 : null;
    const install = {
      name: consumer.name, root: consumer.root, selector, archive: vendored.archive, archiveSha256: vendored.sha256,
      receiptSha256, build: receiptSha256 ? receiptSha256.slice(0, 16) : null, verified: false, runtimeFilesVerified: 0,
    };
    if (!pkg) problems.push(`${consumer.name}: ${packageFile} not found or not JSON`);
    else if (!vendored.receipt) problems.push(`${consumer.name}: ${vendored.problems.join('; ')}`);
    else if (typeof verifier !== 'string') {
      const lockedArtifact = selector.replace(/^file:/, '');
      try {
        const verified = verifier(consumer.root, lockedArtifact, vendored.receipt, consumer.name);
        install.verified = true;
        install.runtimeFilesVerified = Array.isArray(verified?.manifest?.runtimeFiles) ? verified.manifest.runtimeFiles.length : 0;
      } catch (error) {
        const message = errorText(error);
        const files = VERIFIER_REFUSAL_FILES.find(([prefix]) => message.startsWith(prefix))?.[1](lockedArtifact) ?? [];
        problems.push(`${consumer.name}: ${message}${files.length ? ` (${files.map(file => path.join(consumer.root, file)).join(', ')})` : ''}`);
      }
    }
    return install;
  });
  // The framework checks EDC exports with the API's own build (the first version's IQ-036).
  const consumerSha = installs.find(install => install.name === sameBuild.consumer)?.archiveSha256 ?? null;
  const referenceSha = installs.find(install => install.name === sameBuild.reference)?.receiptSha256 ?? null;
  if (!consumerSha || consumerSha !== referenceSha) {
    problems.push(`the ${sameBuild.consumer} archive (${consumerSha ?? 'unread'}) is not the build of the ${sameBuild.reference} receipt (${referenceSha ?? 'unread'})`);
  }
  const builds = installs.map(install => `${install.name} ${install.build ?? 'unread'}`).join(', ');
  const passed = problems.length === 0;
  return fileResult('IQ-008', label, passed,
    passed
      ? `${installs.length} consumers verified by the EDC's verifyPinnedStudyContract (builds ${builds}; different builds per consumer `
        + `are recorded, not failed); the ${sameBuild.consumer} archive is the ${sameBuild.reference} build`
      : problems.join('; '),
    verifierFile, {
      readPaths: [verifierFile, ...installs.flatMap(install => [path.join(install.root, 'package.json'), path.join(install.root, 'package-lock.json'),
        ...(VENDORED_SELECTOR.test(install.selector) ? [install.archive, `${install.archive}.json`] : [])])],
      verifier: verifierFile, consumers: installs, sameBuild: { ...sameBuild, consumerSha256: consumerSha, referenceSha256: referenceSha } });
}

/** The environment a declaration's source file sets: a compose file's core-api service,
 * or an env file's KEY=value lines. */
function sourceEnvironment(file: string, text: string): { reader: string; environment?: SourceEnvironment; missing?: string } {
  const name = path.basename(file).toLowerCase();
  if (/\.ya?ml$/.test(name)) {
    const environment = composeServiceEnvironment(text, CORE_API_SERVICE);
    return environment ? { reader: `the ${CORE_API_SERVICE} service environment`, environment }
      : { reader: 'none', missing: `the compose file has no ${CORE_API_SERVICE} service` };
  }
  if (name.startsWith('.env') || name.endsWith('.env')) return { reader: 'its KEY=value lines', environment: dotenvEnvironment(text) };
  return { reader: 'none', missing: 'no reader for this kind of file (a compose file or an env file)' };
}

const valueText = (value: FlagValue | null | undefined) => (value === null || value === undefined ? 'not determinable' : String(value));

/** IQ-029: the target under test is segregated from production, read from the configuration
 * declaration: neither its target nor the run's --base-url is the production API host the
 * system description names, and its source file is no production configuration file (no
 * "production" in its name). A production target records TARGET_IS_PRODUCTION: its
 * segregation from the test environments is the System Owner's confirmation, not this check.
 * Without a declaration the case is not executed (NO_TARGET_CONFIGURATION). */
export function checkEnvironmentSegregation(declarationFile: string | undefined, baseUrl: string): EvidenceResult {
  const label = 'Environment segregation';
  if (!declarationFile) {
    return {
      testCaseId: 'IQ-029', timestamp: ts(), endpoint: 'Configuration declaration (--target-config)', method: 'CONTRACT',
      responseStatus: 0, responseBody: null, passed: false, outcomeCode: 'NO_TARGET_CONFIGURATION',
      notes: `${label}: not executed. No --target-config declaration (${TARGET_CONFIGURATION_CONTRACT}) was given, `
        + 'so the target under test cannot be shown to be segregated from production.',
    };
  }
  let declared: DeclaredConfiguration;
  try { declared = readTargetConfiguration(declarationFile); }
  catch (error) { return fileResult('IQ-029', label, false, errorText(error), path.resolve(declarationFile)); }
  const { configuration } = declared;
  const host = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } };
  const productionHost = host(SYSTEM_INFO.environments.production.apiUrl);
  const production = [configuration.target, baseUrl].filter(url => productionHost !== null && host(url) === productionHost);
  const sourceName = path.basename(configuration.source.path);
  const productionSource = /production/i.test(sourceName);
  const body = {
    target: configuration.target, baseUrl, productionApiHost: productionHost, source: configuration.source.path,
    declaredNodeEnv: configuration.flags.NODE_ENV ?? null, declarationSha256: declared.sha256,
  };
  if (production.length) {
    return {
      ...fileResult('IQ-029', label, false, `the target under test (${production.join(', ')}) is the production API host ${productionHost}; `
        + 'its segregation from the test environments is the System Owner\'s confirmation, not this check', declared.file, body),
      outcomeCode: 'TARGET_IS_PRODUCTION',
    };
  }
  const passed = !productionSource;
  return fileResult('IQ-029', label, passed,
    passed
      ? `the declared target ${configuration.target} is not the production API host ${productionHost}, and its configuration source `
        + `${sourceName} is not a production configuration file${configuration.flags.NODE_ENV ? ` (declared NODE_ENV ${configuration.flags.NODE_ENV})` : ''}`
      : `the configuration source ${configuration.source.path} is a production configuration file, so the declared target is not shown to be segregated from production`,
    declared.file, body);
}

/** IQ-033: the configuration under test. The declaration's target is the run's; its
 * source file, when present here, has the declared SHA-256 and, for a compose or env
 * file, sets every declared flag as declared (a flag the file leaves to an
 * interpolation or to the shell is listed undetermined, not failed). The record
 * states the delta to the EDC production example and that live production values
 * are not visible. Without a declaration the case is not executed. */
export function checkConfigurationUnderTest(declarationFile: string | undefined, baseUrl: string, apiRoot: string): EvidenceResult {
  const label = 'Configuration under test';
  if (!declarationFile) {
    return {
      testCaseId: 'IQ-033', timestamp: ts(), endpoint: 'Configuration declaration (--target-config)', method: 'CONTRACT',
      responseStatus: 0, responseBody: null, passed: false, outcomeCode: 'NO_TARGET_CONFIGURATION',
      notes: `${label}: not executed. No --target-config declaration (${TARGET_CONFIGURATION_CONTRACT}) was given, `
        + 'so the configuration under test is not recorded.',
    };
  }
  let declared: DeclaredConfiguration;
  try { declared = readTargetConfiguration(declarationFile); }
  catch (error) { return fileResult('IQ-033', label, false, errorText(error), path.resolve(declarationFile)); }
  const { configuration } = declared;
  const flags = Object.entries(configuration.flags) as Array<[TargetConfigurationFlag, FlagValue]>;
  const problems: string[] = [];
  const findings: string[] = [];
  if (!sameTarget(configuration.target, baseUrl)) problems.push(`the declaration describes target ${configuration.target}, not the run's target ${baseUrl}`);

  const source = {
    path: configuration.source.path, declaredSha256: configuration.source.sha256, observedSha256: null as string | null,
    verified: null as boolean | null, crossCheck: 'not made', mismatches: [] as ConfigurationMismatch[], undetermined: [] as string[],
  };
  let sourceBytes: Buffer | undefined;
  try { sourceBytes = fs.readFileSync(configuration.source.path); } catch { sourceBytes = undefined; }
  if (!sourceBytes) {
    source.crossCheck = 'not made: the source is not present here';
    findings.push(`source ${configuration.source.path} is not present here, so its hash is not verified`);
  } else {
    source.observedSha256 = sha256(sourceBytes);
    source.verified = source.observedSha256 === configuration.source.sha256;
    if (!source.verified) {
      source.crossCheck = 'not made: the source bytes differ from the declaration';
      problems.push(`source ${configuration.source.path} does not match its declared SHA-256, so it is not the declared source`);
    } else {
      const { reader, environment, missing } = sourceEnvironment(configuration.source.path, sourceBytes.toString('utf8'));
      source.crossCheck = environment ? reader : `not made: ${missing}`;
      for (const [flag, value] of environment ? flags : []) {
        const observed = sourceFlagValue(environment!, flag);
        if (observed === undefined) source.undetermined.push(flag);
        else if (observed !== value) source.mismatches.push({ flag, declared: value, observed, observedBy: 'IQ-033' });
      }
      findings.push(environment
        ? `source ${configuration.source.path} has the declared SHA-256 and was cross-checked against ${reader}: `
          + `${source.mismatches.length} mismatch(es)${source.undetermined.length ? `, set outside the file: ${source.undetermined.join(', ')}` : ''}`
        : `source ${configuration.source.path} has the declared SHA-256; cross-check ${source.crossCheck}`);
      for (const mismatch of source.mismatches) {
        problems.push(`the source sets ${mismatch.flag} to ${valueText(mismatch.observed)} where the declaration states ${valueText(mismatch.declared)}`);
      }
    }
  }

  // The delta to the committed production example, for the same flags.
  const examplePath = path.join(apiRoot, PRODUCTION_EXAMPLE);
  const exampleText = safeReadFile(examplePath);
  const productionDelta: Array<{ flag: TargetConfigurationFlag; declared: FlagValue; productionExample: FlagValue | null; setIn: string }> = [];
  if (exampleText === null) {
    problems.push(`the production example ${examplePath} is not found, so no production delta is stated`);
  } else {
    const example = dotenvEnvironment(exampleText);
    for (const [flag, value] of flags) {
      const production = sourceFlagValue(example, flag) ?? null;
      const entry = example.entries.get(flag);
      if (production !== value) productionDelta.push({ flag, declared: value, productionExample: production, setIn: entry ? `line ${entry.line}` : 'not set, so the code default' });
    }
    findings.push(`production delta against ${examplePath}: ${productionDelta.length
      ? productionDelta.map(delta => `${delta.flag} declared ${valueText(delta.declared)}, the example ${valueText(delta.productionExample)} (${delta.setIn})`).join('; ')
      : 'none'}`);
  }

  const passed = problems.length === 0;
  return fileResult('IQ-033', label, passed,
    `${passed ? '' : `${problems.join('; ')}. `}${flags.length} flag(s) declared for ${configuration.target} by ${configuration.declaredBy} at `
      + `${configuration.declaredAt} (declaration SHA-256 ${declared.sha256}); ${findings.join('; ')}. ${LIVE_PRODUCTION_STATEMENT}`,
    declared.file, {
      contract: configuration.contract, sha256: declared.sha256, target: configuration.target,
      declaredBy: configuration.declaredBy, declaredAt: configuration.declaredAt, flags: configuration.flags,
      source, productionExample: { path: examplePath, delta: productionDelta }, liveProduction: LIVE_PRODUCTION_STATEMENT,
      // The declaration lies outside the API checkout; the example and a source inside it are bound.
      readPaths: [declared.file, configuration.source.path, examplePath],
    });
}

// ---------------------------------------------------------------------------
// 1. Software Installation (IQ-001 through IQ-008)
//    IQ-001 and IQ-002 are API-based and run separately in the main runner.
// ---------------------------------------------------------------------------

export function checkSoftwareInstallation(workspaceRoot: string, apiRoot: string, frameworkRoot = FRAMEWORK_ROOT): EvidenceResult[] {
  const results: EvidenceResult[] = [];

  // IQ-003: Backend package.json exists and has version
  {
    const fp = path.join(apiRoot, 'package.json');
    const content = safeReadFile(fp);
    if (!content) {
      results.push(fileResult('IQ-003', 'Backend package.json exists', false, 'file NOT found', fp));
    } else {
      const pkg = safeParseJson(content);
      const version = pkg?.version as string | undefined;
      const passed = !!version;
      results.push(fileResult('IQ-003', 'Backend package.json exists', passed,
        passed ? `version=${version}` : 'version field missing', fp, { version }));
    }
  }

  // IQ-004: Node.js version requirement (engines.node includes "20" or version field exists)
  {
    const fp = path.join(apiRoot, 'package.json');
    const content = safeReadFile(fp);
    if (!content) {
      results.push(fileResult('IQ-004', 'Node.js >=20 configured', false, 'package.json not found', fp));
    } else {
      const pkg = safeParseJson(content);
      const engines = pkg?.engines as Record<string, string> | undefined;
      const nodeEngine = engines?.node;
      if (nodeEngine && nodeEngine.includes('20')) {
        results.push(fileResult('IQ-004', 'Node.js >=20 configured', true,
          `engines.node="${nodeEngine}"`, fp, { enginesNode: nodeEngine }));
      } else if (pkg?.version) {
        results.push(fileResult('IQ-004', 'Node.js >=20 configured', true,
          `engines.node not explicit but package.json has version="${pkg.version}" — acceptable`, fp,
          { enginesNode: nodeEngine ?? 'not set', version: pkg.version }));
      } else {
        results.push(fileResult('IQ-004', 'Node.js >=20 configured', false,
          'engines.node missing and no version field', fp));
      }
    }
  }

  // IQ-005: the frontend declares the Angular major the system description states
  {
    const label = 'Angular version matches the system description';
    const expected = SYSTEM_INFO.architecture.frontend.version;
    const fp = path.join(resolveFrontendRoot(workspaceRoot), 'package.json');
    const pkg = readPackageJson(fp);
    if (!pkg) {
      results.push(fileResult('IQ-005', label, false, 'package.json not found or not JSON', fp));
    } else {
      const angularCore = declaredDependency(pkg, '@angular/core');
      const major = declaredMajor(angularCore);
      const passed = major !== undefined && String(major) === expected;
      results.push(fileResult('IQ-005', label, passed,
        passed
          ? `@angular/core="${angularCore}", major ${major} as the system description states`
          : `@angular/core="${angularCore || 'not declared'}"; the system description states Angular ${expected}`,
        fp, { angularCore, major: major ?? null, expectedMajor: expected }));
    }
  }

  // IQ-006: the API and the frontend declare the TypeScript major of the system description
  {
    const label = 'TypeScript version matches the system description';
    const expected = /TypeScript (\d+)\./.exec(SYSTEM_INFO.architecture.sharedTypes.version)?.[1];
    const declared = [
      { project: 'api', file: path.join(apiRoot, 'package.json') },
      { project: 'frontend', file: path.join(resolveFrontendRoot(workspaceRoot), 'package.json') },
    ].map(({ project, file }) => {
      const pkg = readPackageJson(file);
      const typescript = declaredDependency(pkg, 'typescript');
      return { project, file, found: pkg !== null, typescript, major: declaredMajor(typescript) ?? null };
    });
    const wrong = declared.filter(entry => !entry.found || entry.major === null || String(entry.major) !== expected);
    const passed = expected !== undefined && wrong.length === 0;
    results.push(fileResult('IQ-006', label, passed,
      passed
        ? declared.map(entry => `${entry.project} typescript="${entry.typescript}"`).join(', ') + `, major ${expected} as the system description states`
        : wrong.map(entry => `${entry.file}: ${entry.found ? `typescript="${entry.typescript || 'not declared'}"` : 'not found or not JSON'}`).join('; ')
          + `; the system description states TypeScript ${expected ?? 'with no major'}`,
      declared[0].file, { declared, expectedMajor: expected ?? null }));
  }

  // IQ-007: Backend dependencies installed (node_modules exists)
  {
    const nmDir = path.join(apiRoot, 'node_modules');
    const exists = fs.existsSync(nmDir);
    results.push(fileResult('IQ-007', 'Backend dependencies installed', exists,
      exists ? 'node_modules directory present' : 'node_modules directory NOT found', nmDir));
  }

  // IQ-008: shared types installed in the API, the frontend and this framework from
  // the vendored release, checked by the EDC's own verifier; never a source folder.
  results.push(checkSharedTypesInstallation(path.join(apiRoot, SHARED_TYPES_VERIFIER), [
    { name: 'api', root: apiRoot },
    { name: 'ui', root: resolveFrontendRoot(workspaceRoot) },
    { name: 'validation-framework', root: frameworkRoot },
  ], { consumer: 'validation-framework', reference: 'api' }));

  return results;
}

// ---------------------------------------------------------------------------
// 2. Database Schema (IQ-009 through IQ-018)
// ---------------------------------------------------------------------------

function checkDatabaseSchema(apiRoot: string): EvidenceResult[] {
  const results: EvidenceResult[] = [];

  const migrationsPath = path.join(apiRoot, 'src', 'config', 'migrations.ts');
  const databasePath = path.join(apiRoot, 'src', 'config', 'database.ts');
  const migrationsContent = safeReadFile(migrationsPath);
  const databaseContent = safeReadFile(databasePath);

  // IQ-009: PostgreSQL configured (pg pool in database.ts)
  {
    if (!databaseContent) {
      results.push(fileResult('IQ-009', 'PostgreSQL configured', false, 'database.ts not found', databasePath));
    } else {
      const hasPg = /Pool|pg|postgres/i.test(databaseContent);
      results.push(fileResult('IQ-009', 'PostgreSQL configured', hasPg,
        hasPg ? 'pg Pool configuration found in database.ts' : 'No pg Pool reference found', databasePath));
    }
  }

  // IQ-010: Database connection pool configured
  {
    if (!databaseContent) {
      results.push(fileResult('IQ-010', 'Database pool configured', false, 'database.ts not found', databasePath));
    } else {
      const hasPool = /new\s+Pool|pool|createPool/i.test(databaseContent);
      results.push(fileResult('IQ-010', 'Database pool configured', hasPool,
        hasPool ? 'Pool configuration found' : 'No Pool configuration found', databasePath));
    }
  }

  // IQ-011 through IQ-016: Table definitions in migrations.ts
  const tableChecks: Array<{ id: string; label: string; pattern: RegExp; alsoRequires?: RegExp[] }> = [
    { id: 'IQ-011', label: 'Audit log table defined', pattern: /audit_log_event|acc_audit_log|audit_log/i },
    { id: 'IQ-012', label: 'E-signatures infrastructure defined', pattern: /signature|esign|e_sign/i },
    { id: 'IQ-013', label: 'Users table defined', pattern: /acc_users|CREATE\s+TABLE[^;]*users|user_account/i },
    { id: 'IQ-014', label: 'Query infrastructure defined', pattern: /query|queries|acc_queries/i },
    { id: 'IQ-015', label: 'Data locks infrastructure defined', pattern: /lock|freeze|unlock_request|data_lock/i },
    // IQ-016 requires ALL THREE real task tables, not any one of them. The previous
    // pattern (/workflow_task|acc_task|task_status/) passed on a single loose match
    // while the IQ document it evidenced claimed a nonexistent `acc_tasks` table —
    // so the check passed for the wrong reason. There is no acc_tasks table.
    {
      id: 'IQ-016',
      label: 'Task tables defined (acc_workflow_tasks, acc_study_tasks, acc_task_status)',
      pattern: /acc_workflow_tasks/i,
      alsoRequires: [/acc_study_tasks/i, /acc_task_status/i],
    },
  ];

  for (const check of tableChecks) {
    if (!migrationsContent) {
      results.push(fileResult(check.id, check.label, false, 'migrations.ts not found', migrationsPath));
    } else {
      const missing = [check.pattern, ...(check.alsoRequires ?? [])]
        .filter((p) => !p.test(migrationsContent))
        .map((p) => p.source);
      const found = missing.length === 0;
      results.push(fileResult(check.id, check.label, found,
        found ? 'table definition found in migrations.ts'
              : `table definition NOT found in migrations.ts (missing: ${missing.join(', ')})`,
        migrationsPath));
    }
  }

  // IQ-017: Foreign key constraints (at least 5)
  {
    if (!migrationsContent) {
      results.push(fileResult('IQ-017', 'Foreign key constraints', false, 'migrations.ts not found', migrationsPath));
    } else {
      const fkCount = countMatches(migrationsContent, /REFERENCES|FOREIGN\s+KEY/gi);
      const passed = fkCount >= 5;
      results.push(fileResult('IQ-017', 'Foreign key constraints', passed,
        passed ? `${fkCount} REFERENCES/FOREIGN KEY found (≥5 required)` : `Only ${fkCount} found (≥5 required)`,
        migrationsPath, { foreignKeyCount: fkCount }));
    }
  }

  // IQ-018: Database indexes (at least 5)
  {
    if (!migrationsContent) {
      results.push(fileResult('IQ-018', 'Database indexes', false, 'migrations.ts not found', migrationsPath));
    } else {
      const idxCount = countMatches(migrationsContent, /CREATE\s+(UNIQUE\s+)?INDEX/gi);
      const passed = idxCount >= 5;
      results.push(fileResult('IQ-018', 'Database indexes', passed,
        passed ? `${idxCount} CREATE INDEX statements found (≥5 required)` : `Only ${idxCount} found (≥5 required)`,
        migrationsPath, { indexCount: idxCount }));
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// 3. Configuration (IQ-019 through IQ-025)
// ---------------------------------------------------------------------------

function checkConfiguration(apiRoot: string): EvidenceResult[] {
  const results: EvidenceResult[] = [];
  const mwDir = path.join(apiRoot, 'src', 'middleware');
  const cfgDir = path.join(apiRoot, 'src', 'config');
  const srcDir = path.join(apiRoot, 'src');

  // IQ-019: Part 11 compliance middleware
  {
    const fp = path.join(mwDir, 'part11.middleware.ts');
    const exists = fs.existsSync(fp);
    results.push(fileResult('IQ-019', 'Part 11 compliance middleware', exists,
      exists ? 'part11.middleware.ts present' : 'part11.middleware.ts NOT found', fp));
  }

  // IQ-020: JWT_SECRET referenced from environment (not hardcoded)
  {
    const authMwPath = path.join(mwDir, 'auth.middleware.ts');
    const envPath = path.join(cfgDir, 'environment.ts');
    let found = false;
    let source = authMwPath;
    const readPaths = [authMwPath];

    const authContent = safeReadFile(authMwPath);
    if (authContent && /process\.env\.JWT_SECRET|process\.env\[['"]JWT_SECRET['"]\]/i.test(authContent)) {
      found = true;
      source = authMwPath;
    }
    if (!found) {
      readPaths.push(envPath);
      const envContent = safeReadFile(envPath);
      if (envContent && /JWT_SECRET/i.test(envContent)) {
        found = true;
        source = envPath;
      }
    }

    results.push(fileResult('IQ-020', 'JWT_SECRET from environment', found,
      found ? `JWT_SECRET referenced in ${path.basename(source)}` : 'JWT_SECRET environment reference NOT found',
      source, { readPaths }));
  }

  // IQ-021: Rate limiter middleware
  {
    const fp = path.join(mwDir, 'rateLimiter.middleware.ts');
    const exists = fs.existsSync(fp);
    results.push(fileResult('IQ-021', 'Rate limiter middleware', exists,
      exists ? 'rateLimiter.middleware.ts present' : 'rateLimiter.middleware.ts NOT found', fp));
  }

  // IQ-022: CORS configured in backend
  {
    const candidates = ['server.ts', 'app.ts', 'index.ts'].map(f => path.join(srcDir, f));
    let found = false;
    let foundFile = candidates[0];
    const readPaths: string[] = [];

    for (const fp of candidates) {
      readPaths.push(fp);
      const content = safeReadFile(fp);
      if (content && /cors/i.test(content)) {
        found = true;
        foundFile = fp;
        break;
      }
    }

    results.push(fileResult('IQ-022', 'CORS configured', found,
      found ? `cors referenced in ${path.basename(foundFile)}` : 'cors reference NOT found in server.ts/app.ts/index.ts',
      foundFile, { readPaths }));
  }

  // IQ-023: environment.ts exists and references database configuration
  {
    const fp = path.join(cfgDir, 'environment.ts');
    const content = safeReadFile(fp);
    if (!content) {
      results.push(fileResult('IQ-023', 'Environment config with database settings', false,
        'environment.ts not found', fp));
    } else {
      const hasDbConfig = /DATABASE_URL|DB_HOST|LIBRECLINICA_DB|database|pool/i.test(content);
      results.push(fileResult('IQ-023', 'Environment config with database settings', hasDbConfig,
        hasDbConfig ? 'Database configuration referenced in environment.ts' : 'Database configuration NOT found', fp));
    }
  }

  // IQ-024: Audit middleware exists
  {
    const fp = path.join(mwDir, 'audit.middleware.ts');
    const exists = fs.existsSync(fp);
    results.push(fileResult('IQ-024', 'Audit middleware', exists,
      exists ? 'audit.middleware.ts present' : 'audit.middleware.ts NOT found', fp));
  }

  // IQ-025: Error handler middleware exists
  {
    const fp = path.join(mwDir, 'errorHandler.middleware.ts');
    const exists = fs.existsSync(fp);
    results.push(fileResult('IQ-025', 'Error handler middleware', exists,
      exists ? 'errorHandler.middleware.ts present' : 'errorHandler.middleware.ts NOT found', fp));
  }

  return results;
}

// ---------------------------------------------------------------------------
// 4. Security & Backup (IQ-026 through IQ-032)
//    IQ-031 is API-based and runs separately in the main runner.
// ---------------------------------------------------------------------------

function checkSecurityAndBackup(_workspaceRoot: string, apiRoot: string): EvidenceResult[] {
  const results: EvidenceResult[] = [];
  const backupDir = path.join(apiRoot, 'src', 'services', 'backup');
  const cfgDir = path.join(apiRoot, 'src', 'config');
  const svcDir = path.join(apiRoot, 'src', 'services', 'database');

  // IQ-026: Backup service exists
  {
    const fp = path.join(backupDir, 'backup.service.ts');
    const exists = fs.existsSync(fp);
    results.push(fileResult('IQ-026', 'Backup service', exists,
      exists ? 'backup.service.ts present' : 'backup.service.ts NOT found', fp));
  }

  // IQ-027: AES-256 encryption used in encryption service
  {
    const fp = path.join(backupDir, 'encryption.service.ts');
    const content = safeReadFile(fp);
    if (!content) {
      results.push(fileResult('IQ-027', 'AES-256 encryption', false,
        'encryption.service.ts not found', fp));
    } else {
      const hasAes = /aes-256|AES.256|createCipher|createCipheriv/i.test(content);
      results.push(fileResult('IQ-027', 'AES-256 encryption', hasAes,
        hasAes ? 'AES-256 reference found in encryption.service.ts' : 'No AES-256 reference found in file', fp));
    }
  }

  // IQ-028: Backup scheduler exists
  {
    const fp = path.join(backupDir, 'backup-scheduler.service.ts');
    const exists = fs.existsSync(fp);
    results.push(fileResult('IQ-028', 'Backup scheduler', exists,
      exists ? 'backup-scheduler.service.ts present' : 'backup-scheduler.service.ts NOT found', fp));
  }

  // IQ-029 (environment segregation) reads the configuration declaration: checkEnvironmentSegregation, from run().

  // IQ-030: UTC timezone reference in database or environment config
  {
    const dbPath = path.join(cfgDir, 'database.ts');
    const envPath = path.join(cfgDir, 'environment.ts');
    const dbContent = safeReadFile(dbPath);
    const envContent = safeReadFile(envPath);
    let found = false;
    let source = dbPath;

    if (dbContent && /UTC|timezone/i.test(dbContent)) {
      found = true;
      source = dbPath;
    } else if (envContent && /UTC|timezone/i.test(envContent)) {
      found = true;
      source = envPath;
    }

    results.push(fileResult('IQ-030', 'UTC timezone reference', found,
      found ? `UTC/timezone referenced in ${path.basename(source)}` : 'No UTC/timezone reference found in database.ts or environment.ts',
      source, { readPaths: [dbPath, envPath] }));
  }

  // IQ-032: Password complexity validation in auth service
  {
    const fp = path.join(svcDir, 'auth.service.ts');
    const content = safeReadFile(fp);
    if (!content) {
      results.push(fileResult('IQ-032', 'Password complexity validation', false,
        'auth.service.ts not found', fp));
    } else {
      const hasPasswordValidation =
        /password/i.test(content) &&
        (/length|complexity|regex|minimum|minLength|strong|weak|valid/i.test(content));
      results.push(fileResult('IQ-032', 'Password complexity validation', hasPasswordValidation,
        hasPasswordValidation
          ? 'Password validation logic found in auth.service.ts'
          : 'No password complexity/validation pattern found in auth.service.ts',
        fp));
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Source binding: the API checkout read is the API release under test (IR-265)
// ---------------------------------------------------------------------------

/** The path with every part that exists resolved as the file system holds it (a junction, a subst
 * drive, an 8.3 short name), so it compares with the paths git reports under its real top level;
 * a part that does not exist (a deleted file) is kept as written under its resolved parent. */
function realPath(file: string): string {
  const resolved = path.resolve(file);
  try { return fs.realpathSync.native(resolved); } catch {
    const parent = path.dirname(resolved);
    return parent === resolved ? resolved : path.join(realPath(parent), path.basename(resolved));
  }
}

/** True when `inner` is `outer` or lies under it (case-insensitive on Windows, as path.relative is).
 * Both are real paths (realPath). */
function within(outer: string, inner: string): boolean {
  const relative = path.relative(outer, inner);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Every path a file system record read: the path it names and each one its check lists in
 * `readPaths` (a check that reads more files, or a directory), as real paths. */
function recordReadPaths(body: Record<string, unknown>): string[] {
  const listed = Array.isArray(body.readPaths) ? body.readPaths : [];
  return [...new Set([body.path, ...listed].filter((file): file is string => typeof file === 'string' && file.length > 0).map(realPath))];
}

/** Binds every file system record that read the API checkout to the API release under test. A
 * record is bound when its path, or any path in its `readPaths`, lies in the API checkout. With a
 * Git commit as the release, a checkout whose HEAD is another commit (or cannot be read, or whose git
 * top level is not the API folder itself, as for a folder inside another repository) fails the record
 * (SOURCE_NOT_RELEASE_UNDER_TEST); with any release, any read path in the checkout with uncommitted or
 * untracked changes fails it (SOURCE_FILE_MODIFIED); an image ID cannot be compared with a checkout,
 * so the record states its binding unverified. A record that already failed with a code keeps that
 * code; a passed record the binding fails gets responseStatus 409 (fileResult's 200 is the file
 * check's). Without a release identity (a runner called outside the CLI) records are left unchanged. */
export function bindApiSourceToRelease(
  results: EvidenceResult[], apiRoot: string, release: ReleaseComponent | undefined,
  state: () => CheckoutState = () => checkoutState(apiRoot),
): void {
  if (!release) return;
  const api = realPath(apiRoot);
  const bound = results.flatMap(result => {
    if (result.method !== 'FS' || !isRecord(result.responseBody)) return [];
    const reads = recordReadPaths(result.responseBody).filter(file => within(api, file));
    return reads.length ? [{ result, reads }] : [];
  });
  if (!bound.length) return;
  const read = state();
  const root = read.root === undefined ? undefined : realPath(read.root);
  // git reads the enclosing repository for a plain folder inside one: its HEAD is not the API's.
  const nested = root !== undefined && path.relative(root, api) !== '';
  const checkout: CheckoutState = nested ? {} : read;
  const changed = checkout.changed?.map(realPath) ?? [];
  const releaseText = `${release.kind} ${release.identity}`;
  const unread = nested
    ? `the API folder ${apiRoot} is not the top level of a git checkout (git reads ${read.root})`
    : `the HEAD of the API checkout ${apiRoot} cannot be read`;
  for (const { result, reads } of bound) {
    const body = result.responseBody as Record<string, unknown>;
    const modified = changed.filter(file => reads.some(readPath => within(file, readPath) || within(readPath, file)));
    let code: string | undefined;
    let statement: string;
    if (release.kind === 'git-commit' && checkout.commit !== release.identity) {
      code = 'SOURCE_NOT_RELEASE_UNDER_TEST';
      statement = checkout.commit
        ? `the API checkout ${apiRoot} is at ${checkout.commit}, not the API release under test ${release.identity}`
        : `${unread}, so it is not shown to be the API release under test ${release.identity}`;
      if (modified.length) statement += `, and ${modified.join(', ')} ${modified.length === 1 ? 'has' : 'have'} uncommitted changes`;
    } else if (modified.length) {
      code = 'SOURCE_FILE_MODIFIED';
      statement = `${modified.join(', ')} ${modified.length === 1 ? 'has' : 'have'} uncommitted changes in the API checkout ${apiRoot}, so the record did not read the files `
        + `of the API release under test ${releaseText}`;
    } else if (release.kind === 'git-commit') {
      statement = `the API checkout is at the API release under test ${release.identity} and no path the record read in it `
        + `(${reads.map(file => path.relative(api, file) || '.').join(', ')}) has an uncommitted change`;
    } else {
      statement = `binding unverified: the API release under test is ${releaseText}, which a checkout cannot be compared with`
        + `${checkout.commit ? ` (checkout at ${checkout.commit})` : nested ? ` (${unread})` : ''}`;
    }
    result.responseBody = {
      ...body,
      sourceBinding: {
        release: releaseText, checkoutCommit: checkout.commit ?? null,
        verified: release.kind === 'git-commit' && code === undefined, ...(modified.length ? { modified } : {}),
      },
    };
    if (code) {
      if (result.passed && result.responseStatus === 200) result.responseStatus = 409;
      result.passed = false;
      result.outcomeCode ??= code;
      result.notes += `; source binding failed: ${statement}`;
    } else {
      result.notes += `; source binding: ${statement}`;
    }
  }
}

/** A case a throwing check group did not record: CONTRACT, not executed (IQ_CHECK_ERROR). */
function checkErrorResult(testCaseId: string, group: string, error: string): EvidenceResult {
  return {
    testCaseId, timestamp: ts(), endpoint: `IQ check group ${group}`, method: 'CONTRACT',
    responseStatus: 0, responseBody: { group, error }, passed: false, outcomeCode: 'IQ_CHECK_ERROR',
    notes: `Not executed: the IQ check group ${group} failed before recording this case (${error}).`,
  };
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export async function run(
  outputDir: string,
  baseUrl: string,
  workspaceRoot?: string,
  _qualificationFlags: readonly string[] = [],
  options: IqRunOptions = {},
): Promise<EvidenceResult[]> {
  const wsRoot = workspaceRoot || defaultWorkspaceRoot();
  const apiRoot = resolveLibreclinicaApiRoot(wsRoot);
  console.log(`\n  Running IQ checks (${IQ_CASE_COUNT} test cases) against ${baseUrl}...`);

  const results: EvidenceResult[] = [];
  // Each check group's records are journaled as it completes, so an interrupted run keeps them (IR-166). The
  // journaled copies are bound to the release as the saved records are, on one read of the API checkout.
  let journalCheckout: CheckoutState | undefined;
  const journal = (rows: EvidenceResult[]) => {
    const copies = JSON.parse(JSON.stringify(rows)) as EvidenceResult[];
    bindApiSourceToRelease(copies, apiRoot, currentReleaseIdentity()?.components.api, () => (journalCheckout ??= checkoutState(apiRoot)));
    appendCaseJournal(outputDir, 'iq', copies);
  };

  // --- File-based checks (IQ-003..IQ-030, IQ-032..IQ-035) ---
  // Each group's cases, so a group that throws still leaves a row for each of them (IQ_CHECK_ERROR).
  const range = (from: number, to: number) => IQ_CASE_IDS.slice(from - 1, to);
  const groups: Array<{ name: string; cases: readonly string[]; check: () => EvidenceResult[] }> = [
    { name: 'checkSoftwareInstallation', cases: range(3, 8), check: () => checkSoftwareInstallation(wsRoot, apiRoot) },
    { name: 'checkDatabaseSchema', cases: range(9, 18), check: () => checkDatabaseSchema(apiRoot) },
    { name: 'checkConfiguration', cases: range(19, 25), check: () => checkConfiguration(apiRoot) },
    { name: 'checkSecurityAndBackup', cases: ['IQ-026', 'IQ-027', 'IQ-028', 'IQ-030', 'IQ-032'], check: () => checkSecurityAndBackup(wsRoot, apiRoot) },
    { name: 'checkEnvironmentSegregation', cases: ['IQ-029'], check: () => [checkEnvironmentSegregation(options.targetConfigFile, baseUrl)] },
    { name: 'checkConfigurationUnderTest', cases: ['IQ-033'], check: () => [checkConfigurationUnderTest(options.targetConfigFile, baseUrl, apiRoot)] },
    { name: 'checkDeadSettings', cases: ['IQ-034'], check: () => [checkDeadSettings(apiRoot, resolveFrontendRoot(wsRoot), wsRoot)] },
    { name: 'checkVendoredReceipts', cases: ['IQ-035'], check: () => [checkVendoredReceipts(apiRoot)] },
  ];
  for (const group of groups) {
    const before = results.length;
    try { results.push(...group.check()); } catch (err: unknown) {
      console.error(`  [IQ] ${group.name} error:`, err);
      const recorded = new Set(results.map(result => result.testCaseId));
      results.push(...group.cases.filter(id => !recorded.has(id)).map(id => checkErrorResult(id, group.name, errorText(err))));
    }
    journal(results.slice(before));
  }
  const apiChecksFrom = results.length;

  // --- API-based checks ---

  // IQ-001: the version /health reports is the validated release's label (07-iq-protocol states it, IR-585).
  try {
    let mismatch = false;
    const healthResult = await captureWithValidator({ testCaseId: 'IQ-001', method: 'GET', url: '/health', baseUrl }, (status, body) => {
      if (status < 200 || status >= 300) return { passed: false, notes: `/health returned HTTP ${status}` };
      const version = isRecord(body) && typeof body.version === 'string' ? body.version : undefined;
      if (version === SYSTEM_INFO.version) return { passed: true, notes: `/health reports version "${version}", the validated release's label` };
      mismatch = true;
      return { passed: false, notes: `/health reports ${version === undefined ? 'no version' : `version "${version}"`}, `
        + `not the validated release's label "${SYSTEM_INFO.version}"` };
    });
    if (mismatch && !healthResult.passed) healthResult.outcomeCode = 'VERSION_MISMATCH';
    results.push(healthResult);
  } catch (err: unknown) {
    results.push({
      testCaseId: 'IQ-001', timestamp: ts(),
      endpoint: 'GET /health', method: 'GET', responseStatus: 0,
      responseBody: { error: err instanceof Error ? err.message : String(err) },
      passed: false, notes: `Health check failed: ${err instanceof Error ? err.message : 'unknown'}`,
    });
  }

  // IQ-002: Auth required on protected endpoints
  try {
    const authRequired = await captureWithExpectedStatus(
      { testCaseId: 'IQ-002', method: 'GET', url: '/api/users', baseUrl }, 401,
    );
    results.push(authRequired);
  } catch (err: unknown) {
    results.push({
      testCaseId: 'IQ-002', timestamp: ts(),
      endpoint: 'GET /api/auth/me', method: 'GET', responseStatus: 0,
      responseBody: { error: err instanceof Error ? err.message : String(err) },
      passed: false, notes: `Auth-required check failed: ${err instanceof Error ? err.message : 'unknown'}`,
    });
  }

  // IQ-031: Studies endpoint without auth → 401
  try {
    const noAuth = await captureWithExpectedStatus(
      { testCaseId: 'IQ-031', method: 'GET', url: '/api/studies', baseUrl }, 401,
    );
    results.push(noAuth);
  } catch (err: unknown) {
    results.push({
      testCaseId: 'IQ-031', timestamp: ts(),
      endpoint: 'GET /api/studies', method: 'GET', responseStatus: 0,
      responseBody: { error: err instanceof Error ? err.message : String(err) },
      passed: false, notes: `Unauthenticated access check failed: ${err instanceof Error ? err.message : 'unknown'}`,
    });
  }

  journal(results.slice(apiChecksFrom));

  // --- Every protocol case has a row; the API checkout's records are bound to the release ---
  const recorded = new Set(results.map(result => result.testCaseId));
  results.push(...IQ_CASE_IDS.filter(id => !recorded.has(id)).map(id => checkErrorResult(id, 'run', 'no check recorded this case')));
  bindApiSourceToRelease(results, apiRoot, currentReleaseIdentity()?.components.api);

  // --- Sort by test case ID for clean output ---
  results.sort((a, b) => {
    const numA = parseInt(a.testCaseId.replace(/\D/g, ''), 10);
    const numB = parseInt(b.testCaseId.replace(/\D/g, ''), 10);
    return numA - numB;
  });

  // --- Save evidence ---
  const evidencePath = saveEvidence(outputDir, 'iq', results);
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`  IQ: ${passed}/${results.length} checks passed, ${failed} failed.`);
  console.log(`  Evidence: ${evidencePath}`);

  if (failed > 0) {
    console.log('  Failed checks:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`    ✗ ${r.testCaseId}: ${r.notes}`);
    }
  }

  return results;
}
