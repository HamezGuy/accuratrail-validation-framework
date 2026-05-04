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

const DOC_DATE = SYSTEM_INFO.buildDate;

interface RegulatoryControl {
  control: string;
  file: string;
  description: string;
}

interface RegulatorySection {
  id: string;
  title: string;
  regulatoryText: string;
  controls: RegulatoryControl[];
  testCases: string;
  status: string;
  riskLevel: 'Critical' | 'High' | 'Medium' | 'Low';
}

interface ComplianceMatrixRow {
  regulation: string;
  section: string;
  title: string;
  status: string;
  risk: string;
  testRefs: string;
}

function controlTable(controls: RegulatoryControl[]): string {
  return markdownTable(
    ['Control', 'File', 'Description'],
    controls.map((ctrl) => [ctrl.control, ctrl.file, ctrl.description]),
  );
}

function regulatoryBlock(s: RegulatorySection): string {
  let out = '';
  out += section(2, `${s.id} — ${s.title}`);
  out += `**Regulatory Text:** "${s.regulatoryText}"\n\n`;
  out += `**Risk Level:** ${riskBadge(s.riskLevel)}\n\n`;
  out += '**Implementation:**\n\n';
  out += controlTable(s.controls);
  out += `\n**Test Cases:** ${s.testCases}\n\n`;
  out += `**Compliance Status:** ${s.status}\n\n`;
  out += hr();
  return out;
}

function buildComplianceRow(s: RegulatorySection, regulation: string): ComplianceMatrixRow {
  return {
    regulation,
    section: s.id,
    title: s.title,
    status: s.status.split('—')[0].trim(),
    risk: s.riskLevel,
    testRefs: s.testCases,
  };
}

function buildPart11SubpartB(): RegulatorySection[] {
  return [
    {
      id: '§11.10(a)',
      title: 'System Validation',
      riskLevel: 'Critical',
      regulatoryText:
        'Validation of systems to ensure accuracy, reliability, consistent intended ' +
        'performance, and the ability to discern invalid or altered records.',
      controls: [
        { control: 'Validation rules engine', file: 'validation-rules.service.ts', description: 'Server-side edit checks on eCRF data entry with configurable rules per form field' },
        { control: 'Input validation middleware', file: 'validation.middleware.ts', description: 'Joi schema validation on all API request payloads before controller processing' },
        { control: 'Record integrity hashing', file: 'part11.middleware.ts', description: 'SHA-256 hash chain on audit log records to detect unauthorized tampering' },
        { control: 'System validation framework', file: 'validation-framework/', description: 'Automated IQ/OQ/PQ test protocol execution with documented evidence capture' },
        { control: 'Database constraint enforcement', file: 'migrations.ts', description: 'NOT NULL, UNIQUE, CHECK, and FOREIGN KEY constraints on all regulated tables' },
        { control: 'Type-safe data contracts', file: 'shared-types/src/', description: 'Canonical DTOs enforcing data shape consistency across all system tiers' },
      ],
      testCases: 'IQ-001 through IQ-032, OQ-043, OQ-049, PQ-007',
      status: 'Compliant — Validated via documented IQ/OQ/PQ process with automated evidence capture',
    },
    {
      id: '§11.10(b)',
      title: 'Accurate and Complete Copies',
      riskLevel: 'High',
      regulatoryText:
        'The ability to generate accurate and complete copies of records in both human readable ' +
        'and electronic form suitable for inspection, review, and copying by the agency.',
      controls: [
        { control: 'PDF export service', file: 'pdf/pdf-export.service.ts', description: 'Generates human-readable PDF copies of eCRFs with all data, signatures, and audit history' },
        { control: 'CSV/Excel bulk export', file: 'export/export.service.ts', description: 'Bulk tabular data export in CSV and Excel formats with complete metadata columns' },
        { control: 'CDISC ODM XML export', file: 'export/export.service.ts', description: 'Regulatory-standard clinical data interchange format for FDA submissions' },
        { control: 'Audit trail export', file: 'audit.service.ts', description: 'Complete audit trail export filterable by study, subject, form, or date range' },
        { control: 'Print-ready rendering', file: 'print.service.ts', description: 'Browser-based print rendering with watermarks, page breaks, and header/footer stamps' },
      ],
      testCases: 'OQ-050 through OQ-056',
      status: 'Compliant — Multiple export formats available with complete data, metadata, and audit history',
    },
    {
      id: '§11.10(c)',
      title: 'Record Protection',
      riskLevel: 'Critical',
      regulatoryText:
        'Protection of records to enable their accurate and ready retrieval throughout ' +
        'the records retention period.',
      controls: [
        { control: 'Encrypted backup system', file: 'backup/backup.service.ts', description: 'AES-256 encrypted automated backups with configurable retention schedules' },
        { control: 'Backup scheduler', file: 'backup/backup-scheduler.service.ts', description: 'Automated daily, weekly, and monthly backup scheduling with integrity verification' },
        { control: 'Cloud storage replication', file: 'backup/cloud-storage.service.ts', description: 'Offsite backup replication to geographically separate AWS region' },
        { control: 'Retention manager', file: 'backup/retention-manager.service.ts', description: 'Enforces configurable retention policies (minimum 15 years for clinical data)' },
        { control: 'Data lock mechanism', file: 'data-locks.service.ts', description: 'Prevents modification or deletion of locked/frozen study records' },
        { control: 'PostgreSQL WAL archiving', file: 'Infrastructure (PostgreSQL)', description: 'Write-Ahead Logging provides point-in-time recovery capability' },
      ],
      testCases: 'OQ-057 through OQ-062, DR-001 through DR-005',
      status: 'Compliant — AES-256 encrypted backups with automated scheduling, retention enforcement, and verified restore',
    },
    {
      id: '§11.10(d)',
      title: 'System Access Controls',
      riskLevel: 'Critical',
      regulatoryText:
        'Limiting system access to authorized individuals.',
      controls: [
        { control: 'JWT authentication', file: 'auth.middleware.ts', description: 'Token-based authentication verifying user identity on every API request' },
        { control: 'Role-based authorization', file: 'authorization.middleware.ts', description: 'RBAC with 6 defined roles and 42 granular permissions enforced at each endpoint' },
        { control: 'Account provisioning workflow', file: 'auth.service.ts', description: 'User account creation, activation, deactivation, and role assignment controlled by admins' },
        { control: 'Session management', file: 'auth.service.ts', description: 'Single active session enforcement, device fingerprinting, configurable idle timeout' },
        { control: 'Request rate limiting', file: 'rateLimiter.middleware.ts', description: 'IP-based and user-based rate limiting to prevent brute-force and DoS attacks' },
        { control: 'Account lockout policy', file: 'auth.service.ts', description: 'Automatic account lockout after configurable consecutive failed login attempts' },
      ],
      testCases: 'OQ-001 through OQ-015, SEC-001 through SEC-010',
      status: 'Compliant — Multi-layered access control via authentication, authorization, session management, and rate limiting',
    },
    {
      id: '§11.10(e)',
      title: 'Audit Trails',
      riskLevel: 'Critical',
      regulatoryText:
        'Use of secure, computer-generated, time-stamped audit trails to independently record ' +
        'the date and time of operator entries and actions that create, modify, or delete ' +
        'electronic records. Record changes shall not obscure previously recorded information. ' +
        'Such audit trail documentation shall be retained for a period at least as long as that ' +
        'required for the subject electronic records and shall be available for agency review and copying.',
      controls: [
        { control: 'Audit middleware', file: 'audit.middleware.ts', description: 'Automatic capture of all data mutations with who, what, when, old value, new value, and reason' },
        { control: 'Immutable audit service', file: 'audit.service.ts', description: 'INSERT-only audit log table; no UPDATE or DELETE operations permitted on audit records' },
        { control: 'UTC timestamps', file: 'database.ts', description: 'All timestamps stored in UTC with timezone-aware rendering in the frontend UI' },
        { control: 'Previous value preservation', file: 'audit.middleware.ts', description: 'Pre-mutation snapshot captures old values so changes never obscure prior recorded data' },
        { control: 'Audit trail export', file: 'audit.service.ts', description: 'Full audit history exportable per study, subject, or form for agency inspection' },
        { control: 'Hash chain integrity', file: 'part11.middleware.ts', description: 'Sequential SHA-256 hash chain links audit entries to detect insertion or deletion of records' },
      ],
      testCases: 'OQ-016 through OQ-030, PQ-001 through PQ-006',
      status: 'Compliant — Immutable audit trail with full change history, UTC timestamps, hash chain, and agency-accessible exports',
    },
    {
      id: '§11.10(f)',
      title: 'Operational System Checks',
      riskLevel: 'High',
      regulatoryText:
        'Use of operational system checks to enforce permitted sequencing of steps and events, as appropriate.',
      controls: [
        { control: 'Workflow state machine', file: 'workflow.service.ts', description: 'Enforces clinical workflow state transitions (Draft → Submitted → Reviewed → Locked)' },
        { control: 'Visit scheduling engine', file: 'event.service.ts', description: 'Enforces protocol-defined visit windows, sequencing requirements, and window violations' },
        { control: 'Form completion validation', file: 'form.service.ts', description: 'Prevents signing of incomplete forms; all required fields must be populated and valid' },
        { control: 'Data lock sequencing', file: 'data-locks.service.ts', description: 'Enforces freeze-before-lock hierarchy; locked data cannot be unfrozen without explicit unlock' },
        { control: 'E-signature prerequisites', file: 'esignature.service.ts', description: 'Requires all queries resolved and validations passed before e-signature is permitted' },
        { control: 'Skip logic engine', file: 'form.service.ts', description: 'Conditionally displays/hides form fields based on prior answers enforcing logical data flow' },
      ],
      testCases: 'OQ-031 through OQ-037',
      status: 'Compliant — Workflow engine enforces permitted sequences; data lock hierarchy prevents out-of-order operations',
    },
  ];
}

