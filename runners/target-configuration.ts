import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { isRecord, strictObject, type EvidenceResult } from './evidence-capture';

// The configuration under test (TA3 plan VAL-1, spec P20 VD-9, 3.3 and 3.9). A
// validation-target-configuration/1 declaration states the EDC settings of the
// target that decide what the OQ can observe. Its flag names come only from an
// allowlist, and every other member has a fixed form, so no secret can enter.
// IQ-033 checks a declaration against its source file and states its delta to
// the EDC production example; a sealed package records it with every
// contradiction the run observed (configurationUnderTest in package-manifest.json).
// Contract: contracts/validation-target-configuration-v1.schema.json.

export const TARGET_CONFIGURATION_CONTRACT = 'validation-target-configuration/1';
/** Required members; the contract test compares them with the schema. */
export const TARGET_CONFIGURATION_REQUIRED = ['contract', 'target', 'source', 'declaredBy', 'declaredAt', 'flags'] as const;
export const TARGET_CONFIGURATION_SOURCE_REQUIRED = ['path', 'sha256'] as const;
/** The EDC service whose environment a compose source sets (the K6, sandbox and EDCProjectCompliant compose files). */
export const CORE_API_SERVICE = 'core-api';

/** How the EDC reads a boolean setting: on only when exactly 'true'; on unless exactly
 * 'false'; on when unset or exactly 'true'. */
type BooleanReading = 'true-enables' | 'false-disables' | 'unset-or-true';
type FlagSpec = { kind: 'boolean'; reading: BooleanReading } | { kind: 'node-env' } | { kind: 'presence' };

/** The allowlist (spec P20 3.3), with the reading the EDC applies to each setting. */
export const TARGET_CONFIGURATION_FLAGS = {
  // libreclinicaapi src/config/environment.ts: process.env.ENABLE_DEVIATION_ENGINE === 'true'
  ENABLE_DEVIATION_ENGINE: { kind: 'boolean', reading: 'true-enables' },
  // src/services/database/domain-event.service.ts domainEventsEnabled()
  ENABLE_DOMAIN_EVENTS: { kind: 'boolean', reading: 'true-enables' },
  // O-1 (spec P09 4.3): 503 DEVIATION_DECISIONS_DISABLED unless 'true'
  ENABLE_DEVIATION_DECISIONS: { kind: 'boolean', reading: 'true-enables' },
  // src/server.ts: process.env.ENABLE_STUDY_TASK_CRON !== 'false'
  ENABLE_STUDY_TASK_CRON: { kind: 'boolean', reading: 'false-disables' },
  // src/config/environment.ts: process.env.ESIG_ACKNOWLEDGEMENT_ENFORCED === 'true'
  ESIG_ACKNOWLEDGEMENT_ENFORCED: { kind: 'boolean', reading: 'true-enables' },
  // src/config/environment.ts: process.env.ENABLE_M2M_API_KEYS === 'true'
  ENABLE_M2M_API_KEYS: { kind: 'boolean', reading: 'true-enables' },
  // src/config/environment.ts: (process.env.ENABLE_DATA_CLEANING ?? 'true') === 'true'
  ENABLE_DATA_CLEANING: { kind: 'boolean', reading: 'unset-or-true' },
  // W-1 (spec P17 2.2.9), default false; suite 18 depends on both
  INSPECTION_COPY_TA3_INVENTORY: { kind: 'boolean', reading: 'true-enables' },
  ENABLE_SEGMENTED_INSPECTION_EXPORT: { kind: 'boolean', reading: 'true-enables' },
  NODE_ENV: { kind: 'node-env' },
  // src/services/database/training-duty-readiness.ts: declared only as set or unset
  TRAINING_SERVICE_URL: { kind: 'presence' },
} as const satisfies Record<string, FlagSpec>;

