import * as fs from 'fs';
import * as path from 'path';
import { SYSTEM_INFO } from '../config/system-info';
import { REGULATORY_SCOPE } from '../config/regulatory-scope';
import { FEATURE_RISKS } from '../config/risk-ratings';
import {
  documentHeader,
  testCaseBlock,
  section,
  approvalBlock,
  tableOfContents,
  hr,
  markdownTable,
  type SectionEntry,
  type TestCaseOptions,
} from './helpers/markdown-writer';
import { getDocumentMeta, stampDocument } from './helpers/version-stamper';

interface IqTestCase {
  id: string;
  title: string;
  requirement: string;
  cfr: string;
  steps: string[];
  expectedResult: string;
  evidence: string;
}

const YEAR = new Date().getFullYear();
const DOC_ID = `IQ-${YEAR}-001`;

function softwareInstallationCases(): IqTestCase[] {
  return [
    {
      id: 'IQ-001',
      title: 'Application version matches release',
      requirement: 'Deployed application version matches the validated release version',
      cfr: '§11.10(a) — Validation',
      steps: [
        'Send GET request to the /health endpoint of the backend API.',
        `Verify the response includes a version field matching "${SYSTEM_INFO.version}".`,
        'Cross-reference with package.json in the backend repository.',
      ],
      expectedResult: `API returns version "${SYSTEM_INFO.version}" matching the validated release.`,
      evidence: 'See evidence/iq/IQ-001.json',
    },
    {
      id: 'IQ-002',
      title: 'Backend API is running and responding',
      requirement: 'The Express/Node.js REST API is operational and returns HTTP 200 on health check',
      cfr: '§11.10(a) — Validation',
      steps: [
        `Send GET request to ${SYSTEM_INFO.environments.production.apiUrl}/health.`,
        'Verify response status is 200.',
        'Verify response body contains a status field indicating healthy.',
      ],
      expectedResult: 'Health endpoint returns HTTP 200 with healthy status.',
      evidence: 'See evidence/iq/IQ-002.json',
    },
    {
      id: 'IQ-003',
      title: 'Frontend application is deployed and accessible',
      requirement: 'The Angular SPA is served and loads in a browser',
      cfr: 'N/A',
      steps: [
        `Navigate to ${SYSTEM_INFO.environments.production.frontendUrl} in a browser.`,
        'Verify the page loads without HTTP errors (status 200).',
        'Verify the Angular application renders (login or dashboard page visible).',
      ],
      expectedResult: 'Frontend URL returns HTTP 200 and the application renders correctly.',
      evidence: 'See evidence/iq/IQ-003.json',
    },
    {
      id: 'IQ-004',
      title: 'Node.js version is 20+',
      requirement: 'Runtime environment runs Node.js 20 or higher as specified',
      cfr: '§11.10(a) — Validation',
      steps: [
        'Execute `node --version` on the server hosting the backend API.',
        'Parse the major version number from the output.',
        'Verify major version is >= 20.',
      ],
      expectedResult: 'Node.js major version is 20 or higher.',
      evidence: 'See evidence/iq/IQ-004.json',
    },
    {
      id: 'IQ-005',
      title: 'Angular version is 19',
      requirement: 'Frontend uses Angular 19 as specified in the architecture',
      cfr: 'N/A',
      steps: [
        'Inspect package.json in the ElectronicDataCaptureReal directory.',
        'Locate the @angular/core dependency version.',
        'Verify major version is 19.',
      ],
      expectedResult: 'Angular @angular/core version starts with 19.x.',
      evidence: 'See evidence/iq/IQ-005.json',
    },
    {
      id: 'IQ-006',
      title: 'TypeScript version is 5.x',
      requirement: 'TypeScript compiler version matches the architecture specification',
      cfr: 'N/A',
      steps: [
        'Inspect package.json in the shared-types directory.',
        'Locate the typescript dependency version.',
        'Verify major version is 5.',
      ],
      expectedResult: 'TypeScript version starts with 5.x.',
      evidence: 'See evidence/iq/IQ-006.json',
    },
    {
      id: 'IQ-007',
      title: 'All npm dependencies installed without vulnerabilities',
      requirement: 'Dependency tree is complete and free of known critical/high vulnerabilities',
      cfr: '§11.10(a) — Validation',
      steps: [
        'Run `npm audit` in the libreclinicaapi directory.',
        'Run `npm audit` in the ElectronicDataCaptureReal directory.',
        'Verify no critical or high severity vulnerabilities are reported.',
        'If vulnerabilities exist, document them with justification or remediation plan.',
      ],
      expectedResult: 'No critical or high severity npm vulnerabilities, or all documented with remediation.',
      evidence: 'See evidence/iq/IQ-007.json',
    },
    {
      id: 'IQ-008',
      title: 'Shared-types package built and linked',
      requirement: '@accura-trial/shared-types is compiled and symlinked to consuming projects',
      cfr: 'N/A',
      steps: [
        'Verify shared-types/dist/ directory exists and contains compiled .js and .d.ts files.',
        'Verify libreclinicaapi/node_modules/@accura-trial/shared-types resolves to shared-types.',
        'Verify ElectronicDataCaptureReal/node_modules/@accura-trial/shared-types resolves to shared-types.',
        'Import a type from the package in a test script and confirm it compiles.',
      ],
      expectedResult: 'Shared-types is built, and both frontend and backend resolve the package correctly.',
      evidence: 'See evidence/iq/IQ-008.json',
    },
  ];
}

