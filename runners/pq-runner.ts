import {
  type EvidenceResult,
  captureWithValidator,
  captureApiCall,
  saveEvidence,
} from './evidence-capture';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function login(baseUrl: string, username: string, password: string): Promise<string | null> {
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!resp.ok) return null;
    const body: unknown = await resp.json();
    if (isRecord(body) && typeof body.accessToken === 'string') return body.accessToken;
    if (isRecord(body) && isRecord(body.data) && typeof body.data.accessToken === 'string') return body.data.accessToken;
    if (isRecord(body) && typeof body.token === 'string') return body.token;
    return null;
  } catch {
    return null;
  }
}

function evidence(testCaseId: string, endpoint: string, method: string, status: number, body: unknown, passed: boolean, notes: string): EvidenceResult {
  return { testCaseId, timestamp: new Date().toISOString(), endpoint, method, responseStatus: status, responseBody: body, passed, notes };
}

function manual(testCaseId: string, note: string): EvidenceResult {
  return evidence(testCaseId, 'N/A', 'MANUAL', 0, null, false, `Manual/integration test required: ${note}`);
}

interface WorkflowState {
  adminToken: string | null;
  studyId: number | null;
  siteId: number | null;
  subjectId: number | null;
  formId: number | null;
  visitId: number | null;
  queryId: number | null;
}

async function runStudySetup(baseUrl: string, state: WorkflowState): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];

  if (!state.adminToken) {
    results.push(manual('PQ-001', 'Study creation — no admin token available'));
    results.push(manual('PQ-002', 'Site/user setup — no admin token available'));
    results.push(manual('PQ-003', 'Study config verification — no admin token available'));
    return results;
  }

  const headers = authHeaders(state.adminToken);

  const createStudy = await captureWithValidator(
    { testCaseId: 'PQ-001', method: 'POST', url: '/api/studies', baseUrl, headers, body: {
      name: `PQ Validation Study ${Date.now()}`,
      protocolId: `PQ-PROTO-${Date.now()}`,
      phase: 'Phase III',
      description: 'PQ validation test study — created by automated PQ runner',
      status: 'ACTIVE',
    }},
    (s, b) => {
      if (s === 200 || s === 201) {
        if (isRecord(b) && isRecord(b.data) && typeof b.data.id === 'number') {
          state.studyId = b.data.id;
        } else if (isRecord(b) && typeof b.id === 'number') {
          state.studyId = b.id;
        }
        return { passed: state.studyId !== null, notes: state.studyId !== null ? `Study created with ID ${state.studyId}` : 'Study created but ID not parseable' };
      }
      return { passed: false, notes: `Study creation returned ${s}` };
    },
  );
  results.push(createStudy);

  results.push(manual('PQ-002', 'Site and user role assignment — requires site creation API calls and user provisioning'));
  results.push(manual('PQ-003', 'Study configuration verification — retrieve and compare full config'));

  return results;
}

async function runEnrollment(baseUrl: string, state: WorkflowState): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];

  if (!state.adminToken || !state.studyId) {
    results.push(manual('PQ-004', 'Subject enrollment — requires study ID from PQ-001'));
    results.push(manual('PQ-005', 'Duplicate subject prevention — requires study ID'));
    results.push(manual('PQ-006', 'Visit schedule generation — requires enrolled subject'));
    return results;
  }

  const headers = authHeaders(state.adminToken);
  const subjectLabel = `PQ-SUBJ-${Date.now()}`;

  const enrollResult = await captureWithValidator(
    { testCaseId: 'PQ-004', method: 'POST', url: '/api/subjects', baseUrl, headers, body: {
      studyId: state.studyId,
      label: subjectLabel,
      siteId: state.siteId ?? 1,
      status: 'ENROLLED',
    }},
    (s, b) => {
      if (s === 200 || s === 201) {
        if (isRecord(b) && isRecord(b.data) && typeof b.data.id === 'number') {
          state.subjectId = b.data.id;
        } else if (isRecord(b) && typeof b.id === 'number') {
          state.subjectId = b.id;
        }
        return { passed: state.subjectId !== null, notes: state.subjectId !== null ? `Subject enrolled with ID ${state.subjectId}` : 'Subject created but ID not parseable' };
      }
      return { passed: false, notes: `Subject enrollment returned ${s}` };
    },
  );
  results.push(enrollResult);

  if (state.subjectId) {
    const dupResult = await captureWithValidator(
      { testCaseId: 'PQ-005', method: 'POST', url: '/api/subjects', baseUrl, headers, body: {
        studyId: state.studyId,
        label: subjectLabel,
        siteId: state.siteId ?? 1,
        status: 'ENROLLED',
      }},
      (s, _b) => ({
        passed: s === 409 || s === 400 || s === 422,
        notes: s === 409 || s === 400 || s === 422
          ? `Duplicate subject correctly rejected (${s})`
          : `Expected 409/400/422, got ${s} — duplicate may not be detected`,
      }),
    );
    results.push(dupResult);
  } else {
    results.push(manual('PQ-005', 'Duplicate subject test — initial enrollment did not return ID'));
  }

  results.push(manual('PQ-006', 'Visit schedule generation — requires visit schedule API query after enrollment'));

  return results;
}

