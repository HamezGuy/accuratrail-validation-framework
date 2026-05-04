import * as fs from 'fs';
import * as path from 'path';
import { SYSTEM_INFO } from '../config/system-info';
import {
  documentHeader,
  markdownTable,
  section,
  approvalBlock,
  tableOfContents,
  hr,
} from './helpers/markdown-writer';

const DOC_DATE = new Date().toISOString().split('T')[0];
const DOC_YEAR = new Date().getFullYear();

type FRS = [string, string, string, string, string];

interface RouteData {
  file: string;
  method: string;
  path: string;
  middlewares: string[];
  controllerRef: string;
}

let routes: Array<{
  file: string;
  method: string;
  path: string;
  middlewares: string[];
  controllerRef: string;
}> = [];

function loadRoutes(workspaceRoot: string): RouteData[] {
  try {
    routes = require('../collectors/route-collector').collectRoutes(workspaceRoot);
    return routes as RouteData[];
  } catch {
    return [];
  }
}

function authFrs(): FRS[] {
  return [
    ['FRS-001', 'URS-001', 'System shall authenticate users via username + password before granting access to any system function', 'auth.routes.ts POST /api/auth/login → auth.controller.ts → auth.service.ts; auth.middleware.ts JWT verification on all protected routes', 'OQ-001'],
    ['FRS-002', 'URS-002', 'Each user account shall have a unique username enforced at the database level', 'acc_users table UNIQUE constraint on username column; auth.service.ts rejects duplicate at registration', 'OQ-002'],
    ['FRS-003', 'URS-003', 'Passwords shall require minimum 8 characters including uppercase, lowercase, number, and special character', 'auth.service.ts validatePassword() function; Joi schema validation in auth.routes.ts', 'OQ-004'],
    ['FRS-004', 'URS-004', 'Sessions shall expire after a configurable idle timeout period', 'auth.middleware.ts JWT expiration check; frontend idle-timeout.service.ts triggers forced logout; timeout configurable via environment variable', 'OQ-005'],
    ['FRS-005', 'URS-005', 'Device fingerprinting shall track and verify login devices per session', 'auth.service.ts deviceFingerprint generation; auth.middleware.ts compares fingerprint header against stored session fingerprint', 'OQ-007'],
    ['FRS-006', 'URS-006', 'System shall enforce 6 predefined roles with 42 granular permissions checked on every protected endpoint', 'authorization.middleware.ts authorize([roles]); permission.service.ts granular permission checks; acc_user_roles and acc_permissions tables', 'OQ-011 to OQ-016'],
    ['FRS-007', 'URS-007', 'Role-based access checks shall execute on every protected API endpoint before handler execution', 'authorization.middleware.ts authorize() applied to all route files; middleware order: auth → authorization → validation → handler', 'OQ-017'],
    ['FRS-008', 'URS-008', 'JWT tokens shall be issued with configurable expiration and signed with a strong secret', 'auth.service.ts generateToken() with configurable JWT_EXPIRATION env var; minimum 32-character JWT_SECRET', 'OQ-005'],
    ['FRS-009', 'URS-009', 'Rate limiting shall be enforced on authentication endpoints to prevent brute-force attacks', 'rateLimiter.middleware.ts applied to POST /api/auth/login and POST /api/auth/register; configurable window and max attempts', 'OQ-009'],
    ['FRS-010', 'URS-010', 'Account shall be locked after a configurable number of consecutive failed login attempts', 'auth.service.ts tracks failed_login_count in acc_users; locks account at threshold; requires admin unlock', 'OQ-009'],
    ['FRS-011', 'URS-011', 'User provisioning shall support creation with role assignment, study assignment, and site assignment', 'POST /api/users → user.controller.ts → user.service.ts; admin role required; acc_user_roles and acc_study_users tables', 'OQ-018'],
    ['FRS-012', 'URS-012', 'User deactivation shall set is_active=false without deleting any records or audit trail entries', 'PUT /api/users/:id/deactivate → user.service.ts; login check rejects inactive users; all historical data preserved', 'OQ-019'],
    ['FRS-013', 'URS-013', 'Password expiration shall be enforced after a configurable period requiring password change', 'auth.service.ts checks password_changed_at against expiration policy; forces password change flow on expired passwords', 'OQ-020'],
    ['FRS-014', 'URS-014', 'Password history shall prevent reuse of the last N passwords', 'auth.service.ts stores hashed passwords in acc_password_history; rejects matches against configurable history depth', 'OQ-020'],
    ['FRS-015', 'URS-015', 'Concurrent session prevention shall invalidate prior session tokens on new login', 'auth.service.ts invalidates prior session token on new login; single active session per user enforced', 'OQ-021'],
    ['FRS-016', 'URS-015', 'Periodic user access review report shall be available to administrators', 'GET /api/users/access-report → user.controller.ts; returns all users with roles, studies, last login, status', 'OQ-022'],
    ['FRS-017', 'URS-015', 'All administrative actions (user creation, role changes, deactivation) shall be audit-logged', 'audit.middleware.ts intercepts all /api/users mutations; logs to acc_audit_log with admin userId, action, old/new values', 'OQ-022'],
    ['FRS-018', 'URS-015', 'Login attempt logging shall record username, IP address, timestamp, and success/failure for every attempt', 'auth.service.ts logs to acc_login_audit (immutable insert-only table); both successful and failed attempts recorded', 'OQ-022'],
  ];
}

