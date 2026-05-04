import * as fs from 'fs';
import * as path from 'path';
import { SYSTEM_INFO } from '../config/system-info';
import { REGULATORY_SCOPE } from '../config/regulatory-scope';
import {
  documentHeader,
  section,
  approvalBlock,
  tableOfContents,
  hr,
  markdownTable,
  riskBadge,
  type SectionEntry,
} from './helpers/markdown-writer';
import { getDocumentMeta, stampDocument } from './helpers/version-stamper';

interface OqTestCase {
  id: string;
  title: string;
  requirement: string;
  cfr: string;
  riskLevel: 'Critical' | 'High' | 'Medium' | 'Low';
  preconditions: string;
  steps: string[];
  expectedResult: string;
  evidence: string;
}

const YEAR = new Date().getFullYear();
const DOC_ID = `OQ-${YEAR}-001`;

function oqTestCaseBlock(tc: OqTestCase): string {
  const lines: string[] = [
    `### ${tc.id}: ${tc.title}`,
    '',
    `- **Requirement:** ${tc.requirement}`,
    `- **CFR Reference:** ${tc.cfr}`,
    `- **Risk Level:** ${riskBadge(tc.riskLevel)}`,
    `- **Preconditions:** ${tc.preconditions}`,
    '- **Steps:**',
  ];
  tc.steps.forEach((step, i) => {
    lines.push(`  ${i + 1}. ${step}`);
  });
  lines.push(`- **Expected Result:** ${tc.expectedResult}`);
  lines.push('- **Actual Result:** _[To be completed]_');
  lines.push('- **Pass/Fail:** _[Pending]_');
  lines.push(`- **Evidence:** _[See evidence/oq/]_`);
  lines.push('');
  return lines.join('\n');
}

function authenticationCases(): OqTestCase[] {
  return [
    {
      id: 'OQ-001', title: 'Valid Login', requirement: 'URS-AUTH-001', cfr: '11.10(d)',
      riskLevel: 'Critical', preconditions: 'Valid user account exists in the system',
      steps: [
        'POST /api/auth/login with valid username and password.',
        'Verify response status is 200.',
        'Verify JWT token is present in the response body.',
        'Verify the token is valid JWT format (three base64url segments).',
      ],
      expectedResult: 'HTTP 200 returned with a valid JWT token in the response.',
      evidence: 'See evidence/oq/OQ-001.json',
    },
    {
      id: 'OQ-002', title: 'Unique User ID Verification', requirement: 'URS-AUTH-002', cfr: '11.10(d)',
      riskLevel: 'Critical', preconditions: 'User "testuser" exists in the system',
      steps: [
        'POST /api/auth/register or user creation endpoint with same username "testuser".',
        'Verify response status is 409 or 400 rejection.',
      ],
      expectedResult: 'System rejects duplicate username with HTTP 409/400.',
      evidence: 'See evidence/oq/OQ-002.json',
    },
    {
      id: 'OQ-003', title: 'Invalid Login Audit', requirement: 'URS-AUDIT-001', cfr: '11.10(e)',
      riskLevel: 'High', preconditions: 'Valid user account exists in the system',
      steps: [
        'POST /api/auth/login with valid username and incorrect password.',
        'Verify response status is 401.',
        'Query audit log for failed login entry matching the username.',
      ],
      expectedResult: 'HTTP 401 returned AND audit log contains failed login attempt with timestamp and IP.',
      evidence: 'See evidence/oq/OQ-003.json',
    },
    {
      id: 'OQ-004', title: 'Password Complexity', requirement: 'URS-AUTH-003', cfr: '11.10(d)/164.312(d)',
      riskLevel: 'High', preconditions: 'None',
      steps: [
        'Attempt registration with password "abc" (too short).',
        'Attempt registration with password "password" (too simple).',
        'Attempt registration with a compliant strong password.',
      ],
      expectedResult: 'Weak passwords rejected, strong password accepted.',
      evidence: 'See evidence/oq/OQ-004.json',
    },
    {
      id: 'OQ-005', title: 'Session Timeout', requirement: 'URS-AUTH-004', cfr: '11.10(d)',
      riskLevel: 'High', preconditions: 'User logged in with valid JWT',
      steps: [
        'Note JWT expiry time from the token payload.',
        'Wait past the expiry time.',
        'Attempt an API call with the expired token.',
        'Verify response status is 401.',
      ],
      expectedResult: 'Expired JWT returns HTTP 401 Unauthorized.',
      evidence: 'See evidence/oq/OQ-005.json',
    },
    {
      id: 'OQ-006', title: 'JWT Token Content', requirement: 'URS-AUTH-005', cfr: '11.10(d)',
      riskLevel: 'Medium', preconditions: 'Valid JWT obtained via login',
      steps: [
        'Decode the JWT payload (base64url decode the second segment).',
        'Verify payload contains userId field.',
        'Verify payload contains role field.',
        'Verify payload contains exp (expiration) claim.',
        'Verify payload contains iat (issued at) claim.',
      ],
      expectedResult: 'JWT contains userId, role, exp, and iat claims.',
      evidence: 'See evidence/oq/OQ-006.json',
    },
    {
      id: 'OQ-007', title: 'Device Fingerprint Tracking', requirement: 'URS-AUTH-006', cfr: '11.10(d)',
      riskLevel: 'Medium', preconditions: 'User account exists in the system',
      steps: [
        'Login from device A with a specific User-Agent header.',
        'Login from device B with a different User-Agent header.',
        'Query session/device records for the user.',
        'Verify both device fingerprints are tracked.',
      ],
      expectedResult: 'Both device fingerprints recorded in system.',
      evidence: 'See evidence/oq/OQ-007.json',
    },
    {
      id: 'OQ-008', title: 'Rate Limiting', requirement: 'URS-SEC-001', cfr: '11.10(a)',
      riskLevel: 'High', preconditions: 'API is running and accessible',
      steps: [
        'Send 20+ rapid sequential POST /api/auth/login requests.',
        'Verify HTTP 429 is returned after the rate limit threshold.',
        'Verify Retry-After header is present in the 429 response.',
      ],
      expectedResult: 'HTTP 429 Too Many Requests after rate limit exceeded.',
      evidence: 'See evidence/oq/OQ-008.json',
    },
    {
      id: 'OQ-009', title: 'Account Lockout', requirement: 'URS-AUTH-007', cfr: '11.10(d)',
      riskLevel: 'Critical', preconditions: 'Valid user account exists in the system',
      steps: [
        'Send 5+ failed login attempts with incorrect password.',
        'Attempt login with the correct password.',
        'Verify account locked response is returned.',
      ],
      expectedResult: 'Account locked after 5+ failed attempts, correct password also rejected until unlocked.',
      evidence: 'See evidence/oq/OQ-009.json',
    },
    {
      id: 'OQ-010', title: 'Logout', requirement: 'URS-AUTH-008', cfr: '11.10(d)',
      riskLevel: 'Medium', preconditions: 'User is logged in with a valid session',
      steps: [
        'POST /api/auth/logout with current session token.',
        'Attempt an API call with the same token.',
        'Verify response status is 401.',
      ],
      expectedResult: 'Session invalidated, subsequent requests with same token return 401.',
      evidence: 'See evidence/oq/OQ-010.json',
    },
  ];
}