async function runDataEntryAndQueries(baseUrl: string, state: WorkflowState): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  const dataIds: Array<[string, string]> = [
    ['PQ-007', 'Complete eCRF data entry for a visit — requires form/visit endpoints and test data'],
    ['PQ-008', 'Validation rule firing and auto-query — requires configured validation rule'],
    ['PQ-009', 'Manual query creation and resolution — requires form data and query workflow'],
    ['PQ-010', 'Data correction with reason — requires existing data to correct'],
    ['PQ-011', 'Skip/branching logic — requires configured branching rules on form'],
    ['PQ-012', 'Multi-form visit completion — requires visit with multiple assigned forms'],
  ];
  for (const [id, note] of dataIds) {
    results.push(manual(id, note));
  }
  return results;
}

async function runReviewApproval(baseUrl: string, state: WorkflowState): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  const ids: Array<[string, string]> = [
    ['PQ-013', 'Monitor SDV workflow — requires monitor role and completed form data'],
    ['PQ-014', 'Data manager review — requires data manager role and reviewed form'],
    ['PQ-015', 'Investigator e-signature — requires PI role and reviewed form'],
    ['PQ-016', 'Form lifecycle sign-off — requires full form state progression'],
  ];
  for (const [id, note] of ids) {
    results.push(manual(id, note));
  }
  return results;
}

async function runDataClosure(baseUrl: string, state: WorkflowState): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  const ids: Array<[string, string]> = [
    ['PQ-017', 'Casebook freeze — requires complete, signed casebook'],
    ['PQ-018', 'Casebook lock — requires frozen casebook'],
    ['PQ-019', 'Study-level database lock — requires all subjects locked'],
    ['PQ-020', 'Final data export — requires locked study'],
  ];
  for (const [id, note] of ids) {
    results.push(manual(id, note));
  }
  return results;
}

async function runArchiveRecovery(baseUrl: string, state: WorkflowState): Promise<EvidenceResult[]> {
  const results: EvidenceResult[] = [];
  results.push(manual('PQ-021', 'Backup execution and verification — requires backup service trigger'));
  results.push(manual('PQ-022', 'Data retrieval from archive — requires backup restore to test env'));
  return results;
}

export async function run(outputDir: string, baseUrl: string): Promise<EvidenceResult[]> {
  const state: WorkflowState = {
    adminToken: null,
    studyId: null,
    siteId: null,
    subjectId: null,
    formId: null,
    visitId: null,
    queryId: null,
  };

  const pqUsername = process.env.PQ_USERNAME || process.env.OQ_USERNAME || 'admin';
  const pqPassword = process.env.PQ_PASSWORD || process.env.OQ_PASSWORD || 'admin';

  state.adminToken = await login(baseUrl, pqUsername, pqPassword);

  if (!state.adminToken) {
    const loginEvidence = evidence(
      'PQ-000', '/api/auth/login', 'POST', 0, null, false,
      'Failed to authenticate admin user — all PQ tests require authentication. Verify test credentials.',
    );
    saveEvidence(outputDir, 'pq', [loginEvidence]);
    return [loginEvidence];
  }

  const allResults: EvidenceResult[] = [];

  const suites = [
    runStudySetup,
    runEnrollment,
    runDataEntryAndQueries,
    runReviewApproval,
    runDataClosure,
    runArchiveRecovery,
  ];

  for (const suite of suites) {
    try {
      const results = await suite(baseUrl, state);
      allResults.push(...results);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      allResults.push(evidence(
        'PQ-ERR', baseUrl, 'SUITE', 0, { error: msg }, false,
        `PQ test suite threw unexpected error: ${msg}`,
      ));
    }
  }

  allResults.sort((a, b) => a.testCaseId.localeCompare(b.testCaseId, undefined, { numeric: true }));
  saveEvidence(outputDir, 'pq', allResults);
  return allResults;
}