function auditFrs(): FRS[] {
  return [
    ['FRS-019', 'URS-016', 'Audit middleware shall automatically log all data mutations (POST/PUT/PATCH/DELETE) on protected endpoints', 'audit.middleware.ts wraps all mutation routes; inserts to acc_audit_log with userId, action, entity, timestamp', 'OQ-023'],
    ['FRS-020', 'URS-017', 'Each audit entry shall include userId, userName, role, entity type, entity ID, and IP address', 'audit.service.ts createAuditEntry() populates all identity fields from AuthRequest context; acc_audit_log schema enforces NOT NULL', 'OQ-025'],
    ['FRS-021', 'URS-018', 'Audit entry timestamps shall be server-generated UTC in ISO 8601 format', 'acc_audit_log.created_at DEFAULT NOW(); audit.service.ts never accepts client-supplied timestamps; stored as TIMESTAMPTZ', 'OQ-028'],
    ['FRS-022', 'URS-019', 'Audit entries shall capture old value and new value as structured JSONB for every field change', 'audit.middleware.ts performs before/after diff; stores old_values and new_values as JSONB in acc_audit_log', 'OQ-024'],
    ['FRS-023', 'URS-020', 'Audit entries shall include action type classification (CREATE, UPDATE, DELETE, READ, SIGN)', 'audit.service.ts maps HTTP method to action type; stored in acc_audit_log.action column', 'OQ-027'],
    ['FRS-024', 'URS-021', 'Reason for change shall be captured and stored for all clinical data corrections', 'Form data PUT endpoint requires reason field in request body; stored in acc_audit_log.reason column; rejected if missing', 'OQ-029'],
    ['FRS-025', 'URS-022', 'No API endpoint shall permit UPDATE or DELETE operations on audit trail records', 'audit.routes.ts exposes only GET endpoints; no PUT/PATCH/DELETE handlers; database REVOKE UPDATE/DELETE on acc_audit_log', 'OQ-031'],
    ['FRS-026', 'URS-023', 'Audit trail shall be exportable via API in PDF and CSV formats', 'GET /api/audit/export?format=pdf|csv → audit.controller.ts → export.service.ts; content matches database records', 'OQ-032'],
    ['FRS-027', 'URS-024', 'Audit entries shall persist independently of the records they audit — record deletion shall not cascade to audit entries', 'Soft-delete pattern: records set is_deleted=true; acc_audit_log references entity_id without FK CASCADE DELETE', 'OQ-030'],
    ['FRS-028', 'URS-025', 'Sequential audit entry IDs shall enable gap detection for audit trail integrity verification', 'acc_audit_log.id BIGSERIAL monotonically increasing; gap detection via sequence check utility', 'OQ-030'],
    ['FRS-029', 'URS-026', 'ePHI access (read operations) shall generate audit entries for HIPAA compliance', 'audit.middleware.ts logs GET requests to ePHI endpoints (/api/subjects/*, /api/forms/data/*)', 'OQ-032'],
    ['FRS-030', 'URS-027', 'Configuration changes shall be audit-logged with old and new configuration values', 'audit.middleware.ts covers /api/studies/*, /api/validation-rules/*; all config endpoints audited with value diff', 'OQ-032'],
    ['FRS-031', 'URS-028', 'Audit writes shall be atomic with data writes via database transactions', 'pool.transaction() wraps data mutation + audit insert; ROLLBACK on either failure; no partial writes possible', 'OQ-030'],
    ['FRS-032', 'URS-028', 'Audit trail search and filtering shall support queries by subject, form, user, date range, and action type', 'GET /api/audit?subjectId=&formId=&userId=&dateFrom=&dateTo=&action= → audit.controller.ts with validated query params', 'OQ-032'],
  ];
}