export type TargetConfigurationFlag = keyof typeof TARGET_CONFIGURATION_FLAGS;
export const TARGET_CONFIGURATION_FLAG_NAMES = Object.keys(TARGET_CONFIGURATION_FLAGS) as TargetConfigurationFlag[];
export const NODE_ENVIRONMENTS = ['production', 'staging', 'development', 'test'] as const;
export type FlagValue = boolean | typeof NODE_ENVIRONMENTS[number] | 'set' | 'unset';
export type DeclaredFlags = Partial<Record<TargetConfigurationFlag, FlagValue>>;

export interface TargetConfiguration {
  contract: typeof TARGET_CONFIGURATION_CONTRACT;
  /** The API base URL the declaration describes; it must be the run's --base-url. */
  target: string;
  /** The file that sets the target's environment (a compose file or an env file) and its SHA-256. */
  source: { path: string; sha256: string };
  declaredBy: string;
  declaredAt: string;
  flags: DeclaredFlags;
}

/** A declared flag that something the run observed contradicts. `observedBy` names
 * the case: IQ-033 for the source file, an OQ case for the target's answer. */
export interface ConfigurationMismatch {
  flag: TargetConfigurationFlag;
  declared: FlagValue;
  observed: FlagValue;
  observedBy: string;
}
export const CONFIGURATION_MISMATCH_REQUIRED = ['flag', 'declared', 'observed', 'observedBy'] as const;

/** configurationUnderTest of a sealed package: the declaration it retained and the contradictions. */
export interface ConfigurationUnderTest {
  contract: typeof TARGET_CONFIGURATION_CONTRACT;
  /** SHA-256 of the retained declaration's bytes (inputs/target-configuration.json). */
  sha256: string;
  flags: DeclaredFlags;
  mismatches: ConfigurationMismatch[];
}
export const CONFIGURATION_UNDER_TEST_REQUIRED = ['contract', 'sha256', 'flags', 'mismatches'] as const;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const CASE_ID = /^[A-Z]{2,4}-\d{3}$/;
const DECLARATION_BYTE_LIMIT = 1024 * 1024;

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const withoutBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

function boundedText(value: unknown, at: string, limit: number): string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value),
    `${at} must be text of 1 to ${limit} printable characters`);
  return value;
}

export function isTargetConfigurationFlag(name: unknown): name is TargetConfigurationFlag {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(TARGET_CONFIGURATION_FLAGS, name);
}

/** The values a flag may take: a boolean, one of NODE_ENVIRONMENTS, or set and unset. */
export function isFlagValue(flag: TargetConfigurationFlag, value: unknown): value is FlagValue {
  const spec: FlagSpec = TARGET_CONFIGURATION_FLAGS[flag];
  if (spec.kind === 'boolean') return typeof value === 'boolean';
  if (spec.kind === 'node-env') return (NODE_ENVIRONMENTS as readonly unknown[]).includes(value);
  return value === 'set' || value === 'unset';
}

function flagValueText(flag: TargetConfigurationFlag): string {
  const spec: FlagSpec = TARGET_CONFIGURATION_FLAGS[flag];
  if (spec.kind === 'boolean') return 'true or false';
  if (spec.kind === 'node-env') return `one of ${NODE_ENVIRONMENTS.join(', ')}`;
  return 'set or unset';
}

/** Strict flags: allowlisted names with their value forms. A refusal names the flag,
 * never the value, so a refused file prints nothing it held. */
export function parseDeclaredFlags(value: unknown, at: string, allowEmpty = false): DeclaredFlags {
  check(isRecord(value), `${at} must be an object`);
  const names = Object.keys(value);
  check(allowEmpty || names.length > 0, `${at} declares no flag`);
  for (const name of names) {
    check(isTargetConfigurationFlag(name), `${at} names ${JSON.stringify(name.slice(0, 64))}, which is not on the allowlist `
      + `(${TARGET_CONFIGURATION_FLAG_NAMES.join(', ')})`);
    check(isFlagValue(name, value[name]), `${at}.${name} must be ${flagValueText(name)}`);
  }
  return value as DeclaredFlags;
}