function accessControlCases(): OqTestCase[] {
  return [
    {
      id: 'OQ-011', title: 'Admin Full Access', requirement: 'URS-RBAC-001', cfr: '11.10(d)',
      riskLevel: 'Critical', preconditions: 'Admin user logged in',
      steps: [
        'GET /api/users (user management) — verify 200.',
        'GET /api/studies (study config) — verify 200.',
        'POST /api/data-locks (data locks) — verify 200.',
      ],
      expectedResult: 'Admin can access user management, study config, and data lock endpoints.',
      evidence: 'See evidence/oq/OQ-011.json',
    },
    {
      id: 'OQ-012', title: 'Data Manager Access', requirement: 'URS-RBAC-002', cfr: '11.10(d)',
      riskLevel: 'High', preconditions: 'data_manager user logged in',
      steps: [
        'GET /api/queries — verify 200.',
        'POST /api/data-locks — verify 200.',
        'GET /api/export — verify 200.',
      ],
      expectedResult: 'Data manager can manage queries, locks, and exports.',
      evidence: 'See evidence/oq/OQ-012.json',
    },
    {
      id: 'OQ-013', title: 'Investigator Access', requirement: 'URS-RBAC-003', cfr: '11.10(d)',
      riskLevel: 'High', preconditions: 'investigator user logged in',
      steps: [
        'POST /api/form-data (enter data) — verify 200.',
        'POST /api/esignatures (sign forms) — verify 200.',
      ],
      expectedResult: 'Investigator can enter data and sign forms.',
      evidence: 'See evidence/oq/OQ-013.json',
    },
    {
      id: 'OQ-014', title: 'Coordinator Access', requirement: 'URS-RBAC-004', cfr: '11.10(d)',
      riskLevel: 'High', preconditions: 'coordinator user logged in',
      steps: [
        'POST /api/form-data (enter data) — verify 200.',
        'POST /api/subjects (manage subjects) — verify 200.',
      ],
      expectedResult: 'Coordinator can enter data and manage subjects.',
      evidence: 'See evidence/oq/OQ-014.json',
    },
    {
      id: 'OQ-015', title: 'Monitor Access', requirement: 'URS-RBAC-005', cfr: '11.10(d)',
      riskLevel: 'High', preconditions: 'monitor user logged in',
      steps: [
        'GET /api/sdv (SDV dashboard) — verify 200.',
        'POST /api/queries (create queries) — verify 200.',
      ],
      expectedResult: 'Monitor can view SDV dashboard and create queries.',
      evidence: 'See evidence/oq/OQ-015.json',
    },
    {
      id: 'OQ-016', title: 'Viewer Access', requirement: 'URS-RBAC-006', cfr: '11.10(d)',
      riskLevel: 'Medium', preconditions: 'viewer user logged in',
      steps: [
        'GET /api/dashboard — verify 200.',
        'POST /api/form-data — verify 403 Forbidden.',
      ],
      expectedResult: 'Viewer has read-only access to dashboards, cannot modify data.',
      evidence: 'See evidence/oq/OQ-016.json',
    },
    {
      id: 'OQ-017', title: 'Coordinator Cannot Lock (Negative)', requirement: 'URS-RBAC-007', cfr: '11.10(d)',
      riskLevel: 'High', preconditions: 'coordinator user logged in',
      steps: [
        'POST /api/data-locks to freeze casebook.',
        'Verify response status is 403 Forbidden.',
      ],
      expectedResult: 'System returns 403, coordinator cannot freeze/lock data.',
      evidence: 'See evidence/oq/OQ-017.json',
    },
    {
      id: 'OQ-018', title: 'Monitor Cannot Edit (Negative)', requirement: 'URS-RBAC-008', cfr: '11.10(d)',
      riskLevel: 'High', preconditions: 'monitor user logged in',
      steps: [
        'PUT /api/form-data to edit clinical data.',
        'Verify response status is 403 Forbidden.',
      ],
      expectedResult: 'System returns 403, monitor cannot edit form data.',
      evidence: 'See evidence/oq/OQ-018.json',
    },
    {
      id: 'OQ-019', title: 'Viewer Cannot Export (Negative)', requirement: 'URS-RBAC-009', cfr: '11.10(d)',
      riskLevel: 'Medium', preconditions: 'viewer user logged in',
      steps: [
        'GET /api/export/csv for raw data export.',
        'Verify response status is 403 Forbidden.',
      ],
      expectedResult: 'System returns 403, viewer cannot export raw data.',
      evidence: 'See evidence/oq/OQ-019.json',
    },
    {
      id: 'OQ-020', title: 'Unauthenticated Access Denied', requirement: 'URS-AUTH-009', cfr: '11.10(d)',
      riskLevel: 'Critical', preconditions: 'No authentication token',
      steps: [
        'GET /api/studies without Authorization header — verify 401.',
        'GET /api/subjects without Authorization header — verify 401.',
      ],
      expectedResult: 'All protected endpoints return 401 without valid JWT.',
      evidence: 'See evidence/oq/OQ-020.json',
    },
    {
      id: 'OQ-021', title: 'Role Change Effective', requirement: 'URS-RBAC-010', cfr: '11.10(d)',
      riskLevel: 'High', preconditions: 'User with coordinator role exists',
      steps: [
        'Change user role to viewer via admin API.',
        'User logs in again to obtain a new JWT.',
        'Attempt data entry POST /api/form-data.',
        'Verify response status is 403.',
      ],
      expectedResult: 'Updated role permissions take effect, former coordinator now denied data entry.',
      evidence: 'See evidence/oq/OQ-021.json',
    },
    {
      id: 'OQ-022', title: 'Deactivated User Denied', requirement: 'URS-AUTH-010', cfr: '11.10(d)',
      riskLevel: 'Critical', preconditions: 'Active user account exists',
      steps: [
        'Deactivate user via admin API.',
        'Attempt login with deactivated credentials.',
        'Verify login fails.',
      ],
      expectedResult: 'Deactivated user cannot authenticate.',
      evidence: 'See evidence/oq/OQ-022.json',
    },
  ];
}