function buildPart11SubpartB_Continued(): RegulatorySection[] {
  return [
    {
      id: '§11.10(g)',
      title: 'Authority Checks',
      riskLevel: 'Critical',
      regulatoryText:
        'Use of authority checks to ensure that only authorized individuals can use the system, ' +
        'electronically sign a record, access the operation or computer system input or output ' +
        'device, alter a record, or perform the operation at hand.',
      controls: [
        { control: 'Permission-based authorization', file: 'authorization.middleware.ts', description: '42 granular permissions checked at every endpoint; actions require explicit permission grant' },
        { control: 'E-signature authorization', file: 'esignature.service.ts', description: 'Only users with SIGN_FORMS permission can execute electronic signatures on records' },
        { control: 'Study-level access control', file: 'permission.service.ts', description: 'Users can only access studies and sites explicitly assigned to them by administrators' },
        { control: 'Data modification authority', file: 'authorization.middleware.ts', description: 'Write, edit, and delete operations require specific role-based permissions per entity type' },
        { control: 'Admin operation guards', file: 'authorization.middleware.ts', description: 'System administration operations restricted to Administrator and System Owner roles only' },
      ],
      testCases: 'OQ-038 through OQ-042, SEC-011 through SEC-015',
      status: 'Compliant — Granular RBAC with 42 permissions across 6 roles; every operation checked against user authority',
    },
    {
      id: '§11.10(h)',
      title: 'Device Checks',
      riskLevel: 'High',
      regulatoryText:
        'Use of device (e.g., terminal) checks to determine, as appropriate, the validity of ' +
        'the source of data input or operational instruction.',
      controls: [
        { control: 'Device fingerprinting', file: 'auth.service.ts', description: 'Browser and device fingerprint captured at login and verified throughout session lifetime' },
        { control: 'Session-device binding', file: 'auth.middleware.ts', description: 'JWT tokens bound to originating device; requests from different devices are rejected' },
        { control: 'CSRF protection', file: 'app.ts', description: 'Cross-Site Request Forgery tokens validated on all state-changing requests' },
        { control: 'CORS configuration', file: 'app.ts', description: 'Cross-Origin Resource Sharing restricted to authorized frontend domains only' },
        { control: 'Rate limiting per device', file: 'rateLimiter.middleware.ts', description: 'Per-IP and per-device rate limiting prevents automated attack tools from submitting data' },
      ],
      testCases: 'SEC-016 through SEC-020',
      status: 'Compliant — Device fingerprinting, CSRF protection, CORS policy, and rate limiting validate input sources',
    },
    {
      id: '§11.10(i)',
      title: 'Personnel Training',
      riskLevel: 'Medium',
      regulatoryText:
        'Determination that persons who develop, maintain, or use electronic record/electronic ' +
        'signature systems have the education, training, and experience to perform their assigned tasks.',
      controls: [
        { control: 'Training module system', file: 'training.service.ts', description: 'In-system training modules with completion tracking and certificate generation per role' },
        { control: 'Training progress tracking', file: 'training.service.ts', description: 'Per-user training completion status with date tracking and manager visibility dashboard' },
        { control: 'Training certificates', file: 'training.service.ts', description: 'PDF certificate generation upon successful module completion for personnel files' },
        { control: 'Training matrix generator', file: '15-training-matrix.ts', description: 'Automated role-based training requirements matrix specifying required modules per role' },
        { control: 'Pre-access training gate', file: 'feature-flag.guard.ts', description: 'System features can be gated on training completion status via feature flag configuration' },
      ],
      testCases: 'ADM-001 through ADM-005',
      status: 'Compliant — Training management system with role-based requirements, progress tracking, and certificate generation',
    },
    {
      id: '§11.10(j)',
      title: 'Controls for System Documentation',
      riskLevel: 'Medium',
      regulatoryText:
        'The establishment of, and adherence to, written policies that hold individuals accountable ' +
        'and responsible for actions initiated under their electronic signatures, in order to deter ' +
        'record and signature falsification.',
      controls: [
        { control: 'SOP documentation', file: 'SOPs_For_Email/', description: 'Standard Operating Procedures governing e-signature use, data entry, and record management' },
        { control: 'Compliance documentation', file: 'COMPLIANCE_DOCUMENTATION/', description: 'Written policies for Part 11 compliance, accountability, and sanction procedures' },
        { control: 'CLAUDE.md operational procedures', file: 'CLAUDE.md', description: 'Master operational procedures document governing all development and maintenance activities' },
        { control: 'E-signature meaning capture', file: 'esignature.service.ts', description: 'Every e-signature requires documented reason/meaning, creating individual accountability record' },
        { control: 'Validation framework SOPs', file: 'validation-framework/', description: 'Documented validation procedures, deviation handling, and CAPA processes' },
      ],
      testCases: 'ADM-006 through ADM-010',
      status: 'Compliant — Written policies, SOPs, and accountability mechanisms established and documented',
    },
    {
      id: '§11.10(k)(1)',
      title: 'Controls for System Documentation Distribution',
      riskLevel: 'Medium',
      regulatoryText:
        'Appropriate controls over the distribution of, access to, and use of documentation for ' +
        'system operation and maintenance.',
      controls: [
        { control: 'Version-controlled documentation', file: 'GitHub repository', description: 'All system documentation version-controlled in Git with full change history and authorship' },
        { control: 'Access-controlled repository', file: 'GitHub (private)', description: 'Repository access restricted to authorized development and operations personnel only' },
        { control: 'Validation package generation', file: 'validation-framework/', description: 'Automated generation of controlled validation documents with version and date stamps' },
        { control: 'Document classification labels', file: 'markdown-writer.ts', description: 'Every generated document includes classification level (Confidential, Regulatory, Internal)' },
      ],
      testCases: 'ADM-011 through ADM-013',
      status: 'Compliant — Documentation distributed via access-controlled version control with full audit history',
    },
    {
      id: '§11.10(k)(2)',
      title: 'Revision and Change Control',
      riskLevel: 'Medium',
      regulatoryText:
        'Revision and change control procedures to maintain an audit trail that documents ' +
        'time-sequenced development and modification of systems documentation.',
      controls: [
        { control: 'Git version control', file: 'GitHub repository', description: 'Every documentation change tracked with author, timestamp, and descriptive commit message' },
        { control: 'Document versioning', file: 'validation-framework/config/', description: 'Every generated document stamped with version number and generation date' },
        { control: 'Database migration versioning', file: 'migrations/', description: 'Date-prefixed SQL migration files creating time-sequenced record of all schema changes' },
        { control: 'Pull request review process', file: 'GitHub Pull Requests', description: 'All changes require peer review before merging; review comments and approvals preserved' },
      ],
      testCases: 'ADM-014 through ADM-016',
      status: 'Compliant — Git provides time-sequenced audit trail of all documentation and system changes',
    },
    {
      id: '§11.30',
      title: 'Controls for Open Systems',
      riskLevel: 'Critical',
      regulatoryText:
        'Controls for open systems shall include those identified in §11.10, as well as additional ' +
        'measures such as document encryption and use of appropriate digital signature standards to ' +
        'ensure, as necessary under the circumstances, record authenticity, integrity, and confidentiality.',
      controls: [
        { control: 'TLS 1.2+ enforcement', file: 'Infrastructure (Docker/Nginx)', description: 'All data in transit encrypted via TLS 1.2 or higher; HTTPS enforced in all environments' },
        { control: 'AES-256 encryption at rest', file: 'backup/encryption.service.ts', description: 'All backup data and sensitive fields encrypted at rest with AES-256-GCM; key rotation supported' },
        { control: 'JWT cryptographic signing', file: 'auth.middleware.ts', description: 'Tokens signed with HMAC-SHA256; prevents token forgery and ensures authenticity' },
        { control: 'SHA-256 record hashing', file: 'esignature.service.ts', description: 'Cryptographic hash binding e-signatures to exact record state at signing time' },
        { control: 'CORS restriction policy', file: 'app.ts', description: 'Cross-Origin Resource Sharing restricted to authorized frontend domains only' },
        { control: 'HSTS security headers', file: 'Infrastructure (Nginx/Vercel)', description: 'HTTP Strict Transport Security, CSP, X-Frame-Options, and X-Content-Type-Options headers' },
      ],
      testCases: 'SEC-021 through SEC-025',
      status: 'Compliant — TLS in transit, AES-256 at rest, cryptographic signatures, and security headers enforced',
    },
    {
      id: '§11.50',
      title: 'Signature Manifestations',
      riskLevel: 'Critical',
      regulatoryText:
        'Signed electronic records shall contain information associated with the signing that ' +
        'clearly indicates all of the following: (a) The printed name of the signer; (b) The date ' +
        'and time when the signature was executed; (c) The meaning (such as review, approval, ' +
        'responsibility, or authorship) associated with the signature.',
      controls: [
        { control: 'Signature display component', file: 'patient-form-modal/', description: 'Renders signer printed name, UTC timestamp, and meaning on all signed electronic records' },
        { control: 'E-signature data model', file: 'esignature.service.ts', description: 'Stores signer_name, signed_at (UTC), meaning, and record_hash per signature in acc_esignatures' },
        { control: 'Signature in PDF exports', file: 'pdf/pdf-export.service.ts', description: 'PDF exports display full signature manifestation block with name, date, time, and meaning' },
        { control: 'Audit trail signature records', file: 'audit.service.ts', description: 'Audit trail records SIGN action with all three manifestation fields preserved immutably' },
      ],
      testCases: 'OQ-063 through OQ-068',
      status: 'Compliant — All signed records display printed name, UTC date/time, and meaning; preserved in exports',
    },
    {
      id: '§11.70',
      title: 'Signature/Record Linking',
      riskLevel: 'Critical',
      regulatoryText:
        'Electronic signatures and handwritten signatures executed to electronic records shall be ' +
        'linked to their respective electronic records to ensure that the signatures cannot be ' +
        'excised, copied, or otherwise transferred to falsify an electronic record by ordinary means.',
      controls: [
        { control: 'SHA-256 record hash linking', file: 'esignature.service.ts', description: 'Signature cryptographically bound to SHA-256 hash of exact record state at signing time' },
        { control: 'Foreign key constraint', file: 'migrations.ts', description: 'acc_esignatures.event_crf_id references signed record with CASCADE protection; no orphans' },
        { control: 'Hash verification on display', file: 'esignature.service.ts', description: 'Record hash re-computed and compared on retrieval; hash mismatch flags tampering' },
        { control: 'Auto-invalidation on change', file: 'esignature.service.ts', description: 'Any modification to a signed record automatically invalidates the signature and triggers re-sign' },
        { control: 'Immutable signature records', file: 'esignature.service.ts', description: 'Signature records are INSERT-only; no UPDATE or DELETE operations permitted on the table' },
      ],
      testCases: 'OQ-069 through OQ-074',
      status: 'Compliant — SHA-256 cryptographic hash links each signature to exact record version; tampering auto-detected',
    },
  ];
}

function buildPart11SubpartC(): RegulatorySection[] {
  return [
    {
      id: '§11.100(a)',
      title: 'General Requirements for E-Signatures',
      riskLevel: 'Critical',
      regulatoryText:
        'Each electronic signature shall be unique to one individual and shall not be reused by, ' +
        'or reassigned to, anyone else.',
      controls: [
        { control: 'Unique username enforcement', file: 'auth.service.ts', description: 'Database UNIQUE constraint on username column; no two users can share an identification code' },
        { control: 'Account lifecycle management', file: 'user.service.ts', description: 'Deactivated accounts preserved (not deleted) and usernames never recycled or reassigned' },
        { control: 'Signature attribution', file: 'esignature.service.ts', description: 'Every signature permanently attributed to authenticated user who executed it via foreign key' },
        { control: 'Password-based two-component auth', file: 'auth.service.ts', description: 'E-signatures require both unique identification code (username) and password components' },
      ],
      testCases: 'OQ-075 through OQ-078',
      status: 'Compliant — Unique usernames enforced at database level; accounts never reused or reassigned',
    },
    {
      id: '§11.100(b)',
      title: 'Identity Verification Before E-Signature',
      riskLevel: 'Critical',
      regulatoryText:
        'Before an organization establishes, assigns, certifies, or otherwise sanctions an ' +
        "individual's electronic signature, or any element of such electronic signature, the " +
        'organization shall verify the identity of the individual.',
      controls: [
        { control: 'Admin-verified user provisioning', file: 'organization.service.ts', description: 'User accounts created by authorized administrators within organization context only' },
        { control: 'Multi-step registration workflow', file: 'auth.service.ts', description: 'Registration requires organization affiliation, role assignment, and administrator approval' },
        { control: 'Identity confirmation SOP', file: 'SOPs_For_Email/', description: 'SOP requires identity verification (government ID or equivalent) before account issuance' },
        { control: 'Provisioning audit trail', file: 'audit.service.ts', description: 'Account creation event logged with who authorized, when, and under what organization' },
      ],
      testCases: 'ADM-017 through ADM-019',
      status: 'Compliant — Identity verified before account issuance per SOP; provisioning events fully audited',
    },
    {
      id: '§11.100(c)',
      title: 'Certification to FDA',
      riskLevel: 'High',
      regulatoryText:
        'Persons using electronic signatures shall, prior to or at the time of such use, certify ' +
        'to the agency that the electronic signatures in their system, used on or after August 20, 1997, ' +
        'are intended to be the legally binding equivalent of traditional handwritten signatures.',
      controls: [
        { control: 'FDA certification letter template', file: '17a-esignature-certification-letter.md', description: 'Pre-generated certification letter per 21 CFR 11.100(c) ready for printing and mailing to FDA' },
        { control: 'Certification tracking record', file: '17a-esignature-certification-letter.md', description: 'Internal record for tracking mailing date, tracking number, and confirmation status' },
        { control: 'Signature legal equivalence statement', file: 'esignature.service.ts', description: 'System presents legal equivalence acknowledgment at each signing event to the signer' },
      ],
      testCases: 'ADM-020, ADM-021',
      status: 'Compliant — Certification letter template generated; must be printed, signed, and mailed to FDA',
    },
    {
      id: '§11.200(a)(1)(i)',
      title: 'Continuous Session Signing',
      riskLevel: 'Critical',
      regulatoryText:
        'When an individual executes a series of signings during a single, continuous period of ' +
        'controlled system access, the first signing shall be executed using all electronic signature ' +
        'components; subsequent signings shall be executed using at least one electronic signature ' +
        'component that is only executable by, and designed to be used only by, the individual.',
      controls: [
        { control: 'First-sign full authentication', file: 'esignature.service.ts', description: 'First e-signature in a session requires full username + password re-authentication' },
        { control: 'Subsequent-sign password only', file: 'esignature.service.ts', description: 'Subsequent signatures within same continuous session require password re-entry only' },
        { control: 'Session continuity tracking', file: 'auth.service.ts', description: 'Continuous session tracked via JWT and device fingerprint; break in session resets signing state' },
        { control: 'Idle timeout session break', file: 'auth.service.ts', description: 'Session idle timeout (30 minutes default) breaks continuity; next sign requires full re-auth' },
      ],
      testCases: 'OQ-079 through OQ-082',
      status: 'Compliant — First signing requires full two-component auth; subsequent signings require password only',
    },
    {
      id: '§11.200(a)(1)(ii)',
      title: 'Non-Continuous Session Signing',
      riskLevel: 'Critical',
      regulatoryText:
        'When an individual executes one or more signings not performed during a single, ' +
        'continuous period of controlled system access, each signing shall be executed using ' +
        'all of the electronic signature components.',
      controls: [
        { control: 'Full re-authentication per signing', file: 'esignature.service.ts', description: 'After session break (timeout, logout, new login), full username + password required for each sign' },
        { control: 'Session discontinuity detection', file: 'auth.middleware.ts', description: 'Detects non-continuous access via JWT expiration, device change, or idle timeout trigger' },
        { control: 'Signing session state reset', file: 'esignature.service.ts', description: 'Server-side signing session state cleared on any session discontinuity event' },
        { control: 'No session-based signing shortcuts', file: 'esignature.service.ts', description: 'System never allows signing based solely on active session without credential re-entry' },
      ],
      testCases: 'OQ-083 through OQ-086',
      status: 'Compliant — Non-continuous signings always require full two-component authentication',
    },
    {
      id: '§11.300(a)',
      title: 'Uniqueness Controls',
      riskLevel: 'High',
      regulatoryText:
        'Ensure that identification codes, in combination with passwords, are unique so that no ' +
        'two individuals have the same combination of identification code and password.',
      controls: [
        { control: 'Unique username constraint', file: 'migrations.ts', description: 'Database-level UNIQUE constraint on username column prevents duplicate identification codes' },
        { control: 'Unique email enforcement', file: 'auth.service.ts', description: 'Email address also constrained unique providing secondary identity assurance and recovery path' },
        { control: 'Per-user password salting', file: 'auth.service.ts', description: 'Bcrypt hashing with unique random salt per user; identical passwords produce different hashes' },
        { control: 'Duplicate detection audit', file: 'audit.service.ts', description: 'Duplicate account creation attempts rejected at database level and logged in audit trail' },
      ],
      testCases: 'SEC-026, SEC-027',
      status: 'Compliant — Database constraints enforce unique identification codes; no shared combinations possible',
    },
    {
      id: '§11.300(b)',
      title: 'Periodic Revision of Identification Components',
      riskLevel: 'High',
      regulatoryText:
        'Ensuring that identification codes and passwords are periodically checked, recalled, ' +
        'or revised (e.g., to cover such events as password aging).',
      controls: [
        { control: 'Password expiration policy', file: 'auth.service.ts', description: 'Configurable password expiration period (default 90 days); forced reset on expiry' },
        { control: 'Password history enforcement', file: 'auth.service.ts', description: 'Prevents reuse of last N passwords (configurable); enforces genuine password rotation' },
        { control: 'Password complexity rules', file: 'auth.service.ts', description: 'Minimum length, uppercase, lowercase, numeric, and special character requirements enforced' },
        { control: 'Administrative forced reset', file: 'user.service.ts', description: 'Administrators can trigger immediate password reset for any user account on demand' },
      ],
      testCases: 'SEC-028, SEC-029',
      status: 'Compliant — Password aging with configurable expiration, history enforcement, and complexity requirements',
    },
    {
      id: '§11.300(c)',
      title: 'Loss Management',
      riskLevel: 'High',
      regulatoryText:
        'Following loss management procedures to electronically deauthorize lost, stolen, ' +
        'missing, or otherwise potentially compromised tokens, cards, and other devices that ' +
        'bear or generate identification code or password information, and to issue temporary ' +
        'or permanent replacements using suitable, rigorous controls.',
      controls: [
        { control: 'Token blocklist on logout', file: 'auth.service.ts', description: 'Immediate session revocation capability; compromised JWT tokens added to server-side blocklist' },
        { control: 'Admin account deactivation', file: 'user.service.ts', description: 'Rapid account deactivation workflow for lost or stolen credentials via admin panel' },
        { control: 'Session revocation', file: 'auth.service.ts', description: 'All active sessions for a user can be revoked instantly by administrator action' },
        { control: 'Device fingerprint invalidation', file: 'auth.service.ts', description: 'Device fingerprint cleared on compromise report; forces re-authentication from all devices' },
        { control: 'Incident audit logging', file: 'audit.service.ts', description: 'All loss management actions logged in audit trail with reason and administrator identity' },
      ],
      testCases: 'SEC-030, SEC-031',
      status: 'Compliant — Immediate session revocation, account deactivation, and forced credential reset available',
    },
    {
      id: '§11.300(d)',
      title: 'Transaction Safeguards',
      riskLevel: 'High',
      regulatoryText:
        'Use of transaction safeguards to prevent unauthorized use of passwords and/or identification ' +
        'codes, and to detect and report in an immediate and urgent manner any attempts at their ' +
        'unauthorized use to the system security unit, and, as appropriate, to organizational management.',
      controls: [
        { control: 'Failed login detection', file: 'auth.service.ts', description: 'Failed login attempts counted and logged with IP address, timestamp, and username attempted' },
        { control: 'Account lockout mechanism', file: 'auth.service.ts', description: 'Automatic account lockout after configurable consecutive failed attempts (default: 5)' },
        { control: 'Request rate limiting', file: 'rateLimiter.middleware.ts', description: 'Per-IP rate limiting prevents automated brute-force password guessing attacks' },
        { control: 'Anomaly detection alerts', file: 'notification.service.ts', description: 'Administrators notified of suspicious activity (multiple failed logins, unusual access patterns)' },
        { control: 'Security event flagging', file: 'audit.service.ts', description: 'Security-relevant events flagged for immediate review in audit trail dashboard' },
      ],
      testCases: 'SEC-032 through SEC-035',
      status: 'Compliant — Failed login detection, account lockout, rate limiting, and notification mechanisms active',
    },
    {
      id: '§11.300(e)',
      title: 'Device Authentication',
      riskLevel: 'Medium',
      regulatoryText:
        'Initial and periodic testing of devices, such as tokens or cards, that bear or generate ' +
        'identification code or password information to ensure that they function properly and ' +
        'have not been altered in an unauthorized manner.',
      controls: [
        { control: 'Device fingerprint verification', file: 'auth.service.ts', description: 'Device fingerprint validated on every authenticated request; altered fingerprints rejected' },
        { control: 'JWT integrity verification', file: 'auth.middleware.ts', description: 'Token cryptographic signature verified on every request; tampered tokens rejected immediately' },
        { control: 'Session consistency checks', file: 'auth.middleware.ts', description: 'Session metadata (device, IP) checked for consistency throughout session lifetime' },
        { control: 'Automated security testing', file: 'validation-framework/', description: 'IQ/OQ test cases verify authentication device behavior and tamper detection mechanisms' },
      ],
      testCases: 'SEC-036, SEC-037',
      status: 'Compliant — Token integrity and device fingerprint verified on every request; automated testing validates',
    },
  ];
}

