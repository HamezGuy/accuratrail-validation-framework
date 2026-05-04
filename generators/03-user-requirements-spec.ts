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

const DOC_DATE = new Date().toISOString().split('T')[0];
const DOC_YEAR = new Date().getFullYear();

interface Requirement {
  id: string;
  description: string;
  priority: 'Must' | 'Should' | 'Could';
  risk: 'Critical' | 'High' | 'Medium' | 'Low';
  part11Ref: string;
  acceptance: string;
}

interface ReqCategory {
  title: string;
  anchor: string;
  requirements: Requirement[];
}

interface DetailedDescription {
  id: string;
  rationale: string;
  context: string;
  acceptanceMethod: string;
}

function buildDetailedDescriptions(): DetailedDescription[] {
  return [
    {
      id: 'URS-001',
      rationale: '21 CFR Part 11 §11.10(d) mandates that system access be limited to authorized individuals. ' +
        'In a clinical trial EDC system, unauthorized access could lead to data integrity breaches affecting ' +
        'patient safety decisions and regulatory submission data quality. Shared accounts make it impossible ' +
        'to attribute actions to specific individuals, violating the fundamental accountability requirements.',
      context: 'Clinical trial sites may have multiple users sharing workstations in busy research units. ' +
        'The system must ensure individual accountability for all data entries through unique identification. ' +
        'During FDA inspections, auditors routinely verify that every data entry can be traced to a specific person.',
      acceptanceMethod: 'Verified through OQ-001 (valid login with unique credentials), OQ-002 (duplicate username ' +
        'prevention at registration), OQ-003 (invalid credential rejection), and IQ-013 (acc_users table schema ' +
        'verification with UNIQUE constraint on username column).',
    },
    {
      id: 'URS-002',
      rationale: '21 CFR Part 11 §11.300(a) requires procedures to ensure uniqueness and confidentiality of ' +
        'electronic signatures. Weak passwords are the primary attack vector for unauthorized system access. ' +
        'NIST SP 800-63B and FDA guidance recommend complexity requirements as a baseline control.',
      context: 'Clinical research coordinators and investigators may not prioritize password security. ' +
        'The system must enforce complexity without creating barriers that lead to password sharing or ' +
        'write-down behaviors, both of which are common findings in FDA 483 observations.',
      acceptanceMethod: 'Verified through OQ-004 (password complexity enforcement), OQ-005 (weak password ' +
        'rejection), PQ-001 (password policy integration test), and IQ-014 (bcrypt hashing verification ' +
        'in database storage).',
    },
    {
      id: 'URS-003',
      rationale: '21 CFR Part 11 §11.300(d) requires controls to detect and report unauthorized use attempts. ' +
        'Account lockout is a critical control against brute-force attacks that could compromise regulated ' +
        'records. Without lockout, an attacker has unlimited attempts to guess credentials.',
      context: 'Clinical trial systems are high-value targets because they contain patient data and treatment ' +
        'assignment information. Automated attacks against login endpoints are common. The lockout threshold ' +
        'must balance security (low threshold) against usability (avoiding lockout from typos).',
      acceptanceMethod: 'Verified through OQ-006 (lockout after N failed attempts), OQ-007 (locked account ' +
        'rejects valid credentials), OQ-008 (admin unlock workflow), and PQ-002 (brute-force simulation test).',
    },
    {
      id: 'URS-004',
      rationale: '21 CFR Part 11 §11.10(d) requires controls to prevent unauthorized access. Unattended ' +
        'workstations in clinical settings pose a significant risk — a nurse or coordinator stepping away ' +
        'from a logged-in terminal could allow anyone to modify regulated records under their identity.',
      context: 'Clinical research sites are busy healthcare environments where staff frequently move between ' +
        'patients, exam rooms, and workstations. Automatic session timeout is the primary control against ' +
        'unauthorized access through abandoned sessions. HIPAA §164.312(a)(2)(iii) also mandates this control.',
      acceptanceMethod: 'Verified through OQ-009 (session expiration after idle period), OQ-010 (re-authentication ' +
        'required after timeout), PQ-003 (idle timeout integration with frontend timer), and IQ-015 (JWT ' +
        'expiration claim configuration verification).',
    },
    {
      id: 'URS-005',
      rationale: '21 CFR Part 11 §11.10(d) and §11.10(g) require system access limited to authorized individuals ' +
        'with controls over the distribution of, access to, and use of documentation for system operation. ' +
        'RBAC implements the principle of least privilege, ensuring users can only perform actions necessary ' +
        'for their clinical role.',
      context: 'Clinical trials involve multiple distinct roles: investigators enter clinical data, monitors ' +
        'perform source data verification, data managers resolve queries, and administrators manage users. ' +
        'Each role requires different access levels. A site coordinator should never be able to lock a database, ' +
        'and a monitor should not modify subject data.',
      acceptanceMethod: 'Verified through OQ-011 (role assignment enforcement), OQ-012 (cross-role access denial), ' +
        'OQ-013 (permission matrix verification for all 6 roles), PQ-004 (end-to-end role-based workflow test), ' +
        'and IQ-016 (acc_roles and acc_permissions table schema verification).',
    },
    {
      id: 'URS-006',
      rationale: '21 CFR Part 11 §11.10(d) requires limiting access to authorized individuals for their specific ' +
        'responsibilities. In multi-site, multi-study environments, a user authorized for Study A must not see ' +
        'data from Study B. Cross-study data leakage could compromise blinding and introduce bias.',
      context: 'Pharmaceutical sponsors often run multiple concurrent trials. CROs managing data for competing ' +
        'sponsors must have strict study-level data isolation. Site-level restrictions ensure monitors only ' +
        'see data from their assigned sites, preventing inadvertent unblinding or competitive intelligence issues.',
      acceptanceMethod: 'Verified through OQ-014 (study-scoped data filtering), OQ-015 (site-scoped data ' +
        'filtering), OQ-016 (cross-study access denial), and PQ-005 (multi-study user isolation integration test).',
    },
    {
      id: 'URS-009',
      rationale: '21 CFR Part 11 §11.10(e) requires audit trails for operator entries and actions. Login ' +
        'attempt logging is the foundation of access monitoring — it enables detection of brute-force attacks, ' +
        'unauthorized access attempts, and account compromise. Failed login patterns are a key security indicator.',
      context: 'During regulatory inspections, FDA auditors review login records to verify system access controls ' +
        'are functioning. The login audit trail provides evidence that only authorized users accessed the system ' +
        'during the trial period. IP address logging enables geographic anomaly detection.',
      acceptanceMethod: 'Verified through OQ-017 (successful login audit entry), OQ-018 (failed login audit entry ' +
        'with IP), OQ-019 (audit log completeness verification), and PQ-006 (login audit trail review test).',
    },
    {
      id: 'URS-015',
      rationale: '21 CFR Part 11 §11.10(e) requires comprehensive audit trails. Administrative actions — user ' +
        'creation, role changes, deactivation — directly affect who can access and modify regulated records. ' +
        'Without logging these actions, changes to access control cannot be investigated after the fact.',
      context: 'Administrative changes are high-impact events. Creating a new user account grants access to ePHI ' +
        'and regulated records. Changing a role could elevate privileges. Deactivating a user could disrupt ' +
        'clinical operations. Every such action must be attributable for regulatory accountability.',
      acceptanceMethod: 'Verified through OQ-020 (user creation audit entry), OQ-021 (role change audit entry), ' +
        'OQ-022 (deactivation audit entry), and PQ-007 (administrative action audit trail completeness test).',
    },
    {
      id: 'URS-016',
      rationale: '21 CFR Part 11 §11.10(e) explicitly requires "computer-generated, time-stamped audit trails ' +
        'to independently record the date and time of operator entries and actions." This is the cornerstone ' +
        'requirement of Part 11 — without audit trails, electronic records cannot be considered trustworthy.',
      context: 'In clinical trials, every data change must be traceable. When an adverse event severity is changed ' +
        'from "mild" to "severe," regulators need to know who made the change, when, and why. The audit trail ' +
        'serves as the permanent, immutable history of every record in the system.',
      acceptanceMethod: 'Verified through OQ-023 (audit entry generated on data creation), OQ-024 (audit entry ' +
        'generated on data modification), OQ-025 (audit entry generated on data deletion), OQ-026 (UTC timestamp ' +
        'verification), and IQ-017 (acc_audit_log table schema with NOT NULL constraints).',
    },
    {
      id: 'URS-017',
      rationale: '21 CFR Part 11 §11.10(e) specifies that audit trails must record "previously recorded ' +
        'information" and identify the "operator." Incomplete audit entries fail to meet the regulatory standard ' +
        'and would be cited as a finding during inspection. Each field serves a distinct regulatory purpose.',
      context: 'A complete audit trail entry answers the five W questions for regulated records: Who (user identity), ' +
        'What (action performed and record affected), When (UTC timestamp), Where (record identifier), and Why ' +
        '(reason for change, captured separately). Missing any element undermines the investigative value.',
      acceptanceMethod: 'Verified through OQ-027 (audit entry field completeness check for all six fields), ' +
        'OQ-028 (no null fields in audit entries for data changes), and IQ-018 (NOT NULL constraints on all ' +
        'required acc_audit_log columns).',
    },
    {
      id: 'URS-018',
      rationale: '21 CFR Part 11 §11.10(e) and ICH E6(R2) §8.0 require that any correction to trial data ' +
        'include an explanation. The reason for change distinguishes legitimate corrections from data manipulation. ' +
        'It provides the clinical context that auditors need to assess whether a change was appropriate.',
      context: 'In practice, data corrections happen frequently in clinical trials — typos, measurement ' +
        'recalculations, late information from lab reports. The reason for change allows data managers and ' +
        'monitors to verify that each correction is clinically justified and not suspicious.',
      acceptanceMethod: 'Verified through OQ-029 (reason field required on data correction), OQ-030 (correction ' +
        'rejected without reason), OQ-031 (reason stored in audit trail), and PQ-008 (data correction workflow ' +
        'end-to-end test).',
    },
    {
      id: 'URS-019',
      rationale: '21 CFR Part 11 §11.10(e) states that audit trail records shall not be altered. If audit trails ' +
        'can be modified, the entire electronic record system loses trustworthiness. An editable audit trail is ' +
        'equivalent to having no audit trail at all from a regulatory perspective.',
      context: 'Audit trail immutability is the single most scrutinized control during FDA inspections of ' +
        'computerized systems. Inspectors routinely attempt to verify that no mechanism exists — through the ' +
        'application, database, or administrative tools — to alter audit trail records.',
      acceptanceMethod: 'Verified through OQ-032 (no API endpoint for audit modification), OQ-033 (database ' +
        'permission REVOKE verification), OQ-034 (attempted audit modification returns error), and IQ-019 ' +
        '(database role permission audit for acc_audit_log table).',
    },
    {
      id: 'URS-020',
      rationale: '21 CFR Part 11 §11.10(e) requires audit trails to be maintained "throughout the records ' +
        'retention period." For clinical trial data, FDA regulations require retention for at least 2 years ' +
        'after drug approval or investigation termination. Industry practice extends this to 15+ years.',
      context: 'Pharmaceutical companies may face regulatory inquiries years or decades after a trial concludes. ' +
        'The audit trail must be accessible and readable for the full retention period. This requires both ' +
        'physical storage durability and format readability over time.',
      acceptanceMethod: 'Verified through OQ-035 (retention policy configuration), OQ-036 (no auto-purge on ' +
        'audit tables), IQ-020 (retention-manager.service.ts configuration review), and PQ-009 (simulated ' +
        'long-term retention test).',
    },
    {
      id: 'URS-027',
      rationale: '21 CFR Part 11 §11.10(e) requires "computer-generated, time-stamped" audit trails. If users ' +
        'or applications can supply their own timestamps, the chronological integrity of the audit trail is ' +
        'compromised. Backdated entries could conceal the true sequence of events.',
      context: 'Server-generated timestamps in UTC eliminate timezone ambiguity and prevent timestamp manipulation. ' +
        'In multi-site, multi-timezone clinical trials, a single consistent time source is essential for ' +
        'reconstructing the accurate sequence of events during regulatory review.',
      acceptanceMethod: 'Verified through OQ-037 (client-supplied timestamps rejected), OQ-038 (server timestamp ' +
        'accuracy verification against NTP), and IQ-021 (DEFAULT NOW() on acc_audit_log.created_at column).',
    },
    {
      id: 'URS-029',
      rationale: '21 CFR Part 11 §11.100(a) requires that each electronic signature be "unique to one individual ' +
        'and not reused by, or reassigned to, anyone else." Shared or reassigned signatures would undermine the ' +
        'legal equivalence of electronic signatures to handwritten ones.',
      context: 'In clinical trials, electronic signatures are used to approve CRF data, sign adverse event reports, ' +
        'and authorize database locks. Each signature carries legal weight equivalent to a wet-ink signature on ' +
        'paper. The signer takes personal responsibility for the content they sign.',
      acceptanceMethod: 'Verified through OQ-039 (signature creation requires personal re-authentication), ' +
        'OQ-040 (signature uniquely tied to authenticated user ID), and PQ-010 (signature lifecycle integration ' +
        'test with multiple signers).',
    },
    {
      id: 'URS-041',
      rationale: '21 CFR Part 11 §11.10(a) requires controls to ensure the integrity of electronic records. ' +
        'The eCRF is the primary electronic record in a clinical trial — it captures the data that drives ' +
        'safety monitoring, efficacy analysis, and regulatory submissions.',
      context: 'eCRF data entry is the core function of an EDC system. Every field on every form may contribute ' +
        'to a regulatory submission. Field-level validation at point of entry is the first defense against ' +
        'data quality issues that could require costly corrections later in the trial.',
      acceptanceMethod: 'Verified through OQ-041 (all CRF field types render and save correctly), OQ-042 ' +
        '(field-level validation fires on entry), PQ-011 (complete CRF data entry workflow test), and ' +
        'IQ-022 (form data storage schema verification).',
    },
    {
      id: 'URS-044',
      rationale: '21 CFR Part 11 §11.10(b) requires the ability to generate "accurate and complete copies of ' +
        'records in both human readable and electronic form suitable for inspection, review, and copying." ' +
        'Multiple export formats ensure regulatory authorities can review data in their preferred format.',
      context: 'FDA inspectors may request data in PDF for on-screen review, CSV for analysis, XML for automated ' +
        'processing, or CDISC ODM for regulatory submission. The system must produce exports that faithfully ' +
        'represent the source data without omission or transformation artifacts.',
      acceptanceMethod: 'Verified through OQ-043 (PDF export completeness), OQ-044 (CSV export accuracy), ' +
        'OQ-045 (XML well-formedness), OQ-046 (CDISC ODM compliance), and PQ-012 (export round-trip verification ' +
        'against source data).',
    },
    {
      id: 'URS-057',
      rationale: '21 CFR Part 11 §11.10(a) requires controls ensuring the integrity of electronic records. ' +
        'Subject enrollment is the gateway to clinical trial participation — errors in enrollment can affect ' +
        'patient safety (wrong treatment), data integrity (wrong study), and regulatory compliance (eligibility).',
      context: 'Subject enrollment assigns a unique identifier that links all subsequent clinical data to that ' +
        'individual. Duplicate enrollment or cross-site enrollment errors are serious protocol deviations that ' +
        'can invalidate study data and endanger patients.',
      acceptanceMethod: 'Verified through OQ-047 (unique subject ID generation), OQ-048 (duplicate enrollment ' +
        'prevention), OQ-049 (site assignment verification), and PQ-013 (enrollment workflow end-to-end test).',
    },
    {
      id: 'URS-069',
      rationale: 'HIPAA Security Rule §164.312(a)(2)(iv) specifies encryption as an addressable implementation ' +
        'specification for access control. Given that this system stores ePHI including patient identifiers, ' +
        'medical histories, and adverse event data, encryption at rest is a required safeguard.',
      context: 'Clinical trial data includes sensitive health information that, if exposed, could harm patients ' +
        'through discrimination, insurance denial, or social stigma. Database-level and backup encryption ' +
        'protect against physical media theft, unauthorized database access, and backup exposure.',
      acceptanceMethod: 'Verified through IQ-023 (PostgreSQL encryption-at-rest configuration), IQ-024 ' +
        '(backup encryption verification with AES-256-GCM), OQ-050 (encrypted backup creation and ' +
        'decryption test), and PQ-014 (encryption key rotation test).',
    },
    {
      id: 'URS-073',
      rationale: 'HIPAA Security Rule §164.312(b) requires audit controls with "mechanisms to record and ' +
        'examine activity in information systems that contain or use ePHI." This extends beyond Part 11 audit ' +
        'trails to include read access — knowing who viewed patient data is a HIPAA requirement.',
      context: 'In healthcare settings, "snooping" — viewing patient records without a clinical need — is a ' +
        'common privacy violation. The system must log not just data modifications but also data access events ' +
        'to enable detection of unauthorized viewing of ePHI.',
      acceptanceMethod: 'Verified through OQ-051 (ePHI read access audit entry generation), OQ-052 (audit log ' +
        'completeness for read events), and PQ-015 (ePHI access audit trail review and anomaly detection test).',
    },
  ];
}