function auditTrailCases(): OqTestCase[] {
  return [
    {
      id: 'OQ-023', title: 'Create Generates Audit', requirement: 'URS-AUDIT-002', cfr: '11.10(e)',
      riskLevel: 'Critical', preconditions: 'Authenticated user with data entry permissions',
      steps: [
        'POST to create a record (e.g., subject or form data).',
        'GET /api/audit with entity filter for the created record.',
        'Verify audit entry exists with CREATE action.',
      ],
      expectedResult: 'Audit entry created with action=CREATE, entity reference, and user identity.',
      evidence: 'See evidence/oq/OQ-023.json',
    },
    {
      id: 'OQ-024', title: 'Update Generates Audit with Old/New Values', requirement: 'URS-AUDIT-003', cfr: '11.10(e)',
      riskLevel: 'Critical', preconditions: 'Existing record in the system',
      steps: [
        'PUT/PATCH to modify the existing record.',
        'GET /api/audit for that entity.',
        'Verify old_values and new_values are captured in the audit entry.',
      ],
      expectedResult: 'Audit entry shows both old and new field values.',
      evidence: 'See evidence/oq/OQ-024.json',
    },
    {
      id: 'OQ-025', title: 'Audit Contains User Identity', requirement: 'URS-AUDIT-004', cfr: '11.10(e)',
      riskLevel: 'Critical', preconditions: 'Audit entries exist in the system',
      steps: [
        'GET /api/audit.',
        'Verify each entry has userId, fullName, and role fields.',
      ],
      expectedResult: 'Every audit entry identifies the acting user by ID, name, and role.',
      evidence: 'See evidence/oq/OQ-025.json',
    },
    {
      id: 'OQ-026', title: 'Audit Contains Timestamp', requirement: 'URS-AUDIT-005', cfr: '11.10(e)',
      riskLevel: 'Critical', preconditions: 'Audit entries exist in the system',
      steps: [
        'GET /api/audit.',
        'Verify createdAt field is ISO 8601 UTC format.',
      ],
      expectedResult: 'All timestamps in ISO 8601 UTC (e.g., 2026-01-15T14:30:00.000Z).',
      evidence: 'See evidence/oq/OQ-026.json',
    },
    {
      id: 'OQ-027', title: 'Audit Contains Action Type', requirement: 'URS-AUDIT-006', cfr: '11.10(e)',
      riskLevel: 'High', preconditions: 'Various operations (create, update, delete) have been performed',
      steps: [
        'GET /api/audit.',
        'Verify action field contains CREATE, UPDATE, or DELETE as appropriate.',
      ],
      expectedResult: 'Action field accurately reflects the operation type.',
      evidence: 'See evidence/oq/OQ-027.json',
    },
    {
      id: 'OQ-028', title: 'Audit Contains Record Reference', requirement: 'URS-AUDIT-007', cfr: '11.10(e)',
      riskLevel: 'High', preconditions: 'Audit entries exist in the system',
      steps: [
        'GET /api/audit.',
        'Verify entityType and entityId fields are present and accurate.',
      ],
      expectedResult: 'Each audit entry references the specific entity type and ID.',
      evidence: 'See evidence/oq/OQ-028.json',
    },
    {
      id: 'OQ-029', title: 'Reason for Change Captured', requirement: 'URS-AUDIT-008/FRS-DATA-001', cfr: '11.10(e)',
      riskLevel: 'Critical', preconditions: 'Existing clinical data in the system',
      steps: [
        'PUT to modify data with reason field in request body.',
        'GET /api/audit for the modified entity.',
        'Verify reason is captured in the audit entry.',
      ],
      expectedResult: 'Audit entry includes the user-provided reason for change.',
      evidence: 'See evidence/oq/OQ-029.json',
    },
    {
      id: 'OQ-030', title: 'Audit Immutable No Update', requirement: 'URS-AUDIT-009', cfr: '11.10(e)',
      riskLevel: 'Critical', preconditions: 'Audit entries exist in the system',
      steps: [
        'Attempt PUT /api/audit/:id to update an audit record.',
        'Verify response status is 404 or 405.',
      ],
      expectedResult: 'System does not expose update endpoint for audit records.',
      evidence: 'See evidence/oq/OQ-030.json',
    },
    {
      id: 'OQ-031', title: 'Audit Immutable No Delete', requirement: 'URS-AUDIT-010', cfr: '11.10(e)',
      riskLevel: 'Critical', preconditions: 'Audit entries exist in the system',
      steps: [
        'Attempt DELETE /api/audit/:id.',
        'Verify response status is 404 or 405.',
      ],
      expectedResult: 'System does not expose delete endpoint for audit records.',
      evidence: 'See evidence/oq/OQ-031.json',
    },
    {
      id: 'OQ-032', title: 'Audit Export', requirement: 'URS-AUDIT-011', cfr: '11.10(e)',
      riskLevel: 'High', preconditions: 'Audit entries exist in the system',
      steps: [
        'GET /api/audit/export.',
        'Verify response is downloadable.',
        'Verify export contains all required fields (userId, action, entityType, entityId, old/new values, timestamp, reason).',
      ],
      expectedResult: 'Complete audit trail exportable with all compliance fields.',
      evidence: 'See evidence/oq/OQ-032.json',
    },
  ];
}

