import * as fs from 'fs';
import * as path from 'path';
import { SYSTEM_INFO } from '../config/system-info';
import { FEATURE_RISKS } from '../config/risk-ratings';
import {
  loadRunnerEvidence, mappedCaseState, runnerCaseCheck, type MappedCaseState, type RunnerResult,
} from './helpers/evidence-linker';
import { documentHeader, markdownTable, section, approvalBlock, tableOfContents, hr, riskBadge } from './helpers/markdown-writer';

/** A planned assurance activity. It cites runner cases only where the case's actual
 * check (RUNNER_CASE_CHECKS) verifies the feature's stated control; without such a
 * case the activity is an explicit gap and is not qualified. */
interface PlannedActivity {
  planned: string;
  cases: string[];
  /** What the mapped cases do not verify, or why no executed case is mapped. */
  note?: string;
}

interface FeatureAssuranceData {
  intendedUse: string;
  analysisText: string;
  testType: string;
  implFiles: string[][];
  activities: PlannedActivity[];
}

const covered = (planned: string, cases: string[], note?: string): PlannedActivity => ({ planned, cases, note });
const gap = (planned: string, note: string): PlannedActivity => ({ planned, cases: [], note });

const FEATURE_DATA = new Map<string, FeatureAssuranceData>();

FEATURE_DATA.set('FEAT-001', {
  intendedUse:
    'Authenticates clinical users via username and password before granting access to any regulated electronic record. ' +
    'Issues time-limited JWT tokens upon successful credential validation. ' +
    'Directly enforces 21 CFR Part 11 §11.10(d) requiring that only authorized individuals use the system.',
  analysisText:
    'Per CSA guidance Table 1, authentication is classified as High Process Risk because failure to perform as ' +
    'intended could allow unauthorized access to regulated clinical trial records, directly compromising data ' +
    'integrity and patient safety. Unauthorized access could result in falsified efficacy data reaching an FDA ' +
    'submission, which foreseeably compromises subject safety.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/database/auth.service.ts', 'Credential validation, bcrypt password hashing, JWT token generation and refresh'],
    ['libreclinicaapi/src/middleware/auth.middleware.ts', 'JWT verification on every protected request, AuthRequest injection'],
    ['libreclinicaapi/src/routes/auth.routes.ts', 'Login, logout, refresh endpoints with Joi schema validation'],
    ['libreclinicaapi/src/controllers/auth.controller.ts', 'HTTP request/response handling for all authentication flows'],
  ],
  activities: [
    covered('Valid login with correct credentials returns JWT token and user profile', ['OQ-001', 'OQ-006', 'OQ-085', 'OQ-086'],
      'profile fields other than user.userId are not asserted.'),
    covered('Invalid password returns HTTP 401 without revealing which credential is wrong', ['OQ-003'],
      'no case compares the wrong-password and unknown-user messages, so non-disclosure is not verified.'),
    gap('Expired JWT is rejected and requires re-authentication',
      'SEC-005 and OQ-177 send expired tokens whose signatures are also invalid, so expiry is not isolated; no case lets an issued token expire.'),
    covered('Tampered JWT with modified payload is rejected by signature verification', ['SEC-004', 'OQ-095']),
    covered('Logout invalidates the current session token for subsequent requests', ['OQ-010', 'OQ-062']),
  ],
});

FEATURE_DATA.set('FEAT-002', {
  intendedUse:
    'Ensures every user account possesses a globally unique identifier that cannot be reused or reassigned to another individual. ' +
    'Required by 21 CFR Part 11 §11.10(d) to maintain individual accountability for all actions and support ' +
    'non-repudiation of electronic signatures across the regulated system.',
  analysisText:
    'Classified as High Process Risk under CSA guidance because duplicate user identifiers would break audit trail ' +
    'accountability and could attribute regulated actions to the wrong individual. This directly impacts the ' +
    'integrity of electronic signatures and could foreseeably compromise the validity of an entire clinical trial submission.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/database/user.service.ts', 'Unique username enforcement at registration and account creation'],
    ['libreclinicaapi/src/services/database/auth.service.ts', 'Pre-INSERT duplicate check before account provisioning'],
  ],
  activities: [
    covered('Attempt to register a duplicate username is rejected with HTTP 409 Conflict', ['OQ-002'],
      'the native refusal is HTTP 400 "Username already exists", not the planned 409; OQ-066 re-cites the same OQ-002 row and is not counted again.'),
    gap('Database UNIQUE constraint prevents duplicate insertion even if application check is bypassed',
      'No runner case bypasses the API to exercise a database constraint; IQ-013 only matches a users-table name in migrations.ts.'),
  ],
});

FEATURE_DATA.set('FEAT-003', {
  intendedUse:
    'Enforces password complexity requirements, bcrypt hashing with configurable work factor, password history tracking, ' +
    'and expiration policies to prevent unauthorized access through weak or compromised credentials. ' +
    'Implements safeguards required by 21 CFR Part 11 §11.10(d) and HIPAA §164.312(d).',
  analysisText:
    'High Process Risk because weak password controls directly enable unauthorized access to ePHI and regulated ' +
    'clinical records. Per CSA guidance, this feature\'s failure would foreseeably compromise the confidentiality ' +
    'and integrity of clinical trial data, potentially resulting in a quality problem that impacts patient safety.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/database/auth.service.ts', 'Password validation logic, bcrypt hashing, history tracking, expiry enforcement'],
    ['libreclinicaapi/src/routes/auth.routes.ts', 'Joi schemas enforcing password complexity on registration and change endpoints'],
  ],
  activities: [
    covered('Password below minimum length is rejected with HTTP 400 and descriptive error', ['OQ-004', 'OQ-093'],
      'the refused password "123" also fails other rules, so the length boundary is not isolated.'),
    gap('Password missing required character classes (uppercase, digit, special) is rejected',
      'No case isolates a character-class rule; OQ-004 and OQ-093 use "123", which also fails the length rule.'),
    gap('Password reuse within history window is rejected with HTTP 400',
      'No password-history case exists; OQ-071 (password history) is not implemented — the runner records a failing "did not execute" placeholder.'),
    covered('Password change requires current password verification before accepting new password', ['OQ-092'],
      'the stored password is not re-read after the refusal.'),
    gap('Passwords are stored as bcrypt hashes, never in plaintext',
      'No case inspects stored password hashes; OQ-084 only shows the login response does not echo the password and IQ-032 is a source keyword match.'),
  ],
});

