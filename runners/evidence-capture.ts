import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'node:crypto';
import {
  currentReleaseIdentity, isReleaseStamp, releaseComponent, releaseComponentText, releaseStamp, RELEASE_COMPONENTS, type ReleaseStamp,
} from './release-identity';

export interface EvidenceResult {
  testCaseId: string;
  timestamp: string;
  endpoint: string;
  method: string;
  requestBody?: unknown;
  requestHeaders?: Record<string, string>;
  responseStatus: number;
  responseHeaders?: Record<string, string>;
  responseBody: unknown;
  passed: boolean;
  notes: string;
  regulatoryRef?: string;
  testDescription?: string;
  acceptanceCriteria?: string;
  durationMs?: number;
  /** Transport, decoding, or validator failure; a status code alone cannot override it. */
  captureError?: string;
  /** Ordered command/readback exchanges for a multi-request qualification step. */
  relatedEvidence?: EvidenceResult[];
  /** The API, UI and core release (version 2: and training) the record was produced against (stamped by saveEvidence). */
  releaseUnderTest?: ReleaseStamp;
  /** Why a case failed or did not execute, as a fixed code (for example ENGINE_DISABLED); never free text. */
  outcomeCode?: string;
  /** Stamped by saveEvidence on every record of a synthetic run (VD-3); absent otherwise. */
  synthetic?: true;
  /** Stamped by saveEvidence on every record of a run that is not retained (`--no-retain`). */
  retention?: typeof DEVELOPMENT_RUN_NOTICE;
}

export const EVIDENCE_CATEGORIES = ['iq', 'oq', 'pq', 'security', 'dr', 'performance', 'benchmark', 'p13'] as const;
export type EvidenceCategory = typeof EVIDENCE_CATEGORIES[number];

/** An outcome code names a refusal or setup condition, for example FEATURE_ABSENT_AT_RELEASE. */
export const OUTCOME_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

/** Opens every record, summary and document of a synthetic run (VD-3, D-22). */
export const SYNTHETIC_NOTICE = 'SYNTHETIC ENGINEERING EVIDENCE. Synthetic data on a test stack. Not a real trial, not an approval.';
/** Stated on every record and document of a run that is not retained in a sealed package. */
export const DEVELOPMENT_RUN_NOTICE = 'Development run: not retained, not validation evidence';

/** How the evidence and documents of this run are marked. Set once by the CLI
 * (through runners/evidence-package.ts) before anything is written; unset, as in
 * library calls and tests, nothing is stamped. */
export interface EvidenceMarking {
  /** Synthetic as computed by the package rule, never chosen. */
  synthetic: boolean;
  /** True inside a retained package; false for a development run. */
  retained: boolean;
}

let marking: EvidenceMarking | undefined;

export function setEvidenceMarking(value: EvidenceMarking | undefined): void {
  marking = value;
}

export function currentEvidenceMarking(): EvidenceMarking | undefined {
  return marking;
}

/** The notices a document of this run opens with, in order. */
export function evidenceNotices(value: EvidenceMarking | undefined = marking): string[] {
  if (!value) return [];
  return [...(value.synthetic ? [SYNTHETIC_NOTICE] : []), ...(value.retained ? [] : [DEVELOPMENT_RUN_NOTICE])];
}

/** The same notices as Markdown lines for the top of a document; empty when there is none. */
export function evidenceNoticeLines(value: EvidenceMarking | undefined = marking): string[] {
  const notices = evidenceNotices(value);
  return notices.length ? [...notices.flatMap((notice, index) => [...(index ? ['>'] : []), `> **${notice}**`]), ''] : [];
}

export interface CaptureOptions {
  testCaseId: string;
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
  baseUrl: string;
  timeoutMs?: number;
  /** Downloads retain complete bytes/text rather than the diagnostic preview. */
  responseFormat?: 'text' | 'binary';
  /** Scoped authority readers must not forward credentials through redirects. */
  redirect?: 'error';
  /** Optional wire-body limit for potentially large evidence attachments. */
  maxResponseBytes?: number;
}