function esignatureCases(): OqTestCase[] {
  return [
    {
      id: 'OQ-033', title: 'E-Signature Requires Re-Authentication', requirement: 'URS-ESIG-001/FRS-ESIG-001', cfr: '11.50(a)',
      riskLevel: 'Critical', preconditions: 'User logged in with form ready to sign',
      steps: [
        'POST /api/esignatures without password field.',
        'Verify response is rejected (400/401).',
      ],
      expectedResult: 'System requires password re-entry for e-signature, rejects without it.',
      evidence: 'See evidence/oq/OQ-033.json',
    },
    {
      id: 'OQ-034', title: 'Signature Contains Printed Name', requirement: 'URS-ESIG-002', cfr: '11.50(a)(1)',
      riskLevel: 'Critical', preconditions: 'Valid e-signature completed',
      steps: [
        'GET the signature record.',
        'Verify signerName/printedName field is present and matches the user\'s full name.',
      ],
      expectedResult: 'Signature record includes the signer\'s printed name.',
      evidence: 'See evidence/oq/OQ-034.json',
    },
    {
      id: 'OQ-035', title: 'Signature Contains Date/Time', requirement: 'URS-ESIG-003', cfr: '11.50(a)(2)',
      riskLevel: 'Critical', preconditions: 'Valid e-signature completed',
      steps: [
        'GET the signature record.',
        'Verify signedAt field is ISO 8601 UTC format.',
      ],
      expectedResult: 'Signature includes UTC timestamp of signing.',
      evidence: 'See evidence/oq/OQ-035.json',
    },
    {
      id: 'OQ-036', title: 'Signature Contains Meaning', requirement: 'URS-ESIG-004', cfr: '11.50(a)(3)',
      riskLevel: 'Critical', preconditions: 'Valid e-signature completed',
      steps: [
        'GET the signature record.',
        'Verify meaning field is present (e.g., "Approval", "Review", "Responsibility").',
      ],
      expectedResult: 'Signature includes the meaning/intent (e.g., "Approval").',
      evidence: 'See evidence/oq/OQ-036.json',
    },
    {
      id: 'OQ-037', title: 'Signature Linked to Record', requirement: 'URS-ESIG-005', cfr: '11.70',
      riskLevel: 'Critical', preconditions: 'Valid e-signature on a form',
      steps: [
        'GET the signature record.',
        'Verify eventCrfId or recordId is present.',
        'Verify contentHash or data integrity link exists.',
      ],
      expectedResult: 'Signature is cryptographically or referentially bound to the signed record.',
      evidence: 'See evidence/oq/OQ-037.json',
    },
    {
      id: 'OQ-038', title: 'Signature Manifestation Displayed', requirement: 'URS-ESIG-006', cfr: '11.50(b)',
      riskLevel: 'High', preconditions: 'Signed record exists in the system',
      steps: [
        'GET the signed record/form.',
        'Verify response includes signature details (signer, date, meaning) in a displayable format.',
      ],
      expectedResult: 'Signed record displays full signature manifestation (name, date/time, meaning).',
      evidence: 'See evidence/oq/OQ-038.json',
    },
    {
      id: 'OQ-039', title: 'Post-Signature Change Audited', requirement: 'URS-ESIG-007/FRS-ESIG-002', cfr: '11.10(e)/11.50',
      riskLevel: 'Critical', preconditions: 'Signed form exists in the system',
      steps: [
        'PUT to modify data on the signed form.',
        'Verify audit trail shows the change.',
        'Verify signature status changes (invalidated or re-signature required).',
      ],
      expectedResult: 'Data change after signing is audited and signature is invalidated or flagged.',
      evidence: 'See evidence/oq/OQ-039.json',
    },
    {
      id: 'OQ-040', title: 'Signature Copy Prevention', requirement: 'URS-ESIG-008', cfr: '11.70',
      riskLevel: 'Critical', preconditions: 'Valid signature exists in the system',
      steps: [
        'Attempt to apply the same signature payload to a different record/form.',
        'Verify the system rejects the request.',
      ],
      expectedResult: 'System rejects applying a signature to a record it was not created for.',
      evidence: 'See evidence/oq/OQ-040.json',
    },
    {
      id: 'OQ-041', title: 'Wrong Password Rejected', requirement: 'URS-ESIG-009', cfr: '11.50(a)',
      riskLevel: 'Critical', preconditions: 'User is logged in',
      steps: [
        'POST /api/esignatures with incorrect password.',
        'Verify response status is 401 or 403.',
      ],
      expectedResult: 'E-signature rejected when password verification fails.',
      evidence: 'See evidence/oq/OQ-041.json',
    },
    {
      id: 'OQ-042', title: 'Signature Generates Audit Entry', requirement: 'URS-ESIG-010/URS-AUDIT-012', cfr: '11.10(e)/11.50',
      riskLevel: 'High', preconditions: 'None',
      steps: [
        'Complete a valid e-signature.',
        'GET /api/audit filtered by signature entity.',
        'Verify SIGN action is present in the audit log.',
      ],
      expectedResult: 'Audit trail records the signing action with user, timestamp, and record reference.',
      evidence: 'See evidence/oq/OQ-042.json',
    },
  ];
}