function httpUrl(value: unknown, at: string): string {
  const text = boundedText(value, at, 2048);
  let url: URL | undefined;
  try { url = new URL(text); } catch { url = undefined; }
  check(url && (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && !url.search && !url.hash,
    `${at} must be an http or https URL with no credentials, query or fragment`);
  return text;
}

/** Strict reading of a validation-target-configuration/1 declaration. */
export function parseTargetConfiguration(value: unknown, at = 'The configuration declaration'): TargetConfiguration {
  const declaration = strictObject(value, at, TARGET_CONFIGURATION_REQUIRED);
  check(declaration.contract === TARGET_CONFIGURATION_CONTRACT, `${at} contract must be ${TARGET_CONFIGURATION_CONTRACT}`);
  httpUrl(declaration.target, `${at} target`);
  const source = strictObject(declaration.source, `${at} source`, TARGET_CONFIGURATION_SOURCE_REQUIRED);
  check(path.isAbsolute(boundedText(source.path, `${at} source.path`, 1024)), `${at} source.path must be an absolute path`);
  check(typeof source.sha256 === 'string' && SHA256_HEX.test(source.sha256), `${at} source.sha256 must be a SHA-256 in lower-case hex`);
  boundedText(declaration.declaredBy, `${at} declaredBy`, 200);
  check(typeof declaration.declaredAt === 'string' && INSTANT.test(declaration.declaredAt) && Number.isFinite(Date.parse(declaration.declaredAt)),
    `${at} declaredAt must be a UTC instant (yyyy-mm-ddThh:mm:ssZ)`);
  parseDeclaredFlags(declaration.flags, `${at} flags`);
  return declaration as unknown as TargetConfiguration;
}

export interface DeclaredConfiguration {
  /** The absolute path read. */
  file: string;
  /** SHA-256 of the declaration's bytes. */
  sha256: string;
  configuration: TargetConfiguration;
}

/** Reads a declaration file (at most 1 MiB of JSON) and refuses one that breaks the contract. */
export function readTargetConfiguration(file: string): DeclaredConfiguration {
  const resolved = path.resolve(file);
  let bytes: Buffer;
  try {
    const stat = fs.statSync(resolved);
    check(stat.isFile() && stat.size <= DECLARATION_BYTE_LIMIT, `The configuration declaration ${resolved} is not a file of at most ${DECLARATION_BYTE_LIMIT} bytes.`);
    bytes = fs.readFileSync(resolved);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('The configuration declaration ')) throw error;
    throw new Error(`The configuration declaration ${resolved} cannot be read (${(error as NodeJS.ErrnoException).code ?? String(error)}).`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(withoutBom(bytes.toString('utf8'))); }
  catch { throw new Error(`The configuration declaration ${resolved} is not JSON.`); }
  return { file: resolved, sha256: sha256(bytes), configuration: parseTargetConfiguration(parsed, `The configuration declaration ${resolved}`) };
}

/** Two base URLs name the same target: protocol, host and port, and path without trailing slashes. */
export function sameTarget(left: string, right: string): boolean {
  const normal = (value: string) => {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  };
  try { return normal(left) === normal(right); } catch { return false; }
}

/** The CLI's check before any runner starts: the declaration reads, keeps the
 * contract and describes the run's target. */
export function checkTargetConfiguration(file: string, baseUrl: string): DeclaredConfiguration {
  const declared = readTargetConfiguration(file);
  check(sameTarget(declared.configuration.target, baseUrl),
    `The configuration declaration ${declared.file} describes target ${declared.configuration.target}, not the run's --base-url ${baseUrl}.`);
  return declared;
}

// ---------------------------------------------------------------------------
// Files that set an environment: env files and compose service environments
// ---------------------------------------------------------------------------

export interface EnvironmentEntry {
  /** The literal value, or undefined when it is set elsewhere (an interpolation, or taken from the shell). */
  value: string | undefined;
  /** One-based line in the file. */
  line: number;
}

export interface SourceEnvironment {
  entries: Map<string, EnvironmentEntry>;
  /** False when a key absent from the entries may still be set (env_file, a YAML merge key). */
  complete: boolean;
}

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const indentOf = (line: string) => line.length - line.trimStart().length;
const isContent = (line: string) => line.trim() !== '' && !line.trimStart().startsWith('#');

/** A value as a compose or env file writes it: the inside of matching quotes, or the
 * plain text without a trailing comment. */
function unquote(raw: string): { text: string; quoted: boolean } {
  const text = raw.trim();
  const quote = text[0];
  if (quote === '"' || quote === '\'') {
    const close = text.indexOf(quote, 1);
    if (close > 0 && /^(?:\s+#.*)?$/.test(text.slice(close + 1))) return { text: text.slice(1, close), quoted: true };
  }
  return { text: text.replace(/\s+#.*$/, ''), quoted: false };
}

/** Undefined for an interpolation, which is resolved where the stack starts, not in the file. */
const literal = (text: string): string | undefined => (/\$\{|\$[A-Za-z_]/.test(text) ? undefined : text);

/** A compose map value: undefined when it is taken from the shell (empty, ~ or null)
 * or is a block scalar this reader does not follow. */
function composeValue(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const { text, quoted } = unquote(raw);
  if (!quoted && ['', '~', 'null', '|', '>', '|-', '>-'].includes(text)) return undefined;
  return literal(text);
}

/** KEY=value lines of an env file (comments, blank lines and `export` prefixes allowed). */
export function dotenvEnvironment(text: string): SourceEnvironment {
  const entries = new Map<string, EnvironmentEntry>();
  text.split(/\r?\n/).forEach((line, index) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (match) entries.set(match[1], { value: literal(unquote(match[2]).text), line: index + 1 });
  });
  return { entries, complete: true };
}

/** The environment a compose file sets for one service, in the map form (`KEY: value`)
 * or the list form (`- KEY=value`). Undefined when the file has no such service. */
export function composeServiceEnvironment(text: string, service: string): SourceEnvironment | undefined {
  const lines = text.split(/\r?\n/);
  const services = lines.findIndex(line => /^services:\s*(?:#.*)?$/.test(line));
  if (services < 0) return undefined;
  const first = lines.slice(services + 1).find(isContent);
  if (!first || indentOf(first) === 0) return undefined;
  const serviceIndent = indentOf(first);
  const serviceKeys = [`${service}:`, `"${service}":`, `'${service}':`];
  let start = -1;
  for (let i = services + 1; i < lines.length; i++) {
    if (isContent(lines[i]) && indentOf(lines[i]) === 0) break;
    if (indentOf(lines[i]) === serviceIndent && serviceKeys.includes(lines[i].trim().replace(/\s+#.*$/, ''))) { start = i; break; }
  }
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length && !(isContent(lines[end]) && indentOf(lines[end]) <= serviceIndent)) end++;
  const block = lines.slice(start + 1, end);
  const entries = new Map<string, EnvironmentEntry>();
  let complete = !block.some(line => /^\s*env_file:/.test(line));
  const environment = block.findIndex(line => /^\s*environment:\s*(?:#.*)?$/.test(line));
  if (environment < 0) {
    // No environment, or an inline one this reader does not parse: nothing is known to be unset.
    return { entries, complete: complete && !block.some(line => /^\s*environment:/.test(line)) };
  }
  const environmentIndent = indentOf(block[environment]);
  const body: Array<{ text: string; line: number }> = [];
  for (let i = environment + 1; i < block.length && !(isContent(block[i]) && indentOf(block[i]) <= environmentIndent); i++) {
    if (isContent(block[i])) body.push({ text: block[i], line: start + 1 + i + 1 });
  }
  const entryIndent = body.length ? indentOf(body[0].text) : 0;
  for (const { text: entry, line } of body) {
    if (indentOf(entry) !== entryIndent) continue;
    const item = entry.trim();
    if (item.startsWith('<<')) { complete = false; continue; }
    if (item.startsWith('- ')) {
      // `- KEY` without a value is taken from the shell.
      const listed = unquote(item.slice(2)).text;
      const equals = listed.indexOf('=');
      const name = equals < 0 ? listed : listed.slice(0, equals);
      if (KEY.test(name)) entries.set(name, { value: equals < 0 ? undefined : literal(listed.slice(equals + 1)), line });
      else complete = false;
      continue;
    }
    const mapped = /^["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:(?:\s+(.*))?$/.exec(item);
    if (mapped) entries.set(mapped[1], { value: composeValue(mapped[2]), line });
    else complete = false;
  }
  return { entries, complete };
}

/** What the EDC reads from a setting's raw value (undefined when not set): a boolean by
 * its reading, NODE_ENV as given when it is one of NODE_ENVIRONMENTS, and set or unset
 * for TRAINING_SERVICE_URL. Undefined when that cannot be told. */
export function effectiveFlagValue(flag: TargetConfigurationFlag, raw: string | undefined): FlagValue | undefined {
  const spec: FlagSpec = TARGET_CONFIGURATION_FLAGS[flag];
  if (spec.kind === 'boolean') {
    if (spec.reading === 'true-enables') return raw === 'true';
    if (spec.reading === 'false-disables') return raw !== 'false';
    return raw === undefined || raw === 'true';
  }
  if (spec.kind === 'node-env') return (NODE_ENVIRONMENTS as readonly (string | undefined)[]).includes(raw) ? raw as FlagValue : undefined;
  return raw === undefined || raw === '' ? 'unset' : 'set';
}

/** A flag's value in a source environment: undefined when its entry is set elsewhere,
 * or when it is absent from an environment that may set it elsewhere. */
export function sourceFlagValue(environment: SourceEnvironment, flag: TargetConfigurationFlag): FlagValue | undefined {
  const entry = environment.entries.get(flag);
  if (entry) return entry.value === undefined ? undefined : effectiveFlagValue(flag, entry.value);
  return environment.complete ? effectiveFlagValue(flag, undefined) : undefined;
}

// ---------------------------------------------------------------------------
// What the run observed, and the configuration under test of a sealed package
// ---------------------------------------------------------------------------

/** The OQ cases that observe a declared flag at the target (spec P20 3.4 and 3.9: the
 * engine, the O-1 decision routes, and the two W-1 inspection flags). They land with
 * VAL-1/validation-oq; until then no OQ record observes a flag. OQ-219 and OQ-220
 * read ungated members and OQ-225 and OQ-226 exist without O-1, so they observe none. */
export const FLAG_OBSERVING_CASES: ReadonlyArray<{ caseId: string; flag: TargetConfigurationFlag }> = [
  { caseId: 'OQ-206', flag: 'ENABLE_DEVIATION_ENGINE' },
  { caseId: 'OQ-221', flag: 'ENABLE_DEVIATION_DECISIONS' },
  { caseId: 'OQ-222', flag: 'ENABLE_DEVIATION_DECISIONS' },
  { caseId: 'OQ-223', flag: 'ENABLE_DEVIATION_DECISIONS' },
  { caseId: 'OQ-224', flag: 'ENABLE_DEVIATION_DECISIONS' },
  { caseId: 'OQ-241', flag: 'INSPECTION_COPY_TA3_INVENTORY' },
  { caseId: 'OQ-242', flag: 'ENABLE_SEGMENTED_INSPECTION_EXPORT' },
];

/** Outcome codes that mean the target answered the feature disabled (spec P20 VD-5). */
export const DISABLED_OUTCOME_CODES = ['ENGINE_DISABLED', 'FEATURE_DISABLED_AT_TARGET'] as const;
export const CONFIGURATION_MISMATCH_CODE = 'CONFIGURATION_MISMATCH';

/** What an observing OQ record saw of its boolean flag: off when the target refused the
 * feature as disabled, on when the case passed, the opposite of the declaration when the
 * case itself recorded CONFIGURATION_MISMATCH, and nothing otherwise (absent at the
 * release, not executed, or failed for another reason). */
export function observedFlag(record: EvidenceResult, declared: FlagValue): FlagValue | undefined {
  if (typeof declared !== 'boolean') return undefined;
  if (record.outcomeCode === CONFIGURATION_MISMATCH_CODE) return !declared;
  if ((DISABLED_OUTCOME_CODES as readonly (string | undefined)[]).includes(record.outcomeCode)) return false;
  return record.passed ? true : undefined;
}

function mismatchShape(value: unknown, at: string): ConfigurationMismatch {
  const entry = strictObject(value, at, CONFIGURATION_MISMATCH_REQUIRED);
  check(isTargetConfigurationFlag(entry.flag), `${at}.flag is not on the allowlist`);
  check(isFlagValue(entry.flag, entry.declared) && isFlagValue(entry.flag, entry.observed) && entry.declared !== entry.observed,
    `${at} must hold two different values of ${entry.flag}`);
  check(typeof entry.observedBy === 'string' && CASE_ID.test(entry.observedBy), `${at}.observedBy must be a case ID`);
  return entry as unknown as ConfigurationMismatch;
}

/** Every contradiction of the declared flags the run recorded: IQ-033's source file
 * cross-check and the observing OQ cases, in that order. */
export function configurationMismatches(flags: DeclaredFlags, evidence: { iq: EvidenceResult[]; oq: EvidenceResult[] }): ConfigurationMismatch[] {
  const mismatches: ConfigurationMismatch[] = [];
  const iq033 = evidence.iq.find(record => record.testCaseId === 'IQ-033');
  const sourceCheck = isRecord(iq033?.responseBody) && isRecord(iq033.responseBody.source) ? iq033.responseBody.source.mismatches : undefined;
  if (sourceCheck !== undefined) {
    check(Array.isArray(sourceCheck), 'IQ-033 records its source mismatches as an array');
    sourceCheck.forEach((item, index) => {
      const mismatch = mismatchShape(item, `IQ-033 source mismatches[${index}]`);
      check(flags[mismatch.flag] === mismatch.declared, `IQ-033 source mismatches[${index}] is not about the retained declaration`);
      mismatches.push(mismatch);
    });
  }
  for (const { caseId, flag } of FLAG_OBSERVING_CASES) {
    const declared = flags[flag];
    const record = evidence.oq.find(entry => entry.testCaseId === caseId);
    if (declared === undefined || !record) continue;
    const observed = observedFlag(record, declared);
    if (observed !== undefined && observed !== declared) mismatches.push({ flag, declared, observed, observedBy: caseId });
  }
  return mismatches;
}

/** configurationUnderTest of a package from its retained declaration's bytes and its records. */
export function configurationUnderTest(declarationBytes: Buffer, evidence: { iq: EvidenceResult[]; oq: EvidenceResult[] }): ConfigurationUnderTest {
  const declaration = parseTargetConfiguration(JSON.parse(withoutBom(declarationBytes.toString('utf8'))), 'The retained configuration declaration');
  return {
    contract: TARGET_CONFIGURATION_CONTRACT,
    sha256: sha256(declarationBytes),
    flags: { ...declaration.flags },
    mismatches: configurationMismatches(declaration.flags, evidence),
  };
}

/** Strict reading of a manifest's configurationUnderTest object. */
export function parseConfigurationUnderTest(value: unknown, at: string): ConfigurationUnderTest {
  const entry = strictObject(value, at, CONFIGURATION_UNDER_TEST_REQUIRED);
  check(entry.contract === TARGET_CONFIGURATION_CONTRACT, `${at}.contract must be ${TARGET_CONFIGURATION_CONTRACT}`);
  check(typeof entry.sha256 === 'string' && SHA256_HEX.test(entry.sha256), `${at}.sha256 is malformed`);
  parseDeclaredFlags(entry.flags, `${at}.flags`);
  check(Array.isArray(entry.mismatches), `${at}.mismatches must be an array`);
  entry.mismatches.forEach((item, index) => mismatchShape(item, `${at}.mismatches[${index}]`));
  return entry as unknown as ConfigurationUnderTest;
}
