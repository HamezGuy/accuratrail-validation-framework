import { captureApiCall, isRecord, redactEvidenceSecrets, type EvidenceResult } from './evidence-capture';

/** Bearer header for an authenticated qualification request. */
export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Operator credentials for live qualification: OQ_USERNAME / OQ_PASSWORD, else the
 * runner's defaults. Every runner resolves its credentials through this one lookup. */
export function qualificationCredentials(
  defaults: { username: string; password: string } = { username: 'admin', password: 'admin' },
): { username: string; password: string } {
  return {
    username: process.env.OQ_USERNAME || defaults.username,
    password: process.env.OQ_PASSWORD || defaults.password,
  };
}

export interface LoginSession {
  token: string;
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