FEATURE_DATA.set('FEAT-004', {
  intendedUse:
    'Implements role-based access control with predefined roles and granular permissions to enforce least-privilege access ' +
    'across all system functions. Ensures clinical research coordinators, investigators, monitors, data managers, and ' +
    'sponsors access only the data and functions required for their role per 21 CFR Part 11 §11.10(d) and HIPAA §164.312(a)(1).',
  analysisText:
    'High Process Risk because RBAC failure could grant unauthorized users the ability to modify regulated ' +
    'clinical records, sign electronic documents, lock/unlock data, or export patient information. Per CSA ' +
    'guidance, such a failure foreseeably compromises both data integrity and patient confidentiality.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/middleware/authorization.middleware.ts', 'authorize([roles]) enforcement on every protected route'],
    ['libreclinicaapi/src/services/database/permission.service.ts', 'Granular permission checks for 42 discrete permissions'],
  ],
  activities: [
    gap('Data Manager can manage data quality but cannot modify user accounts (HTTP 403)',
      'No data_manager refusal case exists; in OQ-021 the data_manager role only reads its own user record.'),
    gap('Investigator can sign forms but cannot export all studies (HTTP 403)', 'No investigator-role case exists.'),
    gap('Monitor (CRA) has read-only access with SDV/query capabilities only',
      'No monitor-role case exists; SDV and query steps run as the qualification operator.'),
    gap('Accessing a study not assigned to the user is blocked with HTTP 403',
      'No study-assignment authorization case exists; studyId filters run as the operator.'),
    gap('Accessing a site not assigned to the user is blocked with HTTP 403', 'No site-scope case exists.'),
    covered('Permission changes take effect immediately without re-login', ['OQ-021'],
      'the API revokes the account\'s sessions on a role change, so a fresh login is required; the planned "without re-login" behavior is not what the API does.'),
    gap('Role assignment changes are immutably audit-logged',
      'No case reads a role-change audit entry; OQ-142 only finds some user_account row for the owned authentication account.'),
    gap('Non-admin cannot escalate their own permissions', 'No self-escalation case exists.'),
    gap('Concurrent role validation prevents TOCTOU race conditions', 'No race-condition case exists.'),
    gap('Expired tokens cannot be used to bypass permission checks',
      'SEC-005 and OQ-177 tokens also carry invalid signatures, so expiry is not isolated.'),
    gap('Frontend role guards align with backend enforcement', 'No UI case exists.'),
    gap('Bulk operations respect per-item permission checks', 'No bulk-authorization case exists.'),
    gap('API endpoints without explicit role requirements default to deny',
      'Unauthenticated refusals (SEC-003, OQ-018, OQ-110 to OQ-120) show that authentication is required, not that role checks default to deny.'),
  ],
});

FEATURE_DATA.set('FEAT-005', {
  intendedUse:
    'Manages user sessions with configurable idle timeouts that automatically terminate inactive sessions, preventing ' +
    'unauthorized access via unattended workstations. Owner decision 2026-10-02 ("Keep multiple devices; verify each ' +
    'session independently"): simultaneous independent sessions (devices) are supported for one account; each session is ' +
    'tracked and verified independently by its session ID (exact-session logout, refresh, idle timeout and audit), and a ' +
    'new login does not end other sessions. Account-wide revocation of all sessions occurs only on a password change, an ' +
    'administrator role change, disable, lock or deletion of the account, removal of the user from a study, or the ' +
    'emergency POST /api/users/:id/revoke-sessions endpoint, and every session of a locked (including the automatic ' +
    'failed-login lockout) or inactive account is refused while that state lasts. An optional API fingerprint header is recorded at login when ' +
    'supplied (the UI does not send it); a mismatch raises an alert without rejecting the request, so it is not enforced ' +
    'device binding, and fingerprint-mismatch rejection remains a separate unresolved requirement.',
  analysisText:
    'High Process Risk because failure to terminate idle sessions at clinical sites could allow unauthorized ' +
    'individuals to access and modify regulated clinical records. Per CSA guidance, this foreseeably compromises ' +
    'data integrity when workstations in clinical environments are shared or accessible to non-authorized personnel.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/middleware/auth.middleware.ts', 'Per-session (sid) revocation, idle-timeout and account-state checks on every request; optional fingerprint mismatch alert'],
    ['libreclinicaapi/src/services/database/token-blocklist.service.ts', 'One session row per sid; exact-session logout and refresh; account-wide revocation'],
    ['libreclinicaapi/src/controllers/auth.controller.ts', 'Login registers an additional session; logout and refresh act on the exact session'],
    ['EDCProjectCompliant/src/app/services/auth/idle-timeout.service.ts', 'Client-side inactivity detection and forced logout'],
  ],
  activities: [
    covered('Simultaneous sessions of one account are both issued and each verifies independently (a new login does not end the other)', ['OQ-094']),
    covered('Logout revokes exactly the session that logged out', ['OQ-010', 'OQ-062'],
      'neither case re-verifies another session of the account after the logout.'),
    gap('Logging out or refreshing one session leaves the account\'s other sessions usable',
      'No case checks this explicitly. Indirect run-order evidence only: OQ-186 re-verifies the run\'s operator session after OQ-056 and OQ-062 logged out other sessions of the same account.'),
    covered('Refreshing a session issues a usable replacement access token for that session', ['OQ-087'],
      'other sessions are not re-verified after the refresh.'),
    gap('Each session times out independently after the configured idle period and then requires re-authentication',
      'No case lets a session idle out; OQ-086 bounds only the absolute token lifetime.'),
    gap('Login and logout audit records identify the exact session',
      'OQ-127 reads successful-login history without matching a session ID; no case reads a logout audit row.'),
    covered('Account-wide security events revoke all of the account\'s sessions', ['OQ-021', 'OQ-022'],
      'only a role change and a disable are exercised; password change, account deletion, study removal and the emergency revoke-sessions endpoint are not exercised against issued tokens (OQ-058 only requires that endpoint to answer 200 success=true).'),
    covered('The optional API fingerprint header supplied at login is recorded for each session', ['OQ-007'],
      'UI delivery of the header is not qualified, and recording is not device binding.'),
    gap('A request whose supplied fingerprint does not match its session is rejected (device binding, URS-010)',
      'Not implemented: the API only raises a security alert on a mismatch, so optional fingerprint recording is not enforced device binding; this requested control remains unresolved (URS-010).'),
  ],
});

FEATURE_DATA.set('FEAT-006', {
  intendedUse:
    'Provides administrative workflows for creating new user accounts, assigning roles and study/site access, ' +
    'and deactivating users who no longer require system access. Ensures only properly provisioned and trained ' +
    'users can interact with regulated clinical records.',
  analysisText:
    'High Process Risk because improper provisioning could grant elevated privileges to unqualified users, or ' +
    'failure to deactivate departed personnel could leave unauthorized access paths open. Per CSA guidance, ' +
    'this could foreseeably compromise the access control framework that protects clinical data integrity.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/database/user.service.ts', 'CRUD operations for user accounts with soft-delete deactivation'],
    ['libreclinicaapi/src/routes/user.routes.ts', 'Admin endpoints for user management with authorization checks'],
  ],
  activities: [
    covered('New user creation with role assignment succeeds for administrators only', ['OQ-AUTH-FIXTURE'],
      'only the administrator path is exercised; no non-administrator creation refusal is attempted.'),
    covered('User deactivation prevents login while preserving audit trail history', ['OQ-022'],
      'audit-history preservation is not read.'),
    gap('Non-admin user cannot create or modify other user accounts (HTTP 403)',
      'No create or modify refusal is attempted; the viewer refusal in OQ-021 is a read of a user record.'),
    gap('Deactivated username cannot be reassigned to a new account', 'OQ-002 tests a duplicate of an active account only.'),
    covered('All provisioning and deactivation events are immutably audit-logged', ['OQ-142'],
      'the event type is not checked, deactivation is not identified and immutability of these rows is not tested.'),
  ],
});