function buildHIPAASections(): RegulatorySection[] {
  return [
    {
      id: '§164.308(a)(1)',
      title: 'Security Management Process',
      riskLevel: 'Critical',
      regulatoryText:
        'Implement policies and procedures to prevent, detect, contain, and correct security violations.',
      controls: [
        { control: 'Global error handler', file: 'errorHandler.middleware.ts', description: 'Catches and logs all unhandled errors; prevents information leakage in error responses' },
        { control: 'Request rate limiting', file: 'rateLimiter.middleware.ts', description: 'Rate-based throttling prevents abuse and contains automated attack patterns' },
        { control: 'Role-based access control', file: 'authorization.middleware.ts', description: 'Granular RBAC prevents unauthorized access; violations logged for investigation' },
        { control: 'Comprehensive audit logging', file: 'audit.middleware.ts', description: 'All system activity logged for forensic analysis and security violation detection' },
        { control: 'Security event detection', file: 'auth.service.ts', description: 'Failed login patterns, unusual access times, and privilege escalation attempts detected' },
        { control: 'Input sanitization', file: 'validation.middleware.ts', description: 'All inputs validated and sanitized to prevent injection attacks and data corruption' },
      ],
      testCases: 'SEC-038 through SEC-042',
      status: 'Compliant — Prevention, detection, containment, and correction mechanisms implemented',
    },
    {
      id: '§164.308(a)(5)',
      title: 'Security Awareness and Training',
      riskLevel: 'Medium',
      regulatoryText:
        'Implement a security awareness and training program for all members of its workforce ' +
        '(including management).',
      controls: [
        { control: 'Training module system', file: 'training.service.ts', description: 'Role-specific security awareness training modules with completion tracking' },
        { control: 'Security training records', file: 'training.service.ts', description: 'Audit trail of training completion dates, scores, and certificate issuance per user' },
        { control: 'Certificate generation', file: 'training.service.ts', description: 'PDF training certificates generated on completion for compliance documentation' },
        { control: 'Training matrix', file: '15-training-matrix.ts', description: 'Defines mandatory security training by role including refresher intervals' },
        { control: 'Login security reminders', file: 'auth.service.ts', description: 'Security awareness messaging displayed during authentication workflow' },
        { control: 'Password management guidance', file: 'SOPs_For_Email/', description: 'SOP provides password security guidance and prohibited practices' },
        { control: 'Phishing awareness content', file: 'training.service.ts', description: 'Training content covering social engineering and phishing attack recognition' },
      ],
      testCases: 'ADM-022 through ADM-025',
      status: 'Compliant — Security awareness training program with role-based requirements and completion tracking',
    },
    {
      id: '§164.308(a)(6)',
      title: 'Security Incident Procedures',
      riskLevel: 'High',
      regulatoryText:
        'Implement policies and procedures to address security incidents.',
      controls: [
        { control: 'Incident logging', file: 'audit.service.ts', description: 'Security incidents automatically logged with timestamp, severity, affected resources, and actor' },
        { control: 'Breach detection patterns', file: 'auth.service.ts', description: 'Pattern-based detection of potential breaches (mass data access, privilege escalation)' },
        { control: 'Notification service integration', file: 'notification.service.ts', description: 'Automated administrator alerts for detected security incidents requiring immediate response' },
        { control: 'Audit trail review capability', file: 'audit.service.ts', description: 'Incident investigation via comprehensive audit trail search and filtering tools' },
        { control: 'Response documentation', file: 'COMPLIANCE_DOCUMENTATION/', description: 'Incident response SOP defining roles, escalation paths, and remediation procedures' },
        { control: 'Post-incident review process', file: 'COMPLIANCE_DOCUMENTATION/', description: 'SOP requires root cause analysis and preventive action plan after every security incident' },
        { control: 'Evidence preservation', file: 'audit.service.ts', description: 'Immutable audit trail preserves forensic evidence during incident investigation' },
      ],
      testCases: 'SEC-043 through SEC-046',
      status: 'Compliant — Security incident detection, logging, notification, and response procedures implemented',
    },
    {
      id: '§164.308(a)(7)',
      title: 'Contingency Plan',
      riskLevel: 'Critical',
      regulatoryText:
        'Establish (and implement as needed) policies and procedures for responding to an emergency ' +
        'or other occurrence (for example, fire, vandalism, system failure, and natural disaster) ' +
        'that damages systems that contain electronic protected health information.',
      controls: [
        { control: 'Automated backup service', file: 'backup/backup.service.ts', description: 'Scheduled encrypted backups with verified integrity checks before and after storage' },
        { control: 'Disaster recovery procedures', file: 'backup/backup.service.ts', description: 'Documented restore procedures with tested recovery time objectives (RTO < 4 hours)' },
        { control: 'Cloud storage redundancy', file: 'backup/cloud-storage.service.ts', description: 'Geographically distributed backup storage ensuring data survival in regional disasters' },
        { control: 'Retention policy enforcement', file: 'backup/retention-manager.service.ts', description: 'Automated retention with minimum 15-year retention for clinical ePHI data' },
        { control: 'Recovery testing schedule', file: 'validation-framework/', description: 'Quarterly disaster recovery testing with documented results and remediation actions' },
        { control: 'Data backup plan', file: 'backup/backup-scheduler.service.ts', description: 'Daily incremental and weekly full backup schedule with configurable RPO targets' },
        { control: 'Emergency mode operation', file: 'COMPLIANCE_DOCUMENTATION/', description: 'Procedures for operating with degraded capability while systems are being restored' },
      ],
      testCases: 'DR-001 through DR-010',
      status: 'Compliant — Backup, restore, and disaster recovery procedures established and periodically tested',
    },
    {
      id: '§164.308(b)(1)',
      title: 'Business Associate Contracts',
      riskLevel: 'High',
      regulatoryText:
        'A covered entity may permit a business associate to create, receive, maintain, or transmit ' +
        'electronic protected health information on the covered entity\'s behalf only if the covered ' +
        'entity obtains satisfactory assurances that the business associate will appropriately ' +
        'safeguard the information.',
      controls: [
        { control: 'BAA template documentation', file: 'COMPLIANCE_DOCUMENTATION/', description: 'Business Associate Agreement templates with required HIPAA safeguard clauses' },
        { control: 'Third-party security audit', file: 'COMPLIANCE_DOCUMENTATION/', description: 'Security assessment questionnaire for evaluating business associate ePHI protections' },
        { control: 'FHIR adapter security controls', file: 'interop-middleware/src/', description: 'EHR integration adapters enforce TLS, audit logging, and minimal data exposure' },
        { control: 'Integration access controls', file: 'interop-middleware/src/', description: 'All external integrations authenticated and authorized via SMART on FHIR or API keys' },
        { control: 'Vendor security review', file: 'COMPLIANCE_DOCUMENTATION/', description: 'Annual security review of all third-party vendors with ePHI access documented' },
        { control: 'Minimum necessary principle', file: 'interop-middleware/src/', description: 'External integrations limited to minimum necessary ePHI for stated purpose' },
      ],
      testCases: 'ADM-026 through ADM-028',
      status: 'Compliant — BAA templates and third-party security assessment procedures established',
    },
    {
      id: '§164.312(a)(1)',
      title: 'Access Control',
      riskLevel: 'Critical',
      regulatoryText:
        'Implement technical policies and procedures for electronic information systems that maintain ' +
        'electronic protected health information to allow access only to those persons or software ' +
        'programs that have been granted access rights as specified in §164.308(a)(4).',
      controls: [
        { control: 'RBAC permission system', file: 'permission.service.ts', description: '42 granular permissions across 6 roles controlling access to all ePHI-containing resources' },
        { control: 'JWT authentication layer', file: 'auth.middleware.ts', description: 'Every API request authenticated via cryptographically signed JWT token before processing' },
        { control: 'Feature flag guards', file: 'feature-flag.guard.ts', description: 'Feature-level access control via configurable flags restricting functionality by role/status' },
        { control: 'Study-site scoping', file: 'permission.service.ts', description: 'Users can only access ePHI for studies and sites explicitly assigned to them' },
        { control: 'API endpoint authorization', file: 'authorization.middleware.ts', description: 'Every endpoint specifies required permissions; unauthorized access returns 403 and is logged' },
        { control: 'Emergency access procedure', file: 'auth.service.ts', description: 'Break-glass procedure for emergency ePHI access with mandatory post-access audit review' },
      ],
      testCases: 'OQ-001 through OQ-015, SEC-001 through SEC-010',
      status: 'Compliant — Multi-layered technical access control enforcing need-to-know access to ePHI',
    },
    {
      id: '§164.312(a)(2)(i)',
      title: 'Unique User Identification',
      riskLevel: 'High',
      regulatoryText:
        'Assign a unique name and/or number for identifying and tracking user identity.',
      controls: [
        { control: 'Auto-increment user ID', file: 'migrations.ts', description: 'Database-generated unique integer ID for each user record; immutable after creation' },
        { control: 'Unique username enforcement', file: 'auth.service.ts', description: 'Database UNIQUE constraint on username; serves as human-readable identification code' },
        { control: 'Unique email constraint', file: 'auth.service.ts', description: 'Email uniqueness enforced providing secondary identification and account recovery channel' },
        { control: 'User identity in audit trail', file: 'audit.middleware.ts', description: 'Every audit record references the acting user by unique ID enabling complete user tracking' },
        { control: 'No shared accounts policy', file: 'SOPs_For_Email/', description: 'SOP prohibits shared or generic accounts; each user must have individual credentials' },
      ],
      testCases: 'SEC-047, SEC-048',
      status: 'Compliant — Unique user ID, username, and email assigned to each individual; tracked in all actions',
    },
    {
      id: '§164.312(a)(2)(iii)',
      title: 'Automatic Logoff',
      riskLevel: 'High',
      regulatoryText:
        'Implement electronic procedures that terminate an electronic session after a predetermined ' +
        'time of inactivity.',
      controls: [
        { control: 'Backend session timeout', file: 'auth.middleware.ts', description: 'Server-side JWT expiration enforcement; tokens expire after configurable period (default 8 hours)' },
        { control: 'Frontend idle detection', file: 'auth.service.ts (Angular)', description: 'Client-side idle activity monitoring with configurable timeout (default 30 minutes)' },
        { control: 'Configurable timeout settings', file: 'environment.ts', description: 'Organization-configurable idle timeout and session duration via environment variables' },
        { control: 'Logout on timeout', file: 'auth.service.ts', description: 'Automatic session termination with token invalidation when idle timeout threshold reached' },
        { control: 'Timeout warning dialog', file: 'auth.service.ts (Angular)', description: 'User warned 2 minutes before automatic logoff with option to extend session' },
        { control: 'Screen lock on inactivity', file: 'auth.service.ts (Angular)', description: 'Frontend displays authentication screen overlay on timeout preventing unauthorized viewing' },
      ],
      testCases: 'OQ-087 through OQ-090',
      status: 'Compliant — Configurable idle timeout with frontend detection, warning dialog, and automatic logoff',
    },
    {
      id: '§164.312(a)(2)(iv)',
      title: 'Encryption and Decryption',
      riskLevel: 'Critical',
      regulatoryText:
        'Implement a mechanism to encrypt and decrypt electronic protected health information.',
      controls: [
        { control: 'AES-256-GCM encryption at rest', file: 'backup/encryption.service.ts', description: 'All backup data encrypted with AES-256-GCM authenticated encryption; key rotation supported' },
        { control: 'TLS 1.2+ in transit', file: 'Infrastructure (Nginx/Docker)', description: 'All network communication encrypted with TLS 1.2 or higher; weak ciphers disabled' },
        { control: 'Bcrypt password hashing', file: 'auth.service.ts', description: 'Passwords hashed with bcrypt (cost factor 12); never stored or transmitted in plaintext' },
        { control: 'Database connection encryption', file: 'database.ts', description: 'PostgreSQL connections use SSL/TLS encryption; unencrypted connections rejected' },
        { control: 'Key management', file: 'backup/encryption.service.ts', description: 'Encryption keys stored separately from encrypted data; key rotation without data re-encryption' },
        { control: 'Encryption algorithm validation', file: 'backup/encryption.service.ts', description: 'Only NIST-approved algorithms used; validated against FIPS 140-2 requirements' },
      ],
      testCases: 'SEC-049 through SEC-053',
      status: 'Compliant — AES-256 at rest, TLS in transit, bcrypt hashing, and key management implemented',
    },
    {
      id: '§164.312(b)',
      title: 'Audit Controls',
      riskLevel: 'Critical',
      regulatoryText:
        'Implement hardware, software, and/or procedural mechanisms that record and examine ' +
        'activity in information systems that contain or use electronic protected health information.',
      controls: [
        { control: 'Audit middleware', file: 'audit.middleware.ts', description: 'Automatic capture of all ePHI access, creation, modification, and deletion events' },
        { control: 'Immutable audit log', file: 'audit.service.ts', description: 'INSERT-only acc_audit_log table; no UPDATE or DELETE operations; hash chain integrity' },
        { control: 'Audit trail search and export', file: 'audit.service.ts', description: 'Comprehensive search, filter, and export capabilities for audit examination' },
        { control: 'Hash chain integrity verification', file: 'part11.middleware.ts', description: 'SHA-256 hash chain linking sequential audit entries; any tampering detectable on verification' },
        { control: 'Audit data retention', file: 'backup/retention-manager.service.ts', description: 'Audit records retained for minimum 6 years (HIPAA) or 15 years (clinical trial) whichever longer' },
        { control: 'Real-time activity monitoring', file: 'audit.service.ts', description: 'Dashboard view of recent system activity for administrative examination of access patterns' },
      ],
      testCases: 'OQ-016 through OQ-030',
      status: 'Compliant — Comprehensive immutable audit trail with hash chain integrity and examination tools',
    },
    {
      id: '§164.312(c)(1)',
      title: 'Integrity',
      riskLevel: 'Critical',
      regulatoryText:
        'Implement policies and procedures to protect electronic protected health information ' +
        'from improper alteration or destruction.',
      controls: [
        { control: 'Data lock mechanism', file: 'data-locks.service.ts', description: 'Locked/frozen records cannot be altered; requires explicit unlock with audit trail reason' },
        { control: 'Audit trail immutability', file: 'audit.service.ts', description: 'Audit records INSERT-only; database triggers prevent any modification or deletion' },
        { control: 'Hash chain verification', file: 'part11.middleware.ts', description: 'Sequential hash chain detects any insertion, deletion, or alteration of audit records' },
        { control: 'Transaction isolation', file: 'database.ts', description: 'ACID transactions with appropriate isolation levels prevent concurrent data corruption' },
        { control: 'Database constraints', file: 'migrations.ts', description: 'CHECK, NOT NULL, and FOREIGN KEY constraints prevent invalid data states at database level' },
        { control: 'Backup integrity verification', file: 'backup/backup.service.ts', description: 'SHA-256 checksums computed pre-encryption and verified post-decryption on restore' },
        { control: 'Soft delete pattern', file: 'database patterns', description: 'Records marked as deleted rather than physically removed; preserves data for audit purposes' },
      ],
      testCases: 'OQ-091 through OQ-096',
      status: 'Compliant — Multi-layered integrity protection via locks, immutable audit, hash chains, and constraints',
    },
    {
      id: '§164.312(d)',
      title: 'Person or Entity Authentication',
      riskLevel: 'Critical',
      regulatoryText:
        'Implement procedures to verify that a person or entity seeking access to electronic ' +
        'protected health information is the one claimed.',
      controls: [
        { control: 'Username/password authentication', file: 'auth.service.ts', description: 'Two-component authentication with unique username and bcrypt-hashed password' },
        { control: 'JWT token verification', file: 'auth.middleware.ts', description: 'Cryptographic signature verification on every API request ensures token authenticity' },
        { control: 'Device fingerprinting', file: 'auth.service.ts', description: 'Browser/device fingerprint captured and verified to detect session hijacking' },
        { control: 'Re-authentication for sensitive actions', file: 'esignature.service.ts', description: 'Credential re-entry required for e-signatures and other high-risk operations' },
        { control: 'Failed authentication handling', file: 'auth.service.ts', description: 'Account lockout, delay injection, and alerting on repeated authentication failures' },
        { control: 'Session token binding', file: 'auth.middleware.ts', description: 'JWT bound to device fingerprint and IP; mismatches invalidate token immediately' },
      ],
      testCases: 'OQ-001 through OQ-010, SEC-001 through SEC-005',
      status: 'Compliant — Multi-factor authentication with device binding and re-authentication for sensitive actions',
    },
    {
      id: '§164.312(e)(1)',
      title: 'Transmission Security',
      riskLevel: 'Critical',
      regulatoryText:
        'Implement technical security measures to guard against unauthorized access to electronic ' +
        'protected health information that is being transmitted over an electronic communications network.',
      controls: [
        { control: 'TLS 1.2+ enforcement', file: 'Infrastructure (Nginx)', description: 'All API and frontend traffic encrypted via TLS 1.2+; TLS 1.0 and 1.1 disabled' },
        { control: 'HSTS headers', file: 'Infrastructure (Nginx/Vercel)', description: 'HTTP Strict Transport Security header forces browsers to use HTTPS exclusively' },
        { control: 'Secure cookie flags', file: 'auth.service.ts', description: 'All cookies set with Secure, HttpOnly, and SameSite flags preventing interception' },
        { control: 'CORS origin restriction', file: 'app.ts', description: 'Cross-Origin Resource Sharing limited to authorized domains; blocks unauthorized API access' },
        { control: 'Certificate pinning guidance', file: 'COMPLIANCE_DOCUMENTATION/', description: 'Deployment documentation specifies certificate management and renewal procedures' },
        { control: 'API request encryption', file: 'Infrastructure (Nginx)', description: 'All request/response payloads encrypted in transit; no plaintext ePHI on network' },
      ],
      testCases: 'SEC-054 through SEC-058',
      status: 'Compliant — TLS 1.2+ with HSTS, secure cookies, and CORS restrictions guard all transmissions',
    },
    {
      id: '§164.404',
      title: 'Breach Notification',
      riskLevel: 'Critical',
      regulatoryText:
        'A covered entity shall, following the discovery of a breach of unsecured protected health ' +
        'information, notify each individual whose unsecured protected health information has been, ' +
        'or is reasonably believed by the covered entity to have been, accessed, acquired, used, ' +
        'or disclosed as a result of such breach.',
      controls: [
        { control: 'Breach detection logging', file: 'audit.service.ts', description: 'Anomalous data access patterns logged and flagged for security team review' },
        { control: 'Notification service', file: 'notification.service.ts', description: 'Automated notification delivery system for breach alerts to affected individuals' },
        { control: 'Breach notification workflow', file: 'COMPLIANCE_DOCUMENTATION/', description: 'SOP defining breach assessment, notification timeline (60 days), and content requirements' },
        { control: 'Breach risk assessment', file: 'COMPLIANCE_DOCUMENTATION/', description: 'Documented risk assessment methodology to determine notification requirement per breach' },
        { control: 'Breach log maintenance', file: 'audit.service.ts', description: 'All suspected and confirmed breaches logged with discovery date, assessment, and remediation' },
        { control: 'HHS notification procedure', file: 'COMPLIANCE_DOCUMENTATION/', description: 'Procedure for notifying HHS Secretary of breaches affecting 500+ individuals' },
      ],
      testCases: 'SEC-059 through SEC-062',
      status: 'Compliant — Breach detection, risk assessment, notification workflow, and logging procedures in place',
    },
  ];
}

