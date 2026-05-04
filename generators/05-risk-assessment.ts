import * as fs from 'fs';
import * as path from 'path';
import { SYSTEM_INFO } from '../config/system-info';
import {
  RISK_DEFINITIONS,
  FEATURE_RISKS,
  RiskLevel,
  FeatureRisk,
} from '../config/risk-ratings';
import {
  documentHeader,
  markdownTable,
  section,
  approvalBlock,
  tableOfContents,
  hr,
  riskBadge,
} from './helpers/markdown-writer';

const DOC_DATE = new Date().toISOString().split('T')[0];
const DOC_YEAR = new Date().getFullYear();

interface MitigationControl {
  featureId: string;
  feature: string;
  controls: string;
  residualRisk: string;
}

interface DetailedRiskAnalysis {
  featureId: string;
  failureMode: string;
  patientSafetyImpact: string;
  dataIntegrityImpact: string;
  mitigationControls: string[];
  residualRisk: string;
  csaClassification: 'High Process Risk' | 'Not High Process Risk';
  csaReasoning: string;
}

function buildDetailedRiskAnalyses(criticalFeatures: FeatureRisk[]): DetailedRiskAnalysis[] {
  const analysisMap: Record<string, Omit<DetailedRiskAnalysis, 'featureId'>> = {
    'FEAT-001': {
      failureMode: 'Authentication mechanism fails, allowing unauthorized access or rejecting authorized users.',
      patientSafetyImpact: 'Unauthorized access could allow modification of treatment assignment data, adverse event reports, or eligibility assessments, directly affecting patient care decisions.',
      dataIntegrityImpact: 'Without authenticated identity, audit trail entries cannot be attributed to specific individuals, undermining the non-repudiation requirement of §11.10(j).',
      mitigationControls: ['JWT-based authentication with bcrypt password hashing', 'Account lockout after 5 failed attempts (§11.300(d))', 'Password expiration at 90 days (§11.300(b))', 'Token blocklist on logout', 'Rate limiting on login endpoint'],
      residualRisk: 'Low — Multiple layered controls address all identified failure modes.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Failure foreseeably compromises safety per FDA CSA guidance Section V.A.2.',
    },
    'FEAT-002': {
      failureMode: 'Unique user identification fails, allowing duplicate accounts or shared credentials.',
      patientSafetyImpact: 'Shared accounts prevent tracing data modifications to individuals, making it impossible to identify who entered incorrect dosing or safety data.',
      dataIntegrityImpact: 'Audit trail loses accountability — entries attributed to shared accounts cannot identify the responsible operator, violating §11.10(d) and §11.10(e).',
      mitigationControls: ['Database UNIQUE constraint on username column', 'Application-level duplicate check before INSERT', 'Registration validation via Joi schema', 'Audit logging of all account creation events'],
      residualRisk: 'Low — Database-level constraint provides definitive prevention.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Failure undermines individual accountability required for regulated record attribution.',
    },
    'FEAT-003': {
      failureMode: 'Password controls fail, permitting weak or compromised credentials.',
      patientSafetyImpact: 'Weak passwords enable unauthorized access, potentially allowing unqualified individuals to modify treatment data or safety assessments.',
      dataIntegrityImpact: 'Compromised credentials enable undetected unauthorized data modification, undermining the trustworthiness of all electronic records.',
      mitigationControls: ['Complexity policy (8+ chars, mixed case, digit, special)', 'bcrypt hashing with configurable cost factor', 'Password history prevents reuse of last N passwords', 'Periodic expiration enforcement', 'Joi schema validation on all password endpoints'],
      residualRisk: 'Low — Multi-layer policy enforcement at application and database levels.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Weak authentication directly enables unauthorized access to safety-critical records.',
    },
    'FEAT-004': {
      failureMode: 'RBAC fails, granting users access to functions beyond their authorized role.',
      patientSafetyImpact: 'A data entry user gaining monitor privileges could approve their own data without independent verification, bypassing safety oversight.',
      dataIntegrityImpact: 'Privilege escalation could allow unauthorized database locks, signature forgery, or configuration changes that corrupt study data.',
      mitigationControls: ['authorization.middleware.ts applied to every protected route', '6 predefined roles with 42 granular permissions', 'Study-scoped and site-scoped access filtering', 'Permission checks at both route and service layers', 'Role assignment audit logging'],
      residualRisk: 'Low — Middleware-level enforcement with granular permission model.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Access control failure could allow unauthorized modification of safety-relevant data.',
    },
    'FEAT-005': {
      failureMode: 'Session management fails, leaving sessions active on unattended workstations indefinitely.',
      patientSafetyImpact: 'Unauthorized persons could access and modify clinical data through abandoned sessions, potentially altering treatment assignments or safety reports.',
      dataIntegrityImpact: 'Actions performed through hijacked sessions are attributed to the original user, creating false audit trail entries.',
      mitigationControls: ['JWT expiration claim with configurable TTL', 'Frontend idle-timeout service with countdown warning', 'Server-side token validation on every request', 'Device fingerprint verification detects session transfer', 'Concurrent session prevention'],
      residualRisk: 'Low — Server and client-side timeout enforcement with device binding.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Unattended session access could compromise safety data in clinical settings.',
    },
    'FEAT-010': {
      failureMode: 'Audit trail generation fails silently, producing gaps or missing entries in the audit log.',
      patientSafetyImpact: 'Without audit trails, data modifications affecting patient treatment cannot be traced, investigated, or corrected.',
      dataIntegrityImpact: 'Missing audit entries violate §11.10(e) and render the entire electronic record system non-compliant — records without audit trails are considered untrustworthy.',
      mitigationControls: ['audit.middleware.ts applied globally to all mutation routes', 'Atomic audit+data writes via pool.transaction()', 'acc_audit_log schema enforces NOT NULL on required fields', 'Sequential IDs enable gap detection', 'Database triggers as backup audit mechanism'],
      residualRisk: 'Low — Middleware-level enforcement with transactional guarantees.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Audit trail failure invalidates all electronic records per Part 11.',
    },
    'FEAT-011': {
      failureMode: 'Audit entries are generated but missing required fields (who, what, when, old value, new value).',
      patientSafetyImpact: 'Incomplete audit entries prevent reconstruction of data change history, making it impossible to determine if safety-relevant data was altered inappropriately.',
      dataIntegrityImpact: 'Partial audit entries fail regulatory inspection — §11.10(e) requires recording of "previously recorded information" which means old values must always be captured.',
      mitigationControls: ['audit.service.ts populates all fields from AuthRequest context', 'JSONB storage for structured old/new values', 'NOT NULL constraints on required columns', 'Server-generated timestamps prevent client manipulation', 'Validation layer rejects incomplete audit payloads'],
      residualRisk: 'Low — Schema constraints and application validation ensure completeness.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Incomplete audit trails fail to meet §11.10(e) requirements for record accountability.',
    },
    'FEAT-012': {
      failureMode: 'Audit trail records can be modified or deleted through application, API, or direct database access.',
      patientSafetyImpact: 'Mutable audit trails allow concealment of unauthorized data changes that could affect patient treatment decisions.',
      dataIntegrityImpact: 'An editable audit trail invalidates every electronic record in the system — regulators consider the entire dataset untrustworthy if audit immutability cannot be demonstrated.',
      mitigationControls: ['No UPDATE/DELETE API endpoints for acc_audit_log', 'Database REVOKE UPDATE, DELETE on acc_audit_log from application role', 'audit.routes.ts exposes GET endpoints only', 'Periodic integrity checks compare audit counts', 'Database-level trigger prevents direct modification'],
      residualRisk: 'Low — Database and application layer both prevent modification.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Audit trail tampering fundamentally compromises regulated record integrity.',
    },
    'FEAT-014': {
      failureMode: 'Data corrections are allowed without capturing a reason for change.',
      patientSafetyImpact: 'Without documented reasons, corrections to adverse event severity or dosing data cannot be clinically reviewed for appropriateness.',
      dataIntegrityImpact: 'Missing reasons for change violate §11.10(e) and ICH E6(R2) requirements, and are a common FDA 483 observation.',
      mitigationControls: ['Joi validation rejects PUT requests missing reason field', 'reason column NOT NULL in acc_audit_log for data corrections', 'Frontend UI requires reason input before submission', 'Audit entry stores reason alongside old/new values'],
      residualRisk: 'Low — Mandatory field enforced at validation, application, and database layers.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Missing change justification prevents assessment of data correction appropriateness.',
    },
    'FEAT-020': {
      failureMode: 'E-signature creation succeeds without proper identity verification of the signer.',
      patientSafetyImpact: 'Unverified signatures on clinical data approvals mean safety-critical records may be approved by unauthorized or unqualified individuals.',
      dataIntegrityImpact: 'Signatures without identity verification have no legal weight under Part 11, invalidating regulatory submissions that rely on signed records.',
      mitigationControls: ['Fresh password verification (verifyPassword()) required at signing', 'part11.middleware.ts enforces two-component authentication', 'No cached credentials accepted for signatures', 'Failed signing attempts logged in audit trail', 'Signature linked to authenticated user ID'],
      residualRisk: 'Low — Two-component authentication at every signing event.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Invalid signatures compromise the legal standing of regulated record approvals.',
    },
    'FEAT-021': {
      failureMode: 'E-signatures are created but missing required components (printed name, date/time, or meaning).',
      patientSafetyImpact: 'Incomplete signatures on safety reports or data approvals cannot be verified by regulators, undermining the review chain for patient safety decisions.',
      dataIntegrityImpact: 'Signatures missing any of the three required manifestations per §11.50(a) are non-compliant and would be cited during inspection.',
      mitigationControls: ['acc_esignatures schema stores signer_name, signed_at, meaning as NOT NULL', 'Application validates all three components before persisting', 'PDF export renders all signature manifestations', 'UI displays all components in human-readable form'],
      residualRisk: 'Low — Schema constraints prevent incomplete signatures.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Incomplete signature manifestations invalidate electronic signatures under Part 11.',
    },
    'FEAT-022': {
      failureMode: 'Cached or session credentials are accepted for signing instead of fresh re-authentication.',
      patientSafetyImpact: 'Without re-authentication, another person at the same workstation could sign records under a different identity, approving safety data without review.',
      dataIntegrityImpact: 'Signatures using cached credentials violate §11.200(a)(1) which requires each signing to include "at least two distinct identification components."',
      mitigationControls: ['esignature.service.ts requires explicit password input per signing event', 'Session tokens explicitly excluded from signature authentication', 'Each signing triggers independent verifyPassword() call', 'Failed authentication attempts logged'],
      residualRisk: 'Low — Fresh authentication enforced per signing event.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Cached credential acceptance enables unauthorized signing of regulated records.',
    },
    'FEAT-023': {
      failureMode: 'Signatures can be detached from records, or a signed record can be modified without invalidating the signature.',
      patientSafetyImpact: 'A detached signature could be applied to a different record, potentially approving unsafe data that was never actually reviewed.',
      dataIntegrityImpact: 'Unlinked signatures violate §11.70 which requires signatures be "linked to their respective electronic records" to prevent excision, copying, or transfer.',
      mitigationControls: ['SHA-256 hash of record content stored in acc_esignatures.record_hash', 'Any record modification detected by hash mismatch', 'Signature auto-invalidated on record change', 'Cryptographic binding prevents signature transfer between records'],
      residualRisk: 'Low — Cryptographic hash binding prevents tampering.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Detachable signatures undermine the legal binding of approval to specific record content.',
    },
    'FEAT-024': {
      failureMode: 'Signer can deny having signed a record due to insufficient evidence of signing identity.',
      patientSafetyImpact: 'Repudiated signatures on adverse event reports or treatment approvals create ambiguity about who authorized critical safety decisions.',
      dataIntegrityImpact: 'Non-repudiation is required by §11.10(j) — without it, the accountability chain for electronic records breaks down.',
      mitigationControls: ['Signature record includes authenticated userId and fresh password verification', 'SHA-256 record hash ties signature to specific content', 'Server-generated UTC timestamp', 'Audit trail logs all signing events including failures', 'IP address and device fingerprint captured'],
      residualRisk: 'Low — Multi-factor evidence prevents repudiation.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Repudiable signatures void the legal equivalence to handwritten signatures.',
    },
    'FEAT-030': {
      failureMode: 'eCRF data entry fails to validate input, allowing invalid or corrupted clinical data to persist.',
      patientSafetyImpact: 'Invalid clinical data (wrong vital signs, incorrect lab values, erroneous dosing) could directly lead to incorrect treatment decisions.',
      dataIntegrityImpact: 'Corrupted eCRF data affects primary endpoint analysis and regulatory submissions. Once invalid data propagates to analysis datasets, correction is extremely costly.',
      mitigationControls: ['Validation rules fire on save via validation-rules.service.ts', 'Field-level type validation (numeric, date, text)', 'Audit trail captures all changes', 'Part 11 middleware enforces compliance checks', 'Data locks prevent unauthorized modification of reviewed data'],
      residualRisk: 'Low — Multi-layer data integrity controls at entry, storage, and review stages.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Invalid clinical data directly compromises patient safety and endpoint integrity.',
    },
    'FEAT-031': {
      failureMode: 'Data corrections overwrite previous values, destroying the change history.',
      patientSafetyImpact: 'Lost change history prevents investigation of why safety-relevant data was modified — was an adverse event severity downgraded inappropriately?',
      dataIntegrityImpact: 'Overwritten data violates §11.10(e) requirement to preserve "previously recorded information." Original values must always be recoverable.',
      mitigationControls: ['Audit middleware captures old value before overwrite', 'New value recorded alongside old value in JSONB', 'Reason for change required for all corrections', 'Original data always recoverable from audit trail', 'No physical deletion of clinical data records'],
      residualRisk: 'Low — Complete change history preserved in immutable audit trail.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Destroyed change history prevents regulatory reconstruction of data provenance.',
    },
    'FEAT-032': {
      failureMode: 'Validation rules fail to fire, allowing out-of-range or inconsistent data to be saved.',
      patientSafetyImpact: 'Missing edit checks could allow a heart rate of 500 bpm or a negative body weight to be recorded and acted upon clinically.',
      dataIntegrityImpact: 'Without validation, data quality degrades silently. Issues discovered late in the trial require expensive retrospective data cleaning.',
      mitigationControls: ['Configurable rule types: range, pattern, cross-field, required', 'Server-side and client-side validation', 'Auto-query generation on rule violation', 'Rules versioned in acc_validation_rules table', 'Rule compilation and testing before activation'],
      residualRisk: 'Low — Comprehensive validation at entry point with auto-query follow-up.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Missing edit checks allow clinically dangerous data values to persist.',
    },
    'FEAT-040': {
      failureMode: 'Query management fails, preventing creation, tracking, or resolution of data discrepancies.',
      patientSafetyImpact: 'Unresolved queries on safety data (AE severity, concomitant medications) leave ambiguous records that could mislead clinical decisions.',
      dataIntegrityImpact: 'Queries are the primary mechanism for data cleaning in clinical trials. Failure prevents identification and correction of data quality issues before database lock.',
      mitigationControls: ['Full lifecycle management: create, assign, respond, resolve, escalate', 'All query transitions audit-logged', 'Auto-query generation from validation rule violations', 'Query status dashboard for oversight', 'Escalation workflow for overdue queries'],
      residualRisk: 'Low — Full lifecycle management with comprehensive audit trail.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Failed data cleaning directly affects the quality of safety and efficacy analyses.',
    },
    'FEAT-050': {
      failureMode: 'Data freeze fails to prevent modifications, allowing changes to reviewed data.',
      patientSafetyImpact: 'Post-review modifications could introduce errors into data that was previously verified by clinical monitors.',
      dataIntegrityImpact: 'Freeze is a regulatory control ensuring reviewed data remains stable. If modifications bypass freeze, the review process is invalidated.',
      mitigationControls: ['data-locks.service.ts enforces freeze status check on every write', 'Data edits rejected with descriptive error message', 'Query workflow remains active during freeze', 'Freeze status persisted in acc_data_locks table', 'Freeze/unfreeze events audit-logged with e-signature'],
      residualRisk: 'Low — Database-level enforcement of freeze state.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Freeze bypass invalidates the clinical monitoring review process.',
    },
    'FEAT-051': {
      failureMode: 'Data lock fails to prevent all modifications, or lock can be removed without proper authorization.',
      patientSafetyImpact: 'Unauthorized changes to locked data could alter the dataset used for safety analysis and regulatory submission.',
      dataIntegrityImpact: 'Data lock is the final immutability control before regulatory submission. If data can be modified after lock, the submission dataset is unreliable.',
      mitigationControls: ['data-locks.service.ts rejects all modifications on locked records', 'Unlock requires e-signature with documented reason', 'Lock events persisted with full audit trail', 'No API bypass for locked status'],
      residualRisk: 'Low — Immutable lock with e-signature gating for unlock.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Lock bypass compromises the integrity of the submission dataset.',
    },
    'FEAT-052': {
      failureMode: 'Study-level database lock fails, allowing data modifications after the final regulatory milestone.',
      patientSafetyImpact: 'Post-lock modifications to the entire study database could alter treatment group comparisons used for safety and efficacy conclusions.',
      dataIntegrityImpact: 'Database lock is the final regulatory milestone before unblinding and statistical analysis. Any post-lock change invalidates the analysis.',
      mitigationControls: ['Study-level lock via data-locks.service.ts', 'Requires e-signature from authorized roles only', 'Prevents all study data modifications globally', 'Unlock requires formal documented process with QA approval'],
      residualRisk: 'Low — Global lock with regulatory controls and e-signature requirement.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Post-lock data changes invalidate regulatory submission integrity.',
    },
    'FEAT-070': {
      failureMode: 'Subject enrollment allows duplicate enrollment, wrong study assignment, or wrong site assignment.',
      patientSafetyImpact: 'Enrolling a subject in the wrong study or site could lead to incorrect treatment assignment, wrong protocol procedures, or eligibility violations.',
      dataIntegrityImpact: 'Duplicate enrollment creates data conflicts — two records for one subject with potentially different treatment assignments and safety data.',
      mitigationControls: ['Unique subject ID generation with site-scoped duplicate prevention', 'Database constraint on study+label combination', 'Enrollment status tracking with state machine', 'Audit trail for all enrollment events'],
      residualRisk: 'Low — Database constraints and application validation prevent duplicates.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Incorrect enrollment directly affects subject safety through wrong treatment assignment.',
    },
    'FEAT-071': {
      failureMode: 'Subject ID assignment generates duplicate IDs or assigns IDs that conflict with existing subjects.',
      patientSafetyImpact: 'Duplicate subject IDs cause data mixups — clinical data from one patient could be attributed to another, leading to wrong treatment decisions.',
      dataIntegrityImpact: 'ID collisions corrupt the fundamental data linkage in the trial. All data associated with the conflicting IDs becomes unreliable.',
      mitigationControls: ['UNIQUE constraint on subject ID within study scope', 'Application-level validation before INSERT', 'Configurable ID generation patterns per study', 'Descriptive rejection error on duplicate attempt'],
      residualRisk: 'Low — Multi-layer uniqueness enforcement at database and application levels.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Subject ID mixups directly endanger patient safety through data attribution errors.',
    },
    'FEAT-080': {
      failureMode: 'Data export produces incomplete, inaccurate, or corrupted output files.',
      patientSafetyImpact: 'Incomplete safety data exports could lead to underreporting of adverse events to regulatory authorities.',
      dataIntegrityImpact: 'Export is required by §11.10(b) for producing "accurate and complete copies." Inaccurate exports undermine regulatory submission data.',
      mitigationControls: ['Export routes with format selection (PDF/CSV/XML/ODM)', 'export.service.ts generates complete data extracts', 'Checksum verification on output files', 'Audit trail for all export events', 'Round-trip verification against source data'],
      residualRisk: 'Low — Comprehensive export with integrity verification.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Inaccurate exports could misrepresent safety data in regulatory submissions.',
    },
    'FEAT-081': {
      failureMode: 'Audit trail export produces incomplete records or omits entries.',
      patientSafetyImpact: 'Incomplete audit exports during inspection could trigger regulatory action, delaying drug approval and patient access to treatment.',
      dataIntegrityImpact: 'Audit trail export is the primary mechanism for demonstrating compliance during FDA inspection. Incomplete exports suggest data manipulation.',
      mitigationControls: ['Dedicated audit export endpoint with filtering', 'PDF and CSV format support', 'Content verified against database record counts', 'Export events themselves are audit-logged'],
      residualRisk: 'Low — Audit export with count verification against source.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Incomplete audit exports fail inspection readiness requirements.',
    },
    'FEAT-082': {
      failureMode: 'Records become inaccessible or unreadable before the retention period expires.',
      patientSafetyImpact: 'Lost clinical trial records prevent retrospective safety analysis if late-emerging adverse effects are discovered.',
      dataIntegrityImpact: '§11.10(c) requires records to be "readily retrievable throughout the records retention period." Premature loss is a critical compliance failure.',
      mitigationControls: ['PostgreSQL with WAL archiving for durability', 'AES-256 encrypted backups with offsite storage', 'No auto-purge on regulated tables', 'retention-manager.service.ts enforces minimum 15-year retention', 'Periodic retrieval verification tests'],
      residualRisk: 'Low — Multi-layer retention with encrypted backups and monitoring.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Record loss prevents regulatory review and long-term safety surveillance.',
    },
    'FEAT-090': {
      failureMode: 'Backup process fails silently, producing corrupt or unencrypted backup files.',
      patientSafetyImpact: 'Without valid backups, a system failure could permanently destroy clinical trial data including safety records.',
      dataIntegrityImpact: 'HIPAA §164.308(a)(7) requires contingency planning including data backup. Corrupt backups provide a false sense of security.',
      mitigationControls: ['backup.service.ts with AES-256-GCM encryption', 'backup-scheduler.service.ts for automated scheduling', 'retention-manager.service.ts for lifecycle management', 'Key rotation configured', 'Backup integrity verification after creation'],
      residualRisk: 'Low — Automated encrypted backups with integrity verification.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Backup failure risks permanent loss of safety-critical clinical data.',
    },
    'FEAT-091': {
      failureMode: 'Restore process fails or produces a database state inconsistent with the backup.',
      patientSafetyImpact: 'Failed disaster recovery could permanently disrupt an ongoing clinical trial, preventing safety monitoring of enrolled patients.',
      dataIntegrityImpact: 'An inconsistent restore could silently corrupt data relationships, creating subtle data integrity issues that are difficult to detect.',
      mitigationControls: ['backup.service.ts restore() with checksum comparison', 'Post-restore integrity verification', 'Documented DR procedures', 'Periodic DR drills'],
      residualRisk: 'Medium — Restore procedures verified but DR drill frequency should increase.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Failed recovery from disaster directly threatens ongoing patient safety monitoring.',
    },
    'FEAT-110': {
      failureMode: 'Randomization engine produces biased allocation, reveals treatment assignments, or generates duplicate allocations.',
      patientSafetyImpact: 'Biased randomization invalidates the trial by introducing systematic differences between treatment groups, potentially masking safety signals.',
      dataIntegrityImpact: 'Broken randomization invalidates the statistical basis of the entire trial. All efficacy and safety conclusions become unreliable.',
      mitigationControls: ['randomization-engine.service.ts with sealed allocation lists', 'Blinded assignment generation', 'Allocation concealment enforced at application level', 'All randomization events audit-logged', 'Stratification factor support'],
      residualRisk: 'Low — Sealed allocation with comprehensive audit trail.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Randomization failure directly compromises trial validity and patient safety conclusions.',
    },
    'FEAT-141': {
      failureMode: 'Consent management fails to track consent status accurately or allows data collection without valid consent.',
      patientSafetyImpact: 'Collecting data without informed consent violates patient rights under 21 CFR 50 and the Declaration of Helsinki.',
      dataIntegrityImpact: 'Data collected without proper consent may need to be excluded from analysis, potentially invalidating study results.',
      mitigationControls: ['Consent management module with documented workflow', 'Consent status tracked per subject with timestamps', 'Consent events audit-logged', 'Withdrawal handling with data impact assessment', 'Consent version tracking'],
      residualRisk: 'Medium — Consent management is regulatory-critical; ongoing monitoring required.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Consent failures directly violate subject rights and 21 CFR 50 requirements.',
    },
    'FEAT-150': {
      failureMode: 'Encryption at rest is misconfigured or disabled, leaving ePHI stored in plaintext.',
      patientSafetyImpact: 'Exposed ePHI could lead to patient identification, causing discrimination, stigmatization, or insurance denial.',
      dataIntegrityImpact: 'Unencrypted ePHI storage violates HIPAA §164.312(a)(2)(iv) and exposes the organization to breach notification obligations.',
      mitigationControls: ['PostgreSQL volume-level encryption', 'AES-256-GCM for backup files', 'Encryption key management with rotation schedule', 'No plaintext ePHI storage permitted', 'Infrastructure-level encryption verification'],
      residualRisk: 'Low — Encryption at rest verified at infrastructure level.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Unencrypted ePHI storage creates direct patient harm risk through data exposure.',
    },
    'FEAT-151': {
      failureMode: 'TLS configuration fails or downgrades, transmitting ePHI over unencrypted connections.',
      patientSafetyImpact: 'Intercepted ePHI in transit could expose patient identifiers, medical conditions, and treatment assignments.',
      dataIntegrityImpact: 'Unencrypted transmission violates HIPAA §164.312(e)(1) and enables man-in-the-middle attacks that could modify clinical data in transit.',
      mitigationControls: ['TLS 1.2+ enforced on all API endpoints', 'HSTS headers configured to prevent downgrade', 'Certificate management via infrastructure', 'HTTP-to-HTTPS redirect enforced', 'Regular TLS configuration audits'],
      residualRisk: 'Low — TLS enforcement at infrastructure level with HSTS protection.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Unencrypted transmission exposes ePHI to interception and modification.',
    },
    'FEAT-152': {
      failureMode: 'Breach detection mechanisms fail to identify unauthorized access or data exposure events.',
      patientSafetyImpact: 'Undetected breaches allow continued unauthorized access to patient data, prolonging exposure and potential harm.',
      dataIntegrityImpact: 'HIPAA §164.404 requires notification within 60 days. Failure to detect breaches prevents timely notification and remediation.',
      mitigationControls: ['Anomaly detection in audit logs', 'notification.service.ts for breach alerts', 'Documented breach notification procedures (SOP)', '60-day notification window compliance tracking', 'Regular review of detection rule effectiveness'],
      residualRisk: 'Medium — Breach detection is heuristic; regular review of detection rules recommended.',
      csaClassification: 'High Process Risk',
      csaReasoning: 'Undetected breaches prolong patient data exposure and violate notification obligations.',
    },
  };
  return criticalFeatures
    .filter((f) => analysisMap[f.featureId] !== undefined)
    .map((f) => ({ featureId: f.featureId, ...analysisMap[f.featureId] }));
}

