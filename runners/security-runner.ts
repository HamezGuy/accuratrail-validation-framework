import * as fs from 'fs';
import * as path from 'path';
import {
  type EvidenceResult,
  captureWithValidator,
  captureApiCall,
} from './evidence-capture';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function saveSecurityEvidence(outputDir: string, results: EvidenceResult[]): string {
  const evidenceDir = path.join(outputDir, 'evidence', 'security');
  fs.mkdirSync(evidenceDir, { recursive: true });

  fs.writeFileSync(
    path.join(evidenceDir, 'security-results.json'),
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
    category: 'security',
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
    path.join(evidenceDir, 'security-summary.json'),
    JSON.stringify(summary, null, 2),
    'utf-8',
  );

  return evidenceDir;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testSqlInjection(baseUrl: string): Promise<EvidenceResult> {
  return captureWithValidator(
    {
      testCaseId: 'SEC-001',
      method: 'POST',
      url: '/api/auth/login',
      baseUrl,
      body: { username: "' OR 1=1 --", password: 'password' },
    },
    (status, body) => {
      const rejected = status === 400 || status === 401 || status === 422;
      const noToken = !isRecord(body) || typeof body.accessToken !== 'string';
      const passed = rejected && noToken;
      return {
        passed,
        notes: passed
          ? `SQL injection rejected (HTTP ${status})`
          : `SQL injection may not be blocked — status ${status}, hasToken=${!noToken}`,
      };
    },
  );
}

async function testXssInjection(baseUrl: string, token: string | null): Promise<EvidenceResult> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  return captureWithValidator(
    {
      testCaseId: 'SEC-002',
      method: 'POST',
      url: '/api/forms/data',
      baseUrl,
      headers,
      body: { fieldValue: '<script>alert(1)</script>', formId: 1 },
    },
    (status, body) => {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      const reflected = bodyStr.includes('<script>alert(1)</script>');
      if (status === 400 || status === 422) {
        return { passed: true, notes: `XSS payload rejected by server (HTTP ${status})` };
      }
      if (reflected) {
        return { passed: false, notes: 'XSS payload reflected in response — potential vulnerability' };
      }
      return { passed: true, notes: `XSS payload not reflected (HTTP ${status})` };
    },
  );
}

async function testMissingAuth(baseUrl: string): Promise<EvidenceResult> {
  return captureWithValidator(
    {
      testCaseId: 'SEC-003',
      method: 'GET',
      url: '/api/studies',
      baseUrl,
    },
    (status) => ({
      passed: status === 401,
      notes: status === 401
        ? 'Protected endpoint correctly returns 401 without auth'
        : `Expected 401 without auth token, got ${status}`,
    }),
  );
}

async function testTamperedJwt(baseUrl: string): Promise<EvidenceResult> {
  const tamperedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInJvbGUiOiJhZG1pbiJ9.tampered_signature';
  return captureWithValidator(
    {
      testCaseId: 'SEC-004',
      method: 'GET',
      url: '/api/studies',
      baseUrl,
      headers: { Authorization: `Bearer ${tamperedToken}` },
    },
    (status) => ({
      passed: status === 401,
      notes: status === 401
        ? 'Tampered JWT correctly rejected with 401'
        : `Expected 401 for tampered JWT, got ${status}`,
    }),
  );
}

async function testExpiredJwt(baseUrl: string): Promise<EvidenceResult> {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    userId: 1,
    role: 'admin',
    iat: Math.floor(Date.now() / 1000) - 7200,
    exp: Math.floor(Date.now() / 1000) - 3600,
  })).toString('base64url');
  const expiredToken = `${header}.${payload}.expired_signature`;

  return captureWithValidator(
    {
      testCaseId: 'SEC-005',
      method: 'GET',
      url: '/api/studies',
      baseUrl,
      headers: { Authorization: `Bearer ${expiredToken}` },
    },
    (status) => ({
      passed: status === 401,
      notes: status === 401
        ? 'Expired JWT correctly rejected with 401'
        : `Expected 401 for expired JWT, got ${status}`,
    }),
  );
}

async function testPathTraversal(baseUrl: string): Promise<EvidenceResult> {
  return captureWithValidator(
    {
      testCaseId: 'SEC-006',
      method: 'GET',
      url: '/api/forms/../../etc/passwd',
      baseUrl,
    },
    (status, body) => {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      const hasSystemContent = bodyStr.includes('root:') && bodyStr.includes('/bin/');
      if (hasSystemContent) {
        return { passed: false, notes: 'Path traversal succeeded — system file leaked' };
      }
      return {
        passed: true,
        notes: `Path traversal blocked — no sensitive content exposed (HTTP ${status})`,
      };
    },
  );
}