function dataOperationsCases(): OqTestCase[] {
  return [
    {
      id: 'OQ-043', title: 'Create eCRF Data', requirement: 'FRS-DATA-002', cfr: '11.10(a)',
      riskLevel: 'High', preconditions: 'Study with assigned forms exists, subject enrolled',
      steps: [
        'POST /api/form-data with valid field values.',
        'Verify response status is 200 or 201.',
        'GET the record back.',
        'Verify data persisted correctly.',
      ],
      expectedResult: 'Form data saved successfully and retrievable.',
      evidence: 'See evidence/oq/OQ-043.json',
    },
    {
      id: 'OQ-044', title: 'Modify eCRF Data', requirement: 'FRS-DATA-003', cfr: '11.10(e)',
      riskLevel: 'High', preconditions: 'Existing form data in the system',
      steps: [
        'PUT /api/form-data with updated values and reason.',
        'Verify response status is 200.',
        'GET /api/audit for the modified entity.',
        'Verify old value is preserved in audit trail.',
      ],
      expectedResult: 'Data modified, audit trail captures old and new values with reason.',
      evidence: 'See evidence/oq/OQ-044.json',
    },
    {
      id: 'OQ-045', title: 'Validation Rule Fires', requirement: 'FRS-VAL-001', cfr: '11.10(a)',
      riskLevel: 'High', preconditions: 'Validation rule configured on a field',
      steps: [
        'POST /api/form-data with a value violating the rule (e.g., out-of-range).',
        'Verify validation error returned or auto-query created.',
      ],
      expectedResult: 'System enforces validation — blocks save or creates data query.',
      evidence: 'See evidence/oq/OQ-045.json',
    },
    {
      id: 'OQ-046', title: 'Data Correction Requires Reason', requirement: 'FRS-DATA-004/URS-AUDIT-008', cfr: '11.10(e)',
      riskLevel: 'Critical', preconditions: 'Existing saved form data',
      steps: [
        'PUT /api/form-data without reason field.',
        'Verify response is rejected (400).',
        'PUT /api/form-data with reason field.',
        'Verify response is accepted (200).',
      ],
      expectedResult: 'System requires reason for data correction, rejects updates without reason.',
      evidence: 'See evidence/oq/OQ-046.json',
    },
    {
      id: 'OQ-047', title: 'Export CSV', requirement: 'FRS-EXPORT-001', cfr: '11.10(b)',
      riskLevel: 'Medium', preconditions: 'Study with data exists',
      steps: [
        'GET /api/export with format=csv.',
        'Verify response Content-Type is text/csv.',
        'Verify file contains expected columns and data rows.',
      ],
      expectedResult: 'Valid CSV file with complete study data.',
      evidence: 'See evidence/oq/OQ-047.json',
    },
    {
      id: 'OQ-048', title: 'Export PDF', requirement: 'FRS-EXPORT-002', cfr: '11.10(b)',
      riskLevel: 'Medium', preconditions: 'Study with data exists',
      steps: [
        'GET /api/export with format=pdf.',
        'Verify response Content-Type is application/pdf.',
        'Verify file is a valid PDF.',
      ],
      expectedResult: 'Valid PDF generated with study data.',
      evidence: 'See evidence/oq/OQ-048.json',
    },
    {
      id: 'OQ-049', title: 'Record Retrieval', requirement: 'FRS-DATA-005', cfr: '11.10(b)',
      riskLevel: 'High', preconditions: 'Saved form data exists',
      steps: [
        'GET /api/form-data/:id.',
        'Verify response status is 200.',
        'Verify all saved fields returned with correct values.',
      ],
      expectedResult: 'Complete record retrieved with all field values intact.',
      evidence: 'See evidence/oq/OQ-049.json',
    },
    {
      id: 'OQ-050', title: 'Query Create and Resolve', requirement: 'FRS-QUERY-001', cfr: '11.10(e)',
      riskLevel: 'High', preconditions: 'Form data with discrepancy exists',
      steps: [
        'POST /api/queries to create a query on a field — verify OPEN status.',
        'POST to respond to the query.',
        'POST to resolve the query.',
        'GET /api/audit for query lifecycle — verify all actions logged.',
      ],
      expectedResult: 'Query lifecycle (create, respond, resolve) fully audited.',
      evidence: 'See evidence/oq/OQ-050.json',
    },
  ];
}

function dataLockCases(): OqTestCase[] {
  return [
    {
      id: 'OQ-051', title: 'Freeze Prevents Editing', requirement: 'FRS-LOCK-001', cfr: '11.10(a)',
      riskLevel: 'Critical', preconditions: 'Subject casebook with data exists',
      steps: [
        'POST /api/data-locks to freeze casebook.',
        'Attempt PUT /api/form-data on frozen record.',
        'Verify response status is 403 or 409.',
      ],
      expectedResult: 'Frozen casebook rejects data edits.',
      evidence: 'See evidence/oq/OQ-051.json',
    },
    {
      id: 'OQ-052', title: 'Lock Prevents All Changes', requirement: 'FRS-LOCK-002', cfr: '11.10(a)',
      riskLevel: 'Critical', preconditions: 'Subject casebook exists',
      steps: [
        'POST /api/data-locks to lock casebook.',
        'Attempt any modification (edit, query creation, new data entry).',
        'Verify all modification attempts are rejected.',
      ],
      expectedResult: 'Locked casebook rejects all modifications.',
      evidence: 'See evidence/oq/OQ-052.json',
    },
    {
      id: 'OQ-053', title: 'Unlock Request Workflow', requirement: 'FRS-LOCK-003', cfr: '11.10(a)/11.10(e)',
      riskLevel: 'High', preconditions: 'Locked casebook exists',
      steps: [
        'POST unlock request.',
        'Approve unlock (admin/DM).',
        'Attempt edit on the unlocked record.',
        'Verify edit succeeds.',
      ],
      expectedResult: 'Unlock workflow restores editability, all actions audited.',
      evidence: 'See evidence/oq/OQ-053.json',
    },
    {
      id: 'OQ-054', title: 'Lock Status in Response', requirement: 'FRS-LOCK-004', cfr: '11.10(a)',
      riskLevel: 'Medium', preconditions: 'Locked/frozen records exist',
      steps: [
        'GET the record.',
        'Verify lockStatus field reflects current state (frozen/locked/unlocked).',
      ],
      expectedResult: 'API response includes accurate lock/freeze status.',
      evidence: 'See evidence/oq/OQ-054.json',
    },
    {
      id: 'OQ-055', title: 'Lock and Freeze Audited', requirement: 'FRS-LOCK-005/URS-AUDIT-013', cfr: '11.10(e)',
      riskLevel: 'High', preconditions: 'None',
      steps: [
        'Freeze a casebook.',
        'Lock a casebook.',
        'GET /api/audit for lock entity.',
        'Verify FREEZE and LOCK actions are logged.',
      ],
      expectedResult: 'All freeze/lock/unlock actions generate audit trail entries.',
      evidence: 'See evidence/oq/OQ-055.json',
    },
  ];
}