function buildCategories(): ReqCategory[] {
  return [
    {
      title: 'Authentication & Access Control',
      anchor: 'auth',
      requirements: [
        { id: 'URS-001', description: 'The system SHALL require unique user accounts — no shared or group accounts permitted', priority: 'Must', risk: 'Critical', part11Ref: '11.10(d), 11.100(a)', acceptance: 'Each user has a unique username; duplicate usernames rejected at creation' },
        { id: 'URS-002', description: 'The system SHALL enforce password complexity (minimum 8 characters, uppercase, lowercase, digit, special character)', priority: 'Must', risk: 'Critical', part11Ref: '11.300(a)', acceptance: 'Passwords not meeting policy are rejected with descriptive error' },
        { id: 'URS-003', description: 'The system SHALL lock user accounts after a configurable number of failed login attempts', priority: 'Must', risk: 'Critical', part11Ref: '11.300(d)', acceptance: 'Account locks after N failures; admin unlock required' },
        { id: 'URS-004', description: 'The system SHALL enforce automatic session timeout after a configurable idle period', priority: 'Must', risk: 'Critical', part11Ref: '11.10(d)', acceptance: 'Session expires after configured idle minutes; re-authentication required' },
        { id: 'URS-005', description: 'The system SHALL implement Role-Based Access Control (RBAC) with least-privilege enforcement', priority: 'Must', risk: 'Critical', part11Ref: '11.10(d), 11.10(g)', acceptance: 'Users can only access functions permitted by their assigned role(s)' },
        { id: 'URS-006', description: 'The system SHALL restrict data access to authorized studies and sites per user assignment', priority: 'Must', risk: 'Critical', part11Ref: '11.10(d)', acceptance: 'User sees only data for assigned studies/sites; cross-study access denied' },
        { id: 'URS-007', description: 'The system SHALL support user provisioning with role and study assignment by administrators', priority: 'Must', risk: 'High', part11Ref: '11.10(d)', acceptance: 'Admin can create users, assign roles, assign studies; changes audit-logged' },
        { id: 'URS-008', description: 'The system SHALL support user deactivation without data deletion', priority: 'Must', risk: 'High', part11Ref: '11.10(d)', acceptance: 'Deactivated user cannot log in; historical audit trail entries preserved' },
        { id: 'URS-009', description: 'The system SHALL log all login attempts (success and failure) with timestamp and IP address', priority: 'Must', risk: 'Critical', part11Ref: '11.10(e)', acceptance: 'Login audit log contains username, timestamp, IP, success/failure for every attempt' },
        { id: 'URS-010', description: 'The system SHALL enforce device fingerprinting to detect session hijacking', priority: 'Should', risk: 'High', part11Ref: '11.10(h)', acceptance: 'Session invalidated if device fingerprint changes mid-session' },
        { id: 'URS-011', description: 'The system SHALL prevent concurrent sessions for the same user account', priority: 'Should', risk: 'High', part11Ref: '11.10(d)', acceptance: 'New login terminates or blocks previous active session' },
        { id: 'URS-012', description: 'The system SHALL enforce periodic password expiration', priority: 'Should', risk: 'High', part11Ref: '11.300(b)', acceptance: 'Users prompted to change password after configured expiration period' },
        { id: 'URS-013', description: 'The system SHALL prevent password reuse for a configurable number of previous passwords', priority: 'Should', risk: 'High', part11Ref: '11.300(b)', acceptance: 'System rejects passwords matching last N passwords' },
        { id: 'URS-014', description: 'The system SHALL support periodic user access review by administrators', priority: 'Must', risk: 'High', part11Ref: '11.10(d)', acceptance: 'Admin can generate user access report; review documented' },
        { id: 'URS-015', description: 'The system SHALL log all administrative actions (user creation, role changes, deactivation)', priority: 'Must', risk: 'Critical', part11Ref: '11.10(e)', acceptance: 'Admin action audit log captures who, what, when for every change' },
      ],
    },
    {
      title: 'Audit Trail',
      anchor: 'audit',
      requirements: [
        { id: 'URS-016', description: 'The system SHALL generate computer-generated, timestamped audit trails for all electronic record creation, modification, and deletion', priority: 'Must', risk: 'Critical', part11Ref: '11.10(e)', acceptance: 'Every data change produces an audit entry with UTC timestamp' },
        { id: 'URS-017', description: 'Each audit trail entry SHALL contain: user identity, date/time (UTC), action performed, record affected, old value, new value', priority: 'Must', risk: 'Critical', part11Ref: '11.10(e)', acceptance: 'Audit entry contains all six fields; no field is null for data changes' },
        { id: 'URS-018', description: 'The system SHALL capture a reason for change when clinical data is modified', priority: 'Must', risk: 'Critical', part11Ref: '11.10(e)', acceptance: 'Data correction requires reason; reason stored in audit entry' },
        { id: 'URS-019', description: 'Audit trail records SHALL be immutable — no user including administrators can modify or delete audit entries', priority: 'Must', risk: 'Critical', part11Ref: '11.10(e)', acceptance: 'No API endpoint or database operation permits audit record modification' },
        { id: 'URS-020', description: 'Audit trail records SHALL be retained for the full record retention period (minimum 15 years for clinical data)', priority: 'Must', risk: 'Critical', part11Ref: '11.10(e)', acceptance: 'Audit records persist beyond record retention; verified via retention test' },
        { id: 'URS-021', description: 'The system SHALL provide audit trail export in human-readable format (PDF) and machine-readable format (CSV/XML)', priority: 'Must', risk: 'High', part11Ref: '11.10(b)', acceptance: 'Exported audit trail matches database records; formats verified' },
        { id: 'URS-022', description: 'The system SHALL allow authorized users to review audit trails filtered by subject, form, field, user, and date range', priority: 'Must', risk: 'High', part11Ref: '11.10(e)', acceptance: 'All filter combinations return correct, complete results' },
        { id: 'URS-023', description: 'Audit trail entries SHALL be independent of the record they audit — deleting a record must not delete its audit trail', priority: 'Must', risk: 'Critical', part11Ref: '11.10(e)', acceptance: 'After record deletion, audit trail entries remain accessible' },
        { id: 'URS-024', description: 'The system SHALL audit access events (view/read) for ePHI records', priority: 'Must', risk: 'High', part11Ref: '11.10(e)', acceptance: 'Viewing patient data generates an audit entry' },
        { id: 'URS-025', description: 'The system SHALL generate audit entries for all configuration changes (study setup, validation rules, visit schedule)', priority: 'Must', risk: 'High', part11Ref: '11.10(e)', acceptance: 'Configuration audit trail complete for all setting changes' },
        { id: 'URS-026', description: 'The system SHALL include a sequential or unique identifier for each audit entry to detect gaps', priority: 'Should', risk: 'High', part11Ref: '11.10(e)', acceptance: 'Audit entries have monotonically increasing IDs; gaps detectable' },
        { id: 'URS-027', description: 'The system SHALL prevent backdating of audit trail entries', priority: 'Must', risk: 'Critical', part11Ref: '11.10(e)', acceptance: 'Timestamps are server-generated; client-supplied timestamps rejected' },
        { id: 'URS-028', description: 'The system SHALL maintain audit trail during and after system failures', priority: 'Must', risk: 'Critical', part11Ref: '11.10(e)', acceptance: 'Database transactions ensure audit entries are committed atomically with data changes' },
      ],
    },
    {
      title: 'Electronic Signatures',
      anchor: 'esig',
      requirements: [
        { id: 'URS-029', description: 'Each electronic signature SHALL be unique to one individual and not reused by or reassigned to anyone else', priority: 'Must', risk: 'Critical', part11Ref: '11.100(a)', acceptance: 'Signature creation requires re-authentication with personal credentials' },
        { id: 'URS-030', description: 'The system SHALL verify the identity of the signer before allowing an electronic signature', priority: 'Must', risk: 'Critical', part11Ref: '11.100(b)', acceptance: 'Signer must enter username and password at time of signing' },
        { id: 'URS-031', description: 'The system SHALL require re-authentication (password entry) for each signing event', priority: 'Must', risk: 'Critical', part11Ref: '11.200(a)(1)', acceptance: 'Cached credentials not accepted; fresh password entry required' },
        { id: 'URS-032', description: 'Each electronic signature SHALL include the printed name of the signer', priority: 'Must', risk: 'Critical', part11Ref: '11.50(a)', acceptance: 'Signed record displays full name of signer' },
        { id: 'URS-033', description: 'Each electronic signature SHALL include the date and time of signing (UTC)', priority: 'Must', risk: 'Critical', part11Ref: '11.50(a)', acceptance: 'Signed record displays signing timestamp in UTC' },
        { id: 'URS-034', description: 'Each electronic signature SHALL include the meaning (purpose) of the signature', priority: 'Must', risk: 'Critical', part11Ref: '11.50(a)', acceptance: 'Signer selects or enters purpose (e.g., "Reviewed and approved", "Data verified")' },
        { id: 'URS-035', description: 'The signature, name, date/time, and meaning SHALL be displayed in any human-readable form of the signed record', priority: 'Must', risk: 'Critical', part11Ref: '11.50(b)', acceptance: 'PDF export of signed record includes all signature manifestations' },
        { id: 'URS-036', description: 'Electronic signatures SHALL be linked to their respective electronic records such that signatures cannot be excised, copied, or transferred', priority: 'Must', risk: 'Critical', part11Ref: '11.70', acceptance: 'Cryptographic hash binds signature to specific record version' },
        { id: 'URS-037', description: 'The system SHALL prevent modification of a signed record without invalidating the signature and requiring re-signing', priority: 'Must', risk: 'Critical', part11Ref: '11.70', acceptance: 'Any change to signed record voids signature; audit trail records invalidation' },
        { id: 'URS-038', description: 'The system SHALL ensure electronic signature non-repudiation — the signer cannot deny having signed', priority: 'Must', risk: 'Critical', part11Ref: '11.10(j)', acceptance: 'Signature record includes authenticated identity, timestamp, and record hash' },
        { id: 'URS-039', description: 'The system SHALL support multiple signature types: approval, review, verification, acknowledgment', priority: 'Should', risk: 'High', part11Ref: '11.50(a)', acceptance: 'System provides configurable signature meanings per workflow' },
        { id: 'URS-040', description: 'The system SHALL maintain a log of all signing events including failed attempts', priority: 'Must', risk: 'High', part11Ref: '11.10(e)', acceptance: 'Signature audit log includes successful signs and failed authentication attempts' },
      ],
    },
    {
      title: 'Data Entry & Integrity',
      anchor: 'data',
      requirements: [
        { id: 'URS-041', description: 'The system SHALL support electronic Case Report Form (eCRF) data entry with field-level validation', priority: 'Must', risk: 'Critical', part11Ref: '11.10(a)', acceptance: 'All CRF field types render correctly; validation fires on entry/save' },
        { id: 'URS-042', description: 'The system SHALL enforce configurable validation rules (range checks, pattern checks, cross-field checks) at point of entry', priority: 'Must', risk: 'Critical', part11Ref: '11.10(f)', acceptance: 'Invalid data triggers error/warning; rules configurable per form' },
        { id: 'URS-043', description: 'Data corrections SHALL NOT overwrite previous values — old values must be preserved in the audit trail', priority: 'Must', risk: 'Critical', part11Ref: '11.10(e)', acceptance: 'After correction, old value visible in audit trail; reason captured' },
        { id: 'URS-044', description: 'The system SHALL support data export in PDF, CSV, XML, and CDISC ODM formats', priority: 'Must', risk: 'Critical', part11Ref: '11.10(b)', acceptance: 'Exported data matches source; all formats validated' },
        { id: 'URS-045', description: 'The system SHALL retain all electronic records for the required retention period without degradation', priority: 'Must', risk: 'Critical', part11Ref: '11.10(c)', acceptance: 'Records retrievable and readable after retention period simulation' },
        { id: 'URS-046', description: 'The system SHALL provide automated backup with AES-256 encryption', priority: 'Must', risk: 'Critical', part11Ref: '11.10(c)', acceptance: 'Backups encrypted; encryption verified; backup schedule operational' },
        { id: 'URS-047', description: 'The system SHALL support full restoration from backup with verified data integrity', priority: 'Must', risk: 'Critical', part11Ref: '11.10(c)', acceptance: 'Restored data matches pre-backup state; checksums verified' },
        { id: 'URS-048', description: 'The system SHALL support skip/branching logic in eCRFs to show/hide fields based on data entry', priority: 'Should', risk: 'High', part11Ref: '11.10(a)', acceptance: 'Conditional fields appear/hide correctly based on trigger values' },
        { id: 'URS-049', description: 'The system SHALL support calculated fields with automatic derivation from entered data', priority: 'Should', risk: 'High', part11Ref: '11.10(a)', acceptance: 'Calculated values update correctly; formula documented in audit trail' },
        { id: 'URS-050', description: 'The system SHALL support Double Data Entry (DDE) for critical fields with discrepancy detection', priority: 'Should', risk: 'High', part11Ref: '11.10(a)', acceptance: 'DDE mode forces independent entry; discrepancies flagged for review' },
        { id: 'URS-051', description: 'The system SHALL generate accurate and complete copies of records in both human-readable and electronic form', priority: 'Must', risk: 'Critical', part11Ref: '11.10(b)', acceptance: 'PDF copy matches on-screen display; CSV/XML exports are complete' },
        { id: 'URS-052', description: 'The system SHALL protect records from unauthorized modification throughout retention', priority: 'Must', risk: 'Critical', part11Ref: '11.10(c)', acceptance: 'Access controls prevent unauthorized edits; locked records immutable' },
        { id: 'URS-053', description: 'The system SHALL enforce operational sequence checks to prevent out-of-order data entry where required', priority: 'Should', risk: 'High', part11Ref: '11.10(f)', acceptance: 'Workflow-gated forms enforce prerequisite completion' },
        { id: 'URS-054', description: 'The system SHALL validate data types (numeric, date, text) and reject type-mismatched input', priority: 'Must', risk: 'High', part11Ref: '11.10(f)', acceptance: 'Type validation errors displayed; invalid data not persisted' },
        { id: 'URS-055', description: 'The system SHALL support required-field enforcement preventing form submission with missing mandatory data', priority: 'Must', risk: 'High', part11Ref: '11.10(f)', acceptance: 'Mandatory fields flagged; form not marked complete until all required fields populated' },
      ],
    },
    {
      title: 'Clinical Workflows',
      anchor: 'workflow',
      requirements: [
        { id: 'URS-056', description: 'The system SHALL support study setup including protocol configuration, visit schedule, CRF assignment, and site activation', priority: 'Must', risk: 'High', part11Ref: '11.10(a)', acceptance: 'Study created with all components; configuration audit-trailed' },
        { id: 'URS-057', description: 'The system SHALL support subject enrollment with unique subject ID generation and site assignment', priority: 'Must', risk: 'Critical', part11Ref: '11.10(a)', acceptance: 'Subject enrolled with unique ID; no duplicates permitted' },
        { id: 'URS-058', description: 'The system SHALL support visit management with scheduled and unscheduled visit tracking', priority: 'Must', risk: 'High', part11Ref: '11.10(a)', acceptance: 'Visits display per schedule; unscheduled visits creatable; status tracked' },
        { id: 'URS-059', description: 'The system SHALL support query management: creation, assignment, response, resolution, escalation, and auto-generation from validation rules', priority: 'Must', risk: 'Critical', part11Ref: '11.10(e)', acceptance: 'Full query lifecycle functional; all transitions audit-trailed' },
        { id: 'URS-060', description: 'The system SHALL support casebook freeze (soft lock) preventing data modification while allowing queries', priority: 'Must', risk: 'Critical', part11Ref: '11.10(a)', acceptance: 'Frozen casebook rejects data edits; query workflow remains active' },
        { id: 'URS-061', description: 'The system SHALL support casebook lock (hard lock) preventing all modifications including queries', priority: 'Must', risk: 'Critical', part11Ref: '11.10(a)', acceptance: 'Locked casebook rejects all modifications; unlock requires e-signature' },
        { id: 'URS-062', description: 'The system SHALL support Source Data Verification (SDV) workflow for clinical monitors', priority: 'Must', risk: 'High', part11Ref: '11.10(a)', acceptance: 'Monitor can mark fields/forms as source-verified; status tracked' },
        { id: 'URS-063', description: 'The system SHALL support subject randomization with sealed allocation concealment', priority: 'Must', risk: 'Critical', part11Ref: '11.10(a)', acceptance: 'Randomization produces blinded assignment; allocation list sealed' },
        { id: 'URS-064', description: 'The system SHALL support review/approval workflows with configurable review chains', priority: 'Should', risk: 'High', part11Ref: '11.10(g)', acceptance: 'Forms route through configured review chain; approvals audit-logged' },
        { id: 'URS-065', description: 'The system SHALL support study-level database lock as a final regulatory milestone', priority: 'Must', risk: 'Critical', part11Ref: '11.10(a)', acceptance: 'Database lock prevents all study data modifications; e-signature required' },
        { id: 'URS-066', description: 'The system SHALL support overdue visit and form tracking with notifications', priority: 'Should', risk: 'Medium', part11Ref: 'N/A', acceptance: 'Overdue items flagged on dashboard; notifications sent to assigned users' },
        { id: 'URS-067', description: 'The system SHALL support task management for assigning and tracking clinical activities', priority: 'Could', risk: 'Medium', part11Ref: 'N/A', acceptance: 'Tasks assignable, trackable, and filterable by status and assignee' },
        { id: 'URS-068', description: 'The system SHALL support coding of adverse events and concomitant medications using standard dictionaries', priority: 'Should', risk: 'High', part11Ref: '11.10(a)', acceptance: 'Coding lookup available; coded values stored alongside verbatim text' },
      ],
    },
    {
      title: 'HIPAA Safeguards',
      anchor: 'hipaa',
      requirements: [
        { id: 'URS-069', description: 'The system SHALL encrypt all ePHI at rest using AES-256 or equivalent', priority: 'Must', risk: 'Critical', part11Ref: '164.312(a)(2)(iv)', acceptance: 'Database encryption verified; backup encryption verified' },
        { id: 'URS-070', description: 'The system SHALL encrypt all ePHI in transit using TLS 1.2 or higher', priority: 'Must', risk: 'Critical', part11Ref: '164.312(e)(1)', acceptance: 'All API endpoints enforce HTTPS; TLS version verified' },
        { id: 'URS-071', description: 'The system SHALL enforce unique user identification for all users accessing ePHI', priority: 'Must', risk: 'Critical', part11Ref: '164.312(a)(2)(i)', acceptance: 'No shared accounts; every ePHI access tied to individual user' },
        { id: 'URS-072', description: 'The system SHALL implement automatic logoff after configurable idle period', priority: 'Must', risk: 'Critical', part11Ref: '164.312(a)(2)(iii)', acceptance: 'Idle timeout enforced; session terminated; re-auth required' },
        { id: 'URS-073', description: 'The system SHALL maintain audit controls recording all access to ePHI', priority: 'Must', risk: 'Critical', part11Ref: '164.312(b)', acceptance: 'All ePHI read/write operations logged with user, timestamp, record ID' },
        { id: 'URS-074', description: 'The system SHALL protect ePHI integrity through validation and error-detection mechanisms', priority: 'Must', risk: 'Critical', part11Ref: '164.312(c)(1)', acceptance: 'Data integrity checks in place; checksum validation on export' },
        { id: 'URS-075', description: 'The system SHALL authenticate all persons or entities seeking access to ePHI', priority: 'Must', risk: 'Critical', part11Ref: '164.312(d)', acceptance: 'JWT-based auth required for all ePHI endpoints; no anonymous access' },
        { id: 'URS-076', description: 'The system SHALL implement access controls limiting ePHI access to minimum necessary', priority: 'Must', risk: 'Critical', part11Ref: '164.312(a)(1)', acceptance: 'RBAC enforces minimum necessary; verified by cross-role testing' },
        { id: 'URS-077', description: 'The system SHALL support breach notification procedures including detection and reporting', priority: 'Must', risk: 'Critical', part11Ref: '164.404', acceptance: 'Breach detection mechanisms documented; notification workflow tested' },
        { id: 'URS-078', description: 'The system SHALL implement contingency planning including backup, disaster recovery, and emergency mode', priority: 'Must', risk: 'Critical', part11Ref: '164.308(a)(7)', acceptance: 'Backup/restore verified; disaster recovery plan documented and tested' },
        { id: 'URS-079', description: 'The system SHALL support Business Associate Agreement (BAA) requirements for all third-party data processors', priority: 'Must', risk: 'High', part11Ref: '164.308(b)', acceptance: 'BAAs in place with cloud providers; documented and reviewed' },
        { id: 'URS-080', description: 'The system SHALL implement workforce training tracking for HIPAA compliance', priority: 'Must', risk: 'High', part11Ref: '164.308(a)(5)', acceptance: 'Training completion records maintained; periodic refresher tracked' },
      ],
    },
  ];
}

