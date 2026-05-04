/**
 * Risk rating definitions and per-feature risk assignments.
 * Uses the 4-tier scale mandated by the validation requirements.
 */

export type RiskLevel = 'Critical' | 'High' | 'Medium' | 'Low';

export interface RiskDefinition {
  level: RiskLevel;
  description: string;
  releaseBlocking: boolean;
}

export const RISK_DEFINITIONS: Record<RiskLevel, RiskDefinition> = {
  Critical: {
    level: 'Critical',
    description:
      'Affects subject safety, subject rights, primary endpoint data, regulated records, ' +
      'audit trails, signatures, PHI/ePHI, access control, retention, or inspection readiness.',
    releaseBlocking: true,
  },
  High: {
    level: 'High',
    description:
      'Affects important clinical data, workflows, reports, exports, monitoring, or security.',
    releaseBlocking: true,
  },
  Medium: {
    level: 'Medium',
    description:
      'Affects non-critical workflows but not final regulated records.',
    releaseBlocking: false,
  },
  Low: {
    level: 'Low',
    description:
      'Cosmetic/usability issue with no regulated-record impact.',
    releaseBlocking: false,
  },
};

export interface FeatureRisk {
  featureId: string;
  feature: string;
  riskLevel: RiskLevel;
  justification: string;
  part11Section?: string;
  hipaaSection?: string;
}

