/**
 * Regulatory scope assessment data.
 * This configuration file IS the data source for the Part 11/HIPAA applicability assessment.
 * Edit when regulatory scope changes.
 */

export interface RegulatoryRecord {
  id: string;
  name: string;
  description: string;
  regulated: boolean;
  dataClassification: 'ePHI' | 'PII' | 'clinical' | 'administrative' | 'system';
  retentionYears: number;
}

export interface PredicateRule {
  citation: string;
  title: string;
  applicability: string;
}

export const REGULATORY_SCOPE = {
  part11Applicable: true,
  hipaaApplicable: true,
  electronicSignaturesUsed: true,
  ephiPresent: true,

  part11Justification:
    'The system creates, modifies, maintains, archives, retrieves, and transmits ' +
    'electronic records required by FDA predicate rules (21 CFR 312, 812). It uses ' +
    'electronic signatures to satisfy signature requirements in those predicate rules. ' +
    'Therefore 21 CFR Part 11 applies in full (Subparts B and C).',

  hipaaJustification:
    'The system stores, processes, and transmits individually identifiable health information ' +
    '(patient names, dates of birth, medical history, diagnoses, lab values) in electronic form. ' +
    'This constitutes electronic Protected Health Information (ePHI) under HIPAA. ' +
    'Therefore the HIPAA Security Rule (45 CFR 164.302-318) and Privacy Rule apply.',

  regulatedRecords: [
    { id: 'REC-001', name: 'Electronic Case Report Forms (eCRFs)', description: 'Clinical data entry forms with field-level audit trails', regulated: true, dataClassification: 'ePHI', retentionYears: 15 },
    { id: 'REC-002', name: 'Audit Trail Records', description: 'Computer-generated, timestamped log of all data changes including who, what, when, old value, new value, reason', regulated: true, dataClassification: 'system', retentionYears: 15 },
    { id: 'REC-003', name: 'Electronic Signatures', description: 'Two-component e-signatures (username + password) with printed name, date/time, and meaning', regulated: true, dataClassification: 'system', retentionYears: 15 },
    { id: 'REC-004', name: 'Study Configuration Records', description: 'Study definitions, visit schedules, CRF assignments, site configurations', regulated: true, dataClassification: 'clinical', retentionYears: 15 },
    { id: 'REC-005', name: 'Subject/Patient Records', description: 'Subject enrollment, demographics, study assignment, visit status', regulated: true, dataClassification: 'ePHI', retentionYears: 15 },
    { id: 'REC-006', name: 'Data Queries', description: 'Clinical data queries, responses, resolutions with audit trail', regulated: true, dataClassification: 'clinical', retentionYears: 15 },
    { id: 'REC-007', name: 'Data Lock/Freeze Records', description: 'Casebook freeze and lock status, unlock requests', regulated: true, dataClassification: 'clinical', retentionYears: 15 },
    { id: 'REC-008', name: 'Validation Rules', description: 'Edit checks and validation logic applied to data entry', regulated: true, dataClassification: 'clinical', retentionYears: 15 },
    { id: 'REC-009', name: 'Data Exports', description: 'PDF, CSV, XML, ODM exports of clinical data', regulated: true, dataClassification: 'ePHI', retentionYears: 15 },
    { id: 'REC-010', name: 'User Access Records', description: 'User accounts, roles, permissions, login/logout history', regulated: true, dataClassification: 'system', retentionYears: 6 },
    { id: 'REC-011', name: 'Workflow/Task Records', description: 'Task assignments, SDV workflow, DDE workflow, review workflow', regulated: true, dataClassification: 'clinical', retentionYears: 15 },
    { id: 'REC-012', name: 'Randomization Records', description: 'Subject randomization assignments, sealed allocation lists', regulated: true, dataClassification: 'clinical', retentionYears: 15 },
    { id: 'REC-013', name: 'Source Data Verification Records', description: 'SDV status, monitor verification workflow', regulated: true, dataClassification: 'clinical', retentionYears: 15 },
    { id: 'REC-014', name: 'Backup/Recovery Records', description: 'Encrypted backup manifests, restore verification', regulated: true, dataClassification: 'system', retentionYears: 6 },
    { id: 'REC-015', name: 'Training Records', description: 'Role-based training completion records', regulated: true, dataClassification: 'administrative', retentionYears: 6 },
  ] as RegulatoryRecord[],

  predicateRules: [
    { citation: '21 CFR 312', title: 'Investigational New Drug Application', applicability: 'Clinical trial data submission for drug/biologic investigations' },
    { citation: '21 CFR 812', title: 'Investigational Device Exemptions', applicability: 'Clinical trial data for medical device investigations' },
    { citation: '21 CFR 50', title: 'Protection of Human Subjects (Informed Consent)', applicability: 'Electronic consent records and documentation' },
    { citation: '21 CFR 56', title: 'Institutional Review Boards', applicability: 'IRB submission documentation and approval records' },
    { citation: '21 CFR 11', title: 'Electronic Records; Electronic Signatures', applicability: 'Directly applicable — governs all electronic records and signatures' },
    { citation: '21 CFR 54', title: 'Financial Disclosure by Clinical Investigators', applicability: 'Investigator financial disclosure records if managed in system' },
    { citation: 'ICH E6(R2)', title: 'Good Clinical Practice', applicability: 'Source data integrity, monitoring, audit trail requirements' },
    { citation: '45 CFR 164 Subpart C', title: 'HIPAA Security Rule', applicability: 'Technical, administrative, and physical safeguards for ePHI' },
    { citation: '45 CFR 164 Subpart D', title: 'HIPAA Breach Notification Rule', applicability: 'Breach notification procedures for ePHI' },
    { citation: '45 CFR 164 Subpart E', title: 'HIPAA Privacy Rule', applicability: 'Use and disclosure limitations for PHI' },
  ] as PredicateRule[],

  eSignatureDetails: {
    method: 'Two-component: username verification + password re-authentication',
    components: ['Printed full name of signer', 'Date and time of signing (UTC)', 'Meaning/purpose of signature'],
    linkage: 'Cryptographic hash linking signature to the exact record version signed',
    nonRepudiation: true,
    fdaCertificationRequired: true,
  },

  ephiFields: [
    'Patient/subject names',
    'Dates of birth',
    'Medical record numbers',
    'Diagnoses and medical history',
    'Lab values and vital signs',
    'Adverse event descriptions',
    'Concomitant medications',
    'Physical examination findings',
    'Treatment assignments (unblinded)',
    'Contact information (if collected)',
  ],
} as const;