function databaseInstallationCases(): IqTestCase[] {
  return [
    {
      id: 'IQ-009',
      title: 'PostgreSQL version is 15+',
      requirement: 'Database server runs PostgreSQL 15 or higher as specified',
      cfr: '§11.10(a) — Validation',
      steps: [
        'Connect to the PostgreSQL instance.',
        'Execute `SELECT version();` or check via API health endpoint if exposed.',
        'Parse the major version number.',
        'Verify major version is >= 15.',
      ],
      expectedResult: 'PostgreSQL major version is 15 or higher.',
      evidence: 'See evidence/iq/IQ-009.json',
    },
    {
      id: 'IQ-010',
      title: 'Database is accessible and responding',
      requirement: 'API can successfully connect to and query the database',
      cfr: '§11.10(a) — Validation',
      steps: [
        'Send GET request to the API health endpoint.',
        'Verify the response indicates database connectivity (db status field).',
        'Alternatively, execute a simple SELECT 1 query via the API diagnostic endpoint.',
      ],
      expectedResult: 'Health check confirms database is connected and responsive.',
      evidence: 'See evidence/iq/IQ-010.json',
    },
    {
      id: 'IQ-011',
      title: 'acc_audit_log table exists with correct schema',
      requirement: 'Audit trail table is present with all required columns for 21 CFR Part 11 compliance',
      cfr: '§11.10(e) — Audit trails',
      steps: [
        'Query information_schema.tables for acc_audit_log.',
        'Verify required columns exist: id, user_id, action, entity_type, entity_id, old_values, new_values, reason, ip_address, created_at.',
        'Verify created_at column has a default of CURRENT_TIMESTAMP.',
        'Verify the table has appropriate indexes.',
      ],
      expectedResult: 'acc_audit_log table exists with all required columns and constraints.',
      evidence: 'See evidence/iq/IQ-011.json',
    },
    {
      id: 'IQ-012',
      title: 'acc_esignatures table exists with correct schema',
      requirement: 'Electronic signatures table supports all Part 11 Subpart C requirements',
      cfr: '§11.50, §11.70 — Electronic signatures',
      steps: [
        'Query information_schema.tables for acc_esignatures.',
        'Verify required columns: id, user_id, record_type, record_id, signature_meaning, signed_at, username_verified, password_verified, printed_name.',
        'Verify foreign key to users table.',
        'Verify NOT NULL constraints on critical fields.',
      ],
      expectedResult: 'acc_esignatures table exists with all required Part 11 Subpart C columns.',
      evidence: 'See evidence/iq/IQ-012.json',
    },
    {
      id: 'IQ-013',
      title: 'User tables exist (acc_users or users)',
      requirement: 'User account management tables are present for access control',
      cfr: '§11.10(d) — Authority checks',
      steps: [
        'Query information_schema.tables for user/account tables.',
        'Verify required columns: id, username, email, password_hash, role, is_active, created_at, updated_at.',
        'Verify unique constraint on username and email.',
        'Verify password_hash column does NOT store plaintext.',
      ],
      expectedResult: 'User tables exist with identity, authentication, and role columns.',
      evidence: 'See evidence/iq/IQ-013.json',
    },
    {
      id: 'IQ-014',
      title: 'acc_queries table exists',
      requirement: 'Data query management table is present for clinical data discrepancy workflow',
      cfr: '§11.10(e) — Audit trails',
      steps: [
        'Query information_schema.tables for acc_queries.',
        'Verify required columns: id, study_id, subject_id, form_id, field_name, query_text, status, created_by, assigned_to, created_at, resolved_at.',
        'Verify status column supports workflow states (OPEN, ANSWERED, CLOSED, CANCELLED).',
      ],
      expectedResult: 'acc_queries table exists with full query workflow support.',
      evidence: 'See evidence/iq/IQ-014.json',
    },
    {
      id: 'IQ-015',
      title: 'acc_data_locks table exists',
      requirement: 'Data lock/freeze table exists for record protection',
      cfr: '§11.10(a) — Validation; data integrity',
      steps: [
        'Query information_schema.tables for acc_data_locks.',
        'Verify required columns: id, entity_type, entity_id, lock_level (freeze/lock), locked_by, locked_at, reason.',
        'Verify the lock_level column distinguishes between freeze and lock states.',
      ],
      expectedResult: 'acc_data_locks table exists with freeze/lock level distinction.',
      evidence: 'See evidence/iq/IQ-015.json',
    },
    {
      id: 'IQ-016',
      title: 'acc_tasks table exists',
      requirement: 'Workflow task management table is present',
      cfr: 'N/A',
      steps: [
        'Query information_schema.tables for acc_tasks.',
        'Verify required columns: id, study_id, task_type, assigned_to, status, created_at, completed_at.',
        'Verify foreign key relationships.',
      ],
      expectedResult: 'acc_tasks table exists with workflow management columns.',
      evidence: 'See evidence/iq/IQ-016.json',
    },
    {
      id: 'IQ-017',
      title: 'All foreign key constraints present',
      requirement: 'Referential integrity enforced across all acc_* extension tables',
      cfr: '§11.10(a) — Validation',
      steps: [
        'Query information_schema.table_constraints for FOREIGN KEY type on all acc_* tables.',
        'Verify acc_audit_log.user_id references the users table.',
        'Verify acc_esignatures.user_id references the users table.',
        'Verify acc_queries foreign keys reference study, subject, and user tables.',
        'Document all foreign key constraints found.',
      ],
      expectedResult: 'All expected foreign key constraints are present and enforced.',
      evidence: 'See evidence/iq/IQ-017.json',
    },
    {
      id: 'IQ-018',
      title: 'All required indexes present',
      requirement: 'Performance-critical and query-critical indexes exist on acc_* tables',
      cfr: 'N/A',
      steps: [
        'Query pg_indexes for all acc_* tables.',
        'Verify index on acc_audit_log(entity_type, entity_id) for audit trail lookups.',
        'Verify index on acc_audit_log(user_id) for user-based audit queries.',
        'Verify index on acc_audit_log(created_at) for chronological audit trail.',
        'Verify index on acc_queries(study_id, status) for query management.',
        'Document all indexes found.',
      ],
      expectedResult: 'All performance-critical indexes are present on acc_* tables.',
      evidence: 'See evidence/iq/IQ-018.json',
    },
  ];
}

