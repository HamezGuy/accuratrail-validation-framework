import * as fs from 'fs';
import * as path from 'path';
import { type EvidenceResult, captureApiCall } from './evidence-capture';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function savePerfEvidence(outputDir: string, results: EvidenceResult[]): string {
  const evidenceDir = path.join(outputDir, 'evidence', 'performance');
  fs.mkdirSync(evidenceDir, { recursive: true });

  fs.writeFileSync(
    path.join(evidenceDir, 'performance-results.json'),
    JSON.stringify(results, null, 2),
    'utf-8',
  );

  for (const result of results) {
    fs.writeFileSync(
      path.join(evidenceDir, `${result.testCaseId}.json`),
      JSON.stringify(result, null, 2),
      'utf-8',
    );
  }

  const passed = results.filter((r) => r.passed).length;
  const summary = {
    category: 'performance',
    executedAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length > 0 ? `${((passed / results.length) * 100).toFixed(1)}%` : 'N/A',
    results: results.map((r) => ({
      testCaseId: r.testCaseId,
      passed: r.passed,
      status: r.responseStatus,
      notes: r.notes,
    })),
  };
  fs.writeFileSync(
    path.join(evidenceDir, 'performance-summary.json'),
    JSON.stringify(summary, null, 2),
    'utf-8',
  );

  return evidenceDir;
}

async function timedFetch(
  url: string,
  opts: RequestInit,
): Promise<{ status: number; body: unknown; durationMs: number }> {
  const start = Date.now();
  try {
    const resp = await fetch(url, opts);
    const durationMs = Date.now() - start;
    const ct = resp.headers.get('content-type') ?? '';
    let body: unknown;
    if (ct.includes('application/json')) {
      body = await resp.json() as unknown;
    } else {
      const text = await resp.text();
      body = text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    }
    return { status: resp.status, body, durationMs };
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return { status: 0, body: { error: message }, durationMs };
  }
}

async function testHealthResponseTime(baseUrl: string): Promise<EvidenceResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/health`;
  const timestamp = new Date().toISOString();
  const { status, body, durationMs } = await timedFetch(url, { method: 'GET' });
  const maxMs = 500;
  const passed = status === 200 && durationMs < maxMs;

  return {
    testCaseId: 'PERF-001',
    timestamp,
    endpoint: url,
    method: 'GET',
    responseStatus: status,
    responseBody: { ...((isRecord(body) ? body : { raw: body }) as Record<string, unknown>), durationMs },
    passed,
    notes: status === 200
      ? `Health endpoint responded in ${durationMs}ms (threshold: ${maxMs}ms) — ${durationMs < maxMs ? 'PASS' : 'FAIL: too slow'}`
      : `Health endpoint returned HTTP ${status} in ${durationMs}ms`,
  };
}

async function testLoginResponseTime(baseUrl: string): Promise<EvidenceResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/auth/login`;
  const timestamp = new Date().toISOString();
  const maxMs = 1000;
  const { status, body, durationMs } = await timedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.OQ_USERNAME || 'admin',
      password: process.env.OQ_PASSWORD || 'admin',
    }),
  });
  const passed = (status === 200 || status === 401) && durationMs < maxMs;

  return {
    testCaseId: 'PERF-002',
    timestamp,
    endpoint: url,
    method: 'POST',
    responseStatus: status,
    responseBody: { durationMs },
    passed,
    notes: `Login endpoint responded in ${durationMs}ms (threshold: ${maxMs}ms) — ${durationMs < maxMs ? 'PASS' : 'FAIL: too slow'}`,
  };
}

async function testStudiesResponseTime(baseUrl: string): Promise<EvidenceResult> {
  const loginUrl = `${baseUrl.replace(/\/$/, '')}/api/auth/login`;
  const timestamp = new Date().toISOString();

  let token: string | null = null;
  try {
    const loginResp = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.OQ_USERNAME || 'admin',
        password: process.env.OQ_PASSWORD || 'admin',
      }),
    });
    if (loginResp.ok) {
      const b: unknown = await loginResp.json();
      if (isRecord(b) && typeof b.accessToken === 'string') token = b.accessToken;
    }
  } catch { /* proceed without token */ }

  if (!token) {
    return {
      testCaseId: 'PERF-003',
      timestamp,
      endpoint: '/api/studies',
      method: 'GET',
      responseStatus: 0,
      responseBody: null,
      passed: false,
      notes: 'Could not authenticate — skipping studies response time test',
    };
  }

  const url = `${baseUrl.replace(/\/$/, '')}/api/studies`;
  const maxMs = 1000;
  const { status, body, durationMs } = await timedFetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const passed = status === 200 && durationMs < maxMs;

  return {
    testCaseId: 'PERF-003',
    timestamp,
    endpoint: url,
    method: 'GET',
    responseStatus: status,
    responseBody: { durationMs },
    passed,
    notes: status === 200
      ? `Studies endpoint responded in ${durationMs}ms (threshold: ${maxMs}ms) — ${durationMs < maxMs ? 'PASS' : 'FAIL: too slow'}`
      : `Studies endpoint returned HTTP ${status} in ${durationMs}ms`,
  };
}