/** Plain-object guard shared by every runner that inspects untyped API payloads. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A key whose value is a credential (password, token, secret, API key, cookie or authorization). */
export function isCredentialKey(key: string): boolean {
  return /^(?:(?:current|new|old|confirm|signature)?password(?:hash)?|passwd|secret|clientsecret|accesstoken|refreshtoken|token|apikey|authorization|cookie|setcookie)$/i
    .test(key.replace(/[-_]/g, ''));
}

/** Remove credentials from retained evidence, preserving revision tokens and other identifiers. */
export function redactEvidenceSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactEvidenceSecrets);
  if (!isRecord(value) || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    isCredentialKey(key) ? '[redacted]' : redactEvidenceSecrets(item),
  ]));
}

function canonicalCheck(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

/** Canonical JSON for hashing: object keys in the default string order (UTF-16
 * code units, never localeCompare), arrays in their order, exact JSON values.
 * Anything JSON cannot carry exactly (an unsafe integer, -0, undefined, a cycle,
 * a sparse array) is refused, never omitted or truncated. `subject` names the
 * value in the refusal. The activation-review/1 digest and the evidence package
 * hash both use it. */
export function canonicalJson(value: unknown, subject: string, ancestors = new Set<object>(), depth = 0): string {
  canonicalCheck(depth <= 200, `${subject} JSON exceeds the server canonicalization depth.`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    canonicalCheck(Number.isFinite(value) && !Object.is(value, -0) && (!Number.isInteger(value) || Number.isSafeInteger(value)),
      `${subject} contains a number requiring exact source custody.`);
    return JSON.stringify(value);
  }
  canonicalCheck(typeof value === 'object' && value !== null && !ancestors.has(value), `${subject} is not finite JSON data.`);
  const array = Array.isArray(value), descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors).filter(key => !(array && key === 'length'));
  canonicalCheck(keys.every(key => typeof key === 'string' && descriptors[key].enumerable && 'value' in descriptors[key]),
    `${subject} contains non-JSON properties.`);
  const names = keys as string[];
  canonicalCheck(!array || (names.length === value.length && names.every((key, index) => key === String(index))),
    `${subject} contains a sparse or extended array.`);
  ancestors.add(value);
  try {
    const parts = (array ? names : names.sort()).map(key => {
      const child = canonicalJson(descriptors[key].value, subject, ancestors, depth + 1);
      return array ? child : `${JSON.stringify(key)}:${child}`;
    });
    return array ? `[${parts.join(',')}]` : `{${parts.join(',')}}`;
  } finally { ancestors.delete(value); }
}

function requireEvidenceResults(value: unknown, source: string): asserts value is EvidenceResult[] {
  if (!Array.isArray(value)) throw new Error(`Invalid evidence in ${source}: expected a result array`);
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)
      || typeof item.testCaseId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item.testCaseId)
      || typeof item.passed !== 'boolean'
      || typeof item.notes !== 'string'
      || typeof item.timestamp !== 'string'
      || typeof item.endpoint !== 'string'
      || typeof item.method !== 'string'
      || typeof item.responseStatus !== 'number' || !Number.isInteger(item.responseStatus)) {
      throw new Error(`Invalid evidence in ${source}: malformed result at index ${index}`);
    }
    if (item.method === 'MANUAL' && item.passed) {
      throw new Error(`Invalid evidence in ${source}: manual result cannot pass automatically`);
    }
    if (item.captureError !== undefined
      && (typeof item.captureError !== 'string' || item.passed)) {
      throw new Error(`Invalid evidence in ${source}: capture failure cannot pass`);
    }
    if (item.releaseUnderTest !== undefined && !isReleaseStamp(item.releaseUnderTest)) {
      throw new Error(`Invalid evidence in ${source}: malformed release identity at index ${index}`);
    }
    if ((item.outcomeCode !== undefined && (typeof item.outcomeCode !== 'string' || !OUTCOME_CODE.test(item.outcomeCode)))
      || (item.synthetic !== undefined && item.synthetic !== true)
      || (item.retention !== undefined && item.retention !== DEVELOPMENT_RUN_NOTICE)) {
      throw new Error(`Invalid evidence in ${source}: malformed outcome code or marking at index ${index}`);
    }
    if (seen.has(item.testCaseId)) throw new Error(`Invalid evidence in ${source}: duplicate test case ${item.testCaseId}`);
    seen.add(item.testCaseId);
  }
}