function configurationCases(): IqTestCase[] {
  return [
    {
      id: 'IQ-019',
      title: 'HTTPS/TLS configured for production',
      requirement: 'All production traffic is encrypted via HTTPS/TLS',
      cfr: '§11.10(c) — Protection of records; HIPAA §164.312(e)(1)',
      steps: [
        `Attempt HTTP connection to ${SYSTEM_INFO.environments.production.apiUrl.replace('https', 'http')}.`,
        'Verify HTTP redirects to HTTPS or is refused.',
        `Connect via HTTPS to ${SYSTEM_INFO.environments.production.apiUrl}.`,
        'Verify TLS certificate is valid and not expired.',
        'Verify TLS version is 1.2 or higher.',
      ],
      expectedResult: 'Production endpoints enforce HTTPS with valid TLS 1.2+ certificates.',
      evidence: 'See evidence/iq/IQ-019.json',
    },
    {
      id: 'IQ-020',
      title: 'JWT secret configured (not default)',
      requirement: 'JWT signing secret is set to a strong, non-default value',
      cfr: '§11.10(d) — Authority checks',
      steps: [
        'Verify JWT_SECRET environment variable is set on the production server.',
        'Verify the value is NOT a default/placeholder (e.g., not "secret", "changeme", "jwt-secret").',
        'Verify the secret length is at least 32 characters.',
        'Note: Do NOT record the actual secret value in evidence.',
      ],
      expectedResult: 'JWT_SECRET is set to a strong, non-default value of at least 32 characters.',
      evidence: 'See evidence/iq/IQ-020.json',
    },
    {
      id: 'IQ-021',
      title: 'Rate limiting enabled',
      requirement: 'API rate limiting is active to prevent abuse and denial-of-service',
      cfr: '§11.10(a) — Validation',
      steps: [
        'Send 100+ rapid sequential requests to a rate-limited endpoint.',
        'Verify that HTTP 429 (Too Many Requests) is returned after the threshold.',
        'Verify the response includes Retry-After or rate limit headers.',
      ],
      expectedResult: 'API returns HTTP 429 when rate limit is exceeded.',
      evidence: 'See evidence/iq/IQ-021.json',
    },
    {
      id: 'IQ-022',
      title: 'CORS properly configured',
      requirement: 'Cross-Origin Resource Sharing only permits authorized origins',
      cfr: '§11.10(d) — Authority checks',
      steps: [
        'Send an OPTIONS preflight request with Origin: https://malicious-site.com.',
        'Verify the response does NOT include Access-Control-Allow-Origin for the malicious origin.',
        `Send an OPTIONS preflight request with Origin: ${SYSTEM_INFO.environments.production.frontendUrl}.`,
        'Verify the response includes the correct Access-Control-Allow-Origin header.',
      ],
      expectedResult: 'CORS only allows the authorized frontend origin, rejecting unknown origins.',
      evidence: 'See evidence/iq/IQ-022.json',
    },
    {
      id: 'IQ-023',
      title: 'Environment variables set (DATABASE_URL, JWT_SECRET, etc.)',
      requirement: 'All required environment variables are configured for production operation',
      cfr: '§11.10(a) — Validation',
      steps: [
        'Verify DATABASE_URL is set and points to the production database.',
        'Verify JWT_SECRET is set (existence only — do not log the value).',
        'Verify NODE_ENV is set to "production".',
        'Verify PORT is set.',
        'Check for any additional required variables documented in .env.example.',
      ],
      expectedResult: 'All required environment variables are present with appropriate values.',
      evidence: 'See evidence/iq/IQ-023.json',
    },
    {
      id: 'IQ-024',
      title: 'Logging enabled and writing to output',
      requirement: 'Application logging is active and persisting log entries',
      cfr: '§11.10(e) — Audit trails',
      steps: [
        'Trigger a request to the API (e.g., GET /health).',
        'Verify that a log entry is generated (check Docker logs or log output).',
        'Verify log entries include timestamp, request method, path, and status code.',
      ],
      expectedResult: 'Application produces structured log output for HTTP requests.',
      evidence: 'See evidence/iq/IQ-024.json',
    },
    {
      id: 'IQ-025',
      title: 'Error handling middleware active',
      requirement: 'Global error handler catches unhandled errors and returns structured responses',
      cfr: '§11.10(a) — Validation',
      steps: [
        'Send a request to a non-existent endpoint (e.g., GET /api/nonexistent).',
        'Verify the response is structured JSON with an error field (not an HTML stack trace).',
        'Verify the response status is 404.',
        'Send a malformed POST body to a validated endpoint.',
        'Verify the response is a structured validation error (400).',
      ],
      expectedResult: 'Error middleware returns structured JSON errors, never raw stack traces.',
      evidence: 'See evidence/iq/IQ-025.json',
    },
  ];
}