function esigFrs(): FRS[] {
  return [
    ['FRS-033', 'URS-029', 'Electronic signature creation shall require fresh re-authentication (username + password) at time of signing', 'POST /api/signatures → esignature.service.ts; verifyPassword() called before signature creation; part11.middleware.ts enforces', 'OQ-033'],
    ['FRS-034', 'URS-030', 'Each signature shall include the printed full name of the signer extracted from the user profile', 'acc_esignatures.signer_name populated from acc_users.full_name; displayed in UI and PDF exports', 'OQ-034'],
    ['FRS-035', 'URS-031', 'Each signature shall include the date and time of signing in UTC', 'acc_esignatures.signed_at TIMESTAMPTZ DEFAULT NOW(); stored and displayed in ISO 8601 UTC format', 'OQ-034'],
    ['FRS-036', 'URS-032', 'Each signature shall include the meaning/purpose selected from a configurable list', 'acc_esignatures.meaning column; configurable meanings per study via acc_signature_meanings table', 'OQ-035'],
    ['FRS-037', 'URS-033', 'Signature manifestations (name, date, meaning) shall be included in all human-readable exports', 'pdf.service.ts renders all signature components on exported signed records; verified against display', 'OQ-034'],
    ['FRS-038', 'URS-034', 'Cryptographic SHA-256 hash shall link each signature to the exact record version signed', 'esignature.service.ts computes SHA-256 hash of record content; stores in acc_esignatures.record_hash', 'OQ-037'],
    ['FRS-039', 'URS-035', 'Record modification after signing shall automatically invalidate the signature and require re-signing', 'Data mutation checks for active signature; voids signature if record changed; audit logs invalidation event', 'OQ-037'],
    ['FRS-040', 'URS-036', 'Signature non-repudiation shall be ensured via authenticated identity + record hash + server timestamp', 'Combination of userId, fresh password verification, SHA-256 record hash, and server-generated timestamp', 'OQ-038'],
    ['FRS-041', 'URS-037', 'All signing events including failed attempts shall be logged in the audit trail', 'esignature.service.ts logs all sign attempts (success/fail) to acc_audit_log with action=SIGN', 'OQ-038'],
    ['FRS-042', 'URS-038', 'Signature meanings shall be configurable per workflow context by study administrators', 'acc_signature_meanings table; admin-configurable per study/form; selectable at signing time', 'OQ-035'],
    ['FRS-043', 'URS-039', 'Identity verification shall require fresh credential entry per signing event — cached credentials not accepted', 'esignature.service.ts does not accept cached/session credentials; explicit password input required for each signing', 'OQ-033'],
    ['FRS-044', 'URS-039', 'Each electronic signature shall be unique to one individual and not reusable or reassignable', 'Signature record bound to authenticated userId; no transfer or reassignment API exists', 'OQ-033'],
    ['FRS-045', 'URS-040', 'Signing event audit log shall distinguish between successful signatures, failed authentication, and invalidations', 'audit.service.ts logs SIGN_SUCCESS, SIGN_FAILED, SIGN_INVALIDATED action types with full context', 'OQ-038'],
    ['FRS-046', 'URS-040', 'Post-signature record access shall display signature status (valid/invalidated) alongside the record', 'Form rendering includes signature status check via esignature.service.ts; UI displays badge for valid/invalid', 'OQ-036'],
  ];
}