async function testVerbTampering(baseUrl: string): Promise<EvidenceResult> {
  return captureWithValidator(
    {
      testCaseId: 'SEC-007',
      method: 'DELETE',
      url: '/api/studies',
      baseUrl,
    },
    (status) => {
      const blocked = status === 401 || status === 403 || status === 404 || status === 405;
      return {
        passed: blocked,
        notes: blocked
          ? `DELETE on read-only endpoint blocked (HTTP ${status})`
          : `DELETE on read-only endpoint returned ${status} — may need review`,
      };
    },
  );
}

async function testCorsPreflight(baseUrl: string): Promise<EvidenceResult> {
  const fullUrl = `${baseUrl.replace(/\/$/, '')}/api/studies`;
  const timestamp = new Date().toISOString();

  try {
    const response = await fetch(fullUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil-origin.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });

    const allowOrigin = response.headers.get('access-control-allow-origin') ?? '';
    const wildcardOrEvil =
      allowOrigin === '*' || allowOrigin.includes('evil-origin.example.com');

    return {
      testCaseId: 'SEC-008',
      timestamp,
      endpoint: fullUrl,
      method: 'OPTIONS',
      responseStatus: response.status,
      responseBody: { accessControlAllowOrigin: allowOrigin },
      passed: !wildcardOrEvil,
      notes: wildcardOrEvil
        ? `CORS allows untrusted origin: ${allowOrigin}`
        : `CORS does not allow untrusted origin (allow-origin: ${allowOrigin || 'not set'})`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      testCaseId: 'SEC-008',
      timestamp,
      endpoint: fullUrl,
      method: 'OPTIONS',
      responseStatus: 0,
      responseBody: { error: message },
      passed: false,
      notes: `CORS preflight request failed: ${message}`,
    };
  }
}

async function testErrorLeakage(baseUrl: string): Promise<EvidenceResult> {
  return captureWithValidator(
    {
      testCaseId: 'SEC-009',
      method: 'GET',
      url: '/api/this-endpoint-should-not-exist-trigger-error',
      baseUrl,
    },
    (status, body) => {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      const leaksStack = /at\s+\w+\s+\(.*\.(?:ts|js):\d+:\d+\)/.test(bodyStr);
      const leaksPath = /(?:[A-Z]:\\|\/home\/|\/usr\/|node_modules)/.test(bodyStr);
      const leaksInternal = leaksStack || leaksPath;

      if (status === 404) {
        return {
          passed: !leaksInternal,
          notes: leaksInternal
            ? 'Error response leaks internal paths or stack traces'
            : 'Error response does not leak sensitive information',
        };
      }
      return {
        passed: !leaksInternal,
        notes: leaksInternal
          ? `HTTP ${status} response leaks sensitive data`
          : `HTTP ${status} response is clean of internal details`,
      };
    },
  );
}

async function testContentTypeEnforcement(baseUrl: string): Promise<EvidenceResult> {
  const fullUrl = `${baseUrl.replace(/\/$/, '')}/api/auth/login`;
  const timestamp = new Date().toISOString();

  try {
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'username=admin&password=admin',
    });
    const status = response.status;
    const contentType = response.headers.get('content-type') ?? '';
    let responseBody: unknown;
    if (contentType.includes('application/json')) {
      responseBody = await response.json() as unknown;
    } else {
      const text = await response.text();
      responseBody = text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    }

    const rejected = status === 400 || status === 415 || status === 422;
    return {
      testCaseId: 'SEC-010',
      timestamp,
      endpoint: fullUrl,
      method: 'POST',
      requestBody: 'username=admin&password=admin',
      responseStatus: status,
      responseBody,
      passed: rejected,
      notes: rejected
        ? `Non-JSON content type rejected (HTTP ${status})`
        : `Non-JSON content type accepted (HTTP ${status}) — may need Content-Type enforcement`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      testCaseId: 'SEC-010',
      timestamp,
      endpoint: fullUrl,
      method: 'POST',
      responseStatus: 0,
      responseBody: { error: message },
      passed: false,
      notes: `Content-Type test request failed: ${message}`,
    };
  }
}