FEATURE_DATA.set('FEAT-010', {
  intendedUse:
    'Automatically generates a complete, computer-generated audit trail for every data mutation in the system. ' +
    'The audit middleware intercepts all create, update, and delete operations and records them in the immutable ' +
    'acc_audit_log table as the primary 21 CFR Part 11 §11.10(e) compliance mechanism.',
  analysisText:
    'High Process Risk — the audit trail is the single most critical Part 11 control. Per CSA guidance, failure ' +
    'to generate audit entries would mean regulated record changes go untracked, directly invalidating the ' +
    'electronic record system. FDA inspectors specifically verify audit trail completeness; a gap foreseeably ' +
    'results in a Form 483 observation or Warning Letter.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/middleware/audit.middleware.ts', 'Global middleware capturing all data mutations with pre/post state'],
    ['libreclinicaapi/src/services/database/audit.service.ts', 'Audit entry creation with atomic transaction binding'],
    ['libreclinicaapi/src/routes/audit.routes.ts', 'Read-only audit query and export endpoints'],
    ['libreclinicaapi/src/config/migrations.ts', 'acc_audit_log table schema with NOT NULL constraints'],
  ],
  activities: [
    covered('Creating a new record generates a corresponding CREATE audit entry', ['OQ-136', 'OQ-137', 'OQ-139', 'OQ-140', 'OQ-141', 'OQ-143'],
      'the CREATE action type is not asserted.'),
    covered('Updating a record generates an UPDATE audit entry with old and new values', ['PQ-037'],
      'OQ-128 re-cites the same PQ-037 row and is not counted again.'),
    gap('Deleting a record generates a DELETE audit entry preserving the deleted state',
      'No deletion-audit case exists; PQ-040 archives the study without reading audit.'),
    gap('Audit entry generated within the same database transaction as data change', 'Transactional atomicity is not tested.'),
    gap('Bulk operations generate individual audit entries for each affected record',
      'OQ-194 batch SDV covers one form and reads no audit.'),
    gap('Failed mutations do not generate orphan audit entries (atomic rollback)', 'No orphan-audit case exists.'),
    gap('Sequential audit IDs have no gaps, enabling gap detection during inspection',
      'No ID-sequence case exists; OQ-133 verifies the native audit hash chain, not ID gaps.'),
  ],
});

FEATURE_DATA.set('FEAT-011', {
  intendedUse:
    'Ensures every audit trail entry contains the complete information required by 21 CFR Part 11 §11.10(e): ' +
    'who performed the action (user ID and name), what was changed (entity type, field, old value, new value), ' +
    'when it was changed (server-generated UTC timestamp), and why (reason for change when applicable).',
  analysisText:
    'High Process Risk because incomplete audit entries fail the Part 11 requirement for records that include ' +
    'the date and time of the operator entry and the action. Missing who/what/when/old/new fields in any audit ' +
    'record could invalidate the entire audit trail during an FDA inspection, foreseeably compromising the ' +
    'regulatory standing of the clinical trial.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/database/audit.service.ts', 'createAuditEntry() populates all required fields from context'],
    ['libreclinicaapi/src/middleware/audit.middleware.ts', 'Extracts user identity from AuthRequest and captures request context'],
    ['libreclinicaapi/src/config/migrations.ts', 'NOT NULL constraints on user_id, action, entity_type, created_at columns'],
  ],
  activities: [
    covered('Audit entry contains old and new values for every modified field in JSONB format', ['PQ-037'],
      'one corrected field is checked; JSONB storage and other fields are not.'),
    covered('Audit entry user_id matches the authenticated JWT subject with no spoofing possible', ['OQ-042', 'OQ-053', 'OQ-055'],
      'actors are compared with the signature proof or the /api/auth/verify user; spoofing is never attempted.'),
    gap('Audit timestamp is server-generated UTC, client-supplied timestamps are ignored',
      'OQ-026 and OQ-121 check only timestamp format or parseability; no client timestamp is ever sent.'),
    covered('Audit entry includes the entity type, entity ID, and specific action performed', ['OQ-027', 'OQ-028'],
      'only the first row of one form-audit read is checked.'),
  ],
});

FEATURE_DATA.set('FEAT-012', {
  intendedUse:
    'Guarantees that once an audit trail entry is written, it cannot be modified or deleted by any user, including ' +
    'system administrators. The audit trail is append-only by design, enforced at both application and database ' +
    'layers through INSERT-only permissions and REVOKE of UPDATE/DELETE on the acc_audit_log table.',
  analysisText:
    'High Process Risk — a mutable audit trail completely invalidates the electronic record system under Part 11. ' +
    'Per CSA guidance, if audit records can be altered, there is no reliable mechanism to detect data fraud or ' +
    'unauthorized modification, which foreseeably compromises the safety and efficacy determination for the ' +
    'investigational product.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/routes/audit.routes.ts', 'Exposes only GET endpoints; no PUT/DELETE/PATCH routes exist for audit data'],
    ['libreclinicaapi/src/config/migrations.ts', 'REVOKE UPDATE, DELETE on acc_audit_log from application database role'],
    ['libreclinicaapi/src/services/database/audit.service.ts', 'Only INSERT operations implemented; no update/delete methods exist'],
  ],
  activities: [
    covered('No API endpoint exists to update an existing audit trail entry (HTTP 405)', ['OQ-030', 'OQ-129', 'OQ-130'],
      'any of HTTP 403, 404 or 405 is accepted; the planned 405 is not required.'),
    covered('No API endpoint exists to delete an audit trail entry (HTTP 405)', ['OQ-031', 'OQ-060', 'OQ-131'],
      'any of HTTP 403, 404 or 405 is accepted; the planned 405 is not required.'),
    gap('Direct database UPDATE on acc_audit_log is blocked by REVOKE permissions',
      'No runner case issues direct SQL; the runner states its audit refusals prove API refusal, not database enforcement.'),
    gap('Direct database DELETE on acc_audit_log is blocked by REVOKE permissions', 'No runner case issues direct SQL.'),
  ],
});

FEATURE_DATA.set('FEAT-013', {
  intendedUse:
    'Exports the complete audit trail in human-readable (PDF) and machine-readable (CSV) formats for regulatory ' +
    'inspection. FDA inspectors require the ability to review and copy audit trail records during facility ' +
    'inspections per 21 CFR Part 11 §11.10(b) and must receive records in a readable and readily retrievable format.',
  analysisText:
    'High Process Risk because inability to produce audit trail exports during an FDA inspection directly ' +
    'impacts inspection readiness. Per CSA guidance, this could foreseeably result in a Form 483 observation ' +
    'for failure to maintain records in a readable and readily retrievable format.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/routes/audit.routes.ts', 'GET /api/audit/export endpoint with date range and format parameters'],
    ['libreclinicaapi/src/services/database/audit.service.ts', 'Audit query with filtering, pagination, and date range support'],
    ['libreclinicaapi/src/services/export/export.service.ts', 'PDF and CSV generation with proper encoding and formatting'],
  ],
  activities: [
    gap('Audit trail export produces complete output within requested date range in PDF format',
      'No date-range audit-trail PDF case exists; OQ-048 and OQ-067 produce a single-form PDF with an audit appendix.'),
    covered('Audit trail export produces correctly formatted CSV parseable by standard tools', ['OQ-032', 'OQ-193'],
      'only the owned correction row is compared; action, entity-type and timestamp columns are not checked.'),
  ],
});