function dataFrs(): FRS[] {
  return [
    ['FRS-047', 'URS-041', 'eCRF rendering shall support all field types with field-level data entry and real-time validation', 'GET/POST /api/forms/data/* → form.controller.ts → form.service.ts; validation-rules.service.ts fires on save', 'OQ-043'],
    ['FRS-048', 'URS-042', 'Configurable validation rules engine shall support range, pattern, cross-field, required, and custom rule types', 'POST /api/validation-rules → validation-rules.service.ts; rule configuration stored in acc_validation_rules table', 'OQ-043'],
    ['FRS-049', 'URS-043', 'Data corrections shall preserve old values in the audit trail with mandatory reason for change', 'PUT /api/forms/data/:id → audit.middleware.ts captures old value before overwrite; reason field required in request', 'OQ-044'],
    ['FRS-050', 'URS-044', 'Multi-format data export shall support PDF, CSV, XML, and CDISC ODM formats', 'GET /api/export/* → export.service.ts; format param selects renderer; pdf.service.ts for PDF generation', 'OQ-045'],
    ['FRS-051', 'URS-045', 'Record retention shall maintain data integrity for the full regulatory retention period without degradation', 'PostgreSQL with WAL archiving; AES-256 encrypted backups; no auto-purge on regulated tables; ≥15 year retention', 'PQ-007'],
    ['FRS-052', 'URS-046', 'Automated backup shall use AES-256-GCM encryption with configurable schedule and retention policy', 'backup.service.ts → encryption.service.ts (AES-256-GCM); backup-scheduler.service.ts; retention-manager.service.ts', 'IQ-027'],
    ['FRS-053', 'URS-047', 'Full restore from backup shall include integrity verification with checksum comparison', 'backup.service.ts restore(); compares checksums post-restore; reports discrepancies; atomic operation', 'OQ-046'],
    ['FRS-054', 'URS-048', 'Skip/branching logic engine shall control field visibility based on data entry conditions', 'Form skip logic evaluated client-side (form.service.ts) and server-side (validation-rules.service.ts)', 'OQ-047'],
    ['FRS-055', 'URS-049', 'Calculated field derivation shall automatically compute values from source fields with audit trail', 'Calculation engine in form.service.ts evaluates formulas; derived results stored with calculation audit entry', 'OQ-048'],
    ['FRS-056', 'URS-050', 'Double Data Entry shall compare entries field-by-field and flag discrepancies for resolution', 'DDE mode in form.service.ts; second entry compared against first; mismatches flagged for reviewer resolution', 'OQ-049'],
    ['FRS-057', 'URS-051', 'Accurate record copies shall be generated matching screen display in human-readable and electronic forms', 'export.service.ts generates exact copies; PDF matches screen display; CSV/XML contains all field data', 'OQ-045'],
    ['FRS-058', 'URS-052', 'Record protection shall prevent unauthorized modification through access controls and data locks', 'authorization.middleware.ts + data-locks.service.ts; locked records reject all modification attempts', 'OQ-050'],
    ['FRS-059', 'URS-053', 'Operational sequence enforcement shall prevent out-of-order data entry where workflow requires it', 'workflow.service.ts enforces form prerequisites; gated forms require prior form completion before entry', 'OQ-050'],
    ['FRS-060', 'URS-054', 'Data type validation shall reject type-mismatched input at point of entry', 'Joi schemas in route files validate field types; form.service.ts enforces type constraints on all fields', 'OQ-043'],
    ['FRS-061', 'URS-055', 'Required field enforcement shall prevent form completion with missing mandatory data', 'validation-rules.service.ts marks form incomplete if required fields empty; UI highlights missing fields', 'OQ-043'],
    ['FRS-062', 'URS-055', 'Auto-query generation shall create data queries automatically when validation rules fire', 'validation-rules.service.ts triggers query creation via query.service.ts when rule violations detected', 'OQ-044'],
  ];
}