function part11ComplianceCases(): OqTestCase[] {
  return [
    {
      id: 'OQ-056', title: 'Password Expiration Enforcement', requirement: 'URS-AUTH-011', cfr: '11.300(b)',
      riskLevel: 'Critical', preconditions: 'User account with password older than PASSWORD_EXPIRY_DAYS (default 90)',
      steps: [
        'Create a user with a password set date older than 90 days (or configured expiry).',
        'POST /api/auth/login with valid credentials.',
        'Verify response indicates password expired (e.g., 403 with password_expired flag).',
        'Change password via PUT /api/auth/change-password.',
        'Verify login succeeds after password change.',
      ],
      expectedResult: 'Login blocked with expired password; succeeds after password reset.',
      evidence: 'See evidence/oq/OQ-056.json',
    },
    {
      id: 'OQ-057', title: 'Account Lockout After Failed Attempts', requirement: 'URS-AUTH-012', cfr: '11.300(d)',
      riskLevel: 'Critical', preconditions: 'Valid user account with no prior lockout',
      steps: [
        'POST /api/auth/login with incorrect password MAX_LOGIN_ATTEMPTS (default 5) times.',
        'Verify the account becomes locked after the threshold.',
        'POST /api/auth/login with the correct password.',
        'Verify login is rejected due to account lockout.',
        'Verify admin notification was sent for the lockout event.',
      ],
      expectedResult: 'Account locked after 5 failed attempts; correct password rejected until admin unlocks; admin notified.',
      evidence: 'See evidence/oq/OQ-057.json',
    },
    {
      id: 'OQ-058', title: 'Emergency Session Revocation', requirement: 'URS-AUTH-013', cfr: '11.300(c)',
      riskLevel: 'Critical', preconditions: 'User with active sessions exists; admin user logged in',
      steps: [
        'POST /api/users/:id/revoke-sessions as admin.',
        'Verify response status is 200.',
        'Attempt API call with the user\'s previously valid JWT.',
        'Verify response status is 401 (token blocked).',
        'Verify audit trail records the revocation event.',
      ],
      expectedResult: 'All active sessions revoked; existing tokens rejected; action audited.',
      evidence: 'See evidence/oq/OQ-058.json',
    },
    {
      id: 'OQ-059', title: 'Two-Component E-Signature', requirement: 'URS-ESIG-011', cfr: '11.200(a)(1)',
      riskLevel: 'Critical', preconditions: 'User logged in with form ready to sign',
      steps: [
        'POST /api/esignatures with signaturePassword only (no signatureUsername).',
        'Verify response is rejected (400).',
        'POST /api/esignatures with signatureUsername only (no signaturePassword).',
        'Verify response is rejected (400).',
        'POST /api/esignatures with both signatureUsername and signaturePassword.',
        'Verify response is accepted (200/201).',
      ],
      expectedResult: 'E-signature requires both username and password components; rejects incomplete submissions.',
      evidence: 'See evidence/oq/OQ-059.json',
    },
    {
      id: 'OQ-060', title: 'Audit Trail Immutability (No Delete)', requirement: 'URS-AUDIT-013', cfr: '11.10(e)',
      riskLevel: 'Critical', preconditions: 'Audit entries exist in the database',
      steps: [
        'Attempt DELETE /api/audit/:id — verify 404 or 405.',
        'Attempt PUT /api/audit/:id — verify 404 or 405.',
        'Attempt direct SQL DELETE on audit_log_event table (if accessible).',
        'Verify database trigger prevents the deletion.',
      ],
      expectedResult: 'API and database-level protections prevent audit trail modification or deletion.',
      evidence: 'See evidence/oq/OQ-060.json',
    },
    {
      id: 'OQ-061', title: 'Reason for Change Required', requirement: 'URS-AUDIT-014/FRS-DATA-006', cfr: '11.10(e)',
      riskLevel: 'Critical', preconditions: 'Existing clinical data in the system',
      steps: [
        'PUT /api/form-data to modify clinical data without reasonForChange field.',
        'Verify response status is 400 with descriptive error.',
        'PUT /api/form-data with reasonForChange field populated.',
        'Verify response status is 200.',
        'GET /api/audit for the modified entity — verify reason is captured.',
      ],
      expectedResult: 'Clinical data mutations blocked without reason; accepted with reason; reason persisted in audit.',
      evidence: 'See evidence/oq/OQ-061.json',
    },
    {
      id: 'OQ-062', title: 'Token Blocklist on Logout', requirement: 'URS-AUTH-014', cfr: '11.10(d)',
      riskLevel: 'Critical', preconditions: 'User logged in with valid JWT',
      steps: [
        'Note the current JWT token.',
        'POST /api/auth/logout.',
        'Verify response status is 200.',
        'Attempt GET /api/studies with the logged-out token.',
        'Verify response status is 401.',
      ],
      expectedResult: 'Token added to blocklist on logout; subsequent requests with same token return 401.',
      evidence: 'See evidence/oq/OQ-062.json',
    },
    {
      id: 'OQ-063', title: 'PHI Not Exposed in Error Responses', requirement: 'URS-SEC-002', cfr: '164.312(c)(1)',
      riskLevel: 'Critical', preconditions: 'API is running in production mode',
      steps: [
        'Trigger a server error on an endpoint that processes PHI (e.g., invalid form submission).',
        'Inspect the error response body.',
        'Verify no stack traces are included.',
        'Verify no PHI fields (names, DOB, SSN) appear in the error response.',
      ],
      expectedResult: 'Error responses contain generic messages only; no stack traces or PHI leaked.',
      evidence: 'See evidence/oq/OQ-063.json',
    },
    {
      id: 'OQ-064', title: 'Signature Manifestation (Name/Date/Meaning)', requirement: 'URS-ESIG-012', cfr: '11.50',
      riskLevel: 'Critical', preconditions: 'Completed e-signature exists in the system',
      steps: [
        'GET the e-signature record by ID.',
        'Verify signerName field is present and matches the signing user\'s full name.',
        'Verify signedAt field is present in ISO 8601 UTC format.',
        'Verify meaning field is present (e.g., "Approval", "Review").',
      ],
      expectedResult: 'Signature record contains all three manifestation components: name, date/time, and meaning.',
      evidence: 'See evidence/oq/OQ-064.json',
    },
    {
      id: 'OQ-065', title: 'Signature-Record Cryptographic Linking', requirement: 'URS-ESIG-013', cfr: '11.70',
      riskLevel: 'Critical', preconditions: 'Signed form exists in the system',
      steps: [
        'GET the e-signature record.',
        'Verify recordHash field contains a SHA-256 hash.',
        'Modify the signed record data.',
        'GET the e-signature record again.',
        'Verify the signature is auto-invalidated (status changed or hash mismatch flagged).',
      ],
      expectedResult: 'Signature includes SHA-256 hash of record content; auto-invalidated when record changes.',
      evidence: 'See evidence/oq/OQ-065.json',
    },
    {
      id: 'OQ-066', title: 'Username Uniqueness Enforcement', requirement: 'URS-AUTH-015', cfr: '11.300(a)',
      riskLevel: 'Critical', preconditions: 'Existing user with username "testuser"',
      steps: [
        'POST /api/auth/register with username "testuser" (duplicate).',
        'Verify response status is 409 or 400.',
        'Verify error message indicates username already exists.',
        'POST /api/auth/register with a unique username.',
        'Verify response status is 200/201.',
      ],
      expectedResult: 'Duplicate usernames rejected; unique usernames accepted.',
      evidence: 'See evidence/oq/OQ-066.json',
    },
    {
      id: 'OQ-067', title: 'Human-Readable Record Copies (PDF Export)', requirement: 'URS-EXPORT-003', cfr: '11.10(b)',
      riskLevel: 'Critical', preconditions: 'Study with completed CRF data exists',
      steps: [
        'GET /api/export with format=pdf for a specific subject/study.',
        'Verify response Content-Type is application/pdf.',
        'Verify PDF contains all CRF field data.',
        'Verify PDF includes audit trail information.',
      ],
      expectedResult: 'Valid PDF generated with complete CRF data and audit trail.',
      evidence: 'See evidence/oq/OQ-067.json',
    },
    {
      id: 'OQ-068', title: 'Backup Service Operational', requirement: 'URS-INFRA-001', cfr: '11.10(c)',
      riskLevel: 'Critical', preconditions: 'Backup service configured and running',
      steps: [
        'Trigger a manual backup via the backup API or service.',
        'Verify backup file is created.',
        'Verify backup file is encrypted (AES-256-GCM).',
        'Verify backup-scheduler.service.ts schedule is active.',
      ],
      expectedResult: 'Backup created successfully with AES-256-GCM encryption; scheduler is operational.',
      evidence: 'See evidence/oq/OQ-068.json',
    },
    {
      id: 'OQ-069', title: 'E-Signature User Certification', requirement: 'URS-ESIG-014', cfr: '11.100(b)',
      riskLevel: 'Critical', preconditions: 'New user who has never signed before',
      steps: [
        'Attempt e-signature without prior certification.',
        'Verify system requires identity certification before first use.',
        'Complete certification process (verify identity).',
        'Attempt e-signature again.',
        'Verify signature is accepted after certification.',
      ],
      expectedResult: 'First-time signers must complete identity certification; signatures accepted after certification.',
      evidence: 'See evidence/oq/OQ-069.json',
    },
    {
      id: 'OQ-070', title: 'System Version Tracking', requirement: 'URS-INFRA-002', cfr: '11.10(k)(2)',
      riskLevel: 'High', preconditions: 'API is running',
      steps: [
        'GET /health endpoint.',
        'Verify response includes version field matching package.json version.',
        'Verify response includes environment field.',
        'Verify Git version control is in use for the codebase.',
      ],
      expectedResult: '/health returns accurate system version; Git provides change documentation.',
      evidence: 'See evidence/oq/OQ-070.json',
    },
    {
      id: 'OQ-071', title: 'Password History Enforcement', requirement: 'URS-AUTH-016', cfr: '11.300(b)',
      riskLevel: 'Critical', preconditions: 'User account with at least one prior password change',
      steps: [
        'PUT /api/auth/change-password with the current password as the new password.',
        'Verify response is rejected (400) — cannot reuse current password.',
        'PUT /api/auth/change-password with a previously used password (within last 5).',
        'Verify response is rejected (400) — password history check.',
        'PUT /api/auth/change-password with a genuinely new password.',
        'Verify response is accepted (200).',
      ],
      expectedResult: 'System rejects reuse of last 5 passwords; accepts new unique passwords.',
      evidence: 'See evidence/oq/OQ-071.json',
    },
    {
      id: 'OQ-072', title: 'Concurrent Session Control', requirement: 'URS-AUTH-017', cfr: '11.10(d)',
      riskLevel: 'High', preconditions: 'User account exists with active session',
      steps: [
        'Login as user from device A — obtain JWT-A.',
        'Login as same user from device B — obtain JWT-B.',
        'Attempt API call with JWT-A.',
        'Verify JWT-A is blocked (401) — old session invalidated.',
        'Verify JWT-B is valid and accepted.',
      ],
      expectedResult: 'New login invalidates previous session; only latest session is active.',
      evidence: 'See evidence/oq/OQ-072.json',
    },
    {
      id: 'OQ-073', title: 'Audit Write Failure Blocks Mutation', requirement: 'URS-AUDIT-015', cfr: '11.10(e)',
      riskLevel: 'Critical', preconditions: 'System running with audit logging configured',
      steps: [
        'Simulate audit database write failure (e.g., disconnect audit DB or simulate error).',
        'Attempt a mutation request (POST /api/form-data).',
        'Verify response status is 503 Service Unavailable.',
        'Verify no data was persisted (mutation rolled back).',
        'Restore audit database connectivity.',
        'Verify mutations succeed again.',
      ],
      expectedResult: 'Mutations blocked with 503 when audit cannot be written; no data persisted without audit.',
      evidence: 'See evidence/oq/OQ-073.json',
    },
    {
      id: 'OQ-074', title: 'PHI Redacted from Application Logs', requirement: 'URS-SEC-003', cfr: '164.312(c)(1)',
      riskLevel: 'Critical', preconditions: 'API running with logging enabled',
      steps: [
        'Submit a request with PHI fields (firstName, lastName, DOB, SSN, diagnoses).',
        'Inspect application logs (Docker logs or log files).',
        'Verify PHI fields are replaced with ***PHI_REDACTED*** in logs.',
        'Verify non-PHI fields are logged normally.',
      ],
      expectedResult: 'PHI fields (firstName, lastName, DOB, SSN, diagnoses) replaced with ***PHI_REDACTED*** in all logs.',
      evidence: 'See evidence/oq/OQ-074.json',
    },
    {
      id: 'OQ-075', title: 'Security Alert on Account Lockout', requirement: 'URS-AUTH-018', cfr: '11.300(d)',
      riskLevel: 'Critical', preconditions: 'Admin users exist; user account with no prior lockout',
      steps: [
        'Trigger account lockout by exceeding MAX_LOGIN_ATTEMPTS.',
        'Verify account is locked.',
        'Check admin notification channel (email, in-app, or notification table).',
        'Verify admin users received an urgent security alert about the lockout.',
        'Verify alert contains: locked username, timestamp, IP address of failed attempts.',
      ],
      expectedResult: 'Admin users receive urgent notification with lockout details (user, time, IP).',
      evidence: 'See evidence/oq/OQ-075.json',
    },
  ];
}


