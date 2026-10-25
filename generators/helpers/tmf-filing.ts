import { evidenceNoticeLines } from '../../runners/evidence-capture';
import { markdownTable } from './markdown-writer';

/** Written into every retained evidence package before it is sealed (spec P20 3.2, VD-4). */
export const TMF_FILING_FILE = 'TMF-FILING.md';

/** The first line of the filing instructions of a synthetic package. */
export const SYNTHETIC_FILING_LINE = 'SYNTHETIC: file only in an IL project on a test stack to show the mechanics; never in a production TMF.';

/** The first line of the filing instructions of a package whose framework checkout was
 * dirty, unreadable or changed during the run (--allow-dirty-framework, IR-056). */
export const NOT_RUN_OF_RECORD_LINE = 'NOT A RUN OF RECORD: framework checkout dirty or changed during the run';

/** The first line of the filing instructions of a package that retains the training module's
 * privileged inspection capture (IR-453; accura-training-module README, "Training evidence in
 * the existing inspection copy": it includes retained material and assessment answer keys). */
export const RESTRICTED_FILING_LINE = 'RESTRICTED: this package holds the training module\'s privileged inspection capture, with assessment answer keys (inputs/training-evidence.json, evidence/training/). Keep it where only holders of training inspection authority read it, and never upload those files.';

/** A package file that holds the training capture: --training-evidence retained as an input,
 * or the copy generator 15 keeps under evidence/training/. */
export function isTrainingCaptureFile(relative: string): boolean {
  return relative === 'inputs/training-evidence.json' || relative.startsWith('evidence/training/');
}

/** The eTMF policy requirement to propose when the platform policy has none. The
 * eTMF has no default catalog, so a person proposes it and another approves it. */
export const VALIDATION_PACKAGE_REQUIREMENT = {
  requirementId: 'computerised-system-validation-package',
  title: 'Computerised system validation package',
  scope: { level: 'platform' },
  documentKind: 'REGULATORY',
  expiryRequired: false,
  externalOriginRequired: false,
} as const;

export interface TmfFilingFacts {
  packageId: string;
  version: string;
  synthetic: boolean;
  /** The framework checkout was dirty, unreadable or changed during the run. */
  notRunOfRecord?: boolean;
  /** The package retains the training module's privileged inspection capture. */
  restricted?: boolean;
}

/** The filing instructions: static text plus the package ID, version and synthetic
 * flag. The framework never files or signs; every step below is a person's act in
 * the Intelligence Layer eTMF. The manifest hash cannot appear here, because this
 * file is one of the files the manifest hashes. */