function workflowFrs(): FRS[] {
  return [
    ['FRS-063', 'URS-056', 'Study setup API shall support protocol configuration, visit schedule, CRF assignment, and site activation', 'POST /api/studies → study.controller.ts → study.service.ts; visit/CRF config via sub-endpoints', 'OQ-051'],
    ['FRS-064', 'URS-057', 'Subject enrollment shall generate unique subject IDs with site-scoped duplicate prevention', 'POST /api/subjects → subject.controller.ts → subject.service.ts; unique constraint on study+label', 'OQ-052'],
    ['FRS-065', 'URS-058', 'Visit management shall support scheduled and unscheduled visits with status tracking', 'GET/POST /api/events → event.controller.ts → event.service.ts; visit schedule from study config', 'OQ-053'],
    ['FRS-066', 'URS-059', 'Query lifecycle shall support creation, assignment, response, resolution, escalation, and bulk operations', 'POST/PUT /api/queries → query.controller.ts → query.service.ts (CRUD, mutations, stats, bulk, recipients)', 'OQ-054'],
    ['FRS-067', 'URS-060', 'Casebook freeze (soft lock) shall prevent data edits while allowing query workflow to continue', 'POST /api/data-locks/freeze → data-locks.service.ts; sets freeze status; rejects data edits; permits queries', 'OQ-055'],
    ['FRS-068', 'URS-061', 'Casebook lock (hard lock) shall prevent all modifications and require e-signature for unlock', 'POST /api/data-locks/lock → data-locks.service.ts; requires e-signature; rejects all modifications', 'OQ-056'],
    ['FRS-069', 'URS-062', 'Source Data Verification workflow shall support field-level and form-level verification by monitors', 'POST /api/sdv → sdv.service.ts; field/form-level verification status tracked per monitor', 'OQ-057'],
    ['FRS-070', 'URS-063', 'Randomization engine shall produce blinded assignments from sealed allocation lists with audit trail', 'POST /api/randomization → randomization-engine.service.ts; allocation list sealed; assignment audit-logged', 'OQ-058'],
    ['FRS-071', 'URS-064', 'Review/approval workflows shall support configurable review chains with e-signature requirements', 'workflow.service.ts; configurable review chains per form/study; approval requires e-signature', 'OQ-059'],
    ['FRS-072', 'URS-065', 'Study-level database lock shall prevent all study data modifications with e-signature requirement', 'POST /api/data-locks/study-lock → data-locks.service.ts; requires e-signature; global study lock', 'OQ-060'],
    ['FRS-073', 'URS-066', 'Overdue tracking shall flag overdue visits and forms on dashboards with configurable notifications', 'dashboard.service.ts computes overdue items; notification.service.ts sends alerts to assigned users', 'OQ-061'],
    ['FRS-074', 'URS-067', 'Task management shall support creation, assignment, status tracking, and filtering', 'POST/GET /api/tasks → tasks.service.ts; assignment, status tracking, filtering by type/assignee/status', 'OQ-062'],
    ['FRS-075', 'URS-068', 'Medical coding shall support dictionary lookup for adverse events and concomitant medications', 'Coding endpoints in form.service.ts; dictionary lookup stores coded value alongside verbatim text', 'OQ-063'],
    ['FRS-076', 'URS-068', 'Import/export functionality shall support bulk data operations with validation and audit trail', 'Import routes → import.service.ts; validates each record; creates audit entries; supports rollback on failure', 'OQ-064'],
  ];
}

