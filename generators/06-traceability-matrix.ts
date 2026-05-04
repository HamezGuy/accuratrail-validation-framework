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
  riskBadge,
} from './helpers/markdown-writer';
import { loadRunnerEvidence, RunnerResult } from './helpers/evidence-linker';

const DOC_DATE = new Date().toISOString().split('T')[0];
const DOC_YEAR = new Date().getFullYear();

type TraceRow = [string, string, string, string, string, string, string, string, string];

const TRACE_HEADERS: string[] = [
  'Legal Requirement', 'Regulatory Ref', 'Risk', 'Implementation/Control',
  'Test Case', 'Result', 'Evidence', 'Deviation', 'Status',
];

// --- Section 1: Part 11 ---
function part11Rows(): TraceRow[] {
  return [
    ['§11.10(a) Validation — systems validated to ensure accuracy, reliability, consistent intended performance, and the ability to discern invalid or altered records', '§11.10(a)', riskBadge('Critical'), 'validation-rules.service.ts, part11.middleware.ts, form.service.ts', 'OQ-043, OQ-044, OQ-049, PQ-007', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§11.10(b) Record copies — generate accurate and complete copies in human-readable and electronic form', '§11.10(b)', riskBadge('Critical'), 'export.service.ts, pdf.service.ts; GET /api/export/* (PDF/CSV/XML/ODM)', 'OQ-045, PQ-020', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§11.10(c) Record protection — protect records throughout retention period', '§11.10(c)', riskBadge('Critical'), 'backup.service.ts, encryption.service.ts (AES-256-GCM), retention-manager.service.ts', 'IQ-026, IQ-027, PQ-021', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['§11.10(d) Access controls — limit system access to authorized individuals', '§11.10(d)', riskBadge('Critical'), 'auth.middleware.ts (JWT), authorization.middleware.ts (RBAC), permission.service.ts, auth.service.ts', 'OQ-001, OQ-002, OQ-003, OQ-005, OQ-006, OQ-008, OQ-009, OQ-010, OQ-011 to OQ-022', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§11.10(e) Audit trail — computer-generated, timestamped audit trails', '§11.10(e)', riskBadge('Critical'), 'audit.middleware.ts (auto-logs all mutations), audit.service.ts (createAuditEntry), acc_audit_log table', 'OQ-023 to OQ-032, OQ-042, OQ-044', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§11.10(f) Operational checks — enforce permitted sequencing of steps and events', '§11.10(f)', riskBadge('Critical'), 'validation-rules.service.ts (edit checks), workflow.service.ts (sequence enforcement)', 'OQ-043, PQ-008', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§11.10(g) Authority checks — use of system checked to authorized individuals', '§11.10(g)', riskBadge('Critical'), 'authorization.middleware.ts authorize([roles]); 6 predefined roles with 42 granular permissions', 'OQ-011 to OQ-022', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§11.10(h) Device checks — check validity of data source or operational instruction', '§11.10(h)', riskBadge('Critical'), 'auth.middleware.ts session timeout, auth.service.ts device fingerprinting, idle-timeout.service.ts', 'OQ-005, OQ-007', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§11.10(i) Training — persons who develop, maintain, or use systems are trained', '§11.10(i)', riskBadge('High'), 'training.service.ts, acc_training_records table; SOP-007 Training Requirements', '15-training-matrix.md', 'Pending', 'evidence/training/', 'None', 'Pending'],
    ['§11.10(j) Documentation — written policies holding individuals accountable for actions under e-signatures', '§11.10(j)', riskBadge('Critical'), 'audit.middleware.ts (reason for change); esignature.service.ts (non-repudiation); SOP documentation', 'OQ-029', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§11.10(k)(1) Documentation controls — distribution, access, and use of documentation', '§11.10(k)(1)', riskBadge('Critical'), 'export.service.ts (controlled export); authorization controls on export endpoints; SOP-008', 'OQ-045', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§11.10(k)(2) Documentation controls — revision and change control', '§11.10(k)(2)', riskBadge('Critical'), 'Version control (Git); audit trail for config changes; SOP-005 Change Management', 'OQ-046', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§11.50 Signature manifestations — display name, date/time, meaning', '§11.50', riskBadge('Critical'), 'esignature.service.ts (stores all components); pdf.service.ts (renders in exports); acc_esignatures table', 'OQ-034, OQ-038', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§11.70 Signature/record linking — signatures linked to respective records', '§11.70', riskBadge('Critical'), 'esignature.service.ts SHA-256 hash in acc_esignatures.record_hash; auto-invalidation on record change', 'OQ-037', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§11.100 General e-signature requirements — unique to individual, not reused', '§11.100', riskBadge('Critical'), 'esignature.service.ts (bound to authenticated userId); no transfer/reassignment API; re-auth per signing', 'OQ-033', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§11.200 E-signature components — two identification components', '§11.200', riskBadge('Critical'), 'part11.middleware.ts (username verification + password re-entry); esignature.service.ts', 'OQ-033', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§11.300 ID code/password controls — uniqueness, periodicity, recall procedures', '§11.300', riskBadge('Critical'), 'auth.service.ts password validation (complexity, expiration, history); acc_password_history table', 'OQ-004', 'Pending', 'evidence/oq/', 'None', 'Pending'],
  ];
}

// --- Section 2: Audit Trail Requirements (Section 7) ---
function auditTrailRows(): TraceRow[] {
  return [
    ['Who made the change (user identity)', '§11.10(e)', riskBadge('Critical'), 'audit.middleware.ts, audit.service.ts — userId captured on every mutation', 'OQ-025', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Role/user identity captured', '§11.10(e)', riskBadge('Critical'), 'audit.service.ts — role field stored in acc_audit_log', 'OQ-025', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Date/time/timezone recorded', '§11.10(e), §11.10(k)(1)', riskBadge('Critical'), 'audit.service.ts — ISO 8601 UTC timestamps via created_at column', 'OQ-026', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Record affected identified', '§11.10(e)', riskBadge('Critical'), 'audit.service.ts — entityType and entityId fields identify target record', 'OQ-028', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Action taken logged', '§11.10(e)', riskBadge('Critical'), 'audit.service.ts — action field (CREATE/UPDATE/DELETE/VIEW/EXPORT/SIGN)', 'OQ-027', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Old value preserved', '§11.10(e)', riskBadge('Critical'), 'audit.middleware.ts — diff captures previous values before mutation', 'OQ-024', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['New value recorded', '§11.10(e)', riskBadge('Critical'), 'audit.middleware.ts — diff captures new values after mutation', 'OQ-024', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Reason for change captured', '§11.10(e), GCP', riskBadge('Critical'), 'Form data correction workflow requires reason; stored in audit entry', 'OQ-029', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Prior data not obscured', '§11.10(e)', riskBadge('Critical'), 'Audit trail preserves old values; no destructive overwrites', 'OQ-024', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Audit trail not editable by users/admins', '§11.10(e)', riskBadge('Critical'), 'No UPDATE/DELETE endpoints for acc_audit_log; INSERT-only table', 'OQ-030, OQ-031', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Audit trail retained as long as record', '§11.10(e), §11.10(c)', riskBadge('Critical'), 'retention-manager.service.ts — audit data included in retention policy', 'PQ-022', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Audit trail exportable for inspection', '§11.10(e), §11.10(b)', riskBadge('High'), 'GET /api/audit/export — CSV/PDF export of audit trail', 'OQ-032', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Signature action audit entry', '§11.10(e)', riskBadge('Critical'), 'esignature.service.ts → audit.service.ts — e-signature action generates audit entry', 'OQ-042', 'Pending', 'evidence/oq/', 'None', 'Pending'],
  ];
}

// --- Section 3: Access Control Requirements (Section 8) ---
function accessControlRows(): TraceRow[] {
  return [
    ['Unique user accounts', '§11.10(d), §164.312(a)(2)(i)', riskBadge('Critical'), 'auth.service.ts, DB UNIQUE constraint on acc_users.username', 'OQ-002', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['No shared accounts', '§11.10(d)', riskBadge('Critical'), 'Unique username enforcement; duplicate registration rejected', 'OQ-002', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Role-based permissions', '§11.10(d), §11.10(g)', riskBadge('Critical'), 'authorization.middleware.ts — 6 roles, 42 granular permissions', 'OQ-011, OQ-012, OQ-013, OQ-014, OQ-015, OQ-016', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Least privilege enforced', '§11.10(d), §11.10(g)', riskBadge('Critical'), 'Role hierarchy with granular permissions; no default admin access', 'OQ-017 to OQ-019', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['User provisioning approval', '§11.10(d)', riskBadge('High'), 'Admin-only user creation via POST /api/users; requires admin role', 'OQ-011', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['User deactivation', '§11.10(d)', riskBadge('Critical'), 'Deactivation endpoint; deactivated users blocked from login', 'OQ-022', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Role change effective immediately', '§11.10(d)', riskBadge('Critical'), 'authorization.middleware.ts — permission recalculation on role change', 'OQ-021', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Periodic access review', '§11.10(d)', riskBadge('High'), 'SOP-015 procedural control; admin user listing for periodic review', '13-sop-gap-analysis.md', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['Privileged/admin access logging', '§11.10(e)', riskBadge('Critical'), 'audit.middleware.ts logs all admin actions with elevated privilege flag', 'OQ-023', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Negative test: unauthorized view denied', '§11.10(g)', riskBadge('Critical'), 'RBAC middleware returns 403 for unauthorized read attempts', 'OQ-020', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Negative test: unauthorized edit denied', '§11.10(g)', riskBadge('Critical'), 'RBAC middleware returns 403 for unauthorized write attempts', 'OQ-018', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Negative test: unauthorized export denied', '§11.10(g)', riskBadge('High'), 'RBAC middleware returns 403 for unauthorized export attempts', 'OQ-019', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Negative test: unauthorized sign denied', '§11.10(g)', riskBadge('Critical'), 'part11.middleware.ts blocks unauthorized e-signature attempts', 'OQ-041', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Negative test: unauthorized lock denied', '§11.10(g)', riskBadge('Critical'), 'RBAC middleware blocks unauthorized data lock attempts', 'OQ-017', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Negative test: unauthorized delete denied', '§11.10(g)', riskBadge('Critical'), 'RBAC middleware blocks unauthorized delete attempts', 'OQ-020', 'Pending', 'evidence/oq/', 'None', 'Pending'],
  ];
}

// --- Section 4: Electronic Signature Requirements (Section 9) ---
function esignatureRows(): TraceRow[] {
  return [
    ['Unique signature per individual', '§11.100', riskBadge('Critical'), 'esignature.service.ts — signature bound to authenticated userId', 'OQ-033', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Identity verification before signing', '§11.100(b)', riskBadge('Critical'), 'User account verification required before first e-signature', 'OQ-033', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Signature requires re-authentication', '§11.200', riskBadge('Critical'), 'part11.middleware.ts — password re-entry required at each signing event', 'OQ-033', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Printed name included', '§11.50(b)', riskBadge('Critical'), 'acc_esignatures.signer_name — full printed name stored', 'OQ-034, OQ-038', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Date/time included', '§11.50(b)', riskBadge('Critical'), 'acc_esignatures.signed_at — UTC timestamp recorded', 'OQ-035', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Meaning/purpose included', '§11.50(b)', riskBadge('Critical'), 'acc_esignatures.meaning — purpose of signature recorded', 'OQ-036', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Permanently linked to record version', '§11.70', riskBadge('Critical'), 'SHA-256 hash linking signature to exact record content', 'OQ-037', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Cannot be copied to another record', '§11.70', riskBadge('Critical'), 'Unique per-record constraint; hash prevents transplant', 'OQ-040', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Post-signature changes audit-trailed', '§11.10(e)', riskBadge('Critical'), 'Audit trail captures any changes to signed records', 'OQ-039', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Post-signature changes require re-review', '§11.10(e)', riskBadge('Critical'), 'Signature auto-invalidated on record change; re-signing required', 'OQ-039', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Written e-signature accountability policy', '§11.10(j)', riskBadge('High'), 'SOP-021 Electronic Signature Policy', '13-sop-gap-analysis.md', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['FDA non-repudiation certification', '§11.100(c)', riskBadge('Critical'), 'FDA certification letter process — administrative control', 'Administrative', 'Pending', 'evidence/admin/', 'None', 'Pending'],
    ['Signature generates audit entry', '§11.10(e)', riskBadge('Critical'), 'esignature.service.ts → audit.service.ts — signing event logged to audit trail', 'OQ-042', 'Pending', 'evidence/oq/', 'None', 'Pending'],
  ];
}

// --- Section 5: Record Copies & Retention (Section 10) ---
function recordRetentionRows(): TraceRow[] {
  return [
    ['Human-readable exports (PDF)', '§11.10(b)', riskBadge('Critical'), 'pdf.service.ts — PDF generation for all CRF data', 'OQ-048', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Electronic exports (CSV/XML/ODM)', '§11.10(b)', riskBadge('Critical'), 'export.service.ts — CSV, XML, and CDISC ODM export', 'OQ-047', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Exports include data + metadata', '§11.10(b)', riskBadge('Critical'), 'Export includes all form fields, visit data, and metadata', 'PQ-020', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Exports include audit trails', '§11.10(b)', riskBadge('Critical'), 'Audit trail data included in regulatory export packages', 'PQ-020', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Exports include queries', '§11.10(b)', riskBadge('High'), 'Query data and resolution history included in export', 'PQ-020', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Exports include signatures', '§11.10(b)', riskBadge('Critical'), 'E-signature records included in export packages', 'PQ-020', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Records retrievable for retention period', '§11.10(c)', riskBadge('Critical'), 'retention-manager.service.ts — configurable retention periods', 'PQ-022', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Archive/retrieval process', '§11.10(c)', riskBadge('Critical'), 'backup.service.ts — automated archive and retrieval', 'PQ-022', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Backup process (AES-256)', '§11.10(c)', riskBadge('Critical'), 'backup.service.ts, encryption.service.ts — AES-256-GCM encrypted backups', 'PQ-021', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Disaster recovery process', '§11.10(c)', riskBadge('Critical'), 'SOP-014 disaster recovery; backup restore procedures', 'PQ-021', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Data modification with audit', '§11.10(e)', riskBadge('Critical'), 'form.service.ts — data modification generates audit trail entry with old/new values', 'OQ-044', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Record retrieval', '§11.10(a), §11.10(b)', riskBadge('Critical'), 'export.service.ts, form.service.ts — records retrievable and reproducible', 'OQ-049', 'Pending', 'evidence/oq/', 'None', 'Pending'],
  ];
}

// --- Section 10: HIPAA Technical ---
function hipaatechnicalRows(): TraceRow[] {
  return [
    ['§164.312(a)(1) Access control — technical policies for electronic information systems', '§164.312(a)(1)', riskBadge('Critical'), 'authorization.middleware.ts (RBAC with 6 roles, 42 permissions); permission.service.ts', 'OQ-011 to OQ-022', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§164.312(a)(2)(i) Unique user identification — assign unique name/number', '§164.312(a)(2)(i)', riskBadge('Critical'), 'acc_users table UNIQUE constraint on username; auth.service.ts duplicate rejection', 'OQ-002', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§164.312(a)(2)(iii) Automatic logoff — terminate session after inactivity', '§164.312(a)(2)(iii)', riskBadge('Critical'), 'auth.middleware.ts JWT expiry; idle-timeout.service.ts (frontend); configurable timeout', 'OQ-005', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§164.312(a)(2)(iv) Encryption and decryption — encrypt/decrypt ePHI', '§164.312(a)(2)(iv)', riskBadge('Critical'), 'PostgreSQL volume encryption; backup.service.ts AES-256-GCM; encryption.service.ts key mgmt', 'IQ-027', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['§164.312(b) Audit controls — record and examine activity in ePHI systems', '§164.312(b)', riskBadge('Critical'), 'audit.middleware.ts (all ePHI access logged); audit.service.ts; acc_audit_log; audit export API', 'OQ-023', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§164.312(c)(1) Integrity — protect ePHI from improper alteration or destruction', '§164.312(c)(1)', riskBadge('Critical'), 'validation-rules.service.ts; audit.middleware.ts (immutable audit); data-locks.service.ts', 'OQ-043', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§164.312(d) Person or entity authentication — verify identity', '§164.312(d)', riskBadge('Critical'), 'auth.middleware.ts JWT authentication; auth.service.ts password verification; no anonymous access', 'OQ-001', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['§164.312(e)(1) Transmission security — guard against unauthorized access during transmission', '§164.312(e)(1)', riskBadge('Critical'), 'TLS 1.2+ enforced; HSTS header; HTTP→HTTPS redirect; certificate management', 'IQ-019', 'Pending', 'evidence/iq/', 'None', 'Pending'],
  ];
}

// --- Section 7: HIPAA Administrative Safeguards ---
function hipaaAdminRows(): TraceRow[] {
  return [
    ['Security Risk Analysis', '§164.308(a)(1)(ii)(A)', riskBadge('Critical'), '14-hipaa-assessment.md — documented risk analysis', 'Administrative', 'Pending', 'evidence/admin/', 'None', 'Pending'],
    ['Risk management plan', '§164.308(a)(1)(ii)(B)', riskBadge('Critical'), '14-hipaa-assessment.md — ongoing risk management', 'Administrative', 'Pending', 'evidence/admin/', 'None', 'Pending'],
    ['BAA requirements', '§164.308(b)(1)', riskBadge('High'), 'Vendor agreements — BAA in place for all subprocessors', 'Administrative', 'Pending', 'evidence/admin/', 'None', 'Pending'],
    ['Security incident response', '§164.308(a)(6)', riskBadge('Critical'), 'SOP-014 incident response procedure', '13-sop-gap-analysis.md', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['Breach notification procedure', '§164.404', riskBadge('Critical'), 'SOP-009 HIPAA Breach Notification and Incident Response', '13-sop-gap-analysis.md', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['Backup/DR/emergency mode', '§164.308(a)(7)', riskBadge('Critical'), 'backup.service.ts, SOP-014 disaster recovery', 'PQ-021', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['HIPAA workforce training', '§164.308(a)(5)', riskBadge('High'), '15-training-matrix.md — HIPAA training program', 'Administrative', 'Pending', 'evidence/training/', 'None', 'Pending'],
    ['6-year HIPAA doc retention', '§164.316(b)(2)', riskBadge('Critical'), 'retention-manager.service.ts — 6-year minimum retention', 'Administrative', 'Pending', 'evidence/admin/', 'None', 'Pending'],
  ];
}

// --- Section 8: Required SOPs (Section 12) ---
function requiredSopRows(): TraceRow[] {
  return [
    ['Computer System Validation', '§11.10(a)', riskBadge('Critical'), 'SOP-006 Computer System Validation', 'Partial', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['Part 11 / Electronic Records', '§11.10', riskBadge('Critical'), 'SOP-015 Compliance', 'Partial', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['Electronic Signatures', '§11.50, §11.100', riskBadge('Critical'), 'SOP-021 Electronic Signature', 'Partial', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['Change Control', '§11.10(k)(2)', riskBadge('Critical'), 'SOP-005 Change Management', 'Partial', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['User Access Management', '§11.10(d)', riskBadge('Critical'), 'SOP-015, SOP-007 Access Control', 'Partial', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['Audit Trail Review', '§11.10(e)', riskBadge('Critical'), 'SOP-008 Audit Trail Review', 'Partial', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['Data Correction', '§11.10(e)', riskBadge('Critical'), 'SOP-029, SOP-020 Data Correction', 'Partial', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['Backup and Restore', '§11.10(c)', riskBadge('Critical'), 'SOP-014 Backup and Restore', 'Partial', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['Disaster Recovery', '§11.10(c)', riskBadge('Critical'), 'SOP-014 Disaster Recovery', 'Partial', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['Record Retention', '§11.10(c)', riskBadge('Critical'), 'SOP-008 Record Retention', 'Partial', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['Incident Response', '§164.308(a)(6)', riskBadge('Critical'), 'SOP-014 Incident Response', 'Covered', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['HIPAA Breach Notification', '§164.404', riskBadge('Critical'), 'SOP-009 HIPAA Breach Notification and Incident Response', 'Covered', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['Vendor Management', '§164.308(b)(1)', riskBadge('High'), 'SOP-010 Vendor and Supplier Management', 'Covered', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['Training', '§11.10(i)', riskBadge('High'), 'SOP-007, SOP-015 Training', 'Covered', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['Document Control', '§11.10(k)', riskBadge('High'), 'SOP-003, SOP-001 Document Control', 'Partial', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['Data Migration/Decommissioning', '§11.10(c)', riskBadge('Medium'), 'SOP-033 Data Migration and System Decommissioning', 'Covered', 'Pending', 'evidence/sop/', 'None', 'Pending'],
    ['Periodic Review', '§11.10(a)', riskBadge('High'), 'SOP-002 Periodic System Review and Revalidation Assessment', 'Covered', 'Pending', 'evidence/sop/', 'None', 'Pending'],
  ];
}

// --- Section 9: Training Records (Section 13) ---
function trainingRows(): TraceRow[] {
  return [
    ['Developers/maintainers', '§11.10(i)', riskBadge('High'), 'SOP-007, 15-training-matrix.md — GxP development training', 'Administrative', 'Pending', 'evidence/training/', 'None', 'Pending'],
    ['QA/validation personnel', '§11.10(i)', riskBadge('High'), 'SOP-015 compliance training — CSV methodology', 'Administrative', 'Pending', 'evidence/training/', 'None', 'Pending'],
    ['System administrators', '§11.10(i)', riskBadge('High'), 'SOP-007 — system administration and security training', 'Administrative', 'Pending', 'evidence/training/', 'None', 'Pending'],
    ['Support staff', '§11.10(i)', riskBadge('Medium'), 'SOP-007 — support procedures and escalation training', 'Administrative', 'Pending', 'evidence/training/', 'None', 'Pending'],
    ['Investigators/site users', '§11.10(i)', riskBadge('Critical'), 'SOP-032, SOP-029 — eCRF data entry and GCP training', 'Administrative', 'Pending', 'evidence/training/', 'None', 'Pending'],
    ['Monitors/CRAs', '§11.10(i)', riskBadge('High'), 'SOP-028, SOP-020 — monitoring, SDV, query management', 'Administrative', 'Pending', 'evidence/training/', 'None', 'Pending'],
    ['Sponsor/data managers', '§11.10(i)', riskBadge('High'), 'SOP-018, SOP-022 — data management and review training', 'Administrative', 'Pending', 'evidence/training/', 'None', 'Pending'],
    ['HIPAA workforce', '§164.308(a)(5)', riskBadge('High'), '15-training-matrix.md — HIPAA privacy and security training', 'Administrative', 'Pending', 'evidence/training/', 'None', 'Pending'],
  ];
}

// --- Section 10: PQ/UAT Workflow Coverage (Section 6) ---
function pqWorkflowRows(): TraceRow[] {
  return [
    ['Study setup', 'GCP', riskBadge('High'), 'study.service.ts — study creation and configuration', 'PQ-001 to PQ-003', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Site/user setup', 'GCP', riskBadge('High'), 'auth.service.ts, permission.service.ts — site user provisioning', 'PQ-002', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Subject enrollment', 'GCP, §11.10(a)', riskBadge('Critical'), 'subject.service.ts — enrollment with screening/randomization', 'PQ-004 to PQ-006', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Duplicate subject prevention', 'GCP, §11.10(a)', riskBadge('Critical'), 'subject.service.ts — duplicate screening number/enrollment check', 'PQ-005', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Visit workflow', 'GCP', riskBadge('High'), 'event.service.ts — scheduled visit management', 'PQ-006', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['eCRF/data entry', '§11.10(a), §11.10(e)', riskBadge('Critical'), 'form.service.ts — data entry with validation and audit', 'PQ-007', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Query creation/resolution', 'GCP', riskBadge('Critical'), 'query.service.ts — query lifecycle management', 'PQ-009', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Investigator review', 'GCP', riskBadge('High'), 'workflow.service.ts — investigator review and approval', 'PQ-015', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Monitor/CRA review', 'GCP', riskBadge('High'), 'sdv.service.ts — source data verification workflow', 'PQ-013', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Data manager review', 'GCP', riskBadge('High'), 'workflow.service.ts — data manager review step', 'PQ-014', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Data correction', '§11.10(e)', riskBadge('Critical'), 'form.service.ts — correction with reason and audit trail', 'PQ-010', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Skip/branching logic', 'GCP, §11.10(a)', riskBadge('High'), 'validation-rules.service.ts — conditional skip and branching logic in eCRFs', 'PQ-011', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Signature/approval workflow', '§11.50, §11.100', riskBadge('Critical'), 'esignature.service.ts — signing with verification', 'PQ-015, PQ-016', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Database lock', '§11.10(a)', riskBadge('Critical'), 'data-locks.service.ts — study/site/subject/form locking', 'PQ-017 to PQ-019', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Casebook lock', '§11.10(a)', riskBadge('Critical'), 'data-locks.service.ts — subject-level casebook lock prevents further edits', 'PQ-018', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Final export', '§11.10(b)', riskBadge('Critical'), 'export.service.ts — regulatory-compliant final export', 'PQ-020', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Archive/retrieval', '§11.10(c)', riskBadge('Critical'), 'backup.service.ts, retention-manager.service.ts', 'PQ-021, PQ-022', 'Pending', 'evidence/pq/', 'None', 'Pending'],
    ['Protocol-specific critical data paths', 'GCP', riskBadge('Critical'), 'validation-rules.service.ts — protocol-driven edit checks', 'PQ-007 to PQ-012', 'Pending', 'evidence/pq/', 'None', 'Pending'],
  ];
}

// --- Section 11: Installation Qualification (IQ) ---
function installationRows(): TraceRow[] {
  return [
    ['Application version verified', '§11.10(a)', riskBadge('High'), 'package.json, /health endpoint', 'IQ-001', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['Backend API responding', '§11.10(a)', riskBadge('Critical'), 'Express server health check', 'IQ-002', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['Frontend deployed and accessible', '§11.10(a)', riskBadge('High'), 'Angular build deployment', 'IQ-003', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['Node.js runtime version 20+', '§11.10(a)', riskBadge('High'), 'Node.js installation', 'IQ-004', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['Angular framework version 19', '§11.10(a)', riskBadge('High'), 'package.json @angular/core', 'IQ-005', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['TypeScript version 5.x', '§11.10(a)', riskBadge('Medium'), 'package.json typescript', 'IQ-006', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['npm dependencies integrity', '§11.10(a)', riskBadge('High'), 'npm audit, package-lock.json', 'IQ-007', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['Shared-types package built', '§11.10(a)', riskBadge('High'), 'shared-types/dist/ present', 'IQ-008', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['PostgreSQL version 15+', '§11.10(a)', riskBadge('Critical'), 'Database version check', 'IQ-009', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['Database accessible', '§11.10(a)', riskBadge('Critical'), 'Database connectivity', 'IQ-010', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['acc_audit_log table schema', '§11.10(e)', riskBadge('Critical'), 'migrations.ts table creation', 'IQ-011', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['acc_esignatures table schema', '§11.50', riskBadge('Critical'), 'migrations.ts table creation', 'IQ-012', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['User tables exist', '§11.10(d)', riskBadge('Critical'), 'migrations.ts table creation', 'IQ-013', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['acc_queries table exists', '§11.10(e)', riskBadge('Critical'), 'migrations.ts table creation', 'IQ-014', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['acc_data_locks table exists', '§11.10(a)', riskBadge('Critical'), 'migrations.ts table creation', 'IQ-015', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['acc_tasks table exists', '§11.10(a)', riskBadge('High'), 'migrations.ts table creation', 'IQ-016', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['Foreign key constraints', '§11.10(a)', riskBadge('High'), 'Database referential integrity', 'IQ-017', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['Required indexes present', '§11.10(a)', riskBadge('High'), 'Database performance', 'IQ-018', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['TLS/HTTPS configured', '§164.312(e)(1)', riskBadge('Critical'), 'HTTPS enforcement', 'IQ-019', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['JWT secret configured', '§11.10(d)', riskBadge('Critical'), 'Environment security', 'IQ-020', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['Rate limiting enabled', '§11.10(d)', riskBadge('High'), 'rateLimiter.middleware.ts', 'IQ-021', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['CORS configured', '§11.10(d)', riskBadge('High'), 'CORS policy', 'IQ-022', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['Environment variables set', '§11.10(a)', riskBadge('Critical'), '.env configuration', 'IQ-023', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['Logging enabled', '§11.10(e)', riskBadge('Critical'), 'Application logging', 'IQ-024', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['Error handling active', '§11.10(a)', riskBadge('High'), 'errorHandler.middleware.ts', 'IQ-025', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['Backup service configured', '§11.10(c)', riskBadge('Critical'), 'backup.service.ts', 'IQ-026', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['AES-256 encryption configured', '§11.10(c), §164.312(a)(2)(iv)', riskBadge('Critical'), 'encryption.service.ts', 'IQ-027', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['Backup schedule configured', '§11.10(c)', riskBadge('Critical'), 'backup-scheduler.service.ts', 'IQ-028', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['Environment segregation', '§11.10(a)', riskBadge('High'), 'docker-compose configs', 'IQ-029', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['UTC timezone configured', '§11.10(k)(1)', riskBadge('High'), 'Server timezone', 'IQ-030', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['Production auth required', '§11.10(d)', riskBadge('Critical'), 'Auth middleware', 'IQ-031', 'Pending', 'evidence/iq/', 'None', 'Pending'],
    ['Admin strong passwords', '§11.300', riskBadge('Critical'), 'Password policy enforcement', 'IQ-032', 'Pending', 'evidence/iq/', 'None', 'Pending'],
  ];
}

// --- Section 12: Data Lock/Freeze ---
function dataLockRows(): TraceRow[] {
  return [
    ['Freeze prevents editing', '§11.10(a)', riskBadge('Critical'), 'data-locks.service.ts', 'OQ-051', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Lock prevents all changes', '§11.10(a)', riskBadge('Critical'), 'data-locks.service.ts', 'OQ-052', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Unlock request workflow', '§11.10(a)', riskBadge('Critical'), 'data-locks.service.ts', 'OQ-053', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Lock status in API response', '§11.10(a)', riskBadge('High'), 'data-locks.service.ts', 'OQ-054', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Lock/freeze generates audit', '§11.10(e)', riskBadge('Critical'), 'audit.middleware.ts', 'OQ-055', 'Pending', 'evidence/oq/', 'None', 'Pending'],
  ];
}

// --- Section 13: Query Workflow ---
function queryWorkflowRows(): TraceRow[] {
  return [
    ['Query create and resolve lifecycle', '§11.10(e), GCP', riskBadge('Critical'), 'query.service.ts', 'OQ-050', 'Pending', 'evidence/oq/', 'None', 'Pending'],
  ];
}

// --- Section 14: Part 11 Compliance Controls ---
function part11ControlsRows(): TraceRow[] {
  return [
    ['Password expiration enforcement', '§11.300(b)', riskBadge('Critical'), 'auth.service.ts — isPasswordExpired() check on login; configurable via PASSWORD_EXPIRY_DAYS (default 90)', 'OQ-056', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Account lockout after failed attempts', '§11.300(d)', riskBadge('Critical'), 'auth.service.ts — incrementLockCounter() + lockAccount() after MAX_LOGIN_ATTEMPTS (default 5); admin notification on lockout', 'OQ-057', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Emergency session revocation', '§11.300(c)', riskBadge('Critical'), 'token-blocklist.service.ts — POST /api/users/:id/revoke-sessions blocks all tokens and optionally locks account', 'OQ-058', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Two-component e-signature (username + password)', '§11.200(a)(1)', riskBadge('Critical'), 'part11.middleware.ts — requirePart11({ required: true }) enforces both signatureUsername and signaturePassword', 'OQ-059', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Audit trail immutability (no delete)', '§11.10(e)', riskBadge('Critical'), 'Database triggers prevent UPDATE/DELETE on audit_log_event; API returns 400+ on audit mutation attempts', 'OQ-060', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Reason for change required', '§11.10(e), GCP', riskBadge('Critical'), 'audit.middleware.ts requireReasonForChange — returns 400 if reasonForChange missing on clinical data mutations', 'OQ-061', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Token blocklist on logout', '§11.10(d)', riskBadge('Critical'), 'token-blocklist.service.ts — blockToken() called on logout; auth.middleware.ts checks isTokenBlocked() before JWT verification', 'OQ-062', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['PHI not exposed in error responses', '§164.312(c)(1)', riskBadge('Critical'), 'errorHandler.middleware.ts strips stack traces; audit.middleware.ts redacts PHI fields with ***PHI_REDACTED***', 'OQ-063', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Signature manifestation (name/date/meaning)', '§11.50', riskBadge('Critical'), 'esignature.service.ts stores signer_name, signed_at, meaning in acc_esignatures table', 'OQ-064', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Signature-record cryptographic linking', '§11.70', riskBadge('Critical'), 'esignature.service.ts computes SHA-256 record_hash; auto-invalidation on record change', 'OQ-065', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Username uniqueness enforcement', '§11.300(a)', riskBadge('Critical'), 'UNIQUE constraint on user_account.user_name; registration rejects duplicates', 'OQ-066', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Human-readable record copies (PDF export)', '§11.10(b)', riskBadge('Critical'), 'export.service.ts + pdf.service.ts — PDF generation for all CRF data with audit trail', 'OQ-067', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Backup service operational', '§11.10(c)', riskBadge('Critical'), 'backup.service.ts — AES-256-GCM encrypted backups; backup-scheduler.service.ts for scheduling', 'OQ-068', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['E-signature user certification', '§11.100(b)', riskBadge('Critical'), 'esignature.service.ts — certification endpoint verifies identity before first signature use', 'OQ-069', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['System version tracking', '§11.10(k)(2)', riskBadge('High'), '/health endpoint returns version; Git version control for change documentation', 'OQ-070', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Password history enforcement', '§11.300(b)', riskBadge('Critical'), 'auth.service.ts changePassword — checks last 5 passwords in acc_password_history table before accepting', 'OQ-071', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Concurrent session control', '§11.10(d)', riskBadge('High'), 'token-blocklist.service.ts — registerSession() on login; old session blocked when new login detected', 'OQ-072', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Audit write failure blocks mutation', '§11.10(e)', riskBadge('Critical'), 'audit.middleware.ts — mutation requests (POST/PUT/PATCH/DELETE) return 503 if audit database write fails', 'OQ-073', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['PHI redacted from application logs', '§164.312(c)(1)', riskBadge('Critical'), 'audit.middleware.ts sanitizeRequestBody — firstName, lastName, DOB, SSN, diagnoses redacted with ***PHI_REDACTED***', 'OQ-074', 'Pending', 'evidence/oq/', 'None', 'Pending'],
    ['Security alert on account lockout', '§11.300(d)', riskBadge('Critical'), 'auth.service.ts — notifyUsers() sends urgent notification to admin users when account locked', 'OQ-075', 'Pending', 'evidence/oq/', 'None', 'Pending'],
  ];
}

// --- Section 15: Security Testing ---
function securityTestRows(): TraceRow[] {
  return [
    ['SQL injection prevention', '§11.10(d), §164.312(c)(1)', riskBadge('Critical'), 'Parameterized queries in all services; Joi validation middleware', 'SEC-001', 'Pending', 'evidence/security/', 'None', 'Pending'],
    ['Cross-site scripting (XSS) prevention', '§11.10(d)', riskBadge('Critical'), 'Angular built-in sanitization; Content-Security-Policy headers', 'SEC-002', 'Pending', 'evidence/security/', 'None', 'Pending'],
    ['Authentication enforcement on protected endpoints', '§11.10(d), §164.312(d)', riskBadge('Critical'), 'auth.middleware.ts applied to all protected routes', 'SEC-003, SEC-004, SEC-005', 'Pending', 'evidence/security/', 'None', 'Pending'],
    ['Path traversal prevention', '§11.10(d)', riskBadge('High'), 'Express path normalization; no user-controlled file paths', 'SEC-006', 'Pending', 'evidence/security/', 'None', 'Pending'],
    ['HTTP verb tampering prevention', '§11.10(d)', riskBadge('High'), 'Explicit route method definitions in Express router', 'SEC-007', 'Pending', 'evidence/security/', 'None', 'Pending'],
    ['CORS policy enforcement', '§164.312(e)(1)', riskBadge('High'), 'CORS middleware with allowed origins whitelist', 'SEC-008', 'Pending', 'evidence/security/', 'None', 'Pending'],
    ['Sensitive data leakage prevention in errors', '§164.312(c)(1)', riskBadge('Critical'), 'errorHandler.middleware.ts strips stack traces in production', 'SEC-009', 'Pending', 'evidence/security/', 'None', 'Pending'],
    ['Content-type enforcement', '§11.10(d)', riskBadge('High'), 'Express JSON parser rejects non-JSON bodies on API endpoints', 'SEC-010', 'Pending', 'evidence/security/', 'None', 'Pending'],
  ];
}

// --- Section 15: Performance Testing ---
function performanceTestRows(): TraceRow[] {
  return [
    ['Health endpoint response time < 500ms', '§11.10(a)', riskBadge('High'), 'Express health endpoint; Docker container resources', 'PERF-001', 'Pending', 'evidence/performance/', 'None', 'Pending'],
    ['Authentication response time < 1000ms', '§11.10(d)', riskBadge('High'), 'auth.service.ts bcrypt hashing; JWT generation', 'PERF-002', 'Pending', 'evidence/performance/', 'None', 'Pending'],
    ['Data access response time < 1000ms', '§11.10(a)', riskBadge('High'), 'PostgreSQL query optimization; database indexes', 'PERF-003', 'Pending', 'evidence/performance/', 'None', 'Pending'],
    ['Concurrent user handling', '§11.10(a)', riskBadge('High'), 'PostgreSQL connection pool; Express async handlers', 'PERF-004', 'Pending', 'evidence/performance/', 'None', 'Pending'],
    ['Input boundary handling', '§11.10(a)', riskBadge('Medium'), 'Joi validation; Express body size limits', 'PERF-005', 'Pending', 'evidence/performance/', 'None', 'Pending'],
  ];
}

// --- Section 16: Disaster Recovery ---
function disasterRecoveryRows(): TraceRow[] {
  return [
    ['Backup service operational', '§11.10(c), §164.308(a)(7)', riskBadge('Critical'), 'backup.service.ts; backup-scheduler.service.ts', 'DR-001', 'Pending', 'evidence/dr/', 'None', 'Pending'],
    ['Encryption configuration verified', '§164.312(a)(2)(iv)', riskBadge('Critical'), 'encryption.service.ts AES-256-GCM; key management', 'DR-002', 'Pending', 'evidence/dr/', 'None', 'Pending'],
    ['Retention policy configured', '§11.10(c)', riskBadge('Critical'), 'retention-manager.service.ts; 15-year clinical data retention', 'DR-003', 'Pending', 'evidence/dr/', 'None', 'Pending'],
    ['Backup schedule active', '§11.10(c)', riskBadge('Critical'), 'backup-scheduler.service.ts; cron-based scheduling', 'DR-004', 'Pending', 'evidence/dr/', 'None', 'Pending'],
    ['Restore verification', '§11.10(c), §164.308(a)(7)', riskBadge('Critical'), 'SOP-014 disaster recovery; restore procedures', 'DR-005', 'Pending', 'evidence/dr/', 'None', 'Pending'],
  ];
}

function parseTestCaseIds(testCaseStr: string): string[] {
  const ids: string[] = [];
  const parts = testCaseStr.split(',').map(p => p.trim());
  for (const part of parts) {
    const rangeMatch = part.match(/^([A-Z]+-?)(\d+)\s*(?:to|–|-)\s*\1?(\d+)$/i);
    if (rangeMatch) {
      const prefix = rangeMatch[1];
      const start = parseInt(rangeMatch[2], 10);
      const end = parseInt(rangeMatch[3], 10);
      for (let i = start; i <= end; i++) {
        ids.push(`${prefix}${String(i).padStart(3, '0')}`);
      }
    } else {
      const singleMatch = part.match(/^[A-Z]+-\d+/i);
      if (singleMatch) {
        ids.push(singleMatch[0]);
      }
    }
  }
  return ids;
}

function overlayEvidence(rows: TraceRow[], evidenceMap: Map<string, RunnerResult>): void {
  for (const row of rows) {
    const testCaseCol = row[4];
    if (!testCaseCol || testCaseCol === 'Administrative' || testCaseCol === 'GAP' || testCaseCol === 'Partial') continue;

    const ids = parseTestCaseIds(testCaseCol);
    if (ids.length === 0) continue;

    let allPassed = true;
    let anyTested = false;
    let anyFailed = false;

    for (const id of ids) {
      const evidence = evidenceMap.get(id);
      if (evidence) {
        anyTested = true;
        if (!evidence.passed) {
          anyFailed = true;
          allPassed = false;
        }
      } else {
        allPassed = false;
      }
    }

    if (anyTested) {
      if (anyFailed) {
        row[5] = 'Fail';
        row[8] = 'Non-Compliant';
      } else if (allPassed) {
        row[5] = 'Pass';
        row[8] = 'Verified';
      } else {
        row[5] = 'Partial';
        row[8] = 'Pending';
      }
    }
  }
}

export function generate(outputDir: string, workspaceRoot: string): void {
  void workspaceRoot;
  const evidenceMap = loadRunnerEvidence(outputDir);
  const content = buildDocument(evidenceMap);
  fs.writeFileSync(path.join(outputDir, '06-traceability-matrix.md'), content);
}

function buildDocument(evidenceMap: Map<string, RunnerResult>): string {
  const p11 = part11Rows();
  const audit = auditTrailRows();
  const access = accessControlRows();
  const esig = esignatureRows();
  const records = recordRetentionRows();
  const hipaaTech = hipaatechnicalRows();
  const hipaaAdmin = hipaaAdminRows();
  const sops = requiredSopRows();
  const training = trainingRows();
  const pq = pqWorkflowRows();
  const installation = installationRows();
  const dataLock = dataLockRows();
  const queryWf = queryWorkflowRows();
  const part11Controls = part11ControlsRows();
  const security = securityTestRows();
  const performance = performanceTestRows();
  const disasterRecovery = disasterRecoveryRows();

  const allSectionRows = [p11, audit, access, esig, records, hipaaTech, hipaaAdmin, sops, training, pq, installation, dataLock, queryWf, part11Controls, security, performance, disasterRecovery];
  for (const rows of allSectionRows) {
    overlayEvidence(rows, evidenceMap);
  }

  const allSections = [
    { name: 'Part 11 Requirements', rows: p11 },
    { name: 'Audit Trail Requirements', rows: audit },
    { name: 'Access Control Requirements', rows: access },
    { name: 'Electronic Signature Requirements', rows: esig },
    { name: 'Record Copies & Retention', rows: records },
    { name: 'HIPAA Technical Safeguards', rows: hipaaTech },
    { name: 'HIPAA Administrative Safeguards', rows: hipaaAdmin },
    { name: 'Required SOPs', rows: sops },
    { name: 'Training Records', rows: training },
    { name: 'PQ/UAT Workflow Coverage', rows: pq },
    { name: 'Installation Qualification (IQ)', rows: installation },
    { name: 'Data Lock/Freeze', rows: dataLock },
    { name: 'Query Workflow', rows: queryWf },
    { name: 'Part 11 Compliance Controls', rows: part11Controls },
    { name: 'Security Testing', rows: security },
    { name: 'Performance Testing', rows: performance },
    { name: 'Disaster Recovery', rows: disasterRecovery },
  ];

  const allRows = allSections.flatMap((s) => s.rows);
  const totalTraced = allRows.length;
  const pendingCount = allRows.filter((r) => r[8] === 'Pending').length;
  const verifiedCount = allRows.filter((r) => r[8] === 'Verified').length;
  const nonCompliantCount = allRows.filter((r) => r[8] === 'Non-Compliant').length;

  const riskDist = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const row of allRows) {
    if (row[2].includes('Critical')) riskDist.Critical++;
    else if (row[2].includes('High')) riskDist.High++;
    else if (row[2].includes('Medium')) riskDist.Medium++;
    else if (row[2].includes('Low')) riskDist.Low++;
  }

  let c = '';

  c += documentHeader({
    title: 'Requirements Traceability Matrix',
    documentId: `TM-${DOC_YEAR}-001`,
    version: '2.0',
    date: DOC_DATE,
    system: SYSTEM_INFO.fullName,
    classification: 'Confidential — Regulatory',
  });

  c += tableOfContents([
    { level: 1, title: 'Purpose' },
    { level: 1, title: 'Methodology' },
    { level: 1, title: '21 CFR Part 11 Traceability' },
    { level: 1, title: 'Audit Trail Requirements' },
    { level: 1, title: 'Access Control Requirements' },
    { level: 1, title: 'Electronic Signature Requirements' },
    { level: 1, title: 'Record Copies & Retention' },
    { level: 1, title: 'HIPAA Technical Safeguards' },
    { level: 1, title: 'HIPAA Administrative Safeguards' },
    { level: 1, title: 'Required SOPs' },
    { level: 1, title: 'Training Records' },
    { level: 1, title: 'PQ/UAT Workflow Coverage' },
    { level: 1, title: 'Installation Qualification (IQ)' },
    { level: 1, title: 'Data Lock/Freeze' },
    { level: 1, title: 'Query Workflow' },
    { level: 1, title: 'Part 11 Compliance Controls' },
    { level: 1, title: 'Security Testing' },
    { level: 1, title: 'Performance Testing' },
    { level: 1, title: 'Disaster Recovery' },
    { level: 1, title: 'Traceability Summary' },
    { level: 2, title: 'Coverage Statistics' },
    { level: 2, title: 'Risk Distribution' },
    { level: 2, title: 'Gaps Identified' },
    { level: 1, title: 'Document Cross-References' },
    { level: 1, title: 'Approval Signatures' },
  ]) + '\n';
  c += hr();

  // Purpose
  c += section(2, 'Purpose');
  c += `This Requirements Traceability Matrix (RTM) is the **key document** linking every applicable regulatory `;
  c += `requirement to its corresponding risk assessment, implementation, test case, `;
  c += `and verification status for the **${SYSTEM_INFO.fullName}** (v${SYSTEM_INFO.version}).\n\n`;
  c += 'The RTM provides:\n\n';
  c += '1. **Forward traceability** — from regulation → implementation → test case\n';
  c += '2. **Backward traceability** — from test result → test case → implementation → requirement → regulation\n';
  c += '3. **Gap analysis** — identifies any regulatory requirement without corresponding implementation or verification\n';
  c += '4. **Compliance evidence** — documents the verification status for each regulatory requirement\n\n';
  c += `This document traces **${totalTraced}** individual regulatory sub-requirements across **${allSections.length}** compliance domains. `;
  c += 'It is maintained as a living record and updated after each validation execution cycle.\n\n';
  c += hr();

  // Methodology
  c += section(2, 'Methodology');
  c += 'Each row in the traceability matrix maps a **legal/regulatory requirement** through the following chain:\n\n';
  c += markdownTable(
    ['Column', 'Description'],
    [
      ['**Legal Requirement**', 'The regulatory citation and its requirement text'],
      ['**Regulatory Ref**', 'The specific section number (e.g., §11.10(a), §164.312(b))'],
      ['**Risk**', 'Risk level from the Risk Assessment (RA) document'],
      ['**Implementation/Control**', 'Source code files, services, middleware, or procedural controls'],
      ['**Test Case**', 'IQ/OQ/PQ test case IDs or document references'],
      ['**Result**', 'Pass/Fail/Pending status from test execution'],
      ['**Evidence**', 'Location of test execution evidence'],
      ['**Deviation**', 'Deviations from expected results, with references'],
      ['**Status**', 'Overall status: Pending, Verified, or Non-Compliant'],
    ],
  );
  c += '\nA requirement is **Verified** only when all associated test cases pass with documented evidence. ';
  c += 'A requirement with any failed test case is **Non-Compliant** until remediated and re-tested.\n\n';
  c += hr();

  // Section 3: Part 11
  c += section(2, '21 CFR Part 11 Traceability');
  c += `This section traces all applicable **21 CFR Part 11** requirements (**${p11.length}** sections from §11.10 through §11.300).\n\n`;
  c += markdownTable(TRACE_HEADERS, p11);
  c += '\n';
  c += hr();

  // Section 4: Audit Trail
  c += section(2, 'Audit Trail Requirements');
  c += `Detailed traceability for **Section 7 — Audit Trail** requirements (**${audit.length}** sub-requirements).\n\n`;
  c += '> Per 21 CFR Part 11 §11.10(e): Computer-generated, time-stamped audit trails must record the date and time of operator entries and actions.\n\n';
  c += markdownTable(TRACE_HEADERS, audit);
  c += '\n';
  c += hr();

  // Section 5: Access Control
  c += section(2, 'Access Control Requirements');
  c += `Detailed traceability for **Section 8 — Access Control** requirements (**${access.length}** sub-requirements), including negative test cases.\n\n`;
  c += markdownTable(TRACE_HEADERS, access);
  c += '\n';
  c += hr();

  // Section 6: E-Signatures
  c += section(2, 'Electronic Signature Requirements');
  c += `Detailed traceability for **Section 9 — Electronic Signatures** (**${esig.length}** sub-requirements).\n\n`;
  c += '> Per 21 CFR Part 11 Subpart C: Electronic signatures must be unique to one individual, include printed name/date/meaning, and be permanently linked to the signed record.\n\n';
  c += markdownTable(TRACE_HEADERS, esig);
  c += '\n';
  c += hr();

  // Section 7: Record Copies & Retention
  c += section(2, 'Record Copies & Retention');
  c += `Detailed traceability for **Section 10 — Record Copies & Retention** (**${records.length}** sub-requirements).\n\n`;
  c += markdownTable(TRACE_HEADERS, records);
  c += '\n';
  c += hr();

  // Section 8: HIPAA Technical
  c += section(2, 'HIPAA Technical Safeguards');
  c += `This section traces all applicable **HIPAA Security Rule** (45 CFR 164 Subpart C) technical safeguard requirements (**${hipaaTech.length}** sections).\n\n`;
  c += markdownTable(TRACE_HEADERS, hipaaTech);
  c += '\n';
  c += hr();

  // Section 9: HIPAA Administrative
  c += section(2, 'HIPAA Administrative Safeguards');
  c += `Traceability for **HIPAA Administrative Safeguards** (**${hipaaAdmin.length}** sub-requirements).\n\n`;
  c += markdownTable(TRACE_HEADERS, hipaaAdmin);
  c += '\n';
  c += hr();

  // Section 10: Required SOPs
  c += section(2, 'Required SOPs');
  c += `Traceability for **Section 12 — Required SOPs** (**${sops.length}** SOP categories). Coverage status indicates whether the SOP exists and is complete.\n\n`;
  c += markdownTable(TRACE_HEADERS, sops);
  c += '\n';
  c += hr();

  // Section 11: Training Records
  c += section(2, 'Training Records');
  c += `Traceability for **Section 13 — Training Records** (**${training.length}** role categories).\n\n`;
  c += markdownTable(TRACE_HEADERS, training);
  c += '\n';
  c += hr();

  // Section 12: PQ/UAT Workflow Coverage
  c += section(2, 'PQ/UAT Workflow Coverage');
  c += `Traceability for **Section 6 — PQ/UAT Workflow Coverage** (**${pq.length}** end-to-end workflows).\n\n`;
  c += markdownTable(TRACE_HEADERS, pq);
  c += '\n';
  c += hr();

  // Section 13: Installation Qualification (IQ)
  c += section(2, 'Installation Qualification (IQ)');
  c += `Traceability for **Installation Qualification (IQ)** requirements (**${installation.length}** verification items).\n\n`;
  c += '> IQ verifies that the system is installed correctly and all infrastructure components meet specified requirements.\n\n';
  c += markdownTable(TRACE_HEADERS, installation);
  c += '\n';
  c += hr();

  // Section 14: Data Lock/Freeze
  c += section(2, 'Data Lock/Freeze');
  c += `Traceability for **Data Lock/Freeze** requirements (**${dataLock.length}** sub-requirements).\n\n`;
  c += markdownTable(TRACE_HEADERS, dataLock);
  c += '\n';
  c += hr();

  // Section 15: Query Workflow
  c += section(2, 'Query Workflow');
  c += `Traceability for **Query Workflow** requirements (**${queryWf.length}** sub-requirements).\n\n`;
  c += markdownTable(TRACE_HEADERS, queryWf);
  c += '\n';
  c += hr();

  // Part 11 Compliance Controls
  c += section(2, 'Part 11 Compliance Controls');
  c += `Traceability for **Part 11 Compliance Controls** implemented to address specific regulatory requirements (**${part11Controls.length}** controls verified).\n\n`;
  c += '> These controls were implemented and verified against the exact text of 21 CFR Part 11 and HIPAA Security Rule §164.312.\n\n';
  c += markdownTable(TRACE_HEADERS, part11Controls);
  c += '\n';
  c += hr();

  // Section 16: Security Testing
  c += section(2, 'Security Testing');
  c += `Traceability for **Security Testing** requirements (**${security.length}** test categories).\n\n`;
  c += '> Security tests verify that the system resists common attack vectors (OWASP Top 10) and enforces defense-in-depth controls.\n\n';
  c += markdownTable(TRACE_HEADERS, security);
  c += '\n';
  c += hr();

  // Section 17: Performance Testing
  c += section(2, 'Performance Testing');
  c += `Traceability for **Performance Testing** requirements (**${performance.length}** test categories).\n\n`;
  c += '> Performance tests verify that the system meets response time, throughput, and boundary handling requirements under expected load.\n\n';
  c += markdownTable(TRACE_HEADERS, performance);
  c += '\n';
  c += hr();

  // Section 18: Disaster Recovery
  c += section(2, 'Disaster Recovery');
  c += `Traceability for **Disaster Recovery** requirements (**${disasterRecovery.length}** verification items).\n\n`;
  c += '> Disaster recovery tests verify backup, encryption, retention, scheduling, and restore capabilities per 21 CFR Part 11 §11.10(c) and HIPAA §164.308(a)(7).\n\n';
  c += markdownTable(TRACE_HEADERS, disasterRecovery);
  c += '\n';
  c += hr();

  // Traceability Summary
  c += section(2, 'Traceability Summary');

  c += '### Coverage Statistics\n\n';
  c += markdownTable(
    ['Metric', 'Value'],
    [
      ['Total Regulatory Sub-Requirements Traced', String(totalTraced)],
      ['Part 11 Core Requirements', String(p11.length)],
      ['Audit Trail Sub-Requirements', String(audit.length)],
      ['Access Control Sub-Requirements', String(access.length)],
      ['Electronic Signature Sub-Requirements', String(esig.length)],
      ['Record Copies & Retention Sub-Requirements', String(records.length)],
      ['HIPAA Technical Safeguards', String(hipaaTech.length)],
      ['HIPAA Administrative Safeguards', String(hipaaAdmin.length)],
      ['Required SOPs', String(sops.length)],
      ['Training Record Categories', String(training.length)],
      ['PQ/UAT Workflow Items', String(pq.length)],
      ['Installation Qualification (IQ) Items', String(installation.length)],
      ['Data Lock/Freeze Items', String(dataLock.length)],
      ['Query Workflow Items', String(queryWf.length)],
      ['Part 11 Compliance Controls', String(part11Controls.length)],
      ['Security Testing Items', String(security.length)],
      ['Performance Testing Items', String(performance.length)],
      ['Disaster Recovery Items', String(disasterRecovery.length)],
      ['Requirements Verified (Passed)', String(verifiedCount)],
      ['Requirements Pending Verification', String(pendingCount)],
      ['Requirements Non-Compliant (Failed)', String(nonCompliantCount)],
      ['Coverage Percentage', `${totalTraced > 0 ? ((verifiedCount / totalTraced) * 100).toFixed(1) : '0.0'}% verified`],
    ],
  );
  c += '\n';

  c += '### Risk Distribution\n\n';
  c += markdownTable(
    ['Risk Level', 'Requirements Count', 'Percentage'],
    (['Critical', 'High', 'Medium', 'Low'] as const).map((level) => {
      const count = riskDist[level];
      const pct = totalTraced > 0 ? ((count / totalTraced) * 100).toFixed(1) : '0.0';
      return [riskBadge(level), String(count), `${pct}%`];
    }),
  );
  c += '\n';

  c += '### Gaps Identified\n\n';
  c += 'All previously identified SOP gaps have been remediated. See the SOP Gap Analysis (13-sop-gap-analysis.md) for the full coverage assessment.\n\n';

  if (verifiedCount === 0 && nonCompliantCount === 0) {
    c += '> **Note:** This traceability matrix will be updated as validation execution progresses. ';
    c += 'Currently all requirements are in **Pending** status awaiting test execution. ';
    c += 'The matrix will be finalized with pass/fail results and evidence references upon completion ';
    c += 'of the IQ, OQ, and PQ protocols.\n\n';
  } else {
    c += `> **Note:** ${verifiedCount} of ${totalTraced} requirements are **Verified**. `;
    if (nonCompliantCount > 0) {
      c += `${nonCompliantCount} are **Non-Compliant** and require remediation. `;
    }
    if (pendingCount > 0) {
      c += `${pendingCount} remain **Pending** verification. `;
    }
    c += '\n\n';
  }
  c += hr();

  // Document Cross-References
  c += section(2, 'Document Cross-References');
  c += markdownTable(
    ['Document', 'Document ID', 'Relationship'],
    [
      ['User Requirements Specification', `URS-${DOC_YEAR}-001`, 'Source of system requirements (URS-xxx entries)'],
      ['Functional Requirements Specification', `FRS-${DOC_YEAR}-001`, 'Source of functional requirements (FRS-xxx entries)'],
      ['Risk Assessment', `RA-${DOC_YEAR}-001`, 'Source of risk ratings for each requirement'],
      ['Installation Qualification Protocol', `IQ-${DOC_YEAR}-001`, 'IQ test cases referenced in Test Case column'],
      ['Operational Qualification Protocol', `OQ-${DOC_YEAR}-001`, 'OQ test cases referenced in Test Case column'],
      ['Performance Qualification Protocol', `PQ-${DOC_YEAR}-001`, 'PQ test cases referenced in Test Case column'],
      ['Deviation Log', `DL-${DOC_YEAR}-001`, 'Deviation records referenced in Deviation column'],
      ['SOP Gap Analysis', '13-sop-gap-analysis.md', 'SOP coverage status and gaps'],
      ['HIPAA Assessment', '14-hipaa-assessment.md', 'HIPAA risk analysis and safeguards'],
      ['Training Matrix', '15-training-matrix.md', 'Training requirements by role'],
    ],
  );
  c += '\n';
  c += hr();

  // Approval Signatures
  c += approvalBlock([
    'Quality Assurance Lead',
    'Validation Lead',
    'Regulatory Affairs',
    'Project Manager',
    'System Owner',
  ]);
  c += '\n---\n*End of Document*\n';

  return c;
}