FEATURE_DATA.set('FEAT-014', {
  intendedUse:
    'Requires users to provide a documented reason for every data correction made to clinical data at the time ' +
    'of the change. The reason is stored as part of the immutable audit trail entry, enabling reconstruction of ' +
    'the data correction history as required by ICH E6(R2) GCP and 21 CFR Part 11 §11.10(e).',
  analysisText:
    'High Process Risk because missing reasons for change would invalidate the clinical data correction process ' +
    'per GCP requirements. Per CSA guidance, this foreseeably compromises the ability to reconstruct the data ' +
    'history during regulatory review, which could result in rejection of clinical data.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/middleware/audit.middleware.ts', 'Captures reason field from request body and attaches to audit entry'],
    ['libreclinicaapi/src/routes/form.routes.ts', 'Joi schema requires non-empty reason field on PUT correction endpoints'],
    ['libreclinicaapi/src/services/database/audit.service.ts', 'Stores reason in acc_audit_log.reason column with NOT NULL for corrections'],
  ],
  activities: [
    covered('Data correction submitted without a reason is rejected with HTTP 400 validation error', ['OQ-061'],
      'OQ-046 re-cites OQ-061 with PQ-037 and is not counted again.'),
    gap('Data correction with empty/blank reason string is rejected',
      'OQ-061 omits the reason field entirely; no blank-string case exists.'),
    covered('Reason for change is stored in audit trail and retrievable via audit export', ['PQ-037', 'OQ-032', 'OQ-193']),
    gap('Reason text preserves Unicode characters and special formatting',
      'PQ-024 roundtrips Unicode field values; its reason text is ASCII.'),
    gap('UI enforces reason entry via modal dialog before submission is permitted', 'No UI case exists.'),
    covered('Audit trail reason field is immutable once written', ['OQ-030', 'OQ-129', 'OQ-130'],
      'API-level refusal only; database-level protection is not tested.'),
  ],
});

FEATURE_DATA.set('FEAT-020', {
  intendedUse:
    'Creates electronic signatures that serve as the legal equivalent of handwritten signatures on regulated ' +
    'clinical trial records. Each signing event requires fresh two-component authentication (username + password) ' +
    'per 21 CFR Part 11 §11.50 and §11.100, ensuring positive identification at the moment of signing.',
  analysisText:
    'High Process Risk — electronic signatures have direct legal weight for FDA submissions. Per CSA guidance, ' +
    'a failure allowing unsigned records to appear signed, or signatures without proper authentication, would ' +
    'foreseeably invalidate regulated submissions and compromise the entire clinical trial record.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/database/esignature.service.ts', 'Signature creation with mandatory password re-verification'],
    ['libreclinicaapi/src/middleware/part11.middleware.ts', 'Part 11 compliance enforcement for all signing actions'],
    ['libreclinicaapi/src/routes/esignature.routes.ts', 'E-signature endpoints with Joi validation of all required fields'],
  ],
  activities: [
    covered('E-signature creation requires fresh password re-entry; cached credentials not accepted', ['OQ-033']),
    covered('Successful e-signature stores signer_name, signed_at, meaning, record_hash in database', ['PQ-027', 'PQ-028'],
      'read through the API status endpoint, not the database; the signer username, not the printed name, is compared.'),
    covered('Signing with incorrect password is rejected with HTTP 401 and audit-logged', ['OQ-041'],
      'the native refusal is HTTP 400 "Invalid password", not the planned 401, and the refusal is not read back from the audit trail (OQ-200 audits a client-reported failure and is not a credential-rejection test).'),
  ],
});

FEATURE_DATA.set('FEAT-021', {
  intendedUse:
    'Ensures every electronic signature manifestation includes the three components required by 21 CFR Part 11 ' +
    '§11.50(b): the printed name of the signer, the date and time of signing in UTC, and the meaning (purpose) ' +
    'of the signature. These components are displayed wherever the signed record is rendered.',
  analysisText:
    'High Process Risk because signatures missing any required component (name, date/time, meaning) are invalid ' +
    'under Part 11. Per CSA guidance, incomplete signatures foreseeably invalidate the signed records and could ' +
    'result in FDA rejection of clinical data submissions.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/database/esignature.service.ts', 'Stores all three signature components with NOT NULL enforcement'],
    ['libreclinicaapi/src/config/migrations.ts', 'NOT NULL constraints on signer_name, signed_at, meaning columns in acc_esignatures'],
  ],
  activities: [
    covered('Signature record includes signer printed name matching authenticated user full name', ['PQ-028', 'OQ-048'],
      'equality with the user-profile full name is not asserted.'),
    covered('Signature record includes UTC date and time of signing as TIMESTAMPTZ value', ['PQ-028'],
      'only a parseable signedAt is required; UTC and TIMESTAMPTZ storage are not checked.'),
    covered('Signature record includes meaning/purpose selected from controlled vocabulary', ['PQ-028'],
      'the canonical form-completion meaning (FORM_DATA_COMPLETE) is checked; vocabulary control is not tested.'),
  ],
});

FEATURE_DATA.set('FEAT-022', {
  intendedUse:
    'Requires fresh password re-authentication for every individual electronic signature event, ensuring the ' +
    'person executing the signature is positively identified at the time of signing. Session-level credentials ' +
    'are never used for signing per 21 CFR Part 11 §11.10(d) identity verification requirements.',
  analysisText:
    'High Process Risk because allowing signatures without re-authentication would enable unauthorized signing ' +
    'from unattended workstations. Per CSA guidance, this foreseeably compromises signature non-repudiation and ' +
    'could result in fraudulent signatures on regulated clinical records.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/database/esignature.service.ts', 'verifyPassword() called before every signature creation'],
    ['libreclinicaapi/src/services/database/auth.service.ts', 'Password verification logic reused for signature re-authentication'],
  ],
  activities: [
    covered('Signing without re-entering password is rejected with HTTP 400', ['OQ-033']),
    covered('Signing with wrong password is rejected with HTTP 401 and audit-logged', ['OQ-041'],
      'the native refusal is HTTP 400 "Invalid password", not the planned 401, and the refusal is not read back from the audit trail.'),
    covered('Session token alone is insufficient for signing; fresh password mandatory', ['OQ-033']),
    gap('Failed re-authentication locks signing capability after configured threshold', 'No signing-lockout case exists.'),
  ],
});

FEATURE_DATA.set('FEAT-023', {
  intendedUse:
    'Cryptographically links each electronic signature to the specific version of the electronic record using ' +
    'SHA-256 content hashing. If the record is modified after signing, the hash mismatch is detected and the ' +
    'signature is automatically invalidated per 21 CFR Part 11 §11.70 linking requirements.',
  analysisText:
    'High Process Risk because unlinked signatures could be copied or transferred between records, enabling ' +
    'fraud. Per CSA guidance, failure of signature-to-record linking foreseeably compromises the legal weight ' +
    'of all electronic signatures in the system.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/database/esignature.service.ts', 'SHA-256 hash computation from canonical record representation and verification'],
    ['libreclinicaapi/src/config/migrations.ts', 'record_hash column in acc_esignatures table storing the content hash'],
  ],
  activities: [
    covered('Signature record contains valid SHA-256 hash of the signed record content', ['PQ-028', 'OQ-042'],
      'the hash format is checked; the hash is not recomputed from the record content.'),
    covered('Modifying a signed record invalidates the signature via hash mismatch detection', ['PQ-029'],
      'invalidation is observed; the hash comparison itself is not. OQ-188 re-cites PQ-029 and is not counted again.'),
    gap('Hash is computed server-side from canonical JSON representation, not client-supplied',
      'OQ-071 is not implemented (the runner records a failing "did not execute" placeholder); no case tests hash provenance.'),
    gap('Re-signing after record modification produces a new hash linking to the updated content',
      'OQ-072 is not implemented (failing "did not execute" placeholder); PQ-029 requires a new signature ID with a verified proof but compares no hashes.'),
    covered('Signature verification endpoint returns valid/invalid status based on hash comparison', ['PQ-029', 'PQ-039'],
      'the unsigned and verified states are observed; the hash comparison itself is not.'),
    covered('Hash algorithm is NIST-approved SHA-256 producing 64-character hex string', ['OQ-042', 'PQ-028'],
      'the algorithm label and hex format are checked, not the computation.'),
  ],
});