function securityBackupCases(): IqTestCase[] {
  return [
    {
      id: 'IQ-026',
      title: 'Backup service configured',
      requirement: 'Automated backup service is configured and capable of executing backups',
      cfr: 'HIPAA §164.308(a)(7) — Contingency plan',
      steps: [
        'Verify the backup service module exists and is loaded at startup.',
        'Verify backup configuration (destination, format) is set via environment variables.',
        'Trigger a manual test backup or verify last successful backup timestamp.',
      ],
      expectedResult: 'Backup service is configured and operational.',
      evidence: 'See evidence/iq/IQ-026.json',
    },
    {
      id: 'IQ-027',
      title: 'AES-256 encryption configured for backups',
      requirement: 'Backup encryption uses AES-256 as required by HIPAA and system specification',
      cfr: 'HIPAA §164.312(a)(2)(iv) — Encryption',
      steps: [
        'Verify backup encryption configuration specifies AES-256.',
        'Verify encryption key management is in place (key exists, key rotation configured).',
        'Verify a test backup file is encrypted (cannot be read as plaintext).',
      ],
      expectedResult: 'Backups are encrypted with AES-256 and keys are managed securely.',
      evidence: 'See evidence/iq/IQ-027.json',
    },
    {
      id: 'IQ-028',
      title: 'Backup schedule configured',
      requirement: 'Automated backup schedule is defined and active',
      cfr: 'HIPAA §164.308(a)(7) — Contingency plan',
      steps: [
        'Verify backup scheduler configuration exists.',
        'Verify the schedule interval (e.g., daily, every 6 hours).',
        'Verify the retention policy is defined (how many backups retained).',
      ],
      expectedResult: 'Backup schedule is configured with defined interval and retention policy.',
      evidence: 'See evidence/iq/IQ-028.json',
    },
    {
      id: 'IQ-029',
      title: 'Environment segregation verified',
      requirement: 'Development, staging, and production environments use different URLs and databases',
      cfr: '§11.10(a) — Validation',
      steps: [
        `Verify production API URL: ${SYSTEM_INFO.environments.production.apiUrl}`,
        `Verify staging API URL: ${SYSTEM_INFO.environments.staging.apiUrl}`,
        `Verify development API URL: ${SYSTEM_INFO.environments.development.apiUrl}`,
        'Confirm all three URLs are distinct.',
        'Confirm database hosts differ between environments.',
      ],
      expectedResult: 'All three environments have distinct URLs and database configurations.',
      evidence: 'See evidence/iq/IQ-029.json',
    },
    {
      id: 'IQ-030',
      title: 'System timezone configured (UTC)',
      requirement: 'Server and database operate in UTC to ensure consistent audit timestamps',
      cfr: '§11.10(e) — Audit trails (timestamp accuracy)',
      steps: [
        'Query the database for SHOW timezone or SELECT current_setting(\'timezone\').',
        'Verify the timezone is UTC.',
        'Check server system clock alignment with NTP.',
        'Verify application-generated timestamps are in ISO 8601 UTC format.',
      ],
      expectedResult: 'Database and server are configured to UTC timezone.',
      evidence: 'See evidence/iq/IQ-030.json',
    },
    {
      id: 'IQ-031',
      title: 'Production access requires authentication',
      requirement: 'All data-access API endpoints require valid authentication',
      cfr: '§11.10(d) — Authority checks',
      steps: [
        'Send GET request to /api/studies without an Authorization header.',
        'Verify response is HTTP 401 (Unauthorized).',
        'Send GET request to /api/subjects without an Authorization header.',
        'Verify response is HTTP 401 (Unauthorized).',
        'Send GET request to /api/audit without an Authorization header.',
        'Verify response is HTTP 401 (Unauthorized).',
      ],
      expectedResult: 'All protected endpoints return HTTP 401 without a valid JWT token.',
      evidence: 'See evidence/iq/IQ-031.json',
    },
    {
      id: 'IQ-032',
      title: 'Admin accounts require strong passwords',
      requirement: 'Password policy enforces minimum complexity for all accounts',
      cfr: '§11.10(d) — Authority checks; HIPAA §164.312(d)',
      steps: [
        'Attempt to create/update a user with a short password (< 8 chars).',
        'Verify the request is rejected with a password policy error.',
        'Attempt to create/update a user with a weak password (e.g., "password123").',
        'Verify the request is rejected or flagged.',
        'Create a user with a strong password (12+ chars, mixed case, numbers, symbols).',
        'Verify the request succeeds.',
      ],
      expectedResult: 'System enforces minimum password complexity; weak passwords are rejected.',
      evidence: 'See evidence/iq/IQ-032.json',
    },
  ];
}