export async function run(outputDir: string, baseUrl: string): Promise<EvidenceResult[]> {
  console.log(`\n  Running Security tests (10 cases) against ${baseUrl}...`);

  let token: string | null = null;
  try {
    const loginResp = await fetch(`${baseUrl.replace(/\/$/, '')}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.OQ_USERNAME || 'admin',
        password: process.env.OQ_PASSWORD || 'admin',
      }),
    });
    if (loginResp.ok) {
      const body: unknown = await loginResp.json();
      if (isRecord(body) && typeof body.accessToken === 'string') {
        token = body.accessToken;
      }
    }
  } catch { /* proceed without token for tests that don't need it */ }

  const results: EvidenceResult[] = [];

  let result: EvidenceResult;

  result = await testSqlInjection(baseUrl);
  result.regulatoryRef = '§11.10(d), §164.312(c)(1)';
  result.testDescription = 'SQL injection attempt on login endpoint';
  result.acceptanceCriteria = 'Login rejected, no data returned, no token issued';
  results.push(result);
  console.log(`  SEC-001 (SQL Injection): ${result.passed ? 'PASS' : 'FAIL'}`);

  result = await testXssInjection(baseUrl, token);
  result.regulatoryRef = '§11.10(d)';
  result.testDescription = 'XSS payload injection in form data';
  result.acceptanceCriteria = 'Payload not reflected in response body';
  results.push(result);
  console.log(`  SEC-002 (XSS Injection): ${result.passed ? 'PASS' : 'FAIL'}`);

  result = await testMissingAuth(baseUrl);
  result.regulatoryRef = '§11.10(d), §164.312(d)';
  result.testDescription = 'Protected endpoint rejects unauthenticated request';
  result.acceptanceCriteria = 'HTTP 401 without auth header';
  results.push(result);
  console.log(`  SEC-003 (Missing Auth): ${result.passed ? 'PASS' : 'FAIL'}`);

  result = await testTamperedJwt(baseUrl);
  result.regulatoryRef = '§11.10(d)';
  result.testDescription = 'Tampered JWT token rejected';
  result.acceptanceCriteria = 'HTTP 401 for JWT with invalid signature';
  results.push(result);
  console.log(`  SEC-004 (Tampered JWT): ${result.passed ? 'PASS' : 'FAIL'}`);

  result = await testExpiredJwt(baseUrl);
  result.regulatoryRef = '§11.10(d)';
  result.testDescription = 'Expired JWT token rejected';
  result.acceptanceCriteria = 'HTTP 401 for JWT past expiration';
  results.push(result);
  console.log(`  SEC-005 (Expired JWT): ${result.passed ? 'PASS' : 'FAIL'}`);

  result = await testPathTraversal(baseUrl);
  result.regulatoryRef = '§11.10(d)';
  result.testDescription = 'Path traversal attack blocked';
  result.acceptanceCriteria = 'No system files exposed in response';
  results.push(result);
  console.log(`  SEC-006 (Path Traversal): ${result.passed ? 'PASS' : 'FAIL'}`);

  result = await testVerbTampering(baseUrl);
  result.regulatoryRef = '§11.10(g)';
  result.testDescription = 'HTTP DELETE on read-only endpoint blocked';
  result.acceptanceCriteria = 'HTTP 401/403/404/405 returned';
  results.push(result);
  console.log(`  SEC-007 (Verb Tampering): ${result.passed ? 'PASS' : 'FAIL'}`);

  result = await testCorsPreflight(baseUrl);
  result.regulatoryRef = '§164.312(e)(1)';
  result.testDescription = 'CORS rejects untrusted origins';
  result.acceptanceCriteria = 'Access-Control-Allow-Origin does not include malicious origin';
  results.push(result);
  console.log(`  SEC-008 (CORS Preflight): ${result.passed ? 'PASS' : 'FAIL'}`);

  result = await testErrorLeakage(baseUrl);
  result.regulatoryRef = '§164.312(c)(1)';
  result.testDescription = 'Error responses do not leak internal paths or stack traces';
  result.acceptanceCriteria = 'No file paths, stack frames, or node_modules references in error body';
  results.push(result);
  console.log(`  SEC-009 (Error Leakage): ${result.passed ? 'PASS' : 'FAIL'}`);

  result = await testContentTypeEnforcement(baseUrl);
  result.regulatoryRef = '§11.10(d)';
  result.testDescription = 'Non-JSON content type rejected on API endpoints';
  result.acceptanceCriteria = 'HTTP 400/415/422 for text/plain content';
  results.push(result);
  console.log(`  SEC-010 (Content-Type): ${result.passed ? 'PASS' : 'FAIL'}`);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log(`\n  Security Summary: ${passed} passed / ${failed} failed out of ${results.length} total`);

  const evidencePath = saveSecurityEvidence(outputDir, results);
  console.log(`  Evidence saved: ${evidencePath}`);
  return results;
}