async function testConcurrentLogins(baseUrl: string): Promise<EvidenceResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/auth/login`;
  const timestamp = new Date().toISOString();
  const concurrency = 5;

  const promises = Array.from({ length: concurrency }, () =>
    timedFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.OQ_USERNAME || 'admin',
        password: process.env.OQ_PASSWORD || 'admin',
      }),
    }),
  );

  const results = await Promise.all(promises);
  const succeeded = results.filter((r) => r.status === 200).length;
  const maxDuration = Math.max(...results.map((r) => r.durationMs));
  const allSucceeded = succeeded === concurrency;

  return {
    testCaseId: 'PERF-004',
    timestamp,
    endpoint: url,
    method: 'POST',
    responseStatus: allSucceeded ? 200 : 0,
    responseBody: {
      concurrency,
      succeeded,
      failed: concurrency - succeeded,
      maxDurationMs: maxDuration,
      durations: results.map((r) => r.durationMs),
    },
    passed: allSucceeded,
    notes: allSucceeded
      ? `All ${concurrency} concurrent logins succeeded (max ${maxDuration}ms)`
      : `${succeeded}/${concurrency} concurrent logins succeeded (max ${maxDuration}ms)`,
  };
}

async function testLargeQueryString(baseUrl: string): Promise<EvidenceResult> {
  const longParam = 'x'.repeat(1100);
  const url = `${baseUrl.replace(/\/$/, '')}/health?q=${longParam}`;
  const timestamp = new Date().toISOString();

  const { status, body, durationMs } = await timedFetch(url, { method: 'GET' });
  const passed = status > 0 && status < 500;

  return {
    testCaseId: 'PERF-005',
    timestamp,
    endpoint: `${baseUrl.replace(/\/$/, '')}/health?q=[1100 chars]`,
    method: 'GET',
    responseStatus: status,
    responseBody: { durationMs, queryLength: longParam.length },
    passed,
    notes: passed
      ? `Large query string handled gracefully (HTTP ${status}, ${durationMs}ms)`
      : `Large query string caused server error (HTTP ${status}, ${durationMs}ms)`,
  };
}

export async function run(outputDir: string, baseUrl: string): Promise<EvidenceResult[]> {
  console.log(`\n  Running Performance tests (5 cases) against ${baseUrl}...`);
  const results: EvidenceResult[] = [];

  let result: EvidenceResult;

  result = await testHealthResponseTime(baseUrl);
  result.regulatoryRef = '§11.10(a)';
  result.testDescription = 'Health endpoint response time under 500ms';
  result.acceptanceCriteria = 'HTTP 200 within 500ms';
  results.push(result);
  console.log(`  PERF-001 (Health RT): ${result.passed ? 'PASS' : 'FAIL'} — ${result.notes}`);

  result = await testLoginResponseTime(baseUrl);
  result.regulatoryRef = '§11.10(d)';
  result.testDescription = 'Authentication endpoint response time under 1000ms';
  result.acceptanceCriteria = 'Login response within 1000ms';
  results.push(result);
  console.log(`  PERF-002 (Login RT): ${result.passed ? 'PASS' : 'FAIL'} — ${result.notes}`);

  result = await testStudiesResponseTime(baseUrl);
  result.regulatoryRef = '§11.10(a)';
  result.testDescription = 'Authenticated data access response time under 1000ms';
  result.acceptanceCriteria = 'GET /api/studies within 1000ms with valid token';
  results.push(result);
  console.log(`  PERF-003 (Studies RT): ${result.passed ? 'PASS' : 'FAIL'} — ${result.notes}`);

  result = await testConcurrentLogins(baseUrl);
  result.regulatoryRef = '§11.10(a)';
  result.testDescription = 'Concurrent login handling (5 simultaneous)';
  result.acceptanceCriteria = 'All 5 concurrent requests succeed without errors';
  results.push(result);
  console.log(`  PERF-004 (Concurrent): ${result.passed ? 'PASS' : 'FAIL'} — ${result.notes}`);

  result = await testLargeQueryString(baseUrl);
  result.regulatoryRef = '§11.10(a)';
  result.testDescription = 'Large query string handled without crash';
  result.acceptanceCriteria = '1100+ character query string returns non-500 response';
  results.push(result);
  console.log(`  PERF-005 (Large QS): ${result.passed ? 'PASS' : 'FAIL'} — ${result.notes}`);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log(`\n  Performance Summary: ${passed} passed / ${failed} failed out of ${results.length} total`);

  const evidencePath = savePerfEvidence(outputDir, results);
  console.log(`  Evidence saved: ${evidencePath}`);
  return results;
}
