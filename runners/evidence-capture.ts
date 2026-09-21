import * as fs from 'fs';
import * as path from 'path';

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
}

export const EVIDENCE_CATEGORIES = ['iq', 'oq', 'pq', 'security', 'dr', 'performance'] as const;
export type EvidenceCategory = typeof EVIDENCE_CATEGORIES[number];

export interface CaptureOptions {
  testCaseId: string;
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
  baseUrl: string;
  timeoutMs?: number;
}

/** Plain-object guard shared by every runner that inspects untyped API payloads. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Remove credentials from retained evidence, preserving revision tokens and other identifiers. */
export function redactEvidenceSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactEvidenceSecrets);
  if (!isRecord(value) || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /^(?:password(?:hash)?|passwd|signaturepassword|secret|clientsecret|accesstoken|refreshtoken|token|apikey|authorization|cookie|setcookie)$/i
      .test(key.replace(/[-_]/g, ''))
      ? '[redacted]' : redactEvidenceSecrets(item),
  ]));
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
  const evidenceDir = path.join(outputDir, 'evidence', category);
  fs.mkdirSync(evidenceDir, { recursive: true });

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
    })),
  };
  fs.writeFileSync(
    path.join(evidenceDir, `${category}-summary.json`),
    JSON.stringify(summary, null, 2),
    'utf-8',
  );

  const reportLines: string[] = [
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
    if (contentType.includes('application/json')) {
      responseBody = await response.json() as unknown;
    } else {
      const text = await response.text();
      responseBody = text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    }

    passed = response.ok;
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
  if (result.captureError !== undefined) return result;
  result.passed = result.responseStatus === expectedStatus;
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
  if (result.captureError !== undefined) return result;
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