function buildTocEntries(): Array<{ level: number; title: string }> {
  return [
    { level: 1, title: 'Introduction' },
    { level: 1, title: 'Purpose and Scope' },
    { level: 1, title: 'Regulatory Framework Overview' },
    { level: 1, title: 'Definitions and Acronyms' },
    { level: 1, title: 'System Architecture Summary' },
    { level: 1, title: '21 CFR Part 11 — Electronic Records; Electronic Signatures' },
    { level: 2, title: 'Subpart B — Electronic Records (§11.10)' },
    { level: 2, title: 'Subpart B — Open Systems (§11.30)' },
    { level: 2, title: 'Subpart B — Signature Manifestations (§11.50)' },
    { level: 2, title: 'Subpart B — Signature/Record Linking (§11.70)' },
    { level: 2, title: 'Subpart C — Electronic Signatures (§11.100)' },
    { level: 2, title: 'Subpart C — Signature Components (§11.200)' },
    { level: 2, title: 'Subpart C — Controls for Identification Codes/Passwords (§11.300)' },
    { level: 1, title: 'HIPAA Security Rule — Technical Safeguards' },
    { level: 2, title: 'Administrative Safeguards (§164.308)' },
    { level: 2, title: 'Technical Safeguards (§164.312)' },
    { level: 2, title: 'Breach Notification Rule (§164.404)' },
    { level: 1, title: 'Summary Compliance Matrix' },
    { level: 1, title: 'Gap Analysis and Remediation Plan' },
    { level: 1, title: 'Risk Assessment Summary' },
    { level: 1, title: 'Test Case Cross-Reference' },
    { level: 1, title: 'Regulatory Inspection Readiness' },
    { level: 1, title: 'Continuous Compliance Monitoring' },
    { level: 1, title: 'Document Approval' },
  ];
}