/** Read the same result contract written by saveEvidence. Only absence means unexecuted. */
export function loadEvidence(outputDir: string, category: EvidenceCategory): EvidenceResult[] {
  const filePath = path.join(outputDir, 'evidence', category, `${category}-results.json`);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid evidence in ${filePath}: malformed JSON`);
  }
  requireEvidenceResults(parsed, filePath);
  return parsed;
}

export function enrichResult(
  result: EvidenceResult,
  meta: { regulatoryRef: string; testDescription: string; acceptanceCriteria: string },
): EvidenceResult {
  result.regulatoryRef = meta.regulatoryRef;
  result.testDescription = meta.testDescription;
  result.acceptanceCriteria = meta.acceptanceCriteria;
  return result;
}

/** Evidence stub for a step that needs manual verification. `saveEvidence`
 * counts these via method === 'MANUAL'; a manual step never passes automatically. */
export function manualResult(
  testCaseId: string,
  note: string,
  meta?: { regulatoryRef?: string; testDescription?: string; acceptanceCriteria?: string },
): EvidenceResult {
  return {
    testCaseId,
    timestamp: new Date().toISOString(),
    endpoint: 'N/A',
    method: 'MANUAL',
    responseStatus: 0,
    responseBody: null,
    passed: false,
    notes: `Manual verification required: ${note}`,
    ...meta,
  };
}

export function saveEvidence(
  outputDir: string,
  category: EvidenceCategory,
  results: EvidenceResult[],
): string {
  requireEvidenceResults(results, category);
  results = redactEvidenceSecrets(results) as EvidenceResult[];
  const identity = currentReleaseIdentity();
  if (identity) {
    const stamp = releaseStamp(identity);
    for (const result of results) {
      if (result.releaseUnderTest && result.releaseUnderTest.identityHash !== stamp.identityHash) {
        throw new Error(`Evidence ${result.testCaseId} was produced against release ${result.releaseUnderTest.identityHash}, not ${stamp.identityHash}.`);
      }
    }
    results = results.map(result => ({ ...result, releaseUnderTest: stamp }));
  }
  // A marked run stamps what it is on every record; a record cannot claim
  // otherwise, because whether evidence is synthetic is computed, never chosen.
  const run = currentEvidenceMarking();
  if (run) {
    for (const result of results) {
      if ((result.synthetic && !run.synthetic) || (result.retention && run.retained)) {
        throw new Error(`Evidence ${result.testCaseId} is marked ${result.synthetic ? 'synthetic' : 'not retained'}, which this run is not.`);
      }
    }
    results = results.map(result => ({
      ...result, ...(run.synthetic ? { synthetic: true as const } : {}), ...(run.retained ? {} : { retention: DEVELOPMENT_RUN_NOTICE }),
    }));
  }
  const evidenceDir = path.join(outputDir, 'evidence', category);
  fs.mkdirSync(evidenceDir, { recursive: true });
  if (identity) {
    fs.writeFileSync(path.join(evidenceDir, 'release-identity.json'), JSON.stringify(identity, null, 2), 'utf-8');
  }

  const filePath = path.join(evidenceDir, `${category}-results.json`);
  fs.writeFileSync(filePath, JSON.stringify(results, null, 2), 'utf-8');

  for (const result of results) {
    const individualPath = path.join(evidenceDir, `${result.testCaseId}.json`);
    fs.writeFileSync(individualPath, JSON.stringify(result, null, 2), 'utf-8');
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const manual = results.filter(r => r.method === 'MANUAL').length;
  const summary = {
    category,
    executedAt: new Date().toISOString(),
    executionEnvironment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    releaseUnderTest: identity ?? null,
    total: results.length,
    passed,
    failed,
    manual,
    passRate: results.length > 0 ? `${((passed / results.length) * 100).toFixed(1)}%` : 'N/A',
    results: results.map(r => ({
      testCaseId: r.testCaseId,
      passed: r.passed,
      status: r.responseStatus,
      durationMs: r.durationMs,
      notes: r.notes,
      regulatoryRef: r.regulatoryRef,
      ...(r.outcomeCode ? { outcomeCode: r.outcomeCode } : {}),
    })),
    // Appended last, so an unmarked summary keeps its bytes.
    ...(run?.synthetic ? { synthetic: true, syntheticNotice: SYNTHETIC_NOTICE } : {}),
    ...(run && !run.retained ? { retention: DEVELOPMENT_RUN_NOTICE } : {}),
  };
  fs.writeFileSync(
    path.join(evidenceDir, `${category}-summary.json`),
    JSON.stringify(summary, null, 2),
    'utf-8',
  );

  const reportLines: string[] = [
    ...evidenceNoticeLines(run),
    `# ${category.toUpperCase()} Test Execution Report`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Category | ${category.toUpperCase()} |`,
    `| Executed At | ${summary.executedAt} |`,
    `| Node.js | ${process.version} |`,
    `| Platform | ${process.platform} ${process.arch} |`,
    `| Total Tests | ${results.length} |`,
    `| Passed | ${passed} |`,
    `| Failed | ${failed} |`,
    `| Manual | ${manual} |`,
    `| Pass Rate | ${summary.passRate} |`,
    ...(identity
      ? [
        `| Release Identity | ${identity.identityHash} |`,
        ...RELEASE_COMPONENTS.map(name => {
          const component = releaseComponent(identity, name);
          return `| Release ${name.toUpperCase()} | ${releaseComponentText(component)}${component ? ` (${component.source})` : ''} |`;
        }),
        `| Target Reported Version | ${identity.target?.version ?? (identity.target?.error ? `unavailable: ${identity.target.error}` : 'not reported')} |`,
        `| Framework Commit | ${identity.framework.commit ?? 'unknown'}${identity.framework.dirty ? ' (uncommitted changes)' : ''} |`,
      ]
      : ['| Release Identity | not recorded: no release under test was supplied |']),
    '',
    '---',
    '',
  ];

  for (const r of results) {
    const icon = r.passed ? 'PASS' : r.method === 'MANUAL' ? 'MANUAL' : 'FAIL';
    reportLines.push(`## ${r.testCaseId}: ${icon}`);
    if (r.testDescription) reportLines.push(`**Description:** ${r.testDescription}`);
    if (r.regulatoryRef) reportLines.push(`**Regulatory Reference:** ${r.regulatoryRef}`);
    if (r.acceptanceCriteria) reportLines.push(`**Acceptance Criteria:** ${r.acceptanceCriteria}`);
    reportLines.push(`**Endpoint:** ${r.method} ${r.endpoint}`);
    reportLines.push(`**Status:** HTTP ${r.responseStatus}${r.durationMs ? ` (${r.durationMs}ms)` : ''}`);
    if (r.outcomeCode) reportLines.push(`**Outcome Code:** ${r.outcomeCode}`);
    reportLines.push(`**Result:** ${r.notes}`);
    if (r.requestBody) {
      reportLines.push(`**Request Body:**`);
      reportLines.push('```json');
      reportLines.push(JSON.stringify(r.requestBody, null, 2).slice(0, 500));
      reportLines.push('```');
    }
    if (r.responseBody && r.responseStatus > 0) {
      reportLines.push(`**Response Body (excerpt):**`);
      reportLines.push('```json');
      const bodyStr = JSON.stringify(r.responseBody, null, 2);
      reportLines.push(bodyStr.length > 500 ? bodyStr.slice(0, 500) + '\n... [truncated]' : bodyStr);
      reportLines.push('```');
    }
    reportLines.push('');
    reportLines.push('---');
    reportLines.push('');
  }

  fs.writeFileSync(
    path.join(evidenceDir, `${category}-execution-report.md`),
    reportLines.join('\n'),
    'utf-8',
  );

  return evidenceDir;
}

