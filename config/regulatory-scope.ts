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

/**
 * ICH E6(R3), the GCP guideline every generated document cites. Generators cite
 * it only through this mapping: `ICH_E6_R3.citation` for a general mention and
 * `e6r3(key)` for a topic. The section numbers are the analyst's reading of the
 * ICH Step 4 text (TA3 plan VAL-1), which no retained copy pins yet, so they stay
 * pending QA verification and every document states that; a correction is one
 * edit here.
 */
export const ICH_E6_R3 = {
  citation: 'ICH E6(R3)',
  title: 'Guideline for Good Clinical Practice, Principles and Annex 1',
  step: 'ICH Step 4, 6 January 2025',
  sectionVerification: 'pending-qa',
} as const;

/** The verification status every generated document states for the section references. */
export const E6_R3_SECTION_STATUS = 'Pending QA verification against the ICH Step 4 text';

export const E6_R3_REFERENCES = {
  gcp: { topic: 'Good clinical practice (general)', section: 'Principles and Annex 1' },
  auditTrails: { topic: 'Audit trails', section: 'Annex 1, 4.2.2 Relevant metadata, including audit trails' },
  dataCorrections: { topic: 'Data corrections', section: 'Annex 1, 4.2.4 Data corrections' },
  signatures: { topic: 'Electronic signatures', section: 'Annex 1, 4.2.2 and 4.3 Computerised systems' },
  dataCapture: { topic: 'Data capture and records', section: 'Annex 1, 4.2.1 Data capture; 3.16 Data and records' },
  protocolAndRecords: {
    topic: 'Protocol, amendments and essential records',
    section: 'Appendix B (protocol and amendments); Appendix C (essential records)',
  },
  reviewOfData: { topic: 'Review of data', section: 'Annex 1, 4.2.3 Review of data and metadata' },
  validation: { topic: 'Computerised system validation', section: 'Annex 1, 4.3.4 Validation' },
  essentialRecords: { topic: 'Essential records', section: 'Appendix C' },
  training: {
    topic: 'Qualification and training',
    section: 'Annex 1, 2.1 and 3.4 (qualification and training); 4.3.2 Training',
  },
  nonCompliance: { topic: 'Noncompliance (protocol deviations)', section: 'Annex 1, 3.12 Noncompliance' },
  qualityManagement: {
    topic: 'Quality management',
    section: 'Annex 1, 3.10 Quality management; 3.11 Quality assurance and quality control',
  },
  blinding: { topic: 'Blinding', section: 'Annex 1, 4.1 Safeguard blinding in data governance' },
  retention: { topic: 'Retention and access', section: 'Annex 1, 4.2.7 Retention and access' },
} as const;

export type E6R3Key = keyof typeof E6_R3_REFERENCES;

/** The citation of one mapped topic, for example "ICH E6(R3) Annex 1, 4.2.4 Data corrections". */
export function e6r3(key: E6R3Key): string {
  const reference = E6_R3_REFERENCES[key];
  if (!reference) throw new Error(`No ICH E6(R3) reference is mapped for ${JSON.stringify(key)}.`);
  return `${ICH_E6_R3.citation} ${reference.section}`;
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
    { citation: ICH_E6_R3.citation, title: `${ICH_E6_R3.title} (${ICH_E6_R3.step})`, applicability: `Data governance and computerised systems, data integrity, audit trails, essential records and noncompliance. Section references: ${E6_R3_SECTION_STATUS}` },
    { citation: 'FDA draft guidance (December 2024)', title: 'Protocol Deviations for Clinical Investigations of Drugs, Biological Products, and Devices', applicability: 'Classification and importance of protocol deviations recorded in the deviation log' },
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