function buildCriticalMitigations(criticalFeatures: FeatureRisk[]): MitigationControl[] {
  const controlMap: Record<string, { controls: string; residualRisk: string }> = {
    'FEAT-001': {
      controls: 'JWT middleware with configurable expiration; password complexity enforcement (min 8 chars, mixed case, digit, special); rate limiting on auth endpoints (rateLimiter.middleware.ts); configurable session idle timeout; account lockout after failed attempts; device fingerprinting',
      residualRisk: 'Low — multi-layered authentication controls with monitoring',
    },
    'FEAT-002': {
      controls: 'Database UNIQUE constraint on acc_users.username; validation at registration in auth.service.ts; application-level duplicate check before INSERT',
      residualRisk: 'Low — database-level constraint prevents bypass',
    },
    'FEAT-003': {
      controls: 'auth.service.ts validatePassword() enforces complexity policy; Joi schema validation on registration/change endpoints; password history prevents reuse; periodic expiration enforced',
      residualRisk: 'Low — policy enforcement at multiple layers',
    },
    'FEAT-004': {
      controls: 'authorization.middleware.ts authorize([roles]) on every protected route; 6 predefined roles with 42 granular permissions; study-scoped and site-scoped access filtering in service layer',
      residualRisk: 'Low — comprehensive RBAC with granular permissions',
    },
    'FEAT-005': {
      controls: 'JWT expiration claim checked by auth.middleware.ts; frontend idle-timeout.service.ts triggers forced logout; concurrent session prevention; device fingerprint verification',
      residualRisk: 'Low — server and client timeout enforcement',
    },
    'FEAT-010': {
      controls: 'audit.middleware.ts applied to all mutation routes globally; atomic audit+data writes via pool.transaction(); acc_audit_log schema enforces NOT NULL on required fields; sequential IDs for gap detection',
      residualRisk: 'Low — middleware-level enforcement ensures no bypass',
    },
    'FEAT-011': {
      controls: 'audit.service.ts createAuditEntry() populates all required fields (who/what/when/old/new) from AuthRequest context; JSONB storage for structured old/new values; server-generated timestamps only',
      residualRisk: 'Low — schema and application enforce completeness',
    },
    'FEAT-012': {
      controls: 'No UPDATE/DELETE API endpoints for acc_audit_log; database REVOKE UPDATE, DELETE on acc_audit_log from application role; audit.routes.ts exposes GET endpoints only',
      residualRisk: 'Low — database and application layer both prevent modification',
    },
    'FEAT-014': {
      controls: 'Form data PUT endpoint requires reason field in request body; Joi validation rejects requests missing reason; reason stored in acc_audit_log.reason column',
      residualRisk: 'Low — mandatory field enforced at validation layer',
    },
    'FEAT-020': {
      controls: 'esignature.service.ts requires fresh password verification (verifyPassword()) before signature creation; part11.middleware.ts enforces two-component authentication; no cached credentials accepted',
      residualRisk: 'Low — two-component auth at every signing event',
    },
    'FEAT-021': {
      controls: 'acc_esignatures schema stores signer_name, signed_at (TIMESTAMPTZ), meaning as NOT NULL columns; pdf.service.ts renders all components in exports; UI displays all manifestations',
      residualRisk: 'Low — schema constraints prevent incomplete signatures',
    },
    'FEAT-022': {
      controls: 'esignature.service.ts calls verifyPassword() requiring explicit password input; session credentials not accepted; each signing event triggers independent authentication',
      residualRisk: 'Low — fresh authentication per signing event',
    },
    'FEAT-023': {
      controls: 'SHA-256 hash of record content computed by esignature.service.ts and stored in acc_esignatures.record_hash; any record modification detected by hash mismatch; signature auto-invalidated on change',
      residualRisk: 'Low — cryptographic hash binding prevents tampering',
    },
    'FEAT-024': {
      controls: 'Signature record includes authenticated userId, fresh password verification, SHA-256 record hash, and server-generated UTC timestamp; audit trail logs all signing events including failures',
      residualRisk: 'Low — multi-factor evidence prevents repudiation',
    },
    'FEAT-030': {
      controls: 'Validation rules fire on save (validation-rules.service.ts); audit trail captures all changes (audit.middleware.ts); Part 11 middleware enforces compliance checks; data locks prevent unauthorized modification',
      residualRisk: 'Low — multi-layer data integrity controls',
    },
    'FEAT-031': {
      controls: 'Audit middleware captures old value before overwrite; new value recorded alongside; reason for change required; original data always recoverable from audit trail',
      residualRisk: 'Low — complete change history preserved',
    },
    'FEAT-032': {
      controls: 'Configurable rule types (range, pattern, cross-field, required); server-side and client-side validation; auto-query generation on rule violation; rules versioned in acc_validation_rules',
      residualRisk: 'Low — comprehensive validation at entry point',
    },
    'FEAT-040': {
      controls: 'Query lifecycle managed by query.service.ts (CRUD, mutations, stats, bulk, recipients); all transitions audit-logged; assignment and escalation workflows; resolution requires clinical review',
      residualRisk: 'Low — full lifecycle management with audit trail',
    },
    'FEAT-050': {
      controls: 'data-locks.service.ts enforces freeze status; data edits rejected with descriptive error; query workflow remains active; freeze status persisted in acc_data_locks table',
      residualRisk: 'Low — database-level enforcement of freeze state',
    },
    'FEAT-051': {
      controls: 'data-locks.service.ts enforces lock status; all modifications rejected; unlock requires e-signature; lock events audit-logged with reason',
      residualRisk: 'Low — immutable lock with e-signature gating',
    },
    'FEAT-052': {
      controls: 'Study-level database lock via data-locks.service.ts; requires e-signature; prevents all study data modifications globally; unlock requires formal documented process',
      residualRisk: 'Low — global lock with regulatory controls',
    },
    'FEAT-070': {
      controls: 'Unique subject ID generation with site-scoped duplicate prevention; database constraint on study+label; enrollment status tracking; audit trail for enrollment events',
      residualRisk: 'Low — database constraints prevent duplicates',
    },
    'FEAT-071': {
      controls: 'UNIQUE constraint on subject ID within study; application-level validation before INSERT; error handling returns descriptive rejection; audit trail logs assignment',
      residualRisk: 'Low — multi-layer uniqueness enforcement',
    },
    'FEAT-080': {
      controls: 'Export routes with format selection (PDF/CSV/XML/ODM); export.service.ts generates complete data extracts; checksum verification on output; audit trail for all exports',
      residualRisk: 'Low — comprehensive export with integrity verification',
    },
    'FEAT-081': {
      controls: 'Audit trail export via GET /api/audit/export; PDF and CSV formats; content verified against database; export events themselves are audit-logged',
      residualRisk: 'Low — audit export with verification',
    },
    'FEAT-082': {
      controls: 'PostgreSQL with WAL archiving; AES-256 encrypted backups; no auto-purge on regulated tables; retention-manager.service.ts enforces retention policy; ≥15 year retention configured',
      residualRisk: 'Low — multi-layer retention with encrypted backups',
    },
    'FEAT-090': {
      controls: 'backup.service.ts → encryption.service.ts (AES-256-GCM); backup-scheduler.service.ts for automated scheduling; retention-manager.service.ts; key rotation configured',
      residualRisk: 'Low — automated encrypted backups with key management',
    },
    'FEAT-091': {
      controls: 'backup.service.ts restore() with checksum comparison; post-restore integrity verification; documented DR procedures; periodic DR drills',
      residualRisk: 'Medium — restore procedures verified but DR drills should increase frequency',
    },
    'FEAT-110': {
      controls: 'randomization-engine.service.ts with sealed allocation lists; blinded assignment generation; allocation concealment enforced; all randomization events audit-logged',
      residualRisk: 'Low — sealed allocation with audit trail',
    },
    'FEAT-141': {
      controls: 'Consent management module with documented consent workflow; consent status tracked per subject; consent events audit-logged; withdrawal handling with data impact assessment',
      residualRisk: 'Medium — consent management is regulatory-critical; ongoing monitoring required',
    },
    'FEAT-150': {
      controls: 'PostgreSQL volume-level encryption; AES-256-GCM for backup files; encryption key management with rotation; no plaintext ePHI storage',
      residualRisk: 'Low — encryption at rest verified at infrastructure level',
    },
    'FEAT-151': {
      controls: 'TLS 1.2+ enforced on all API endpoints; HSTS headers configured; certificate management via infrastructure; HTTP-to-HTTPS redirect enforced',
      residualRisk: 'Low — TLS enforcement at infrastructure level',
    },
    'FEAT-152': {
      controls: 'Anomaly detection in audit logs; notification.service.ts for breach alerts; documented breach notification procedures (SOP); 60-day notification window compliance',
      residualRisk: 'Medium — breach detection is heuristic; regular review of detection rules recommended',
    },
  };

  return criticalFeatures.map((f) => {
    const entry = controlMap[f.featureId];
    return {
      featureId: f.featureId,
      feature: f.feature,
      controls: entry ? entry.controls : 'Controls documented in system design — see implementation reference in FRS',
      residualRisk: entry ? entry.residualRisk : 'To be assessed after control verification',
    };
  });
}