export const FEATURE_RISKS: FeatureRisk[] = [
  // --- Authentication & Access Control ---
  { featureId: 'FEAT-001', feature: 'User Authentication (Login/Logout)', riskLevel: 'Critical', justification: 'Controls access to all regulated records; failure could expose ePHI or allow unauthorized data modification', part11Section: '11.10(d)', hipaaSection: '164.312(d)' },
  { featureId: 'FEAT-002', feature: 'Unique User Identification', riskLevel: 'Critical', justification: 'Required for audit trail accountability and signature non-repudiation', part11Section: '11.10(d)', hipaaSection: '164.312(a)(2)(i)' },
  { featureId: 'FEAT-003', feature: 'Password/MFA Controls', riskLevel: 'Critical', justification: 'Prevents unauthorized access to regulated records and ePHI', part11Section: '11.10(d)', hipaaSection: '164.312(d)' },
  { featureId: 'FEAT-004', feature: 'Role-Based Access Control', riskLevel: 'Critical', justification: 'Enforces least-privilege access to clinical data and system functions', part11Section: '11.10(d)', hipaaSection: '164.312(a)(1)' },
  { featureId: 'FEAT-005', feature: 'Session Management/Timeout', riskLevel: 'Critical', justification: 'Prevents unauthorized access via unattended workstations', part11Section: '11.10(d)', hipaaSection: '164.312(a)(2)(iii)' },
  { featureId: 'FEAT-006', feature: 'User Provisioning/Deactivation', riskLevel: 'High', justification: 'Controls who has access to the system; affects access control integrity', part11Section: '11.10(d)' },

  // --- Audit Trail ---
  { featureId: 'FEAT-010', feature: 'Audit Trail Generation', riskLevel: 'Critical', justification: 'Required by Part 11; primary mechanism to detect altered/invalid records', part11Section: '11.10(e)' },
  { featureId: 'FEAT-011', feature: 'Audit Trail Content (who/what/when/old/new)', riskLevel: 'Critical', justification: 'Incomplete audit trails fail regulatory inspection', part11Section: '11.10(e)' },
  { featureId: 'FEAT-012', feature: 'Audit Trail Immutability', riskLevel: 'Critical', justification: 'Editable audit trails invalidate the entire record', part11Section: '11.10(e)' },
  { featureId: 'FEAT-013', feature: 'Audit Trail Export', riskLevel: 'High', justification: 'Required for regulatory inspection readiness', part11Section: '11.10(e)' },
  { featureId: 'FEAT-014', feature: 'Reason for Change Capture', riskLevel: 'Critical', justification: 'Required for clinical data corrections per GCP', part11Section: '11.10(e)' },

  // --- Electronic Signatures ---
  { featureId: 'FEAT-020', feature: 'E-Signature Creation', riskLevel: 'Critical', justification: 'Legal equivalent of handwritten signature for regulated records', part11Section: '11.50' },
  { featureId: 'FEAT-021', feature: 'E-Signature Components (name/date/meaning)', riskLevel: 'Critical', justification: 'Missing components invalidate the signature', part11Section: '11.50(b)' },
  { featureId: 'FEAT-022', feature: 'E-Signature Re-Authentication', riskLevel: 'Critical', justification: 'Prevents unauthorized signing of regulated records', part11Section: '11.10(d)' },
  { featureId: 'FEAT-023', feature: 'Signature-to-Record Linking', riskLevel: 'Critical', justification: 'Unlinked signatures have no legal weight', part11Section: '11.70' },
  { featureId: 'FEAT-024', feature: 'Signature Non-Repudiation', riskLevel: 'Critical', justification: 'Signer must not be able to deny having signed', part11Section: '11.10(j)' },

  // --- Data Entry & Integrity ---
  { featureId: 'FEAT-030', feature: 'eCRF Data Entry', riskLevel: 'Critical', justification: 'Primary regulated record — subject safety and endpoint data', part11Section: '11.10(a)' },
  { featureId: 'FEAT-031', feature: 'Data Correction Without Overwriting', riskLevel: 'Critical', justification: 'Prior data must not be obscured per Part 11', part11Section: '11.10(e)' },
  { featureId: 'FEAT-032', feature: 'Validation Rules (Edit Checks)', riskLevel: 'Critical', justification: 'Detect invalid data at point of entry; affects data quality for primary endpoints', part11Section: '11.10(a)' },
  { featureId: 'FEAT-033', feature: 'Skip/Branching Logic', riskLevel: 'High', justification: 'Incorrect logic could hide required fields, causing missing data', part11Section: '11.10(a)' },
  { featureId: 'FEAT-034', feature: 'Double Data Entry (DDE)', riskLevel: 'High', justification: 'Additional data integrity control for critical fields' },

  // --- Data Queries ---
  { featureId: 'FEAT-040', feature: 'Query Creation/Response/Resolution', riskLevel: 'Critical', justification: 'Primary mechanism for data cleaning and discrepancy management', part11Section: '11.10(e)' },
  { featureId: 'FEAT-041', feature: 'Auto-Query from Validation Rules', riskLevel: 'High', justification: 'Automated data quality enforcement' },

  // --- Data Lock/Freeze ---
  { featureId: 'FEAT-050', feature: 'Data Freeze', riskLevel: 'Critical', justification: 'Prevents unauthorized modification of reviewed data', part11Section: '11.10(a)' },
  { featureId: 'FEAT-051', feature: 'Data Lock', riskLevel: 'Critical', justification: 'Final lock status — no further changes without formal unlock', part11Section: '11.10(a)' },
  { featureId: 'FEAT-052', feature: 'Study-Level Database Lock', riskLevel: 'Critical', justification: 'Final regulatory milestone before unblinding and analysis' },

  // --- Study Management ---
  { featureId: 'FEAT-060', feature: 'Study Setup/Configuration', riskLevel: 'High', justification: 'Incorrect study configuration affects all downstream data' },
  { featureId: 'FEAT-061', feature: 'Site Management', riskLevel: 'High', justification: 'Site assignment affects data access and subject enrollment' },
  { featureId: 'FEAT-062', feature: 'Visit Schedule Definition', riskLevel: 'High', justification: 'Incorrect visit schedule could cause protocol deviations' },

  // --- Subject/Patient Management ---
  { featureId: 'FEAT-070', feature: 'Subject Enrollment', riskLevel: 'Critical', justification: 'Directly affects subject rights and safety — enrollment in wrong study/site', part11Section: '11.10(a)' },
  { featureId: 'FEAT-071', feature: 'Subject ID Assignment', riskLevel: 'Critical', justification: 'Duplicate IDs could cause data mixups affecting subject safety' },

  // --- Export & Retention ---
  { featureId: 'FEAT-080', feature: 'Data Export (PDF/CSV/XML/ODM)', riskLevel: 'Critical', justification: 'Required for regulatory submission and inspection readiness', part11Section: '11.10(b)' },
  { featureId: 'FEAT-081', feature: 'Audit Trail Export', riskLevel: 'Critical', justification: 'Required for regulatory inspection', part11Section: '11.10(b)' },
  { featureId: 'FEAT-082', feature: 'Record Retention/Retrieval', riskLevel: 'Critical', justification: 'Records must be retrievable for the entire retention period', part11Section: '11.10(b)' },

  // --- Backup & Recovery ---
  { featureId: 'FEAT-090', feature: 'Backup (AES-256 Encrypted)', riskLevel: 'Critical', justification: 'Data loss would be catastrophic for a clinical trial', hipaaSection: '164.308(a)(7)' },
  { featureId: 'FEAT-091', feature: 'Restore/Disaster Recovery', riskLevel: 'Critical', justification: 'Must be able to recover from system failure', hipaaSection: '164.308(a)(7)' },

  // --- Workflow ---
  { featureId: 'FEAT-100', feature: 'SDV Workflow', riskLevel: 'High', justification: 'Source data verification is a GCP requirement for monitoring' },
  { featureId: 'FEAT-101', feature: 'Task Management', riskLevel: 'Medium', justification: 'Workflow convenience; does not directly affect regulated records' },

  // --- Randomization ---
  { featureId: 'FEAT-110', feature: 'Randomization Engine', riskLevel: 'Critical', justification: 'Incorrect randomization directly affects subject safety and trial validity' },

  // --- Reports & Dashboard ---
  { featureId: 'FEAT-120', feature: 'Reports/Analytics Dashboard', riskLevel: 'Medium', justification: 'Read-only presentation of data; source records are the regulated artifacts' },
  { featureId: 'FEAT-121', feature: 'Enrollment Dashboard', riskLevel: 'Medium', justification: 'Monitoring aid; does not modify regulated records' },

  // --- AI Features ---
  { featureId: 'FEAT-130', feature: 'AI Protocol Parsing', riskLevel: 'High', justification: 'AI-generated CRF suggestions must be reviewed by humans before use in regulated trials' },
  { featureId: 'FEAT-131', feature: 'AI Validation Rule Suggestion', riskLevel: 'High', justification: 'AI-suggested rules must be reviewed and approved before application' },

  // --- Integrations ---
  { featureId: 'FEAT-140', feature: 'EHR/FHIR Integration', riskLevel: 'High', justification: 'Imported clinical data must be validated and audit-trailed', hipaaSection: '164.312(e)(1)' },
  { featureId: 'FEAT-141', feature: 'Consent Management', riskLevel: 'Critical', justification: 'Directly affects subject rights and regulatory compliance with 21 CFR 50' },

  // --- HIPAA-specific ---
  { featureId: 'FEAT-150', feature: 'Encryption at Rest', riskLevel: 'Critical', justification: 'ePHI must be encrypted per HIPAA addressable specification', hipaaSection: '164.312(a)(2)(iv)' },
  { featureId: 'FEAT-151', feature: 'Encryption in Transit (TLS)', riskLevel: 'Critical', justification: 'ePHI transmission must be encrypted', hipaaSection: '164.312(e)(1)' },
  { featureId: 'FEAT-152', feature: 'Breach Notification Process', riskLevel: 'Critical', justification: 'Legal obligation under HIPAA Breach Notification Rule', hipaaSection: '164.404' },
];