function hipaaFrs(): FRS[] {
  return [
    ['FRS-077', 'URS-069', 'All ePHI at rest shall be encrypted using AES-256 or equivalent', 'PostgreSQL volume-level encryption; backup.service.ts AES-256-GCM for all backup files', 'IQ-027'],
    ['FRS-078', 'URS-070', 'All ePHI in transit shall be encrypted using TLS 1.2 or higher', 'HTTPS enforced on all endpoints; TLS certificates managed via infrastructure; HSTS header set', 'IQ-019'],
    ['FRS-079', 'URS-071', 'Unique user identification shall be enforced for all ePHI access — no shared accounts', 'auth.middleware.ts + auth.service.ts; every request authenticated with individual JWT; no anonymous access', 'OQ-001'],
    ['FRS-080', 'URS-072', 'Automatic logoff shall terminate sessions after configurable idle timeout', 'Frontend idle-timeout.service.ts + backend JWT expiration; configurable timeout period via environment', 'OQ-005'],
    ['FRS-081', 'URS-073', 'All ePHI access (read and write) shall be recorded in audit controls', 'audit.middleware.ts logs all ePHI endpoint access; acc_audit_log stores user, timestamp, record, action', 'OQ-023'],
    ['FRS-082', 'URS-074', 'Data integrity controls shall include validation rules, checksums on export, and immutable audit trail', 'validation-rules.service.ts, export checksums, audit trail immutability, database constraints', 'OQ-043'],
    ['FRS-083', 'URS-075', 'Authentication shall be required for all ePHI endpoints with no anonymous access permitted', 'auth.middleware.ts applied to all routes; JWT required; unauthenticated requests receive 401', 'OQ-001'],
    ['FRS-084', 'URS-076', 'Minimum necessary access controls shall restrict ePHI access to the least privilege required', 'RBAC roles restrict access to minimum needed; study-scoped and site-scoped data filtering', 'OQ-011'],
    ['FRS-085', 'URS-077', 'Breach detection mechanisms shall monitor for anomalous access patterns with notification workflow', 'Anomaly detection in audit logs; notification.service.ts for breach alerts; documented SOP procedures', 'PQ-020'],
    ['FRS-086', 'URS-078', 'Contingency planning shall include automated backups, disaster recovery procedures, and emergency mode', 'backup-scheduler.service.ts, retention-manager.service.ts; DR procedures documented; emergency mode SOP', 'PQ-021'],
  ];
}