FEATURE_DATA.set('FEAT-024', {
  intendedUse:
    'Prevents signers from repudiating (denying) their electronic signatures by maintaining a complete chain of ' +
    'evidence: authenticated user ID, fresh password verification, SHA-256 record hash, server-generated UTC ' +
    'timestamp, and immutable audit trail entry per 21 CFR Part 11 §11.10(j).',
  analysisText:
    'High Process Risk because repudiable signatures have no legal standing. Per CSA guidance, failure to maintain ' +
    'non-repudiation evidence foreseeably invalidates all electronically signed records, which could compromise ' +
    'the regulatory submission for the clinical trial.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/database/esignature.service.ts', 'Multi-factor signing evidence capture and storage'],
    ['libreclinicaapi/src/services/database/audit.service.ts', 'Immutable audit entry for every signing event with full context'],
  ],
  activities: [
    covered('Signing event creates immutable audit entry with full identity evidence and record reference', ['OQ-042'],
      'immutability of these rows is not separately tested.'),
    gap('Complete non-repudiation evidence chain is retrievable for any historical signature',
      'OQ-042 covers only the two signatures created in the same run.'),
    covered('Four-factor evidence maintained: identity, authentication, hash link, and timestamp', ['PQ-027', 'OQ-042']),
    gap('Signature evidence retained for the full regulatory retention period without modification',
      'PQ-039 and OQ-NATIVE-RETENTION re-read only at the end of the same run.'),
  ],
});

FEATURE_DATA.set('FEAT-030', {
  intendedUse:
    'Provides the primary electronic Case Report Form (eCRF) data entry interface for capturing clinical trial ' +
    'data as the core regulated record of the system. All subject safety and efficacy endpoint data flows through ' +
    'this feature, implementing 21 CFR Part 11 §11.10(a) requirements for validated systems.',
  analysisText:
    'High Process Risk — eCRF data entry is the primary regulated record. Per CSA guidance, failure to accurately ' +
    'capture, validate, and store clinical data foreseeably compromises patient safety determinations and the ' +
    'validity of the entire clinical trial. Data entry errors could propagate to regulatory submissions.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/hybrid/form.service.ts', 'Form data CRUD operations with validation rule execution on save'],
    ['libreclinicaapi/src/routes/form.routes.ts', 'eCRF endpoints with Joi validation of submission payloads'],
    ['libreclinicaapi/src/controllers/form.controller.ts', 'HTTP handling for form data submission and retrieval'],
    ['ElectronicDataCaptureReal/src/app/components/patient-form-modal/', 'eCRF data entry UI component'],
  ],
  activities: [
    covered('Form data submission stores all field values correctly and retrievable via GET', ['PQ-011', 'PQ-012']),
    covered('End-to-end eCRF workflow: create form instance, enter data, save, retrieve, verify integrity', ['PQ-005', 'PQ-011', 'PQ-012', 'PQ-020']),
    covered('Concurrent data entry to same form from different sessions is handled safely', ['PQ-022'],
      'the stale write is simulated sequentially from one session; truly concurrent saves from different sessions are not exercised.'),
    gap('Large form with 100+ fields saves and retrieves all values without truncation', 'The qualification form has five fields.'),
    covered('Unicode characters in field values (patient names, comments) are preserved correctly', ['PQ-024']),
    covered('Form save triggers validation rules and returns violations before commit', ['PQ-014'],
      'the validate-field preview endpoint is used; an invalid value is not posted to the save path.'),
  ],
});

FEATURE_DATA.set('FEAT-031', {
  intendedUse:
    'Implements the data correction process that preserves original values while recording new values, ensuring ' +
    'no clinical data is ever obscured or lost. Every correction generates a complete audit trail entry with ' +
    'old value, new value, reason for change, and user identity per 21 CFR Part 11 §11.10(e).',
  analysisText:
    'High Process Risk because overwriting clinical data without preserving the original violates the core ' +
    'Part 11 principle that electronic records must be maintained to allow reconstruction of data history. ' +
    'Per CSA guidance, clinical data loss foreseeably compromises the integrity of the trial record.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/middleware/audit.middleware.ts', 'Captures old field values before any overwrite operation'],
    ['libreclinicaapi/src/services/database/audit.service.ts', 'Stores old_value/new_value JSONB pair in audit entry'],
    ['libreclinicaapi/src/routes/form.routes.ts', 'Requires reason field on all PUT correction endpoints'],
  ],
  activities: [
    covered('Data correction preserves original value in audit trail old_value JSONB field', ['PQ-013', 'PQ-037'],
      'JSONB storage is not checked.'),
    gap('Multiple sequential corrections maintain complete version history reconstructible from audit',
      'PQ-037 checks one correction only; no history reconstruction case exists.'),
    covered('Correction with reason generates audit entry containing the exact reason text', ['PQ-037']),
    gap('Original data always recoverable by replaying audit trail entries in sequence', 'No audit replay case exists.'),
  ],
});

FEATURE_DATA.set('FEAT-032', {
  intendedUse:
    'Executes configurable validation rules (edit checks) against clinical data at the point of entry to detect ' +
    'invalid, out-of-range, or inconsistent data before it is committed to the database. Supports range checks, ' +
    'pattern matching, cross-field validation, and required field enforcement per 21 CFR Part 11 §11.10(a).',
  analysisText:
    'High Process Risk because validation rules are the primary mechanism to ensure data quality for regulatory ' +
    'endpoints. Per CSA guidance, failure of edit checks to detect invalid data foreseeably allows erroneous ' +
    'safety or efficacy data to enter the clinical database, directly compromising patient safety determinations.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/database/validation-rules.service.ts', 'Rule engine execution with support for multiple rule types'],
    ['libreclinicaapi/src/services/ai/rule-compiler.service.ts', 'Compiles rule definitions into executable validation logic'],
    ['libreclinicaapi/src/routes/validation-rules.routes.ts', 'Rule CRUD and execution endpoints with Joi validation'],
    ['libreclinicaapi/src/config/migrations.ts', 'acc_validation_rules table schema with rule type and configuration columns'],
  ],
  activities: [
    covered('Range validation rule correctly rejects values outside configured min/max bounds', ['PQ-014'],
      'only the minimum bound is exercised, through the preview endpoint.'),
    gap('Pattern validation rule correctly rejects values not matching configured regex', 'No pattern-rule case exists.'),
    gap('Required field validation rejects empty/null submissions for mandatory fields',
      'No required-field case exists; PQ-023 clears optional fields only.'),
    gap('Cross-field validation detects logical inconsistencies between related fields', 'No cross-field case exists.'),
    gap('Validation rules are versioned and audit-trailed when created or modified', 'No rule-versioning case exists.'),
    gap('Server-side execution ensures validation rules cannot be bypassed from the client',
      'No out-of-range value is posted to /api/forms/save to test bypass.'),
    gap('Disabled rules are not executed but retained for audit history', 'No disabled-rule case exists.'),
  ],
});

