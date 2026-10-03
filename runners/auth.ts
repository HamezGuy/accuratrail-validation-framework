import { captureApiCall, isRecord, redactEvidenceSecrets, type EvidenceResult } from './evidence-capture';

/** Bearer header for an authenticated qualification request. */
export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Operator credentials for live qualification come only from the environment:
 * OQ_USERNAME / OQ_PASSWORD, else the runner's own variables passed as `fallback`
 * (named in `variables` for the refusal). There is no built-in account: a missing
 * value refuses the run before any request is made. Every runner resolves its
 * credentials through this one lookup. */
export function qualificationCredentials(
  fallback: { username?: string; password?: string } = {},
  variables: { username: string; password: string } = { username: 'OQ_USERNAME', password: 'OQ_PASSWORD' },
  operator = 'Qualification',
): { username: string; password: string } {
  const username = process.env.OQ_USERNAME || fallback.username || '';
  const password = process.env.OQ_PASSWORD || fallback.password || '';
  const missing = [...(username ? [] : [variables.username]), ...(password ? [] : [variables.password])];
  if (missing.length) throw new Error(`${operator} operator credentials are not configured: set ${missing.join(' and ')}.`);
  return { username, password };
}

/** For runners whose session is optional (their other checks run unauthenticated):
 * null when neither OQ_USERNAME nor OQ_PASSWORD is set, else the complete pair
 * (one without the other is refused as a misconfiguration). */
export function optionalQualificationCredentials(): { username: string; password: string } | null {
  if (!process.env.OQ_USERNAME && !process.env.OQ_PASSWORD) return null;
  return qualificationCredentials();
}

export interface LoginSession {
  token: string;
  /** Kept only in memory for native refresh qualification; evidence is redacted. */
  refreshToken?: string;
  /** Null when the login payload does not identify the user. */
  userId: number | null;
  /** First organisation identified by the payload, or null when absent. */
  orgId: number | null;
}

export interface LoginResult {
  /** The captured login exchange. The password and any issued tokens are redacted. */
  evidence: EvidenceResult;
  /** null when the request was rejected or carried no recognisable token. */
  session: LoginSession | null;
}

/** Tolerates every login payload shape the API has used:
 * `{ accessToken, user?, organizations? }`, `{ data: { accessToken } }` and `{ token }`. */
function readLoginSession(body: unknown): LoginSession | null {
  if (!isRecord(body) || body.success === false) return null;
  const payload = typeof body.accessToken === 'string' || typeof body.token === 'string'
    ? body : isRecord(body.data) ? body.data : body;
  if (payload.success === false) return null;
  const token = payload.accessToken ?? payload.token;
  if (typeof token !== 'string' || !token.trim()) return null;
  const user = isRecord(payload.user) ? payload.user : isRecord(body.user) ? body.user : payload;
  const orgs = Array.isArray(payload.organizations) ? payload.organizations
    : Array.isArray(body.organizations) ? body.organizations : [];
  const org = isRecord(orgs[0]) ? orgs[0] : {};
  const numericId = (value: unknown): number | null =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
  return {
    token,
    ...(typeof payload.refreshToken === 'string' && payload.refreshToken.trim() ? { refreshToken: payload.refreshToken } : {}),
    userId: numericId(user.userId),
    orgId: numericId(org.id ?? org.organizationId),
  };
}

/** Log in through the evidence-capturing transport. The exchange comes back as an
 * evidence row (OQ-LOGIN unless the caller names its own step) so a runner may
 * retain it; the password and any issued tokens never remain in that row. */
export async function login(
  baseUrl: string,
  username: string,
  password: string,
  testCaseId = 'OQ-LOGIN',
): Promise<LoginResult> {
  const evidence = await captureApiCall({
    testCaseId, method: 'POST', url: '/api/auth/login', baseUrl,
    body: { username, password },
  });
  const session = evidence.passed ? readLoginSession(evidence.responseBody) : null;
  if (evidence.passed && !session) {
    evidence.passed = false;
    evidence.notes = 'Login response did not contain a usable access token';
  }
  evidence.requestBody = { username, password: '[redacted]' };
  evidence.responseBody = redactEvidenceSecrets(evidence.responseBody);
  evidence.responseHeaders = redactEvidenceSecrets(evidence.responseHeaders) as Record<string, string>;
  return { evidence, session };
}

/** A login-only probe must release the exact session it creates. Keep the raw
 * login payload in memory for claim/policy assertions; retained evidence is
 * redacted by saveEvidence. Never revoke other sessions for this account. */
export async function captureLoginProbe(
  baseUrl: string, username: string, password: string, testCaseId: string,
): Promise<EvidenceResult> {
  const evidence = await captureApiCall({ testCaseId, method: 'POST', url: '/api/auth/login',
    baseUrl, body: { username, password }, redirect: 'error' });
  const session = evidence.passed ? readLoginSession(evidence.responseBody) : null;
  if (!session) {
    if (evidence.passed) {
      evidence.passed = false;
      evidence.notes = 'Successful login carried no usable session token; owned-session cleanup is unresolved.';
    }
    return evidence;
  }
  const logout = await captureApiCall({ testCaseId: `${testCaseId}-logout`, method: 'POST',
    url: '/api/auth/logout', baseUrl, headers: authHeaders(session.token), redirect: 'error' });
  const reuse = await captureApiCall({ testCaseId: `${testCaseId}-logout-readback`, method: 'GET',
    url: '/api/auth/verify', baseUrl, headers: authHeaders(session.token), redirect: 'error' });
  const body = reuse.responseBody;
  reuse.passed = !reuse.captureError && reuse.responseStatus === 401 && isRecord(body)
    && body.success === false && isRecord(body.error)
    && ['TOKEN_REVOKED', 'SESSION_REVOKED', 'SESSION_NOT_ACTIVE'].includes(String(body.error.code));
  reuse.notes = reuse.passed ? 'The exact issued login token is refused after logout.'
    : 'The exact issued login token did not receive a native session-revocation refusal.';
  logout.passed = !logout.captureError && logout.responseStatus === 200 && isRecord(logout.responseBody)
    && logout.responseBody.success === true;
  evidence.relatedEvidence = redactEvidenceSecrets([logout, reuse]) as EvidenceResult[];
  evidence.passed = evidence.passed && logout.passed && reuse.passed;
  evidence.notes += evidence.passed ? ' Owned-session logout and refusal verified.'
    : ' Owned-session cleanup failed; this probe cannot pass.';
  return evidence;
}