export function generate(outputDir: string, workspaceRoot: string): void {
  const discoveredRoutes = loadRoutes(workspaceRoot);
  const routeNote =
    discoveredRoutes.length > 0
      ? `(${discoveredRoutes.length} routes discovered from codebase analysis)`
      : '(Route collector unavailable — using known implementation paths from architecture documentation)';

  const allFrs = [
    ...authFrs(),
    ...auditFrs(),
    ...esigFrs(),
    ...dataFrs(),
    ...workflowFrs(),
    ...hipaaFrs(),
  ];

  let content = '';

  content += documentHeader({
    title: 'Functional Requirements Specification (FRS)',
    documentId: `FRS-${DOC_YEAR}-001`,
    version: '1.0',
    date: DOC_DATE,
    system: SYSTEM_INFO.fullName,
    classification: 'Confidential — Regulatory',
  });

  content += tableOfContents([
    { level: 1, title: 'Purpose' },
    { level: 1, title: 'Methodology' },
    { level: 1, title: 'Authentication & Access Control (FRS-001 to FRS-018)' },
    { level: 1, title: 'Audit Trail (FRS-019 to FRS-032)' },
    { level: 1, title: 'Electronic Signatures (FRS-033 to FRS-046)' },
    { level: 1, title: 'Data Entry & Integrity (FRS-047 to FRS-062)' },
    { level: 1, title: 'Clinical Workflows (FRS-063 to FRS-076)' },
    { level: 1, title: 'HIPAA Safeguards (FRS-077 to FRS-086)' },
    { level: 1, title: 'Requirements Summary' },
    { level: 1, title: 'Approval Signatures' },
  ]) + '\n';
  content += hr();

  content += section(2, 'Purpose');
  content += `This Functional Requirements Specification (FRS) maps each User Requirement from the URS to specific, `;
  content += `verifiable system functions implemented in **${SYSTEM_INFO.fullName}** (v${SYSTEM_INFO.version}). `;
  content += `Each FRS entry identifies the actual software component (route, controller, service, middleware, or database object) `;
  content += `that fulfills the requirement, enabling traceability from regulation → user need → system function → test case.\n\n`;
  content += hr();

  content += section(2, 'Methodology');
  content += 'Each functional requirement in this document:\n\n';
  content += '1. **Links to a URS entry** — the user requirement it satisfies\n';
  content += '2. **Describes the system function** — what the system does to fulfill the requirement\n';
  content += '3. **References the implementation** — specific source files, routes, services, middleware, and database objects\n';
  content += '4. **Identifies the verification method** — the OQ/IQ/PQ test case(s) that verify correct implementation\n\n';
  content += `${routeNote}\n\n`;
  content += 'The FRS entries are organized by functional domain to align with the URS structure and regulatory sections.\n\n';
  content += hr();

  const categories: [string, FRS[]][] = [
    ['Authentication & Access Control (FRS-001 to FRS-018)', authFrs()],
    ['Audit Trail (FRS-019 to FRS-032)', auditFrs()],
    ['Electronic Signatures (FRS-033 to FRS-046)', esigFrs()],
    ['Data Entry & Integrity (FRS-047 to FRS-062)', dataFrs()],
    ['Clinical Workflows (FRS-063 to FRS-076)', workflowFrs()],
    ['HIPAA Safeguards (FRS-077 to FRS-086)', hipaaFrs()],
  ];

  for (const [title, entries] of categories) {
    content += section(2, title);
    content += markdownTable(
      ['FRS ID', 'URS Ref', 'Functional Requirement', 'Implementation Reference', 'Verification Method'],
      entries,
    );
    content += '\n';
  }

  content += hr();
  content += section(2, 'Requirements Summary');
  content += `**Total Functional Requirements:** ${allFrs.length}\n\n`;
  content += markdownTable(
    ['Domain', 'FRS Range', 'Count'],
    categories.map(([t, e]) => {
      const ids = e.map((row) => row[0]);
      return [t.split(' (')[0], `${ids[0]} – ${ids[ids.length - 1]}`, String(e.length)];
    }),
  );
  content += '\n';

  content += markdownTable(
    ['Metric', 'Value'],
    [
      ['Total FRS Entries', String(allFrs.length)],
      ['URS Requirements Covered', String(new Set(allFrs.map((f) => f[1])).size)],
      ['Verification Methods Referenced', String(new Set(allFrs.map((f) => f[4])).size)],
    ],
  );
  content += '\n';
  content += hr();

  content += approvalBlock([
    'Quality Assurance Lead',
    'Lead Developer',
    'Project Manager',
    'Regulatory Affairs',
  ]);
  content += '\n---\n*End of Document*\n';

  fs.writeFileSync(path.join(outputDir, '04-functional-requirements-spec.md'), content);
}