FEATURE_DATA.set('FEAT-033', {
  intendedUse:
    'Implements conditional skip/branching logic in eCRF forms so that fields and sections are shown or hidden ' +
    'based on the values entered in other fields. Ensures data collectors see only relevant questions based on ' +
    'prior responses, reducing data entry errors and preventing protocol deviations from missing required fields.',
  analysisText:
    'High Process Risk because incorrect branching logic could hide required fields, causing systematically ' +
    'missing data across the clinical trial. Per CSA guidance, missing data for critical endpoints foreseeably ' +
    'compromises the statistical analysis and safety determination for the study.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/hybrid/form.service.ts', 'Skip logic evaluation during form data retrieval and save validation'],
    ['ElectronicDataCaptureReal/src/app/services/forms/libreclinica-form.service.ts', 'Client-side skip logic rendering and field visibility'],
  ],
  activities: [
    gap('Skip logic correctly shows dependent fields when trigger condition is met', 'No skip-logic case exists.'),
    gap('Skip logic correctly hides dependent fields when trigger condition is not met', 'No skip-logic case exists.'),
    gap('Nested skip logic (condition dependent on another conditional field) evaluates correctly', 'No skip-logic case exists.'),
    gap('Server-side skip logic prevents saving hidden required fields as blank without error', 'No skip-logic case exists.'),
  ],
});

FEATURE_DATA.set('FEAT-034', {
  intendedUse:
    'Implements double data entry (DDE) for critical clinical fields where two independent users enter the same ' +
    'source data and the system automatically compares entries to detect discrepancies. Provides an additional ' +
    'layer of data integrity assurance beyond single-pass validation for high-priority endpoint data.',
  analysisText:
    'High Process Risk because DDE is deployed on critical safety and efficacy fields where single-entry errors ' +
    'could directly compromise patient safety determinations. Per CSA guidance, failure of the comparison ' +
    'mechanism foreseeably allows data entry errors to persist in critical endpoint data.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/hybrid/form.service.ts', 'DDE comparison engine detecting field-level discrepancies'],
    ['ElectronicDataCaptureReal/src/app/services/forms/libreclinica-form.service.ts', 'DDE mode UI enabling independent second entry'],
  ],
  activities: [
    gap('Matching DDE entries are accepted and finalized without query generation', 'No double-data-entry case exists.'),
    gap('Mismatched DDE entries generate a discrepancy flag requiring resolution', 'No double-data-entry case exists.'),
  ],
});

FEATURE_DATA.set('FEAT-040', {
  intendedUse:
    'Manages the complete lifecycle of clinical data queries (discrepancies): creation, assignment to site personnel, ' +
    'response from sites, review by data management, and resolution or escalation. Queries are the primary data ' +
    'cleaning mechanism required for GCP-compliant data management per 21 CFR Part 11 §11.10(e).',
  analysisText:
    'High Process Risk because the query system is the primary mechanism for identifying and resolving clinical ' +
    'data discrepancies before database lock. Per CSA guidance, failure of the query system foreseeably allows ' +
    'unresolved data quality issues to persist in the clinical database, compromising safety and efficacy analyses.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/database/query.service.ts', 'Query orchestration coordinating CRUD and state transitions'],
    ['libreclinicaapi/src/routes/query.routes.ts', 'Query endpoints with Joi validation and role-based access'],
    ['libreclinicaapi/src/controllers/query.controller.ts', 'HTTP handling for query lifecycle operations'],
    ['libreclinicaapi/src/services/database/queries/query-crud.service.ts', 'Create and read operations for query records'],
    ['libreclinicaapi/src/services/database/queries/query-mutations.service.ts', 'State transition logic with validation and audit'],
  ],
  activities: [
    covered('Query creation stores all required fields and assigns to target recipient', ['PQ-017'],
      'assignment to a recipient is not checked.'),
    covered('Query response from site updates status and records response text with audit entry', ['PQ-018'],
      'response text and audit are not read back.'),
    covered('Query resolution by data manager closes the query with documented rationale', ['PQ-019', 'PQ-038'],
      'the query is closed by the qualification operator, not a data_manager role, and the rationale is not read back; OQ-196 re-cites PQ-019 and is not counted again.'),
    gap('Query escalation workflow triggers when response deadline is exceeded', 'No escalation case exists.'),
    gap('Query re-opening after resolution generates new audit entry with justification', 'No re-open case exists.'),
    gap('Bulk query operations process each query individually with separate audit entries', 'No bulk-query case exists.'),
    gap('Query state transition validation prevents invalid transitions (e.g., closed to open)', 'No invalid-transition case exists.'),
  ],
});

FEATURE_DATA.set('FEAT-041', {
  intendedUse:
    'Automatically generates data queries when validation rules detect discrepancies, linking the auto-generated ' +
    'query to the specific field, rule, and violation that triggered it. Provides systematic automated data ' +
    'quality enforcement that supplements manual query creation by data managers.',
  analysisText:
    'High Process Risk because auto-query generation is the automated enforcement mechanism for data quality. ' +
    'Per CSA guidance, failure to generate queries for detected violations foreseeably allows known data quality ' +
    'issues to go unaddressed, compromising the integrity of clinical endpoint data.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/database/validation-rules.service.ts', 'Rule violation detection triggering auto-query generation'],
    ['libreclinicaapi/src/services/database/query.service.ts', 'Auto-query creation with rule linkage and violation context'],
  ],
  activities: [
    gap('Range violation triggers auto-query creation linked to the violating field',
      'No auto-query case exists; PQ-014 sends createQueries false.'),
    gap('Auto-query contains the rule name, violation description, and expected value range', 'No auto-query case exists.'),
    gap('Auto-query is assigned to the appropriate site user based on form ownership', 'No auto-query case exists.'),
    gap('Correcting the violating value and re-saving resolves the auto-query automatically', 'No auto-query case exists.'),
    gap('Disabled rules do not trigger auto-query generation even if data violates the rule', 'No auto-query case exists.'),
  ],
});

FEATURE_DATA.set('FEAT-050', {
  intendedUse:
    'Implements the data freeze control that prevents further modifications to reviewed clinical data while ' +
    'still allowing query resolution workflows to proceed. Data freeze is applied at the CRF level after data ' +
    'review to protect the reviewed state as a standard clinical data management control per ICH E6(R2) GCP.',
  analysisText:
    'High Process Risk because failure of the freeze mechanism would allow modifications to reviewed data, ' +
    'invalidating the data review process. Per CSA guidance, uncontrolled modification of reviewed clinical ' +
    'data foreseeably compromises the integrity of the data management process.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/database/data-locks.service.ts', 'Freeze status enforcement checked before any data modification'],
    ['libreclinicaapi/src/config/migrations.ts', 'acc_data_locks table schema with freeze/lock status columns'],
  ],
  activities: [
    covered('Frozen CRF rejects data modification attempts with HTTP 403 and descriptive message', ['PQ-030', 'PQ-031'],
      'the native refusal is HTTP 423 DATA_LOCKED with a message naming the frozen state, not the planned 403. OQ-051 re-cites '
      + 'PQ-030 and PQ-031 and is not counted again.'),
    gap('Frozen CRF still allows query response and resolution workflows to proceed',
      'The query steps (PQ-017 to PQ-019) run before the freeze (PQ-030).'),
    covered('Unfreeze requires elevated permissions and generates audit trail entry with reason', ['PQ-032', 'OQ-055'],
      'no unprivileged unfreeze refusal is attempted.'),
  ],
});