export function generate(outputDir: string, _workspaceRoot: string): void {
  const allCases: OqTestCase[][] = [
    authenticationCases(),
    accessControlCases(),
    auditTrailCases(),
    esignatureCases(),
    dataOperationsCases(),
    dataLockCases(),
    part11ComplianceCases(),
  ];

  const sectionTitles = [
    'Authentication Tests',
    'Access Control Tests',
    'Audit Trail Tests',
    'E-Signature Tests',
    'Data Operations Tests',
    'Data Lock Tests',
    'Part 11 Compliance Controls Tests',
  ];

  const tocEntries: SectionEntry[] = [
    { level: 1, title: 'Objective' },
    { level: 1, title: 'Scope' },
    { level: 1, title: 'Test Environment' },
  ];
  for (const title of sectionTitles) {
    tocEntries.push({ level: 1, title });
  }
  tocEntries.push({ level: 1, title: 'Acceptance Criteria' });
  tocEntries.push({ level: 1, title: 'Deviations' });
  tocEntries.push({ level: 1, title: 'Approval Signatures' });

  const flatCases = allCases.flat();
  let content = '';

  content += documentHeader({
    title: 'Operational Qualification Protocol (OQ)',
    documentId: DOC_ID,
    version: '1.0',
    date: new Date().toISOString().split('T')[0],
    system: SYSTEM_INFO.fullName,
    classification: 'Regulatory — 21 CFR Part 11 Validation',
  });

  content += tableOfContents(tocEntries);
  content += hr();

  content += section(2, 'Objective');
  content += 'This Operational Qualification (OQ) protocol verifies that all regulated system ' +
    `operations of ${SYSTEM_INFO.fullName} v${SYSTEM_INFO.version} function correctly per ` +
    'approved specifications. OQ testing demonstrates that each functional requirement produces ' +
    'the expected output under normal, boundary, and negative conditions.\n\n';

  content += section(2, 'Scope');
  content += 'This protocol covers functional testing of all regulated system operations:\n\n';
  content += '- **Authentication:** Login, session management, password policy, lockout\n';
  content += '- **Access Control:** Role-based permissions (RBAC), positive and negative testing\n';
  content += '- **Audit Trails:** Create/update/delete auditing, immutability, export\n';
  content += '- **Electronic Signatures:** Re-authentication, manifestation, linkage, non-repudiation\n';
  content += '- **Data Operations:** eCRF CRUD, validation rules, exports, query workflow\n';
  content += '- **Data Locks:** Freeze/lock enforcement, unlock workflow, status reporting\n';
  content += '- **Part 11 Compliance Controls:** Password expiration, session revocation, audit immutability, PHI redaction, concurrent sessions\n\n';
  content += `**Applicable regulations:** ${REGULATORY_SCOPE.part11Applicable ? '21 CFR Part 11' : ''}` +
    `${REGULATORY_SCOPE.hipaaApplicable ? ', HIPAA Security Rule' : ''}\n\n`;

  content += section(2, 'Test Environment');
  content += markdownTable(
    ['Component', 'Detail'],
    [
      ['System', SYSTEM_INFO.fullName],
      ['Version', SYSTEM_INFO.version],
      ['API URL', SYSTEM_INFO.environments.production.apiUrl],
      ['Frontend URL', SYSTEM_INFO.environments.production.frontendUrl],
      ['Database Host', SYSTEM_INFO.environments.production.databaseHost],
      ['Frontend Framework', `${SYSTEM_INFO.architecture.frontend.name} v${SYSTEM_INFO.architecture.frontend.version}`],
      ['Backend Runtime', `${SYSTEM_INFO.architecture.backend.name} (${SYSTEM_INFO.architecture.backend.version})`],
      ['Database', `${SYSTEM_INFO.architecture.database.name} ${SYSTEM_INFO.architecture.database.version}`],
      ['Hosting', SYSTEM_INFO.infrastructure.hosting],
      ['Containerization', SYSTEM_INFO.infrastructure.containerization],
    ],
  );
  content += '\n';
  content += hr();

  content += section(2, 'Test Summary');
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
      content += oqTestCaseBlock(tc);
    }
    content += hr();
  }

  content += section(2, 'Acceptance Criteria');
  content += '- All **Critical** and **High** risk test cases MUST pass.\n';
  content += '- **Medium** risk test cases require a 95%+ pass rate.\n';
  content += '- Overall pass rate must be 95% or higher.\n';
  content += '- Any failed Critical test case requires a deviation report and risk assessment before proceeding.\n\n';

  content += section(2, 'Deviations');
  content += markdownTable(
    ['ID', 'Test Case', 'Description', 'Impact', 'Resolution', 'Status'],
    [],
  );
  content += '\n_[To be completed during test execution]_\n\n';

  content += approvalBlock([
    'QA Manager',
    'Clinical Operations Director',
    'System Owner',
    'Validation Lead',
  ]);

  const meta = getDocumentMeta(outputDir);
  content = stampDocument(content, meta);

  fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, '08-oq-protocol.md');
  fs.writeFileSync(outPath, content, 'utf-8');
}