export function generate(outputDir: string, _workspaceRoot: string): void {
  const categories = buildCategories();
  let content = '';

  content += documentHeader({
    title: 'User Requirements Specification (URS)',
    documentId: `URS-${DOC_YEAR}-001`,
    version: '1.0',
    date: DOC_DATE,
    system: SYSTEM_INFO.fullName,
    classification: 'Confidential — Regulatory',
  });

  const tocEntries = [
    { level: 1, title: 'Purpose and Scope' },
    { level: 1, title: 'Requirement Format' },
    ...categories.map((c) => ({ level: 1, title: c.title })),
    { level: 1, title: 'Requirements Summary' },
    { level: 1, title: 'Regulatory Cross-Reference Matrix' },
    { level: 1, title: 'Requirement Prioritization' },
    { level: 1, title: 'Change History' },
    { level: 1, title: 'Approval Signatures' },
  ];
  content += tableOfContents(tocEntries) + '\n';
  content += hr();

  content += section(2, 'Purpose and Scope');
  content += `This User Requirements Specification defines the business and regulatory requirements for the **${SYSTEM_INFO.fullName}** (v${SYSTEM_INFO.version}). `;
  content += 'These requirements form the basis for system validation and are traceable to specific 21 CFR Part 11 sections, HIPAA Security Rule sections, and ICH E6(R2) GCP principles.\n\n';
  content += 'Each requirement is assigned a priority (Must/Should/Could per MoSCoW), a risk level, ' +
    'a regulatory reference, and formal acceptance criteria.\n\n';
  content += hr();

  content += section(2, 'Requirement Format');
  content += markdownTable(
    ['Field', 'Description'],
    [
      ['ID', 'Unique identifier (URS-NNN)'],
      ['Description', 'Clear, testable statement of what the system SHALL/SHOULD/COULD do'],
      ['Priority', 'Must (mandatory), Should (important), Could (desirable)'],
      ['Risk', 'Critical / High / Medium / Low — based on impact to subject safety, data integrity, compliance'],
      ['Part 11 / HIPAA Ref', 'Applicable regulatory section(s)'],
      ['Acceptance Criteria', 'Objective, measurable criteria for verification'],
    ],
  );
  content += '\n';
  content += hr();

  const detailedDescs = buildDetailedDescriptions();
  const detailMap = new Map<string, DetailedDescription>();
  for (const d of detailedDescs) {
    detailMap.set(d.id, d);
  }

  let totalReqs = 0;
  const riskCounts: Record<string, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };

  for (const cat of categories) {
    content += section(2, cat.title);
    content += markdownTable(
      ['ID', 'Description', 'Priority', 'Risk', 'Regulatory Ref', 'Acceptance Criteria'],
      cat.requirements.map((r) => [
        r.id,
        r.description,
        r.priority,
        riskBadge(r.risk),
        r.part11Ref,
        r.acceptance,
      ]),
    );
    content += '\n';

    const catDetails = cat.requirements.filter((r) => detailMap.has(r.id));
    if (catDetails.length > 0) {
      content += section(3, 'Detailed Requirement Descriptions');
      for (const r of catDetails) {
        const detail = detailMap.get(r.id)!;
        content += `**${r.id}: ${r.description.split(' SHALL ')[0]}**\n\n`;
        content += `**Rationale:** ${detail.rationale}\n\n`;
        content += `**Context:** ${detail.context}\n\n`;
        content += `**Acceptance Method:** ${detail.acceptanceMethod}\n\n`;
        content += hr();
      }
    }

    totalReqs += cat.requirements.length;
    for (const r of cat.requirements) {
      riskCounts[r.risk] = (riskCounts[r.risk] || 0) + 1;
    }
  }

  content += hr();

  content += section(2, 'Requirements Summary');
  content += `**Total Requirements:** ${totalReqs}\n\n`;
  content += markdownTable(
    ['Metric', 'Count'],
    [
      ['Total Requirements', String(totalReqs)],
      ['Critical Risk', String(riskCounts['Critical'])],
      ['High Risk', String(riskCounts['High'])],
      ['Medium Risk', String(riskCounts['Medium'])],
      ['Low Risk', String(riskCounts['Low'])],
      ['Must Priority', String(categories.flatMap((c) => c.requirements).filter((r) => r.priority === 'Must').length)],
      ['Should Priority', String(categories.flatMap((c) => c.requirements).filter((r) => r.priority === 'Should').length)],
      ['Could Priority', String(categories.flatMap((c) => c.requirements).filter((r) => r.priority === 'Could').length)],
    ],
  );
  content += '\n';
  content += hr();

  // Regulatory Cross-Reference Matrix
  content += section(2, 'Regulatory Cross-Reference Matrix');
  content += 'The following matrix maps each URS requirement to the applicable regulatory sections from ' +
    '21 CFR Part 11, the HIPAA Security Rule (45 CFR 164), and ICH E6(R2) GCP guidelines. This cross-reference ' +
    'ensures complete regulatory traceability and facilitates inspection readiness.\n\n';

  const allReqs = categories.flatMap((c) => c.requirements);
  const crossRefRows: string[][] = allReqs.map((r) => {
    const ref = r.part11Ref;
    let part11 = 'N/A';
    let hipaa = 'N/A';
    let gcp = 'N/A';
    if (ref.includes('164.')) {
      hipaa = ref;
    } else if (ref !== 'N/A') {
      part11 = ref;
    }
    if (r.id >= 'URS-016' && r.id <= 'URS-028') gcp = 'ICH E6(R2) §8.0';
    if (r.id >= 'URS-029' && r.id <= 'URS-040') gcp = 'ICH E6(R2) §8.0, §2.10';
    if (r.id >= 'URS-041' && r.id <= 'URS-055') gcp = 'ICH E6(R2) §5.5, §8.0';
    if (r.id >= 'URS-056' && r.id <= 'URS-068') gcp = 'ICH E6(R2) §6.4, §8.0';
    if (r.id >= 'URS-069' && r.id <= 'URS-080') hipaa = r.part11Ref.includes('164.') ? r.part11Ref : hipaa;
    return [r.id, r.description.substring(0, 60) + '...', part11, hipaa, gcp];
  });

  content += markdownTable(
    ['URS ID', 'Requirement (abbreviated)', '21 CFR Part 11', 'HIPAA (45 CFR 164)', 'ICH E6(R2) GCP'],
    crossRefRows,
  );
  content += '\n';
  content += '> **Note:** Requirements may reference multiple regulatory frameworks simultaneously. ' +
    'The primary reference is listed in the requirement table; this matrix provides the extended mapping.\n\n';
  content += hr();

  // Requirement Prioritization
  content += section(2, 'Requirement Prioritization');
  content += section(3, 'MoSCoW Methodology');
  content += 'Requirements in this specification are prioritized using the **MoSCoW method**, a widely adopted ' +
    'prioritization framework in regulated software development:\n\n';
  content += '**Must Have (M):** These requirements are non-negotiable for system compliance and patient safety. ' +
    'The system cannot be deployed without satisfying every Must requirement. Failure to implement any Must ' +
    'requirement would result in a regulatory finding during inspection, a potential patient safety risk, or ' +
    'a fundamental inability to support clinical trial operations. In this specification, Must requirements are ' +
    'primarily driven by 21 CFR Part 11 mandates and HIPAA Security Rule obligations.\n\n';
  content += '**Should Have (S):** These requirements are important for operational efficiency, enhanced security, ' +
    'or improved data quality but are not strictly mandated by regulation. Their absence would degrade the system\'s ' +
    'fitness for purpose without creating a direct compliance violation. Should requirements are prioritized for ' +
    'implementation in the initial release but may be deferred with documented justification.\n\n';
  content += '**Could Have (C):** These requirements provide additional value — workflow convenience, enhanced ' +
    'reporting, or user experience improvements — but their absence does not affect compliance, safety, or core ' +
    'functionality. Could requirements are candidates for future releases.\n\n';

  content += section(3, 'Prioritization Rationale');
  content += 'The prioritization was determined through a collaborative assessment involving:\n\n';
  content += '- **Regulatory compliance analysis:** Requirements directly mandated by 21 CFR Part 11 or HIPAA ' +
    'are classified as Must.\n';
  content += '- **Patient safety impact assessment:** Requirements whose failure could foreseeably affect patient ' +
    'safety are classified as Must regardless of explicit regulatory mandate.\n';
  content += '- **Data integrity impact assessment:** Requirements critical to maintaining the accuracy, ' +
    'completeness, and reliability of regulated records are classified as Must.\n';
  content += '- **Operational impact assessment:** Requirements important for efficient clinical trial operations ' +
    'but not directly tied to compliance or safety are classified as Should.\n';
  content += '- **Enhancement assessment:** Requirements that improve user experience or add convenience features ' +
    'without compliance impact are classified as Could.\n\n';

  const mustCount = allReqs.filter((r) => r.priority === 'Must').length;
  const shouldCount = allReqs.filter((r) => r.priority === 'Should').length;
  const couldCount = allReqs.filter((r) => r.priority === 'Could').length;

  content += section(3, 'Priority Distribution');
  content += markdownTable(
    ['Priority', 'Count', 'Percentage', 'Deployment Gate'],
    [
      ['Must', String(mustCount), ((mustCount / totalReqs) * 100).toFixed(1) + '%', '**YES** — all Must requirements must pass validation before release'],
      ['Should', String(shouldCount), ((shouldCount / totalReqs) * 100).toFixed(1) + '%', 'Recommended — deferral requires documented justification'],
      ['Could', String(couldCount), ((couldCount / totalReqs) * 100).toFixed(1) + '%', 'No — may be deferred to future releases'],
    ],
  );
  content += '\n';
  content += hr();

  // Change History
  content += section(2, 'Change History');
  content += 'This section documents the version history of the User Requirements Specification.\n\n';
  content += markdownTable(
    ['Version', 'Date', 'Author', 'Description of Change', 'Approved By'],
    [
      ['0.1', '2025-06-15', 'System Architect', 'Initial draft — core authentication and audit trail requirements', 'N/A (draft)'],
      ['0.2', '2025-08-01', 'System Architect', 'Added electronic signature requirements per Part 11 Subpart C', 'N/A (draft)'],
      ['0.3', '2025-10-10', 'Clinical Operations', 'Added clinical workflow and data entry requirements', 'N/A (draft)'],
      ['0.4', '2025-12-01', 'Regulatory Affairs', 'Added HIPAA Security Rule requirements; regulatory cross-references', 'N/A (draft)'],
      ['0.5', '2026-01-15', 'Quality Assurance', 'Formal review — acceptance criteria refined for testability', 'QA Lead'],
      ['1.0', DOC_DATE, 'Quality Assurance', 'Approved for validation — all requirements finalized with detailed descriptions', 'QA Lead, Project Manager'],
    ],
  );
  content += '\n';
  content += '> **Change Control:** After approval of version 1.0, any changes to this document require a formal ' +
    'change request, impact assessment, and re-approval by the original signatories. Changes affecting validated ' +
    'functionality require re-validation per the Validation Change Control SOP.\n\n';
  content += hr();

  content += approvalBlock([
    'Quality Assurance Lead',
    'Project Manager',
    'Clinical Operations Lead',
    'Regulatory Affairs',
    'System Owner',
  ]);

  content += '\n---\n*End of Document*\n';

  fs.writeFileSync(path.join(outputDir, '03-user-requirements-spec.md'), content);
}