FEATURE_DATA.set('FEAT-051', {
  intendedUse:
    'Implements the hard data lock that prevents all modifications including query resolution on finalized CRF ' +
    'records. Data lock is the final state before database lock representing complete immutability. Unlocking ' +
    'requires electronic signature authorization with documented justification.',
  analysisText:
    'High Process Risk because failure of the lock mechanism would allow modification of finalized clinical ' +
    'data intended for regulatory submission. Per CSA guidance, this foreseeably compromises the integrity ' +
    'of the clinical database at the point when it is being prepared for unblinding and analysis.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/database/data-locks.service.ts', 'Lock status enforcement and unlock with e-signature requirement'],
    ['libreclinicaapi/src/routes/data-locks.routes.ts', 'Lock and unlock endpoints with authorization and e-signature validation'],
  ],
  activities: [
    covered('Locked CRF rejects all modification attempts including query operations (HTTP 403)', ['PQ-033', 'PQ-034'],
      'the native refusal is HTTP 423 DATA_LOCKED, not the planned 403; only a form save is attempted; query operations on a '
      + 'locked form are not tested. OQ-052 re-cites PQ-033 and PQ-034 and is not counted again.'),
    covered('Unlock requires electronic signature with password re-authentication', ['OQ-053'],
      'the signed positive path only; unlock without a signature is not attempted.'),
    covered('Lock and unlock events generate complete audit trail entries with user identity', ['OQ-053', 'OQ-055']),
  ],
});

FEATURE_DATA.set('FEAT-052', {
  intendedUse:
    'Implements the study-level database lock that freezes the entire clinical database for a study prior to ' +
    'unblinding and statistical analysis. This is the final regulatory milestone ensuring no data changes occur ' +
    'between database lock and final analysis, protecting the scientific integrity of the trial.',
  analysisText:
    'High Process Risk because failure of the study-level lock foreseeably allows post-lock modifications that ' +
    'could introduce bias into the clinical trial analysis. Per CSA guidance, this directly compromises the ' +
    'validity of safety and efficacy determinations for the investigational product.',
  testType: 'Robust Scripted Testing (per CSA Guidance Table 1)',
  implFiles: [
    ['libreclinicaapi/src/services/database/data-locks.service.ts', 'Study-level global lock enforcement across all study CRFs'],
    ['libreclinicaapi/src/services/hybrid/study.service.ts', 'Study status transition to locked state with authorization checks'],
  ],
  activities: [
    gap('Study-level database lock prevents all data modifications across all CRFs in the study',
      'No case applies a study-level lock; OQ-198 only reads a study lock-status endpoint.'),
    gap('Study unlock requires formal electronic signature from authorized data manager or sponsor', 'No study-unlock case exists.'),
  ],
});

const GAP_STATUS = 'Gap — no executed case mapped; not qualified';

const STATUS: Record<MappedCaseState, string> = {
  passed: '✅ Pass',
  failed: '❌ Fail',
  'manual-pending': '⏸ Manual verification pending',
  'not-executed': '⬜ Did not execute in the retained run',
  missing: '⬜ Not executed — no retained evidence',
};

/** Retained text reaches table cells and list items: keep it on one line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

interface FeatureCensus {
  ids: string[];
  passed: string[];
  failed: string[];
  manual: string[];
  notExecuted: string[];
  missing: string[];
  gaps: number;
}

function featureCensus(activities: PlannedActivity[], evidence: Map<string, RunnerResult>): FeatureCensus {
  const ids = [...new Set(activities.flatMap(activity => activity.cases))];
  const census: FeatureCensus = {
    ids, passed: [], failed: [], manual: [], notExecuted: [], missing: [],
    gaps: activities.filter(activity => activity.cases.length === 0).length,
  };
  const buckets: Record<MappedCaseState, string[]> = {
    passed: census.passed, failed: census.failed, 'manual-pending': census.manual,
    'not-executed': census.notExecuted, missing: census.missing,
  };
  for (const id of ids) buckets[mappedCaseState(id, evidence)].push(id);
  return census;
}

const count = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;
const listed = (ids: string[]) => ids.join(', ');

function gapSentence(gaps: number): string {
  return gaps === 0 ? ''
    : ` ${gaps === 1 ? '1 planned activity has' : `${gaps} planned activities have`} no executed case mapped and ${gaps === 1 ? 'is' : 'are'} not qualified by this record.`;
}

/** Facts other than the verdict: what is missing, did not execute, awaits manual verification or passed. */
function censusFacts(census: FeatureCensus): string[] {
  const total = census.ids.length;
  const facts: string[] = [];
  if (census.missing.length) facts.push(`${census.missing.length} of ${total} mapped cases ${census.missing.length === 1 ? 'has' : 'have'} no retained evidence (${listed(census.missing)})`);
  if (census.notExecuted.length) facts.push(`${count(census.notExecuted.length, 'case', 'cases')} did not execute in the retained run (${listed(census.notExecuted)})`);
  if (census.manual.length) facts.push(`${count(census.manual.length, 'manual case has', 'manual cases have')} no recorded manual pass (${listed(census.manual)}); the evidence format records manual verification as required and never as an automatic pass`);
  if (census.passed.length) facts.push(`${census.passed.length} passed (${listed(census.passed)})`);
  return facts;
}

/** The conclusion is derived only from the mapped evidence census. */
function conclusion(feature: string, census: FeatureCensus): string {
  const total = census.ids.length;
  const gaps = gapSentence(census.gaps);
  if (total === 0) return `No assurance conclusion: no executed runner case is mapped to this feature's stated control.${gaps}`;
  if (census.missing.length === total) {
    return `Not executed — no conclusion: none of the ${total} mapped cases (${listed(census.ids)}) has retained evidence in this output directory.${gaps}`;
  }
  const facts = censusFacts(census);
  if (census.failed.length) {
    const others = facts.length ? ` Also: ${facts.join('; ')}.` : '';
    return `Not acceptable: ${census.failed.length} of ${total} mapped checks failed in the retained run (${listed(census.failed)}); see Issues Found.${others}${gaps}`;
  }
  if (census.missing.length || census.notExecuted.length) return `Incomplete — no conclusion: ${facts.join('; ')}.${gaps}`;
  if (census.manual.length) return `Manual verification pending — no conclusion: ${facts.join('; ')}.${gaps}`;
  return `All ${total} mapped checks passed in the retained run (${listed(census.ids)}). This evidence supports, but does not `
    + `by itself establish, that the ${feature} control is acceptable for its intended use; acceptance requires review of the `
    + `listed evidence and approval in the signature block.${gaps}`;
}

function issuesFound(census: FeatureCensus, evidence: Map<string, RunnerResult>): string {
  if (census.ids.length === 0 || census.missing.length === census.ids.length) return 'Not assessed: no retained evidence.\n\n';
  const notes = (id: string) => oneLine(evidence.get(id)?.notes ?? '');
  const blocks: string[] = [census.failed.length
    ? census.failed.map(id => `- **${id}:** FAIL — ${notes(id)}`).join('\n')
    : census.passed.length
      ? `No failures were recorded for the ${count(census.passed.length, 'executed mapped check', 'executed mapped checks')} in the retained run.`
      : 'Not assessed: no mapped check executed in the retained run.'];
  const notAssessed = [
    ...census.missing.map(id => `- **${id}:** Not assessed — no retained evidence`),
    ...census.notExecuted.map(id => `- **${id}:** Not assessed — did not execute in the retained run: ${notes(id)}`),
    ...census.manual.map(id => `- **${id}:** Not assessed — manual verification pending: ${notes(id)}`),
  ];
  if (notAssessed.length) blocks.push(notAssessed.join('\n'));
  if (census.gaps) blocks.push(`Planned activities without an executed case (${count(census.gaps, 'gap', 'gaps')} above) were not assessed.`);
  return blocks.join('\n\n') + '\n\n';
}