export function tmfFilingText(facts: TmfFilingFacts): string {
  const requirement = VALIDATION_PACKAGE_REQUIREMENT;
  const lines: string[] = [
    ...(facts.restricted ? [RESTRICTED_FILING_LINE, ''] : []),
    ...(facts.notRunOfRecord ? [NOT_RUN_OF_RECORD_LINE, ''] : []),
    ...(facts.synthetic ? [SYNTHETIC_FILING_LINE, ''] : []),
    ...evidenceNoticeLines({ synthetic: facts.synthetic, retained: true }),
    `# eTMF Filing of Validation Evidence Package ${facts.packageId}`,
    '',
    markdownTable(['Field', 'Value'], [
      ['Package ID', facts.packageId],
      ['Version', facts.version],
      ['Synthetic', facts.synthetic ? 'yes: synthetic engineering evidence' : 'no'],
      ['Package contract', 'validation-evidence-package/1'],
      ['Filed record', 'package-manifest.json'],
    ]),
    'The validation framework never files and never signs. Approval of this package is a person\'s act, recorded in the '
      + 'eTMF as a governance decision on the filing of package-manifest.json. No file in this package carries a signature.',
    '',
    facts.synthetic
      ? 'This package holds synthetic engineering evidence. File it, if at all, only in an IL project on a test stack to '
        + 'show the mechanics. A filing there is not QA approval of a real system.'
      : 'Only a package that is not synthetic is filed in the platform\'s production TMF.',
    '',
    '## 1. Verify the package bytes',
    '',
    'In the validation framework checkout run `npm run verify:package -- <this package directory>`. It exits 0 only when '
      + 'every file package-manifest.json lists is present with its byte count and SHA-256, no other file is present and '
      + 'the package hash recomputes, and it then prints the SHA-256 of package-manifest.json. Do not file a package that '
      + 'fails this check.',
    '',
    'That SHA-256 is the contentHash the eTMF must show for the uploaded package-manifest.json (the SHA-256 of its raw '
      + 'bytes). The validation lead checks it before filing and before proposing the assignment; the QA lead checks it '
      + 'again before approving.',
    '',
    '## 2. Upload the documents',
    '',
    'Upload these files of this package to the platform\'s IL project (`POST /api/projects/:projectId/documents`, role '
      + 'ADMIN or BUILDER), each as document kind REGULATORY. Never use kind OTHER, which feeds the study build.',
    '',
    markdownTable(['File', 'Purpose'], [
      ['package-manifest.json', 'The filed record: every file of the package with its byte count and SHA-256, and the package hash'],
      ['12-validation-summary.md', 'For reading'],
      ['22-platform-validation-summary.md', 'For reading, when this package holds it'],
    ]),
    ...(facts.restricted ? ['Upload no other file of this package: inputs/training-evidence.json and the files under '
      + 'evidence/training/ hold the privileged training capture and stay with the package.', ''] : []),
    '**Do not start an extraction run on these documents.** A run started on a REGULATORY document dispatches the '
      + 'reference extraction families.',
    '',
    '## 3. File them at platform scope',
    '',
    'The validation lead prepares and files the uploaded documents at platform scope '
      + '(`POST /api/projects/:projectId/tmf/filings`).',
    '',
    '## 4. QC review by a different person',
    '',
    'A QA lead, a different person who holds the IL REVIEWER role, accepts the filing in QC review '
      + '(`POST /api/projects/:projectId/tmf/filings/:filingId/reviews`). The filer cannot review the filing.',
    '',
    '## 5. The policy requirement',
    '',
    'When the platform\'s TMF policy has no requirement for this package, a person proposes a policy revision that adds '
      + 'it and a different person approves that revision. The eTMF has no default catalog.',
    '',
    markdownTable(['Member', 'Value'], [
      ['requirementId', requirement.requirementId],
      ['title', requirement.title],
      ['scope', JSON.stringify(requirement.scope)],
      ['documentKind', requirement.documentKind],
      ['expiryRequired', String(requirement.expiryRequired)],
      ['externalOriginRequired', String(requirement.externalOriginRequired)],
      ['tmfReference', 'none until the TMF Reference Model is pinned (plan item W-2)'],
    ]),
    '## 6. Propose the document assignment, without provenance',
    '',
    'After checking that the filed package-manifest.json document\'s contentHash equals the SHA-256 step 1 printed, the '
      + 'validation lead proposes the governance `document` action that assigns it to the requirement '
      + '(`POST /api/projects/:projectId/tmf/governance/proposals`), without `provenance`. None is needed while the '
      + 'requirement sets externalOriginRequired to false, and the filed document\'s contentHash already binds the '
      + 'manifest bytes. A provenance object would need all eight members (system, tenantId, studyId, scope, recordId, '
      + 'version, contentHash, receiptDocumentId) and a separately uploaded intelligence-tmf-source-reconciliation/1 '
      + 'receipt naming the IL tenant, project, study and filed document, which the validation framework cannot know '
      + 'when it writes the package.',
    '',
    '## 7. QA approval',
    '',
    'The QA lead rechecks the contentHash against the SHA-256 from step 1 and approves the assignment with the TMF '
      + 'decision signature (`POST /api/projects/:projectId/tmf/governance/proposals/:proposalId/decisions`). The '
      + 'proposer and the uploader cannot decide. The decision is a Part 11 signature only where the IL runs with '
      + 'IL_TMF_SIGNATURE=required; under the default, attributed, it is not one.',
    '',
    '## Who does what',
    '',
    markdownTable(['Person', 'Acts'], [
      ['Validation lead', 'Verifies the package, uploads and files the documents, proposes the assignment'],
      ['QA lead (a different person, IL REVIEWER role)', 'Accepts the filing in QC review, rechecks the hash, approves the assignment with signature'],
    ]),
  ];
  return `${lines.join('\n').trimEnd()}\n`;
}