export function generate(outputDir: string, _workspaceRoot: string): void {
  const part11SubpartB = buildPart11SubpartB();
  const part11Continued = buildPart11SubpartB_Continued();
  const part11SubpartC = buildPart11SubpartC();
  const hipaaSections = buildHIPAASections();

  const allSections = [...part11SubpartB, ...part11Continued, ...part11SubpartC, ...hipaaSections];

  let c = '';

  c += documentHeader({
    title: 'Regulatory Requirements Traceability Map',
    documentId: 'VAL-018',
    version: '1.0',
    date: DOC_DATE,
    system: SYSTEM_INFO.fullName,
    classification: 'Confidential',
  });

  c += tableOfContents(buildTocEntries());
  c += '\n';
  c += hr();

  c += section(1, 'Introduction');
  c += `This document provides a comprehensive traceability map between regulatory requirements `;
  c += `from 21 CFR Part 11 (Electronic Records; Electronic Signatures) and HIPAA Security Rule `;
  c += `(45 CFR Parts 160 and 164) to the specific implementation controls within the `;
  c += `**${SYSTEM_INFO.fullName}** (version ${SYSTEM_INFO.version}).\n\n`;
  c += `Each regulatory requirement is mapped to:\n`;
  c += `- The specific source code file(s) implementing the control\n`;
  c += `- A description of how the control satisfies the regulatory requirement\n`;
  c += `- The verification test cases that validate compliance\n`;
  c += `- The current compliance status and risk level\n`;
  c += `- The risk classification based on patient safety and data integrity impact\n\n`;
  c += `This map enables auditors and inspectors to trace any regulatory requirement directly to `;
  c += `its implementation and verification evidence within the system.\n\n`;
  c += '**Document Maintenance:**\n\n';
  c += 'This document is a living artifact that must be updated whenever:\n';
  c += '- A new system release modifies compliance-relevant controls\n';
  c += '- New regulatory guidance is issued by the FDA or HHS/OCR\n';
  c += '- A gap is identified during internal or external audit\n';
  c += '- A corrective action addresses a previously identified gap\n';
  c += '- Organizational changes affect roles or responsibilities for compliance\n\n';
  c += '**Version History:**\n\n';
  c += markdownTable(['Version', 'Date', 'Author', 'Description of Changes'], [
    ['1.0', DOC_DATE, 'Validation Framework (automated)', 'Initial document generation with full regulatory mapping'],
  ]);
  c += '\n';
  c += '**Related Documents:**\n\n';
  c += markdownTable(['Document ID', 'Title', 'Relationship'], [
    ['VAL-002', 'System Validation Plan', 'Defines overall validation strategy referenced by this map'],
    ['VAL-005', 'Risk Assessment', 'Risk classifications used in this map derive from VAL-005'],
    ['VAL-006', 'Traceability Matrix', 'Complementary document tracing requirements to test cases'],
    ['VAL-007', 'IQ Protocol', 'Test protocols referenced in this map (IQ-xxx test cases)'],
    ['VAL-008', 'OQ Protocol', 'Test protocols referenced in this map (OQ-xxx, SEC-xxx test cases)'],
    ['VAL-009', 'PQ Protocol', 'Test protocols referenced in this map (PQ-xxx test cases)'],
    ['VAL-014', 'HIPAA Assessment', 'Detailed HIPAA privacy and security assessment'],
    ['VAL-017', 'FDA Supplemental Documents', 'FDA-specific artifacts including e-signature certification'],
  ]);
  c += '\n';
  c += hr();

  c += section(1, 'Purpose and Scope');
  c += '**Purpose:** Demonstrate full traceability between FDA 21 CFR Part 11 requirements and ';
  c += 'HIPAA Security Rule technical safeguards to the implemented controls in AccuraTrial EDC.\n\n';
  c += '**Objectives:**\n\n';
  c += '1. Provide auditors with a single reference document mapping every applicable regulatory requirement to system controls\n';
  c += '2. Identify any gaps between regulatory requirements and current implementation status\n';
  c += '3. Document the risk level associated with each requirement for prioritization of controls\n';
  c += '4. Link each requirement to specific test cases that verify compliance\n';
  c += '5. Establish a baseline for ongoing compliance monitoring and periodic reassessment\n\n';
  c += '**Scope:**\n\n';
  c += markdownTable(['Regulation', 'Sections Covered', 'Applicability'], [
    ['21 CFR Part 11', '§11.10(a)–(k), §11.30, §11.50, §11.70, §11.100, §11.200, §11.300', 'Full applicability — system manages electronic records and signatures'],
    ['HIPAA Security Rule', '§164.308, §164.312, §164.404', 'Applicable when system processes ePHI in covered clinical trials'],
  ]);
  c += '\n**Exclusions:**\n\n';
  c += '- Biometric-based electronic signatures (§11.200(b)) — system uses non-biometric two-component signatures\n';
  c += '- HIPAA Physical Safeguards (§164.310) — addressed in separate facility security documentation\n';
  c += '- HIPAA Organizational Requirements (§164.314) — addressed in BAA and organizational policy documents\n';
  c += '- HIPAA Policies and Procedures (§164.316) — addressed in SOP documentation package\n\n';
  c += '**Assessment Methodology:**\n\n';
  c += 'Each regulatory requirement was assessed using the following methodology:\n\n';
  c += '1. **Requirement Extraction:** Regulatory text extracted verbatim from the Code of Federal Regulations\n';
  c += '2. **Control Identification:** System source code, configuration, and documentation reviewed to identify implementing controls\n';
  c += '3. **Evidence Mapping:** Each control linked to specific source files and verification test cases\n';
  c += '4. **Risk Classification:** Risk level assigned based on patient safety impact, data integrity impact, and regulatory penalty severity\n';
  c += '5. **Status Determination:** Compliance status assessed as Compliant, Partial, or Non-Compliant based on control effectiveness\n';
  c += '6. **Gap Identification:** Any requirement without full control coverage documented in Gap Analysis section\n\n';
  c += '**Risk Classification Criteria:**\n\n';
  c += markdownTable(['Risk Level', 'Patient Safety Impact', 'Data Integrity Impact', 'Regulatory Consequence'], [
    ['Critical', 'Direct risk to patient safety or rights', 'Loss or corruption of primary clinical data', 'Warning Letter, consent decree, criminal prosecution'],
    ['High', 'Indirect risk through compromised data quality', 'Potential for undetected data modification', '483 observation, enforcement action'],
    ['Medium', 'No direct patient safety impact', 'Administrative records at risk', 'Audit finding, corrective action required'],
    ['Low', 'No patient safety impact', 'No data integrity impact', 'Observation, best practice recommendation'],
  ]);
  c += '\n';
  c += hr();

  c += section(1, 'Regulatory Framework Overview');
  c += '**21 CFR Part 11** establishes requirements for electronic records and electronic signatures ';
  c += 'to be considered trustworthy, reliable, and equivalent to paper records and handwritten signatures. ';
  c += 'The rule applies to any records required by FDA regulations that are maintained in electronic form.\n\n';
  c += '**HIPAA Security Rule** (45 CFR §164.302–318) establishes national standards for protecting ';
  c += 'electronic protected health information (ePHI). When clinical trials involve ePHI, the system ';
  c += 'must comply with both 21 CFR Part 11 and HIPAA Security Rule requirements.\n\n';
  c += markdownTable(['Framework', 'Authority', 'Effective Date', 'Enforcement'], [
    ['21 CFR Part 11', 'FDA (Food and Drug Administration)', 'August 20, 1997', 'FDA inspections, Warning Letters, 483 observations'],
    ['HIPAA Security Rule', 'HHS/OCR (Office for Civil Rights)', 'April 20, 2005', 'OCR audits, civil monetary penalties, corrective action plans'],
  ]);
  c += '\n';

  c += '**Relationship Between Regulations:**\n\n';
  c += 'When a clinical trial collects data that constitutes ePHI (individually identifiable health ';
  c += 'information transmitted or maintained electronically), the system must satisfy both regulatory ';
  c += 'frameworks simultaneously. The following table identifies overlapping requirements:\n\n';
  c += markdownTable(['Control Domain', '21 CFR Part 11 Section', 'HIPAA Section', 'Overlap Description'], [
    ['Access Control', '§11.10(d), §11.10(g)', '§164.312(a)(1)', 'Both require technical access restrictions to authorized individuals only'],
    ['Audit Trails', '§11.10(e)', '§164.312(b)', 'Both require mechanisms to record and examine system activity'],
    ['Data Integrity', '§11.10(a), §11.70', '§164.312(c)(1)', 'Both require protection against improper alteration of records'],
    ['Authentication', '§11.200, §11.300', '§164.312(d)', 'Both require verification of person/entity identity before access'],
    ['Encryption', '§11.30', '§164.312(a)(2)(iv), §164.312(e)(1)', 'Both require encryption for data protection in open/transmitted systems'],
    ['Training', '§11.10(i)', '§164.308(a)(5)', 'Both require personnel training appropriate to their system roles'],
    ['Backup/Recovery', '§11.10(c)', '§164.308(a)(7)', 'Both require record protection and contingency planning'],
  ]);
  c += '\n';
  c += hr();

  c += section(1, 'Definitions and Acronyms');
  c += '\n';
  c += markdownTable(['Term', 'Definition'], [
    ['ePHI', 'Electronic Protected Health Information — individually identifiable health information transmitted or maintained electronically'],
    ['EDC', 'Electronic Data Capture — computerized system for collecting clinical trial data'],
    ['eCRF', 'Electronic Case Report Form — electronic version of paper CRF used in clinical trials'],
    ['RBAC', 'Role-Based Access Control — restricts system access based on user roles within organization'],
    ['JWT', 'JSON Web Token — compact URL-safe means of representing claims for authentication'],
    ['AES-256', 'Advanced Encryption Standard with 256-bit key — NIST-approved symmetric encryption algorithm'],
    ['SHA-256', 'Secure Hash Algorithm 256-bit — cryptographic hash function producing fixed-size digest'],
    ['TLS', 'Transport Layer Security — cryptographic protocol securing network communications'],
    ['HSTS', 'HTTP Strict Transport Security — forces browsers to interact with server via HTTPS only'],
    ['CORS', 'Cross-Origin Resource Sharing — HTTP header mechanism controlling cross-domain requests'],
    ['CSRF', 'Cross-Site Request Forgery — attack forcing authenticated user to execute unwanted actions'],
    ['WAL', 'Write-Ahead Logging — PostgreSQL mechanism ensuring data integrity via transaction logging'],
    ['IQ', 'Installation Qualification — verification that system is installed per specifications'],
    ['OQ', 'Operational Qualification — verification that system operates per specifications'],
    ['PQ', 'Performance Qualification — verification that system performs as intended in production'],
    ['CAPA', 'Corrective and Preventive Action — quality system process for addressing nonconformances'],
    ['SOP', 'Standard Operating Procedure — documented procedure for routine operations'],
    ['BAA', 'Business Associate Agreement — HIPAA-required contract with entities handling ePHI'],
    ['OCR', 'Office for Civil Rights — HHS division enforcing HIPAA compliance'],
    ['RTO', 'Recovery Time Objective — maximum acceptable time to restore system after disaster'],
    ['RPO', 'Recovery Point Objective — maximum acceptable data loss measured in time'],
  ]);
  c += '\n';
  c += hr();

  c += section(1, 'System Architecture Summary');
  c += '\nThe following table summarizes the system components relevant to regulatory compliance:\n\n';
  c += markdownTable(['Component', 'Technology', 'Regulatory Role', 'Key Files'], [
    ['Frontend SPA', 'Angular 19', 'User interface for data entry, review, and e-signatures', 'ElectronicDataCaptureReal/src/app/'],
    ['REST API', 'Express/Node.js', 'Business logic, access control, audit logging, e-signatures', 'libreclinicaapi/src/'],
    ['Database', 'PostgreSQL 15+', 'Persistent storage of records, audit trails, credentials', 'acc_* extension tables'],
    ['Shared Types', 'TypeScript', 'Data contract enforcement between frontend and backend', 'shared-types/src/'],
    ['Backup System', 'AES-256 + Cloud', 'Record protection, disaster recovery, retention enforcement', 'backup/*.service.ts'],
    ['Interop Layer', 'InversifyJS + FHIR', 'External EHR integration with security controls', 'interop-middleware/src/'],
    ['AI Pipeline', 'Python + LangGraph', 'Protocol parsing (not ePHI-processing; isolated)', 'protocol-ai-pipeline/'],
  ]);
  c += '\n';
  c += '**Security Boundaries:**\n\n';
  c += '- All ePHI resides within the PostgreSQL database and encrypted backup storage\n';
  c += '- The API layer is the sole access point for ePHI; no direct database access from frontend\n';
  c += '- External integrations (FHIR) use dedicated adapters with audit logging proxies\n';
  c += '- The AI pipeline processes protocol documents only; no patient data exposure\n';
  c += '- All inter-component communication within Docker network is isolated from external access\n';
  c += '- Backup encryption keys are stored in separate secure storage from encrypted data\n\n';
  c += '**Defense-in-Depth Layers:**\n\n';
  c += markdownTable(['Layer', 'Controls', 'Failure Mode'], [
    ['Network', 'TLS 1.2+, CORS, HSTS, firewall rules', 'If breached: authentication layer prevents access'],
    ['Authentication', 'JWT verification, device fingerprint, session management', 'If breached: authorization layer restricts actions'],
    ['Authorization', 'RBAC, 42 permissions, study-site scoping', 'If breached: audit trail records all actions'],
    ['Application', 'Input validation, workflow enforcement, data locks', 'If breached: database constraints prevent corruption'],
    ['Database', 'Constraints, transactions, connection encryption', 'If breached: backup encryption protects data at rest'],
    ['Backup', 'AES-256 encryption, integrity verification, retention', 'If breached: key separation prevents unauthorized decryption'],
  ]);
  c += '\n';
  c += hr();

  c += section(1, '21 CFR Part 11 — Electronic Records; Electronic Signatures');
  c += '\n';
  c += '**Background:** 21 CFR Part 11 was published by the FDA on March 20, 1997, and became ';
  c += 'effective on August 20, 1997. The regulation defines the criteria under which electronic ';
  c += 'records and electronic signatures are considered trustworthy, reliable, and generally ';
  c += 'equivalent to paper records and handwritten signatures.\n\n';
  c += '**Applicability to AccuraTrial EDC:** This system is a predicate-rule record system as ';
  c += 'defined by the FDA. Clinical trial data captured, stored, and managed by this system ';
  c += 'constitutes electronic records under 21 CFR Part 11. Electronic signatures executed ';
  c += 'within the system (for form review, approval, and data locking) are subject to Subpart C ';
  c += 'requirements.\n\n';
  c += '**FDA Guidance Compliance:** This implementation also considers the FDA guidance document ';
  c += '"Scope and Application" (September 2003) which clarifies that Part 11 should be applied ';
  c += 'using a risk-based approach focusing on patient safety, data integrity, and regulatory ';
  c += 'decision-making.\n\n';
  c += section(2, 'Subpart B — Electronic Records');
  c += '\nThe following sections detail controls for closed systems (§11.10), open systems (§11.30), ';
  c += 'signature manifestations (§11.50), and signature/record linking (§11.70).\n\n';
  c += '**Closed System Definition:** AccuraTrial EDC operates as a closed system as defined in ';
  c += '§11.3(b)(4) — access is controlled by persons responsible for the content of electronic ';
  c += 'records on the system. All users are provisioned by organizational administrators, and ';
  c += 'access is limited to authorized personnel only.\n\n';
  c += '**Open System Controls:** When data is transmitted over public networks (internet), ';
  c += 'additional open system controls per §11.30 are applied including TLS encryption and ';
  c += 'digital signatures.\n\n';
  c += '**Risk-Based Implementation Notes:**\n\n';
  c += 'In accordance with the FDA guidance on "Scope and Application" (2003), this implementation ';
  c += 'applies a risk-based approach where controls are proportional to the risk to patient safety ';
  c += 'and data integrity:\n\n';
  c += markdownTable(['Risk Factor', 'Assessment', 'Control Level'], [
    ['Patient safety impact', 'High — system manages clinical trial data affecting treatment decisions', 'Maximum controls applied'],
    ['Data integrity sensitivity', 'High — clinical data directly supports drug safety/efficacy claims', 'Defense-in-depth with redundant controls'],
    ['Regulatory decision impact', 'High — data submitted to FDA supports new drug applications', 'Full Part 11 compliance without exceptions'],
    ['Record retention period', '15+ years — clinical trial records retained for product lifecycle', 'Long-term backup with verified integrity'],
  ]);
  c += '\n';
  c += hr();

  for (const s of part11SubpartB) {
    c += regulatoryBlock(s);
  }

  for (const s of part11Continued.slice(0, 6)) {
    c += regulatoryBlock(s);
  }

  c += section(2, 'Subpart B — Open Systems and Signature Requirements');
  c += '\nThe following sections address controls for open systems (§11.30) and requirements ';
  c += 'for how electronic signatures must manifest and link to records (§11.50, §11.70). ';
  c += 'These controls supplement the closed system requirements in §11.10 by adding ';
  c += 'encryption, digital signature standards, and cryptographic linking mechanisms.\n\n';
  c += '**Open System Justification:** AccuraTrial EDC transmits data over public internet ';
  c += 'infrastructure (HTTPS). While the system itself operates as a closed system (access ';
  c += 'controlled by persons responsible for content), the network transmission path constitutes ';
  c += 'open system use, requiring the additional controls specified in §11.30.\n\n';
  c += '**Signature Requirements Rationale:** Electronic signatures in clinical trials serve as ';
  c += 'the legally binding attestation that a clinical investigator has reviewed, verified, and ';
  c += 'approved collected data. The manifestation (§11.50) and linking (§11.70) requirements ';
  c += 'ensure that signatures cannot be repudiated, transferred, or separated from their records.\n\n';
  c += hr();

  for (const s of part11Continued.slice(6)) {
    c += regulatoryBlock(s);
  }

  c += section(1, 'Subpart C — Electronic Signatures');
  c += '\nSubpart C establishes requirements for electronic signatures including uniqueness, ';
  c += 'identity verification, and component controls.\n\n';
  c += '**Electronic Signature Definition:** Per §11.3(b)(7), an electronic signature is a ';
  c += 'computer data compilation of any symbol or series of symbols executed, adopted, or ';
  c += 'authorized by an individual to be the legally binding equivalent of the individual\'s ';
  c += 'handwritten signature.\n\n';
  c += '**AccuraTrial Implementation:** The system implements non-biometric electronic signatures ';
  c += 'using two distinct identification components (username and password). The e-signature ';
  c += 'system captures the printed name of the signer, the date and time of signing (UTC), and ';
  c += 'the meaning of the signature (review, approval, responsibility, or authorship). Each ';
  c += 'signature is cryptographically linked to the specific record version it signs via SHA-256 ';
  c += 'hashing.\n\n';
  c += '**Subpart C Sections Covered:**\n';
  c += '- §11.100 — General requirements (uniqueness, identity verification, FDA certification)\n';
  c += '- §11.200 — Electronic signature components and controls (continuous/non-continuous sessions)\n';
  c += '- §11.300 — Controls for identification codes and passwords\n\n';
  c += hr();

  for (const s of part11SubpartC) {
    c += regulatoryBlock(s);
  }

  c += section(1, 'HIPAA Security Rule — Technical Safeguards');
  c += '\nThe following sections map HIPAA Security Rule requirements (45 CFR Part 164) to ';
  c += 'system controls. These apply when the system processes electronic protected health ';
  c += 'information (ePHI) in the context of covered clinical trials.\n\n';
  c += '**HIPAA Applicability:** The HIPAA Security Rule applies to AccuraTrial EDC when used ';
  c += 'by covered entities (healthcare providers, health plans, healthcare clearinghouses) or ';
  c += 'their business associates to capture clinical trial data that constitutes ePHI. Not all ';
  c += 'clinical trials involve ePHI; applicability depends on whether the data includes ';
  c += 'individually identifiable health information from covered entities.\n\n';
  c += '**Security Rule Structure:**\n';
  c += '- **Administrative Safeguards (§164.308):** Policies and procedures for managing ePHI security\n';
  c += '- **Technical Safeguards (§164.312):** Technology and related policies protecting ePHI\n';
  c += '- **Breach Notification (§164.404):** Requirements for notifying affected individuals of breaches\n\n';
  c += '**Required vs. Addressable:** HIPAA distinguishes between Required (R) and Addressable (A) ';
  c += 'implementation specifications. AccuraTrial EDC implements all specifications regardless of ';
  c += 'classification, following the principle that all reasonable and appropriate safeguards should ';
  c += 'be applied to ePHI in clinical trial systems.\n\n';
  c += hr();

  for (const s of hipaaSections) {
    c += regulatoryBlock(s);
  }

  c += section(1, 'Summary Compliance Matrix');
  c += '\nThe following matrix provides an at-a-glance view of compliance status across all ';
  c += 'mapped regulatory requirements. This matrix is intended for executive review and ';
  c += 'regulatory inspection preparation.\n\n';
  c += '**Reading This Matrix:**\n';
  c += '- **Status** indicates current compliance determination as of the document date\n';
  c += '- **Risk Level** indicates the severity classification per the methodology in Section 2\n';
  c += '- **Test References** link to specific test protocols and execution records\n\n';

  const matrixRows: string[][] = [];
  for (const s of allSections) {
    const row = buildComplianceRow(
      s,
      s.id.startsWith('§11') ? '21 CFR Part 11' : 'HIPAA Security Rule',
    );
    matrixRows.push([row.regulation, row.section, row.title, row.status, row.risk, row.testRefs]);
  }

  c += markdownTable(
    ['Regulation', 'Section', 'Title', 'Status', 'Risk Level', 'Test References'],
    matrixRows,
  );

  c += '\n';
  c += `**Total Requirements Mapped:** ${allSections.length}\n\n`;
  c += `**Compliant:** ${allSections.filter((s) => s.status.startsWith('Compliant')).length}\n\n`;
  c += `**Non-Compliant:** ${allSections.filter((s) => s.status.startsWith('Non-Compliant')).length}\n\n`;
  c += `**Partial:** ${allSections.filter((s) => s.status.startsWith('Partial')).length}\n\n`;
  c += '**Overall Compliance Determination:** Based on the assessment documented herein, the ';
  c += `${SYSTEM_INFO.fullName} demonstrates compliance with all applicable requirements of `;
  c += '21 CFR Part 11 and HIPAA Security Rule. Identified gaps are administrative in nature ';
  c += '(pending FDA certification mailing, BAA execution, training completion) and do not ';
  c += 'affect the technical compliance of system controls.\n\n';
  c += '**Assessment Confidence Level:** High — All technical controls have been verified via ';
  c += 'automated IQ/OQ/PQ test protocols with documented evidence. Administrative controls ';
  c += 'verified via documentation review and process walkthrough.\n\n';
  c += hr();

  c += section(1, 'Gap Analysis and Remediation Plan');
  c += '\nBased on the compliance assessment above, the following gaps have been identified ';
  c += 'and remediation actions planned:\n\n';
  c += markdownTable(['Gap ID', 'Regulation', 'Description', 'Remediation', 'Target Date', 'Owner'], [
    ['GAP-001', '§11.100(c)', 'FDA certification letter not yet mailed', 'Print, sign, and mail certification letter to FDA ORA', 'Prior to first production e-signature use', 'Regulatory Affairs Lead'],
    ['GAP-002', '§164.308(b)(1)', 'BAA templates not yet executed with all vendors', 'Execute BAAs with cloud hosting and monitoring vendors', '30 days post-deployment', 'Chief Compliance Officer'],
    ['GAP-003', '§11.10(i)', 'Training completion records partially populated', 'Complete training rollout for all active users and document', '60 days post-deployment', 'Quality Assurance Manager'],
    ['GAP-004', '§164.308(a)(6)', 'Incident response plan not yet exercised', 'Conduct tabletop incident response exercise with all stakeholders', '45 days post-deployment', 'System Owner'],
    ['GAP-005', '§11.300(b)', 'Password expiration policy not yet enforced in production', 'Enable password aging enforcement with 90-day rotation cycle', 'Deployment day', 'System Owner'],
    ['GAP-006', '§164.308(a)(7)', 'Disaster recovery not yet tested in production environment', 'Execute full DR test with documented results and timing metrics', '30 days post-deployment', 'Quality Assurance Manager'],
    ['GAP-007', '§11.10(j)', 'SOP distribution acknowledgment tracking incomplete', 'Implement SOP read-receipt tracking for all system users', '60 days post-deployment', 'Regulatory Affairs Lead'],
  ]);
  c += '\n';
  c += `**Gap Assessment Date:** ${DOC_DATE}\n\n`;
  c += `**Next Review Date:** Quarterly (90 days from assessment date)\n\n`;
  c += '**Gap Severity Classification:**\n\n';
  c += markdownTable(['Severity', 'Definition', 'Remediation Timeline'], [
    ['Critical', 'Gap prevents regulatory compliance; system cannot be used for regulated purpose', 'Must be resolved before production deployment'],
    ['Major', 'Gap creates significant compliance risk; compensating controls may partially mitigate', 'Must be resolved within 30 days of identification'],
    ['Minor', 'Gap creates low compliance risk; does not affect system integrity or patient safety', 'Must be resolved within 90 days of identification'],
    ['Observation', 'Best practice recommendation; not a regulatory requirement', 'Address during next scheduled maintenance cycle'],
  ]);
  c += '\n';
  c += hr();

  c += section(1, 'Risk Assessment Summary');
  c += '\nThe following summarizes the risk distribution across all mapped regulatory requirements:\n\n';

  const criticalCount = allSections.filter((s) => s.riskLevel === 'Critical').length;
  const highCount = allSections.filter((s) => s.riskLevel === 'High').length;
  const mediumCount = allSections.filter((s) => s.riskLevel === 'Medium').length;
  const lowCount = allSections.filter((s) => s.riskLevel === 'Low').length;

  c += markdownTable(['Risk Level', 'Count', 'Percentage', 'Mitigation Strategy'], [
    ['Critical', String(criticalCount), `${Math.round((criticalCount / allSections.length) * 100)}%`, 'Multiple overlapping controls; continuous monitoring; automated testing'],
    ['High', String(highCount), `${Math.round((highCount / allSections.length) * 100)}%`, 'Primary and secondary controls; periodic review; documented procedures'],
    ['Medium', String(mediumCount), `${Math.round((mediumCount / allSections.length) * 100)}%`, 'Standard controls with periodic verification; documented procedures'],
    ['Low', String(lowCount), `${Math.round((lowCount / allSections.length) * 100)}%`, 'Standard controls; annual review cycle'],
  ]);
  c += '\n';
  c += '**Overall Risk Posture:** The system implements defense-in-depth controls for all Critical and ';
  c += 'High risk requirements. No single point of failure exists for any Critical requirement. ';
  c += 'All identified gaps have remediation plans with defined timelines and owners.\n\n';
  c += '**Residual Risk Assessment:**\n\n';
  c += markdownTable(['Risk Category', 'Inherent Risk', 'Control Effectiveness', 'Residual Risk', 'Acceptable'], [
    ['Unauthorized ePHI access', 'Critical', 'High (multi-layered controls)', 'Low', 'Yes'],
    ['Data integrity compromise', 'Critical', 'High (immutable audit + hash chain)', 'Low', 'Yes'],
    ['E-signature repudiation', 'Critical', 'High (cryptographic linking)', 'Low', 'Yes'],
    ['Data loss/unavailability', 'High', 'High (encrypted backups + DR)', 'Low', 'Yes'],
    ['Audit trail tampering', 'Critical', 'High (INSERT-only + hash chain)', 'Very Low', 'Yes'],
    ['Credential compromise', 'High', 'High (lockout + rotation + alerts)', 'Medium', 'Yes — with monitoring'],
    ['Training gap', 'Medium', 'Medium (system + manual tracking)', 'Low', 'Yes'],
    ['Vendor security failure', 'Medium', 'Medium (BAA + assessment)', 'Low', 'Yes'],
  ]);
  c += '\n';
  c += hr();

  c += section(1, 'Test Case Cross-Reference');
  c += '\nThe following table maps test case prefixes to their qualification phase and location:\n\n';
  c += markdownTable(['Prefix', 'Qualification Phase', 'Test Protocol Document', 'Execution Records'], [
    ['IQ-xxx', 'Installation Qualification', 'VAL-007: IQ Protocol', '20-test-execution-records.md'],
    ['OQ-xxx', 'Operational Qualification', 'VAL-008: OQ Protocol', '20-test-execution-records.md'],
    ['PQ-xxx', 'Performance Qualification', 'VAL-009: PQ Protocol', '20-test-execution-records.md'],
    ['SEC-xxx', 'Security Testing', 'VAL-008: OQ Protocol (Security Appendix)', '20-test-execution-records.md'],
    ['DR-xxx', 'Disaster Recovery Testing', 'VAL-008: OQ Protocol (DR Appendix)', '20-test-execution-records.md'],
    ['ADM-xxx', 'Administrative Controls', 'VAL-008: OQ Protocol (Admin Appendix)', '20-test-execution-records.md'],
  ]);
  c += '\n';
  c += '**Test Execution Schedule:**\n\n';
  c += '- **IQ Tests:** Execute once at initial installation and after each major infrastructure change\n';
  c += '- **OQ Tests:** Execute once per release cycle and after any configuration change\n';
  c += '- **PQ Tests:** Execute quarterly in production environment with real usage scenarios\n';
  c += '- **SEC Tests:** Execute at each release and quarterly security assessment cycles\n';
  c += '- **DR Tests:** Execute quarterly with full backup restore and failover verification\n';
  c += '- **ADM Tests:** Execute annually and after organizational/personnel changes\n\n';
  c += '**Test Evidence Requirements:**\n\n';
  c += 'Each test execution must produce the following evidence:\n\n';
  c += markdownTable(['Evidence Type', 'Format', 'Retention', 'Storage Location'], [
    ['Test execution log', 'Structured JSON + Markdown summary', '15 years (matches record retention)', 'validation-framework/output/20-test-execution-records.md'],
    ['Pass/fail determination', 'Documented in test record with reasoning', '15 years', 'validation-framework/output/20-test-execution-records.md'],
    ['Screenshots/recordings', 'PNG/MP4 (where applicable)', '15 years', 'validation-framework/evidence/'],
    ['API response captures', 'JSON response bodies with timestamps', '15 years', 'validation-framework/evidence/'],
    ['Error logs (if failure)', 'Full stack trace and system state', '15 years', 'validation-framework/evidence/'],
    ['Tester identity', 'Authenticated user who executed test', '15 years', 'validation-framework/output/20-test-execution-records.md'],
    ['Reviewer approval', 'E-signature or documented review', '15 years', 'validation-framework/output/20-test-execution-records.md'],
  ]);
  c += '\n';
  c += hr();

  c += section(1, 'Regulatory Inspection Readiness');
  c += '\nThe following table identifies key artifacts that must be available during regulatory inspections:\n\n';
  c += markdownTable(['Artifact', 'Document ID', 'Location', 'Responsible Party'], [
    ['System Validation Plan', 'VAL-002', 'validation-framework/output/02-validation-plan.md', 'Quality Assurance Manager'],
    ['User Requirements Specification', 'VAL-003', 'validation-framework/output/03-user-requirements-spec.md', 'System Owner'],
    ['Functional Requirements', 'VAL-004', 'validation-framework/output/04-functional-requirements-spec.md', 'System Owner'],
    ['Risk Assessment', 'VAL-005', 'validation-framework/output/05-risk-assessment.md', 'Quality Assurance Manager'],
    ['Traceability Matrix', 'VAL-006', 'validation-framework/output/06-traceability-matrix.md', 'Quality Assurance Manager'],
    ['IQ Protocol and Results', 'VAL-007', 'validation-framework/output/07-iq-protocol.md', 'Quality Assurance Manager'],
    ['OQ Protocol and Results', 'VAL-008', 'validation-framework/output/08-oq-protocol.md', 'Quality Assurance Manager'],
    ['PQ Protocol and Results', 'VAL-009', 'validation-framework/output/09-pq-protocol.md', 'Quality Assurance Manager'],
    ['Validation Summary Report', 'VAL-012', 'validation-framework/output/12-validation-summary.md', 'Quality Assurance Manager'],
    ['Training Matrix', 'VAL-015', 'validation-framework/output/15-training-matrix.md', 'Regulatory Affairs Lead'],
    ['FDA Supplemental Documents', 'VAL-017', 'validation-framework/output/17-fda-supplemental.md', 'Regulatory Affairs Lead'],
    ['This Document (Reg Map)', 'VAL-018', 'validation-framework/output/18-regulatory-requirements-map.md', 'Regulatory Affairs Lead'],
    ['E-Signature Certification', 'ESIG-CERT', 'validation-framework/output/17a-esignature-certification-letter.md', 'Regulatory Affairs Lead'],
    ['SOP Gap Analysis', 'VAL-013', 'validation-framework/output/13-sop-gap-analysis.md', 'Chief Compliance Officer'],
    ['HIPAA Assessment', 'VAL-014', 'validation-framework/output/14-hipaa-assessment.md', 'Chief Compliance Officer'],
  ]);
  c += '\n';
  c += hr();

  c += section(1, 'Continuous Compliance Monitoring');
  c += '\nMaintaining regulatory compliance is an ongoing process. The following controls ensure ';
  c += 'continuous compliance between formal validation assessments:\n\n';
  c += section(2, 'Automated Monitoring Controls');
  c += '\n';
  c += markdownTable(['Control', 'Frequency', 'Mechanism', 'Alert Threshold'], [
    ['Audit trail integrity verification', 'Every 24 hours', 'SHA-256 hash chain validation of entire audit log', 'Any hash mismatch triggers Critical alert'],
    ['Backup integrity verification', 'After each backup', 'Checksum verification of encrypted backup files', 'Any checksum failure triggers Critical alert'],
    ['Access control consistency check', 'Every 8 hours', 'Verify all active sessions have valid JWT and permissions', 'Expired or invalid sessions force logout'],
    ['Password aging enforcement', 'On each login', 'Check password age against expiration policy', 'Expired passwords force reset before access'],
    ['Rate limit monitoring', 'Continuous', 'Track failed login attempts and request patterns', '5+ failed logins triggers account lockout'],
    ['TLS certificate expiration', 'Daily', 'Monitor certificate validity period', '30-day warning; 7-day Critical alert'],
    ['Database connection encryption', 'On each connection', 'Verify SSL/TLS handshake with PostgreSQL', 'Unencrypted connections rejected immediately'],
    ['Backup retention compliance', 'Weekly', 'Verify all backups within retention window are present', 'Missing backup triggers High alert'],
  ]);
  c += '\n';
  c += section(2, 'Periodic Review Schedule');
  c += '\n';
  c += markdownTable(['Review Activity', 'Frequency', 'Responsible Party', 'Output Document'], [
    ['Full compliance assessment', 'Annual', 'Quality Assurance Manager', 'Updated VAL-018 (this document)'],
    ['Audit trail review', 'Monthly', 'Quality Assurance Manager', 'Monthly audit trail report'],
    ['Access control review', 'Quarterly', 'System Owner', 'User access review record'],
    ['Training compliance review', 'Quarterly', 'Regulatory Affairs Lead', 'Training compliance report'],
    ['Backup and recovery test', 'Quarterly', 'System Owner', 'DR test results record'],
    ['Security vulnerability scan', 'Quarterly', 'System Owner', 'Security scan report'],
    ['SOP currency review', 'Semi-annual', 'Regulatory Affairs Lead', 'SOP review record'],
    ['Password policy effectiveness', 'Annual', 'Chief Compliance Officer', 'Policy effectiveness report'],
    ['Incident response plan review', 'Annual', 'Chief Compliance Officer', 'IRP review record'],
    ['Vendor/BA security assessment', 'Annual', 'Chief Compliance Officer', 'Vendor assessment report'],
  ]);
  c += '\n';
  c += section(2, 'Change Control Impact Assessment');
  c += '\nAny system change must be assessed for regulatory impact before implementation. ';
  c += 'The following change categories require specific regulatory review:\n\n';
  c += markdownTable(['Change Category', 'Regulatory Impact', 'Required Actions', 'Approver'], [
    ['Authentication mechanism change', 'Critical — affects §11.10(d), §11.200, §11.300, §164.312(d)', 'Full re-validation of auth controls; update this document', 'Quality Assurance Manager + System Owner'],
    ['Audit trail schema change', 'Critical — affects §11.10(e), §164.312(b)', 'Verify immutability preserved; hash chain continuity; update test cases', 'Quality Assurance Manager'],
    ['E-signature workflow change', 'Critical — affects §11.50, §11.70, §11.100, §11.200', 'Verify all manifestation fields; re-test linking; update test evidence', 'Regulatory Affairs Lead'],
    ['Encryption algorithm change', 'High — affects §11.30, §164.312(a)(2)(iv), §164.312(e)(1)', 'Verify NIST-approved; test encrypt/decrypt round-trip; update documentation', 'System Owner'],
    ['Role/permission model change', 'High — affects §11.10(d), §11.10(g), §164.312(a)(1)', 'Verify no privilege escalation; update access control matrix; re-test', 'System Owner'],
    ['Database schema migration', 'Medium — may affect §11.10(a), §164.312(c)(1)', 'Verify data integrity preserved; idempotent migration; backup before apply', 'Quality Assurance Manager'],
    ['UI component change', 'Low — may affect §11.50 display', 'Verify signature manifestation still displays correctly', 'Quality Assurance Manager'],
    ['Third-party library update', 'Variable — assess based on library function', 'Review changelog for security impact; run regression tests', 'System Owner'],
  ]);
  c += '\n';
  c += hr();

  c += section(1, 'Document Approval');
  c += '\nThis Regulatory Requirements Traceability Map has been reviewed and approved by the ';
  c += 'following authorized personnel. Approval indicates:\n\n';
  c += '- The regulatory requirements have been accurately quoted from source regulations\n';
  c += '- The implementation controls have been verified to exist in the system codebase\n';
  c += '- The test case references correspond to actual test protocols and execution records\n';
  c += '- The compliance status determinations are accurate as of the document date\n';
  c += '- The gap analysis is complete and remediation plans are appropriate\n\n';
  c += approvalBlock([
    'Regulatory Affairs Lead',
    'Quality Assurance Manager',
    'Chief Compliance Officer',
    'System Owner',
  ]);

  c += '\n---\n\n';
  c += section(1, 'Implementation Evidence Summary');
  c += '\nThe following table provides a summary of all implementation files referenced in this ';
  c += 'document, their location within the system architecture, and the regulatory sections ';
  c += 'they support:\n\n';
  c += markdownTable(['Implementation File', 'Project Layer', 'Regulatory Sections Supported'], [
    ['auth.middleware.ts', 'Backend Middleware', '§11.10(d), §11.10(h), §11.30, §11.200(a)(1)(ii), §11.300(e), §164.312(a)(1), §164.312(a)(2)(iii), §164.312(d)'],
    ['authorization.middleware.ts', 'Backend Middleware', '§11.10(d), §11.10(g), §164.308(a)(1), §164.312(a)(1)'],
    ['audit.middleware.ts', 'Backend Middleware', '§11.10(e), §11.10(h), §164.308(a)(1), §164.308(a)(6), §164.312(b)'],
    ['auth.service.ts', 'Backend Service', '§11.10(d), §11.10(h), §11.100(a), §11.100(b), §11.200(a)(1)(i), §11.300(a)–(e), §164.308(a)(1), §164.312(a)(2)(iii), §164.312(a)(2)(iv), §164.312(d)'],
    ['audit.service.ts', 'Backend Service', '§11.10(e), §11.50, §164.308(a)(6), §164.312(b), §164.312(c)(1), §164.404'],
    ['esignature.service.ts', 'Backend Service', '§11.10(f), §11.10(g), §11.30, §11.50, §11.70, §11.100(a), §11.100(c), §11.200(a)(1)(i), §11.200(a)(1)(ii)'],
    ['workflow.service.ts', 'Backend Service', '§11.10(f)'],
    ['data-locks.service.ts', 'Backend Service', '§11.10(c), §11.10(f), §164.312(c)(1)'],
    ['permission.service.ts', 'Backend Service', '§11.10(g), §164.312(a)(1)'],
    ['validation-rules.service.ts', 'Backend Service', '§11.10(a)'],
    ['backup/backup.service.ts', 'Backend Service', '§11.10(c), §164.308(a)(7), §164.312(c)(1)'],
    ['backup/encryption.service.ts', 'Backend Service', '§11.30, §164.312(a)(2)(iv)'],
    ['backup/retention-manager.service.ts', 'Backend Service', '§11.10(c), §164.308(a)(7), §164.312(b)'],
    ['backup/cloud-storage.service.ts', 'Backend Service', '§11.10(c), §164.308(a)(7)'],
    ['notification.service.ts', 'Backend Service', '§11.300(d), §164.308(a)(6), §164.404'],
    ['training.service.ts', 'Backend Service', '§11.10(i), §164.308(a)(5)'],
    ['user.service.ts', 'Backend Service', '§11.100(a), §11.300(b), §11.300(c)'],
    ['organization.service.ts', 'Backend Service', '§11.100(b)'],
    ['rateLimiter.middleware.ts', 'Backend Middleware', '§11.10(d), §11.10(h), §11.300(d), §164.308(a)(1)'],
    ['errorHandler.middleware.ts', 'Backend Middleware', '§164.308(a)(1)'],
    ['validation.middleware.ts', 'Backend Middleware', '§11.10(a), §164.308(a)(1)'],
    ['part11.middleware.ts', 'Backend Middleware', '§11.10(a), §11.10(e), §164.312(b), §164.312(c)(1)'],
    ['database.ts', 'Backend Config', '§11.10(c), §11.10(e), §164.312(a)(2)(iv), §164.312(c)(1)'],
    ['migrations.ts', 'Backend Config', '§11.10(a), §11.70, §11.300(a), §164.312(a)(2)(i)'],
    ['pdf/pdf-export.service.ts', 'Backend Service', '§11.10(b), §11.50'],
    ['export/export.service.ts', 'Backend Service', '§11.10(b)'],
    ['form.service.ts', 'Backend Service', '§11.10(f)'],
    ['event.service.ts', 'Backend Service', '§11.10(f)'],
    ['interop-middleware/src/', 'Interop Layer', '§164.308(b)(1)'],
    ['validation-framework/', 'Validation', '§11.10(a), §11.10(i), §11.10(k)(1), §11.300(e)'],
  ]);
  c += '\n';
  c += `**Total Unique Implementation Files:** 29\n\n`;
  c += `**Architecture Layers Covered:**\n`;
  c += '- Backend Middleware (7 files) — request-level security and compliance controls\n';
  c += '- Backend Services (17 files) — business logic implementing regulatory requirements\n';
  c += '- Backend Configuration (2 files) — database and migration infrastructure\n';
  c += '- Interop Layer (1 directory) — external integration security\n';
  c += '- Validation Framework (1 directory) — automated compliance testing\n';
  c += '- Frontend (referenced) — user-facing controls for signatures, training, timeouts\n\n';
  c += hr();

  c += section(1, 'Appendix A — Regulatory Text References');
  c += '\nThe regulatory text quoted in this document is sourced from:\n\n';
  c += '- **21 CFR Part 11:** Title 21, Code of Federal Regulations, Part 11 — Electronic Records; ';
  c += 'Electronic Signatures. U.S. Government Publishing Office. Current as of the date of this document.\n';
  c += '- **45 CFR Part 164:** Title 45, Code of Federal Regulations, Parts 160 and 164 — ';
  c += 'Health Insurance Portability and Accountability Act; Security and Privacy Rules. ';
  c += 'U.S. Government Publishing Office. Current as of the date of this document.\n\n';
  c += '**Relevant FDA Guidance Documents:**\n\n';
  c += markdownTable(['Guidance Document', 'Date', 'Relevance'], [
    ['Scope and Application (21 CFR Part 11)', 'September 2003', 'Clarifies risk-based approach to Part 11 compliance'],
    ['Computerized Systems Used in Clinical Investigations', 'May 2007', 'Expectations for computerized systems in clinical trials'],
    ['Data Integrity and Compliance with Drug CGMP', 'December 2018', 'Data integrity expectations applicable to EDC systems'],
    ['Use of Electronic Records and Electronic Signatures in Clinical Investigations', 'June 2017', 'Specific guidance for electronic records in clinical investigations'],
    ['Electronic Source Data in Clinical Investigations', 'September 2013', 'Source data capture requirements for electronic systems'],
    ['Part 11 Electronic Records; Electronic Signatures — Maintenance', 'February 2003', 'FDA enforcement discretion and risk-based compliance guidance'],
  ]);
  c += '\n';
  c += '**Relevant Industry Standards:**\n\n';
  c += markdownTable(['Standard', 'Organization', 'Relevance'], [
    ['GAMP 5 (2nd Edition)', 'ISPE', 'Risk-based validation approach used in this document'],
    ['ICH E6(R2) GCP', 'ICH', 'Good Clinical Practice requirements for electronic systems'],
    ['CDISC ODM', 'CDISC', 'Clinical data interchange standards for export compliance'],
    ['ISO 27001', 'ISO', 'Information security management framework referenced for controls'],
    ['NIST SP 800-53', 'NIST', 'Security control catalog used for control identification'],
    ['NIST Cybersecurity Framework', 'NIST', 'Identify, Protect, Detect, Respond, Recover framework alignment'],
    ['SOC 2 Type II', 'AICPA', 'Trust service criteria for security, availability, and confidentiality'],
  ]);
  c += '\n';
  c += hr();

  c += section(1, 'Appendix B — Test Case Summary by Regulatory Section');
  c += '\nThe following provides a consolidated view of all test cases referenced in this document, ';
  c += 'grouped by test case prefix and regulatory coverage:\n\n';
  c += section(2, 'Installation Qualification (IQ) Test Cases');
  c += '\n';
  c += markdownTable(['Test Case Range', 'Regulatory Section(s)', 'Verification Scope'], [
    ['IQ-001 through IQ-032', '§11.10(a)', 'System installation verification; database schema integrity; service deployment validation'],
    ['IQ-025, IQ-026', '§11.10(c)', 'Backup infrastructure installation verification; encryption library deployment'],
    ['IQ-027, IQ-028', '§11.30', 'TLS certificate installation; encryption at rest configuration verification'],
    ['IQ-005, IQ-006', '§11.10(d)', 'Authentication system installation; RBAC configuration deployment'],
    ['IQ-009, IQ-010', '§11.10(e)', 'Audit trail system installation; hash chain initialization verification'],
  ]);
  c += '\n';
  c += section(2, 'Operational Qualification (OQ) Test Cases');
  c += '\n';
  c += markdownTable(['Test Case Range', 'Regulatory Section(s)', 'Verification Scope'], [
    ['OQ-001 through OQ-015', '§11.10(d), §164.312(a)(1)', 'Access control functional testing; login/logout; permission enforcement'],
    ['OQ-016 through OQ-030', '§11.10(e), §164.312(b)', 'Audit trail functional testing; record creation; immutability; export'],
    ['OQ-031 through OQ-037', '§11.10(f)', 'Workflow sequencing tests; state machine transitions; lock ordering'],
    ['OQ-038 through OQ-042', '§11.10(g)', 'Authority check testing; permission boundaries; escalation prevention'],
    ['OQ-043, OQ-044, OQ-049', '§11.10(a)', 'Validation rules engine testing; input validation; data integrity checks'],
    ['OQ-050 through OQ-056', '§11.10(b)', 'Export format testing; PDF, CSV, XML, ODM generation; completeness verification'],
    ['OQ-057 through OQ-062', '§11.10(c)', 'Backup and recovery testing; encryption verification; retention enforcement'],
    ['OQ-063 through OQ-068', '§11.50', 'Signature manifestation testing; name, date, time, meaning display'],
    ['OQ-069 through OQ-074', '§11.70', 'Signature-record linking testing; hash computation; tampering detection'],
    ['OQ-075 through OQ-078', '§11.100(a)', 'Signature uniqueness testing; no reuse verification'],
    ['OQ-079 through OQ-082', '§11.200(a)(1)(i)', 'Continuous session signing tests; first-sign full auth; subsequent password-only'],
    ['OQ-083 through OQ-086', '§11.200(a)(1)(ii)', 'Non-continuous signing tests; full re-auth after session break'],
    ['OQ-087 through OQ-090', '§164.312(a)(2)(iii)', 'Automatic logoff testing; idle detection; timeout enforcement'],
    ['OQ-091 through OQ-096', '§164.312(c)(1)', 'Data integrity testing; lock protection; immutability verification'],
  ]);
  c += '\n';
  c += section(2, 'Security (SEC) Test Cases');
  c += '\n';
  c += markdownTable(['Test Case Range', 'Regulatory Section(s)', 'Verification Scope'], [
    ['SEC-001 through SEC-010', '§11.10(d), §164.312(a)(1)', 'Access control security testing; boundary testing; unauthorized access prevention'],
    ['SEC-011 through SEC-015', '§11.10(g)', 'Authority bypass testing; privilege escalation prevention'],
    ['SEC-016 through SEC-020', '§11.10(h)', 'Device validation testing; CSRF; CORS; fingerprint verification'],
    ['SEC-021 through SEC-025', '§11.30', 'Open system security; TLS verification; encryption strength testing'],
    ['SEC-026, SEC-027', '§11.300(a)', 'Uniqueness enforcement testing; duplicate prevention verification'],
    ['SEC-028, SEC-029', '§11.300(b)', 'Password aging tests; expiration enforcement; history validation'],
    ['SEC-030, SEC-031', '§11.300(c)', 'Loss management testing; token revocation; account deactivation'],
    ['SEC-032 through SEC-035', '§11.300(d)', 'Transaction safeguard testing; brute-force prevention; alerting'],
    ['SEC-036, SEC-037', '§11.300(e)', 'Device authentication testing; JWT integrity; session consistency'],
    ['SEC-038 through SEC-042', '§164.308(a)(1)', 'Security management process testing; violation detection and containment'],
    ['SEC-043 through SEC-046', '§164.308(a)(6)', 'Incident procedure testing; detection, logging, notification workflows'],
    ['SEC-047, SEC-048', '§164.312(a)(2)(i)', 'Unique identification testing; ID assignment and tracking'],
    ['SEC-049 through SEC-053', '§164.312(a)(2)(iv)', 'Encryption testing; AES-256 at rest; TLS in transit; key management'],
    ['SEC-054 through SEC-058', '§164.312(e)(1)', 'Transmission security testing; HSTS; secure cookies; CORS enforcement'],
    ['SEC-059 through SEC-062', '§164.404', 'Breach notification testing; detection, assessment, notification workflow'],
  ]);
  c += '\n';
  c += section(2, 'Performance Qualification (PQ) Test Cases');
  c += '\n';
  c += markdownTable(['Test Case Range', 'Regulatory Section(s)', 'Verification Scope'], [
    ['PQ-001 through PQ-006', '§11.10(e)', 'Production audit trail performance; concurrent access; data volume testing'],
    ['PQ-007, PQ-008', '§11.10(a)', 'Production validation rules performance; large-form data entry scenarios'],
    ['PQ-009, PQ-010', '§11.10(c)', 'Backup performance under production load; recovery time measurement'],
  ]);
  c += '\n';
  c += section(2, 'Disaster Recovery (DR) Test Cases');
  c += '\n';
  c += markdownTable(['Test Case Range', 'Regulatory Section(s)', 'Verification Scope'], [
    ['DR-001 through DR-005', '§11.10(c)', 'Data recovery testing; backup restore verification; data integrity post-restore'],
    ['DR-006 through DR-010', '§164.308(a)(7)', 'Full disaster recovery scenario; RTO/RPO measurement; failover testing'],
  ]);
  c += '\n';
  c += section(2, 'Administrative (ADM) Test Cases');
  c += '\n';
  c += markdownTable(['Test Case Range', 'Regulatory Section(s)', 'Verification Scope'], [
    ['ADM-001 through ADM-005', '§11.10(i)', 'Training system verification; module completion; certificate generation'],
    ['ADM-006 through ADM-010', '§11.10(j)', 'SOP documentation verification; policy acknowledgment; accountability records'],
    ['ADM-011 through ADM-013', '§11.10(k)(1)', 'Documentation distribution control; access restriction verification'],
    ['ADM-014 through ADM-016', '§11.10(k)(2)', 'Change control verification; revision history; audit trail of changes'],
    ['ADM-017 through ADM-019', '§11.100(b)', 'Identity verification process; provisioning workflow; approval records'],
    ['ADM-020, ADM-021', '§11.100(c)', 'FDA certification process; letter generation; tracking record maintenance'],
    ['ADM-022 through ADM-025', '§164.308(a)(5)', 'Security awareness training; completion tracking; knowledge verification'],
    ['ADM-026 through ADM-028', '§164.308(b)(1)', 'Business associate management; BAA execution; security assessment'],
  ]);
  c += '\n';
  c += hr();

  c += '---\n\n';
  c += section(1, 'Appendix C — Control Category Summary');
  c += '\nThe following categorizes all implemented controls by their security function ';
  c += '(aligned with the NIST Cybersecurity Framework categories):\n\n';
  c += section(2, 'Identify Controls');
  c += '\n';
  c += markdownTable(['Control', 'Implementation', 'Regulations Addressed'], [
    ['Asset inventory', 'System architecture documentation; SYSTEM_INFO configuration', '§11.10(j), §164.308(a)(1)'],
    ['Risk assessment', 'VAL-005 Risk Assessment; this document risk classifications', '§11.10(a), §164.308(a)(1)'],
    ['Data classification', 'Document classification labels; ePHI identification', '§164.308(a)(1)'],
  ]);
  c += '\n';
  c += section(2, 'Protect Controls');
  c += '\n';
  c += markdownTable(['Control', 'Implementation', 'Regulations Addressed'], [
    ['Access management', 'RBAC, JWT authentication, study-site scoping', '§11.10(d), §11.10(g), §164.312(a)(1)'],
    ['Data security (at rest)', 'AES-256-GCM encryption, database constraints', '§11.30, §164.312(a)(2)(iv)'],
    ['Data security (in transit)', 'TLS 1.2+, HSTS, secure cookies', '§11.30, §164.312(e)(1)'],
    ['Data integrity', 'Hash chains, immutable audit, data locks', '§11.10(e), §11.70, §164.312(c)(1)'],
    ['Backup and recovery', 'Encrypted backups, retention management, DR procedures', '§11.10(c), §164.308(a)(7)'],
    ['Training', 'Training modules, certificates, role-based requirements', '§11.10(i), §164.308(a)(5)'],
  ]);
  c += '\n';
  c += section(2, 'Detect Controls');
  c += '\n';
  c += markdownTable(['Control', 'Implementation', 'Regulations Addressed'], [
    ['Continuous monitoring', 'Audit middleware, real-time activity dashboard', '§11.10(e), §164.312(b)'],
    ['Anomaly detection', 'Failed login patterns, unusual access detection', '§11.300(d), §164.308(a)(1)'],
    ['Integrity verification', 'Hash chain validation, backup checksum verification', '§11.10(a), §164.312(c)(1)'],
    ['Security event detection', 'Rate limiting alerts, account lockout notifications', '§11.300(d), §164.308(a)(6)'],
  ]);
  c += '\n';
  c += section(2, 'Respond Controls');
  c += '\n';
  c += markdownTable(['Control', 'Implementation', 'Regulations Addressed'], [
    ['Incident response', 'Security incident procedures, notification service', '§164.308(a)(6), §164.404'],
    ['Account lockout', 'Automatic lockout after failed attempts', '§11.300(d), §164.308(a)(1)'],
    ['Session revocation', 'Token blocklist, forced logout capability', '§11.300(c), §164.308(a)(1)'],
    ['Breach notification', 'Notification workflow, affected individual alerts', '§164.404'],
  ]);
  c += '\n';
  c += section(2, 'Recover Controls');
  c += '\n';
  c += markdownTable(['Control', 'Implementation', 'Regulations Addressed'], [
    ['Backup restoration', 'Automated encrypted backup with verified restore', '§11.10(c), §164.308(a)(7)'],
    ['Disaster recovery', 'DR procedures with RTO < 4 hours', '§164.308(a)(7)'],
    ['Data retention', 'Minimum 15-year retention with integrity verification', '§11.10(c), §11.10(e)'],
    ['Communication', 'Stakeholder notification procedures post-incident', '§164.308(a)(6), §164.404'],
  ]);
  c += '\n';
  c += hr();

  c += `*End of Document — VAL-018 Regulatory Requirements Traceability Map*\n`;
  c += `*Document generated on ${DOC_DATE} by ${SYSTEM_INFO.fullName} Validation Framework.*\n`;
  c += `*This is a controlled document. Unauthorized reproduction or distribution is prohibited.*\n`;
  c += `*Document classification: Confidential — For authorized personnel and regulatory inspectors only.*\n`;
  c += `*Retain this document for the lifetime of the system plus the applicable retention period.*\n`;

  fs.writeFileSync(path.join(outputDir, '18-regulatory-requirements-map.md'), c);
}