function retainedRows(census: FeatureCensus, evidence: Map<string, RunnerResult>): RunnerResult[] {
  return census.ids.map(id => evidence.get(id)).filter((row): row is RunnerResult => row !== undefined);
}

/** Test date only from retained evidence timestamps (UTC calendar dates). */
function testDate(rows: RunnerResult[]): string {
  if (!rows.length) return 'Not executed';
  const days = rows.map(row => Date.parse(row.timestamp)).filter(Number.isFinite)
    .map(ms => new Date(ms).toISOString().slice(0, 10)).sort();
  if (!days.length) return 'Not recorded in retained evidence';
  const first = days[0], last = days[days.length - 1];
  return `${first === last ? first : `${first} to ${last}`} (UTC, from retained evidence timestamps)`;
}

function observedOrigin(endpoint: string): string | undefined {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** The environment is only the endpoint origin the retained evidence actually called. */
function testEnvironment(rows: RunnerResult[]): string {
  const origins = [...new Set(rows.map(row => observedOrigin(row.endpoint)).filter((origin): origin is string => !!origin))].sort();
  if (!origins.length) return 'Not recorded';
  return `Observed endpoint origin${origins.length > 1 ? 's' : ''}: ${origins.join(', ')}`;
}

function activityRows(activities: PlannedActivity[], evidence: Map<string, RunnerResult>): string[][] {
  return activities.flatMap(activity => {
    if (!activity.cases.length) return [[activity.planned, '—', `None. ${activity.note ?? ''}`.trim(), '—', GAP_STATUS]];
    return activity.cases.map(id => {
      const result = evidence.get(id);
      const limit = activity.note ? ` Not covered: ${activity.note}` : '';
      const description = !result ? '—'
        : result.testDescription?.trim() ? oneLine(result.testDescription) : 'Not recorded in retained evidence';
      return [activity.planned, id, `${runnerCaseCheck(id).check}${limit}`, description, STATUS[mappedCaseState(id, evidence)]];
    });
  });
}

export function generate(outputDir: string, _workspaceRoot: string): void {
  const DOC_DATE = SYSTEM_INFO.buildDate;
  const evidenceMap = loadRunnerEvidence(outputDir);

  let content = '';

  content += documentHeader({
    title: 'CSA Feature Assurance Records',
    documentId: 'VAL-019',
    version: '1.0',
    date: DOC_DATE,
    system: SYSTEM_INFO.fullName,
    classification: 'Confidential',
  });

  const tocEntries = FEATURE_RISKS.map((f) => ({
    level: 2 as const,
    title: `${f.featureId}: ${f.feature}`,
  }));
  content += tableOfContents(tocEntries);
  content += '\n';
  content += hr();

  content += section(2, 'Introduction');
  content += 'This document provides Computer Software Assurance (CSA) per-feature records for the ';
  content += `**${SYSTEM_INFO.fullName}** (v${SYSTEM_INFO.version}), following the FDA guidance `;
  content += '"Computer Software Assurance for Production and Quality Management System Software" ';
  content += '(February 2026), Section V.A.6, Table 1.\n\n';
  content += 'The CSA approach classifies each system feature based on process risk:\n\n';
  content += '- **High Process Risk:** Features whose failure to perform as intended could result in a quality ';
  content += 'problem that foreseeably compromises safety, or that produce records required by regulations. ';
  content += 'These require robust scripted testing.\n';
  content += '- **Not High Process Risk:** Features whose failure would not directly compromise safety or ';
  content += 'regulatory records. These may be assured through unscripted exploratory testing.\n\n';
  content += '**Reading these records.** Each planned assurance activity cites a runner case only where that case\'s ';
  content += 'actual executed check, shown beside it, verifies the feature\'s stated control; an activity without such a case ';
  content += `is listed as "${GAP_STATUS}". Status, test date and test environment come only from the retained evidence in `;
  content += 'this output directory (`evidence/<category>/<category>-results.json`): an absent result is reported as not ';
  content += 'executed, a manual-verification record never counts as a pass, and the evidence records no tester identity. ';
  content += 'Each conclusion is derived from the mapped evidence; acceptance and approval require the signature blocks.\n\n';
  content += hr();

  for (const feat of FEATURE_RISKS) {
    const data = FEATURE_DATA.get(feat.featureId);
    const csaClassification: string = (feat.riskLevel === 'Critical' || feat.riskLevel === 'High')
      ? 'High Process Risk'
      : 'Not High Process Risk';

    const intendedUse = data?.intendedUse ?? `${feat.feature} — ${feat.justification}.`;
    const analysisText = data?.analysisText ?? `Classified as ${csaClassification} under FDA CSA guidance. ${feat.justification}.`;
    const testType = data?.testType ?? (csaClassification === 'High Process Risk'
      ? 'Robust Scripted Testing (per CSA Guidance Table 1)'
      : 'Unscripted Testing — Exploratory (per CSA Guidance Table 1)');
    const implFiles = data?.implFiles ?? [];
    const activities = data?.activities ?? [];
    const census = featureCensus(activities, evidenceMap);
    const rows = retainedRows(census, evidenceMap);

    content += section(2, `${feat.featureId}: ${feat.feature}`);

    content += section(3, 'Intended Use');
    content += intendedUse + '\n\n';

    content += section(3, 'CSA Risk-Based Analysis');
    content += `**CSA Classification:** ${csaClassification}  \n`;
    content += `**Risk Level:** ${riskBadge(feat.riskLevel)}  \n`;
    if (feat.part11Section) {
      content += `**21 CFR Part 11 Reference:** §${feat.part11Section}  \n`;
    }
    if (feat.hipaaSection) {
      content += `**HIPAA Reference:** §${feat.hipaaSection}  \n`;
    }
    content += '\n';
    content += analysisText + '\n\n';

    content += section(3, 'Implementation Controls');
    if (implFiles.length > 0) {
      content += markdownTable(
        ['File', 'Responsibility'],
        implFiles,
      );
    } else {
      content += 'See system architecture documentation for implementation details.\n';
    }
    content += '\n';

    content += section(3, 'Assurance Activities');
    content += `**Planned Testing Type:** ${testType}\n\n`;
    if (activities.length > 0) {
      content += markdownTable(['Planned Activity', 'Mapped Case', 'Actual Executed Check', 'Observed Description', 'Status'],
        activityRows(activities, evidenceMap));
    } else {
      content += 'No planned assurance activities are defined for this feature, and no executed runner case is mapped to it.\n';
    }
    content += '\n';

    content += section(3, 'Issues Found');
    content += issuesFound(census, evidenceMap);

    content += section(3, 'Conclusion');
    content += conclusion(feat.feature, census) + '\n\n';

    content += section(3, 'Record');
    content += markdownTable(
      ['Field', 'Value'],
      [
        ['Tested By', 'Not recorded in retained evidence'],
        ['Test Date', testDate(rows)],
        ['Test Environment', testEnvironment(rows)],
        ['Approved By', '_________________'],
        ['Approval Date', '____/____/____'],
      ],
    );
    content += '\n';
    content += hr();
  }

  content += approvalBlock(['CSV Lead', 'Quality Assurance', 'Regulatory Affairs', 'System Owner']);
  content += '\n---\n*End of Document*\n';

  fs.writeFileSync(path.join(outputDir, '19-csa-feature-assurance.md'), content);
}