export function generate(outputDir: string, _workspaceRoot: string): void {
  const allCases: IqTestCase[][] = [
    softwareInstallationCases(),
    databaseInstallationCases(),
    configurationCases(),
    securityBackupCases(),
  ];

  const sectionTitles = [
    'Software Installation Verification',
    'Database Installation Verification',
    'Configuration Verification',
    'Security & Backup Verification',
  ];

  const tocEntries: SectionEntry[] = [
    { level: 1, title: 'Purpose' },
    { level: 1, title: 'Scope' },
    { level: 1, title: 'Test Summary' },
  ];
  for (const title of sectionTitles) {
    tocEntries.push({ level: 1, title });
  }
  tocEntries.push({ level: 1, title: 'Summary & Disposition' });
  tocEntries.push({ level: 1, title: 'Approval Signatures' });

  let content = '';

  content += documentHeader({
    title: 'Installation Qualification Protocol (IQ)',
    documentId: DOC_ID,
    version: '1.0',
    date: new Date().toISOString().split('T')[0],
    system: SYSTEM_INFO.fullName,
    classification: 'Regulatory — 21 CFR Part 11 Validation',
  });

  content += tableOfContents(tocEntries);
  content += hr();

  content += section(2, 'Purpose');
  content += 'This Installation Qualification (IQ) protocol verifies that the ' +
    `${SYSTEM_INFO.fullName} v${SYSTEM_INFO.version} ` +
    'has been installed correctly and that all software components, database structures, ' +
    'configurations, and infrastructure meet the documented specifications.\n\n';
  content += 'IQ establishes documented evidence that the system is installed per the approved ' +
    'design specification and manufacturer recommendations.\n\n';

  content += section(2, 'Scope');
  content += 'This protocol covers:\n\n';
  content += '- Software component installation (frontend, backend, shared libraries)\n';
  content += '- Database schema verification (all acc_* extension tables)\n';
  content += '- System configuration (security, environment, networking)\n';
  content += '- Infrastructure readiness (backups, encryption, timezone)\n\n';
  content += `**Applicable regulations:** ${REGULATORY_SCOPE.part11Applicable ? '21 CFR Part 11' : ''} ` +
    `${REGULATORY_SCOPE.hipaaApplicable ? ', HIPAA Security Rule' : ''}\n\n`;

  content += section(2, 'Test Summary');
  const flatCases = allCases.flat();
  content += markdownTable(
    ['Section', 'Test Cases', 'IDs'],
    sectionTitles.map((title, i) => {
      const cases = allCases[i];
      return [title, String(cases.length), `${cases[0].id} – ${cases[cases.length - 1].id}`];
    }),
  );
  content += `\n**Total test cases:** ${flatCases.length}\n\n`;
  content += hr();

  for (let i = 0; i < sectionTitles.length; i++) {
    content += section(2, sectionTitles[i]);
    for (const tc of allCases[i]) {
      const opts: TestCaseOptions = {
        id: tc.id,
        title: tc.title,
        requirement: tc.requirement,
        cfr: tc.cfr,
        steps: tc.steps,
        expectedResult: tc.expectedResult,
        evidence: tc.evidence,
      };
      content += testCaseBlock(opts);
    }
    content += hr();
  }

  content += section(2, 'Summary & Disposition');
  content += markdownTable(
    ['Metric', 'Value'],
    [
      ['Total Test Cases', String(flatCases.length)],
      ['Passed', '[To be completed after execution]'],
      ['Failed', '[To be completed after execution]'],
      ['Not Tested', '[To be completed after execution]'],
      ['Overall Disposition', '[APPROVED / APPROVED WITH DEVIATIONS / REJECTED]'],
    ],
  );
  content += '\n**Deviations (if any):**\n\n[Document any deviations from expected results and their disposition]\n\n';

  content += approvalBlock([
    'QA Manager',
    'System Administrator',
    'Validation Lead',
    'IT Director',
  ]);

  const meta = getDocumentMeta(outputDir);
  content = stampDocument(content, meta);

  fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, '07-iq-protocol.md');
  fs.writeFileSync(outPath, content, 'utf-8');
}
