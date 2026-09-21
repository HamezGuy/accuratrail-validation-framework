import { authHeaders, login, qualificationCredentials } from './auth';
import { type EvidenceResult, captureApiCall, isRecord, saveEvidence } from './evidence-capture';

// Every timing below is captureApiCall's durationMs: the interval to the response
// headers, with a failed request recording the time until it failed.

async function testHealthResponseTime(baseUrl: string): Promise<EvidenceResult> {
  const maxMs = 500;
  const r = await captureApiCall({ testCaseId: 'PERF-001', method: 'GET', url: '/health', baseUrl });
  const durationMs = r.durationMs ?? 0;
  r.passed = r.responseStatus === 200 && durationMs < maxMs;
  r.responseBody = { ...(isRecord(r.responseBody) ? r.responseBody : { raw: r.responseBody }), durationMs };
  r.notes = r.responseStatus === 200
    ? `Health endpoint responded in ${durationMs}ms (threshold: ${maxMs}ms) — ${durationMs < maxMs ? 'PASS' : 'FAIL: too slow'}`
    : `Health endpoint returned HTTP ${r.responseStatus} in ${durationMs}ms`;
  return r;
}

async function testLoginResponseTime(baseUrl: string): Promise<EvidenceResult> {
  const maxMs = 1000;
  const { username, password } = qualificationCredentials();
  const { evidence: r } = await login(baseUrl, username, password, 'PERF-002');
  const durationMs = r.durationMs ?? 0;
  r.passed = (r.responseStatus === 200 || r.responseStatus === 401) && durationMs < maxMs;
  r.responseBody = { durationMs };
  r.notes = `Login endpoint responded in ${durationMs}ms (threshold: ${maxMs}ms) — ${durationMs < maxMs ? 'PASS' : 'FAIL: too slow'}`;
  return r;
}

async function testStudiesResponseTime(baseUrl: string): Promise<EvidenceResult> {
  const { username, password } = qualificationCredentials();
  const { session } = await login(baseUrl, username, password);

  if (!session) {
    return {
      testCaseId: 'PERF-003',
      timestamp: new Date().toISOString(),
      endpoint: '/api/studies',
      method: 'GET',
      responseStatus: 0,
      responseBody: null,
      passed: false,
      notes: 'Could not authenticate — skipping studies response time test',
    };
  }

  const maxMs = 1000;
  const r = await captureApiCall({
    testCaseId: 'PERF-003', method: 'GET', url: '/api/studies', baseUrl, headers: authHeaders(session.token),
  });
  const durationMs = r.durationMs ?? 0;
  r.requestHeaders = { ...r.requestHeaders, Authorization: '[redacted]' };
  r.passed = r.responseStatus === 200 && durationMs < maxMs;
  r.responseBody = { durationMs };
  r.notes = r.responseStatus === 200
    ? `Studies endpoint responded in ${durationMs}ms (threshold: ${maxMs}ms) — ${durationMs < maxMs ? 'PASS' : 'FAIL: too slow'}`
    : `Studies endpoint returned HTTP ${r.responseStatus} in ${durationMs}ms`;
  return r;
}

async function testConcurrentLogins(baseUrl: string): Promise<EvidenceResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/auth/login`;
  const timestamp = new Date().toISOString();
  const concurrency = 5;
  const { username, password } = qualificationCredentials();

  const attempts = await Promise.all(
    Array.from({ length: concurrency }, () => login(baseUrl, username, password, 'PERF-004')),
  );
  const durations = attempts.map((attempt) => attempt.evidence.durationMs ?? 0);
  const succeeded = attempts.filter((attempt) => attempt.evidence.responseStatus === 200).length;
  const maxDuration = Math.max(...durations);
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
      durations,
    },
    passed: allSucceeded,
    notes: allSucceeded
      ? `All ${concurrency} concurrent logins succeeded (max ${maxDuration}ms)`
      : `${succeeded}/${concurrency} concurrent logins succeeded (max ${maxDuration}ms)`,
  };
}

async function testLargeQueryString(baseUrl: string): Promise<EvidenceResult> {
  const longParam = 'x'.repeat(1100);
  const r = await captureApiCall({ testCaseId: 'PERF-005', method: 'GET', url: `/health?q=${longParam}`, baseUrl });
  const durationMs = r.durationMs ?? 0;
  const status = r.responseStatus;
  r.endpoint = `${baseUrl.replace(/\/$/, '')}/health?q=[1100 chars]`;
  r.passed = status > 0 && status < 500;
  r.responseBody = { durationMs, queryLength: longParam.length };
  r.notes = r.passed
    ? `Large query string handled gracefully (HTTP ${status}, ${durationMs}ms)`
    : `Large query string caused server error (HTTP ${status}, ${durationMs}ms)`;
  return r;
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

  const evidencePath = saveEvidence(outputDir, 'performance', results);
  console.log(`  Evidence saved: ${evidencePath}`);
  return results;
}