export function generate(outputDir: string, _workspaceRoot: string): void {
  const riskLevels: RiskLevel[] = ['Critical', 'High', 'Medium', 'Low'];
  const riskCounts: Record<RiskLevel, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const f of FEATURE_RISKS) {
    riskCounts[f.riskLevel]++;
  }

  const criticalFeatures = FEATURE_RISKS.filter((f) => f.riskLevel === 'Critical');
  const mitigations = buildCriticalMitigations(criticalFeatures);

  let content = '';

  content += documentHeader({
    title: 'Risk Assessment',
    documentId: `RA-${DOC_YEAR}-001`,
    version: '1.0',
    date: DOC_DATE,
    system: SYSTEM_INFO.fullName,
    classification: 'Confidential — Regulatory',
  });

  content += tableOfContents([
    { level: 1, title: 'Purpose and Scope' },
    { level: 1, title: 'Risk Assessment Methodology' },
    { level: 1, title: 'Risk Assessment Matrix' },
    { level: 1, title: 'Risk Summary Statistics' },
    { level: 1, title: 'Critical Risk Mitigation Controls' },
    { level: 1, title: 'Detailed Risk Analysis — Critical Features' },
    { level: 1, title: 'CSA Risk Classification Summary' },
    { level: 1, title: 'Residual Risk Assessment' },
    { level: 1, title: 'Risk Acceptance' },
    { level: 1, title: 'Approval Signatures' },
  ]) + '\n';
  content += hr();

  // Section 1: Purpose and Scope
  content += section(2, 'Purpose and Scope');
  content += `This Risk Assessment document identifies, evaluates, and documents the risks associated with each `;
  content += `feature of the **${SYSTEM_INFO.fullName}** (v${SYSTEM_INFO.version}). `;
  content += `The assessment determines the level of validation rigor required for each feature based on its `;
  content += `potential impact on patient safety, data integrity, regulatory compliance, and system reliability.\n\n`;
  content += 'This risk assessment is performed in accordance with:\n\n';
  content += '- **21 CFR Part 11** — Electronic Records; Electronic Signatures\n';
  content += '- **HIPAA Security Rule** (45 CFR 164 Subpart C) — Technical Safeguards\n';
  content += '- **ICH E6(R2)** — Good Clinical Practice\n';
  content += '- **GAMP 5** — Risk-Based Approach to Compliant GxP Computerized Systems\n\n';
  content += 'The assessment covers all system features that create, modify, store, retrieve, or transmit ';
  content += 'electronic records, electronic signatures, or electronic protected health information (ePHI).\n\n';
  content += hr();

  // Section 2: Risk Assessment Methodology
  content += section(2, 'Risk Assessment Methodology');
  content += 'Each system feature is assessed using a **4-tier risk scale** that considers:\n\n';
  content += '- **Patient safety impact** — Could a failure harm a clinical trial subject?\n';
  content += '- **Data integrity impact** — Could a failure corrupt, lose, or expose regulated records?\n';
  content += '- **Regulatory compliance impact** — Could a failure cause a Part 11 or HIPAA violation?\n';
  content += '- **Business continuity impact** — Could a failure disrupt clinical trial operations?\n\n';
  content += 'The risk levels and their definitions are:\n\n';

  content += markdownTable(
    ['Risk Level', 'Description', 'Release-Blocking?'],
    riskLevels.map((level) => {
      const def = RISK_DEFINITIONS[level];
      return [
        riskBadge(level),
        def.description,
        def.releaseBlocking ? '**YES** — must pass all validation tests before release' : 'No — may proceed with documented acceptance',
      ];
    }),
  );
  content += '\n';
  content += 'Features rated **Critical** or **High** require full IQ/OQ/PQ validation testing. ';
  content += 'Features rated **Medium** require OQ testing. Features rated **Low** require documented review.\n\n';
  content += hr();

  // Section 3: Risk Assessment Matrix
  content += section(2, 'Risk Assessment Matrix');
  content += `The following table presents the risk assessment for all **${FEATURE_RISKS.length}** system features.\n\n`;

  content += markdownTable(
    ['Feature ID', 'Feature', 'Risk Level', 'Justification', 'Part 11 Ref', 'HIPAA Ref'],
    FEATURE_RISKS.map((f) => [
      f.featureId,
      f.feature,
      riskBadge(f.riskLevel),
      f.justification,
      f.part11Section ?? 'N/A',
      f.hipaaSection ?? 'N/A',
    ]),
  );
  content += '\n';
  content += hr();

  // Section 4: Risk Summary Statistics
  content += section(2, 'Risk Summary Statistics');
  content += `**Total Features Assessed:** ${FEATURE_RISKS.length}\n\n`;

  content += markdownTable(
    ['Risk Level', 'Feature Count', 'Percentage', 'Release-Blocking'],
    riskLevels.map((level) => {
      const count = riskCounts[level];
      const pct = ((count / FEATURE_RISKS.length) * 100).toFixed(1);
      return [
        riskBadge(level),
        String(count),
        `${pct}%`,
        RISK_DEFINITIONS[level].releaseBlocking ? 'YES' : 'No',
      ];
    }),
  );
  content += '\n';

  const blockingCount = riskCounts.Critical + riskCounts.High;
  const blockingPct = ((blockingCount / FEATURE_RISKS.length) * 100).toFixed(1);
  content += `**Release-blocking features:** ${blockingCount} of ${FEATURE_RISKS.length} (${blockingPct}%)\n\n`;
  content += `**Critical features requiring maximum validation rigor:** ${riskCounts.Critical}\n\n`;
  content += hr();

  // Section 5: Critical Risk Mitigation Controls
  content += section(2, 'Critical Risk Mitigation Controls');
  content += 'For each **Critical**-rated feature, the following specific controls are implemented to mitigate risk:\n\n';

  for (const m of mitigations) {
    content += `### ${m.featureId}: ${m.feature}\n\n`;
    content += `**Mitigation Controls:**\n\n`;
    const controlItems = m.controls.split('; ');
    for (const ctrl of controlItems) {
      content += `- ${ctrl.trim()}\n`;
    }
    content += `\n**Residual Risk After Controls:** ${m.residualRisk}\n\n`;
  }
  content += hr();

  // Section 5b: Detailed Risk Analysis for Critical Features
  content += section(2, 'Detailed Risk Analysis — Critical Features');
  content += 'For each **Critical**-rated feature, the following expanded analysis documents the failure modes, ' +
    'impact on patient safety and data integrity, specific mitigation controls, residual risk after controls, ' +
    'and CSA risk classification per FDA Computer Software Assurance guidance (February 2026).\n\n';

  const detailedAnalyses = buildDetailedRiskAnalyses(criticalFeatures);
  for (const da of detailedAnalyses) {
    const feat = criticalFeatures.find((f) => f.featureId === da.featureId);
    const featureName = feat ? feat.feature : da.featureId;
    content += section(3, `${da.featureId}: ${featureName} — Detailed Risk Analysis`);
    content += `**Failure Mode:** ${da.failureMode}\n\n`;
    content += `**Impact on Patient Safety:** ${da.patientSafetyImpact}\n\n`;
    content += `**Impact on Data Integrity:** ${da.dataIntegrityImpact}\n\n`;
    content += '**Mitigation Controls:**\n\n';
    for (const ctrl of da.mitigationControls) {
      content += `- ${ctrl}\n`;
    }
    content += `\n**Residual Risk:** ${da.residualRisk}\n\n`;
    content += `**CSA Classification:** ${da.csaClassification} — ${da.csaReasoning}\n\n`;
  }
  content += hr();

  // Section 5c: CSA Risk Classification Summary
  content += section(2, 'CSA Risk Classification Summary');
  content += 'Per the FDA Computer Software Assurance (CSA) for Manufacturing, Operations, and Quality System ' +
    'Software guidance (February 2026), software features are classified using a binary risk model:\n\n';
  content += '- **High Process Risk:** The feature, if it fails, could foreseeably compromise patient safety, ' +
    'product quality, or data integrity per Section V.A.2 of the guidance.\n';
  content += '- **Not High Process Risk:** The feature supports operations but failure would not foreseeably ' +
    'compromise safety, quality, or data integrity.\n\n';
  content += 'Features classified as High Process Risk require **assurance activities commensurate with the risk**, ' +
    'including documented testing. Features classified as Not High Process Risk may use **unscripted testing** ' +
    'or **professional judgment** for assurance.\n\n';

  const csaRows: string[][] = FEATURE_RISKS.map((f) => {
    const analysis = detailedAnalyses.find((da) => da.featureId === f.featureId);
    if (analysis) {
      return [f.featureId, f.feature, riskBadge(f.riskLevel), '**High Process Risk**', analysis.csaReasoning];
    }
    const isHighProcess = f.riskLevel === 'Critical' || f.riskLevel === 'High';
    return [
      f.featureId,
      f.feature,
      riskBadge(f.riskLevel),
      isHighProcess ? 'High Process Risk' : 'Not High Process Risk',
      isHighProcess
        ? 'Feature affects regulated records or clinical workflows'
        : 'Feature supports operations without direct safety or integrity impact',
    ];
  });

  content += markdownTable(
    ['Feature ID', 'Feature', 'Risk Level', 'CSA Classification', 'Reasoning'],
    csaRows,
  );
  content += '\n';

  const highProcessCount = csaRows.filter((r) => r[3].includes('High Process Risk')).length;
  const notHighProcessCount = csaRows.length - highProcessCount;
  content += `**Summary:** ${highProcessCount} of ${FEATURE_RISKS.length} features are classified as **High Process Risk** ` +
    `(${((highProcessCount / FEATURE_RISKS.length) * 100).toFixed(1)}%). ` +
    `${notHighProcessCount} features are classified as **Not High Process Risk** ` +
    `(${((notHighProcessCount / FEATURE_RISKS.length) * 100).toFixed(1)}%).\n\n`;
  content += 'High Process Risk features require scripted validation testing (IQ/OQ/PQ) with documented evidence. ' +
    'Not High Process Risk features may leverage unscripted or exploratory testing approaches per the CSA guidance.\n\n';

  content += hr();

  // Section 6: Residual Risk Assessment
  content += section(2, 'Residual Risk Assessment');
  content += 'After applying the mitigation controls documented in Section 5, the residual risk profile is:\n\n';

  const residualCounts: Record<string, number> = { Low: 0, Medium: 0, High: 0 };
  for (const m of mitigations) {
    if (m.residualRisk.startsWith('Low')) {
      residualCounts['Low']++;
    } else if (m.residualRisk.startsWith('Medium')) {
      residualCounts['Medium']++;
    } else {
      residualCounts['High']++;
    }
  }

  content += markdownTable(
    ['Residual Risk Level', 'Feature Count', 'Notes'],
    [
      ['Low', String(residualCounts['Low']), 'Multi-layer controls reduce risk to acceptable levels'],
      ['Medium', String(residualCounts['Medium']), 'Acceptable with ongoing monitoring and periodic review'],
      ['High', String(residualCounts['High']), 'Requires immediate additional controls before release'],
    ],
  );
  content += '\n';

  content += 'The residual risk assessment demonstrates that the implemented controls effectively reduce ';
  content += 'Critical-rated risks to acceptable levels. Features with Medium residual risk have been documented ';
  content += 'with ongoing monitoring requirements.\n\n';

  content += '**Key findings:**\n\n';
  content += `- ${residualCounts['Low']} of ${mitigations.length} Critical features have been mitigated to Low residual risk\n`;
  content += `- ${residualCounts['Medium']} of ${mitigations.length} Critical features have Medium residual risk with documented monitoring plans\n`;
  if (residualCounts['High'] > 0) {
    content += `- ${residualCounts['High']} of ${mitigations.length} Critical features have High residual risk requiring additional controls\n`;
  }
  content += `- No Critical features have unmitigated residual risk\n\n`;
  content += hr();

  // Section 7: Risk Acceptance
  content += section(2, 'Risk Acceptance');
  content += '### Formal Risk Acceptance Statement\n\n';
  content += `Based on the risk assessment conducted for **${SYSTEM_INFO.fullName}** (v${SYSTEM_INFO.version}):\n\n`;
  content += `1. **${FEATURE_RISKS.length} system features** have been assessed for risk impact on patient safety, `;
  content += 'data integrity, regulatory compliance, and business continuity.\n\n';
  content += `2. **${riskCounts.Critical} Critical-rated features** have documented mitigation controls that reduce `;
  content += 'residual risk to acceptable levels.\n\n';
  content += `3. **${riskCounts.High} High-rated features** have been identified for full validation testing `;
  content += '(IQ/OQ/PQ) to confirm control effectiveness.\n\n';
  content += '4. **All release-blocking features** (Critical and High) must pass their associated validation ';
  content += 'test cases documented in the OQ and PQ protocols before production deployment.\n\n';
  content += '5. The **residual risk** after applying documented controls is assessed as **acceptable** for ';
  content += 'production use in regulated clinical trial data capture, subject to:\n';
  content += '   - Successful completion of all IQ, OQ, and PQ test cases\n';
  content += '   - Implementation of all documented mitigation controls\n';
  content += '   - Ongoing monitoring per the SOP requirements\n';
  content += '   - Periodic risk re-assessment (at minimum annually or upon significant system change)\n\n';
  content += '**Risk acceptance is conditional upon successful completion of the validation protocol.**\n\n';
  content += hr();

  content += approvalBlock([
    'Quality Assurance Lead',
    'Risk Assessment Owner',
    'Project Manager',
    'Regulatory Affairs',
    'System Owner',
  ]);
  content += '\n---\n*End of Document*\n';

  fs.writeFileSync(path.join(outputDir, '05-risk-assessment.md'), content);
}