export async function captureApiCall(opts: CaptureOptions): Promise<EvidenceResult> {
  const fullUrl = opts.url.startsWith('http')
    ? opts.url
    : `${opts.baseUrl.replace(/\/$/, '')}/${opts.url.replace(/^\//, '')}`;

  const timestamp = new Date().toISOString();
  const fetchOpts: RequestInit = {
    method: opts.method,
    ...(opts.redirect ? { redirect: opts.redirect } : {}),
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  };

  let responseStatus = 0;
  let responseBody: unknown = null;
  let responseHeaders: Record<string, string> = {};
  let notes = '';
  let passed = false;
  let durationMs = 0;
  let captureError: string | undefined;

  // Timed to the response headers; a failed request records its elapsed time too.
  const startTime = Date.now();
  try {
    fetchOpts.signal = AbortSignal.timeout(opts.timeoutMs ?? 30000);
    if (opts.body !== undefined && opts.method !== 'GET' && opts.method !== 'HEAD') {
      fetchOpts.body = JSON.stringify(opts.body);
    }
    const response = await fetch(fullUrl, fetchOpts);
    durationMs = Date.now() - startTime;
    responseStatus = response.status;

    responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const contentType = response.headers.get('content-type') ?? '';
    if (opts.maxResponseBytes !== undefined) {
      if (!Number.isSafeInteger(opts.maxResponseBytes) || opts.maxResponseBytes <= 0) throw new Error('Invalid response byte limit');
      const reader = response.body?.getReader();
      const chunks: Buffer[] = [];
      let length = 0;
      if (reader) {
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            length += chunk.value.byteLength;
            if (length > opts.maxResponseBytes) {
              await reader.cancel();
              throw new Error('Response exceeds evidence byte limit');
            }
            chunks.push(Buffer.from(chunk.value));
          }
        } finally { reader.releaseLock(); }
      }
      const bytes = Buffer.concat(chunks);
      responseBody = opts.responseFormat === 'binary'
        ? { encoding: 'base64', byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), content: bytes.toString('base64') }
        : contentType.includes('application/json') ? JSON.parse(bytes.toString('utf8')) : bytes.toString('utf8');
    } else if (opts.responseFormat === 'binary') {
      const bytes = Buffer.from(await response.arrayBuffer());
      responseBody = { encoding: 'base64', byteLength: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'), content: bytes.toString('base64') };
    } else if (contentType.includes('application/json')) {
      responseBody = await response.json() as unknown;
    } else {
      const text = await response.text();
      responseBody = opts.responseFormat !== 'text' && text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    }

    passed = response.ok && !(isRecord(responseBody) && responseBody.success === false);
    notes = passed ? 'Request successful' : `HTTP ${responseStatus} returned`;
  } catch (err: unknown) {
    durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);
    captureError = message;
    notes = `Request failed: ${message}`;
    responseBody = { error: message };
  }

  return {
    testCaseId: opts.testCaseId,
    timestamp,
    endpoint: fullUrl,
    method: opts.method,
    requestBody: opts.body,
    requestHeaders: fetchOpts.headers as Record<string, string>,
    responseStatus,
    responseHeaders,
    responseBody,
    passed,
    notes,
    durationMs,
    ...(captureError !== undefined ? { captureError } : {}),
  };
}

export async function captureWithExpectedStatus(
  opts: CaptureOptions,
  expectedStatus: number,
): Promise<EvidenceResult> {
  const result = await captureApiCall(opts);
  if (result.captureError !== undefined || result.responseStatus === 0 || result.responseStatus >= 500) return result;
  result.passed = result.responseStatus === expectedStatus
    && !(expectedStatus < 400 && isRecord(result.responseBody) && result.responseBody.success === false);
  result.notes = result.passed
    ? `Expected ${expectedStatus}, got ${result.responseStatus} — PASS`
    : `Expected ${expectedStatus}, got ${result.responseStatus} — FAIL`;
  return result;
}

export async function captureWithValidator(
  opts: CaptureOptions,
  validator: (status: number, body: unknown) => { passed: boolean; notes: string },
): Promise<EvidenceResult> {
  const result = await captureApiCall(opts);
  if (result.captureError !== undefined || result.responseStatus === 0 || result.responseStatus >= 500) return result;
  if (result.responseStatus >= 200 && result.responseStatus < 300
    && isRecord(result.responseBody) && result.responseBody.success === false) return result;
  try {
    const validation = validator(result.responseStatus, result.responseBody);
    if (typeof validation.passed !== 'boolean' || typeof validation.notes !== 'string') {
      throw new Error('Validator returned an invalid verdict');
    }
    result.passed = validation.passed;
    result.notes = validation.notes;
  } catch (error) {
    result.passed = false;
    result.captureError = error instanceof Error ? error.message : String(error);
    result.notes = `Validation failed: ${result.captureError}`;
  }
  return result;
}
