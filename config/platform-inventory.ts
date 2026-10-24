import type { EvidenceCategory } from '../runners/evidence-capture';

/**
 * The platform inventory (TA3 plan VAL-1, spec P20 3.7 and VD-7): every
 * computerised system a TA3 use relies on, where its repository is found, the
 * line in its own bytes that states its qualification status, the evidence the
 * platform summary admits for it, and its known gaps with their plan items.
 *
 * Data only. generators/22-platform-validation-summary.ts resolves every
 * repository through collectors/workspace-paths.ts (no path is built here),
 * quotes each statement from the current bytes with the file's SHA-256 and line,
 * and evaluates the probes. A `contains` probe keeps its gap open while the
 * literal is present, an `absent` probe while it is absent; a gap without a
 * probe is stated and re-verified at review. Nothing here is a verdict: the
 * summary never reports a system "qualified".
 *
 * The literals were read at the heads of 2026-10-24 (PLATFORM_INVENTORY_VERSION).
 * tests/cross-repo.contract.test.ts reads them at the sibling heads and fails
 * when a statement moves or a probe stops matching, which forces an update here.
 */

/** The date the statements and probes below were last read at the repository heads. */
export const PLATFORM_INVENTORY_VERSION = '2026-10-24';

/** The EDC workspace under the platform root (the folder holding this framework). */
export const EDC_WORKSPACE_CANDIDATES = ['EDCProject'] as const;

/** EDC workspace repositories that already have a resolver in collectors/workspace-paths.ts,
 * which knows their historical folder names. */
export const EDC_WORKSPACE_RESOLVERS = ['api', 'frontend', 'training', 'interop', 'shared-types'] as const;
export type EdcWorkspaceResolver = typeof EDC_WORKSPACE_RESOLVERS[number];

export type RepositoryLocation =
  /** An EDC workspace repository found by its resolver in collectors/workspace-paths.ts. */
  | { workspaceResolver: EdcWorkspaceResolver }
  /** Candidate paths relative to the EDC workspace, current name first. */
  | { workspaceCandidates: readonly string[] }
  /** Candidate paths relative to the platform root, current name first. */
  | { platformCandidates: readonly string[] };

/** The repository file (posix path from its root) whose first line holding the literal states the qualification status. */
export interface StatementLocator { file: string; literal: string }

export interface GapProbe {
  /** Repository file, posix path from its root. */
  file: string;
  /** contains: the gap is open while the literal is present; absent: while it is absent. */
  rule: 'contains' | 'absent';
  literal: string;
}

export interface InventoryGap {
  /** Unique within its system. */
  id: string;
  text: string;
  /** The plan item that closes it. */
  item: string;
  probe?: GapProbe;
}

/** What a platform-validation-evidence-plan/1 may cite for a system. An entry the
 * system does not admit refuses the plan. */
export interface EvidenceAdmission {
  /** A validation-evidence-package/1, verified with verifyPackage; when categories are
   * named, the verified package must hold evidence of one of them. */
  package?: { categories?: readonly EvidenceCategory[] };
  /** Any other kind, admitted by its SHA-256 alone. */
  hashOnly?: true;
  /** What counts as this system's evidence, as the summary prints it. */
  description: string;
}

export interface PlatformSystem {
  id: string;
  name: string;
  location: RepositoryLocation;
  /** What the system does for the TA3 uses. */
  ta3Uses: readonly string[];
  /** Null when the repository states no qualification status at all. */
  statement: StatementLocator | null;
  evidence: EvidenceAdmission;
  gaps: readonly InventoryGap[];
}

/** The fourteen systems, in the order the summary lists them. */
export const PLATFORM_SYSTEMS = [
  {
    id: 'edc-api', name: 'EDC API', location: { workspaceResolver: 'api' },
    ta3Uses: ['System of record of the TA3 records: deviations (D-03), typed milestones and their measurements, signed-action effort, '
      + 'collection and cleaning latency, frozen cuts, arm lifecycle and TA2 decisions', 'Inspection copies of the trial records'],
    statement: { file: 'docs/change-control-sop-and-fda-readiness.md', literal: '| Status | DRAFT |' },
    evidence: { package: {}, description: 'validation-evidence-package/1 (IQ, OQ and PQ packages of this framework)' },
    gaps: [
      { id: 'production-flags-off', item: 'D-04',
        text: 'The deviation engine, domain events and deviation decisions are off in the production profile until a change-control record and the OQ evidence exist',
        probe: { file: '.env.production.example', rule: 'contains', literal: 'ENABLE_DOMAIN_EVENTS=false' } },
      { id: 'documents-on-container-disk', item: 'N-STORE',
        text: 'Retained TA3 documents are written to container disk; the PostgreSQL copy of their bytes is off in the production profile',
        probe: { file: '.env.production.example', rule: 'contains', literal: 'ENABLE_ARTIFACT_DATABASE_COPY=false' } },
      { id: 'release-identity-operator-input', item: 'VAL-1 (L-2)',
        text: 'The release under test is operator input: GET /health reports only the semantic version, not the API and core releases' },
    ],
  },
  {
    id: 'edc-ui', name: 'EDC UI', location: { workspaceResolver: 'frontend' },
    ta3Uses: ['Screens for the TA3 measurements: milestones and cycle times, latency, interim readiness, arm portfolio and decisions, '
      + 'the enrollment forecast and site lifecycle'],
    statement: { file: 'COMPLIANCE/COMPLIANCE_PLAN.md', literal: 'consolidates all outstanding compliance gaps' },
    evidence: { package: {}, description: 'validation-evidence-package/1 (the packages that qualify the EDC release, UI included)' },
    gaps: [
      { id: 'manual-pq-pending', item: 'VAL-1', text: 'The manual PQ cases PQM-001 to PQM-022 need people and are not executed' },
      { id: 'ci-fails-at-checkout', item: 'VAL-1', text: 'The UI CI backend and compliance jobs fail at checkout (map/repo-edcui.md issue 20)' },
    ],
  },
  {
    id: 'libreclinica-core', name: 'LibreClinica core', location: { workspaceCandidates: ['LibreClinicaCore'] },
    ta3Uses: ['The Java core service and Liquibase schema the EDC database shares'],
    statement: null,
    evidence: { description: 'none: the inventory admits no evidence for the upstream application' },
    gaps: [
      { id: 'upstream-not-qualified', item: 'VAL-1', text: 'The upstream LibreClinica application is not qualified by this platform' },
      { id: 'soap-scope', item: 'VAL-1', text: 'The EDC API keeps SOAP off except /api/import/execute, which calls the core over SOAP' },
    ],
  },
  {
    id: 'training-service', name: 'Training service', location: { workspaceResolver: 'training' },
    ta3Uses: ['Training records and the duty readiness that gates every clinical write on a stack with TRAINING_SERVICE_URL set'],
    statement: { file: 'README.md', literal: 'Deployment qualification and regulatory assessment are still required' },
    evidence: { hashOnly: true, description: 'hash-only (test reports and qualification records)' },
    gaps: [
      { id: 'verification-unsigned', item: 'T-3',
        text: 'Training verification is an unsigned row update unless an EDC-confirmed Part 11 signature is bound to it; '
          + 'the training half of T-3 landed, the EDC half that issues the receipt has not' },
    ],
  },
  {
    id: 'interop-bridge', name: 'Interop middleware', location: { workspaceResolver: 'interop' },
    ta3Uses: ['FHIR R4 reads converted to EDC imports, vendored into the EDC API as a library'],
    statement: { file: 'README.md', literal: 'it has no production EHR or regulatory qualification' },
    evidence: { hashOnly: true, description: 'hash-only (test reports)' },
    gaps: [
      { id: 'vendored-without-receipt', item: 'VAL-1',
        text: 'The EDC API vendors interop build 0.3.0.97319f02 without a receipt (IQ-035 fails on it)' },
    ],
  },
  {
    id: 'shared-types', name: 'Shared types', location: { workspaceResolver: 'shared-types' },
    ta3Uses: ['Build-time contract types the EDC, its UI and the platform services compile against'],
    statement: null,
    evidence: { hashOnly: true, description: 'hash-only (build receipts and test reports)' },
    gaps: [
      { id: 'builds-diverge', item: 'N-STCONVERGE',
        text: 'Consumers pin different builds: five builds across eight consumers on 2026-10-24 (IR-271)' },
      { id: 'tests-not-in-ci', item: 'VAL-1', text: 'The package tests do not run in CI' },
    ],
  },
  {
    id: 'auth-core', name: 'Auth core', location: { workspaceCandidates: ['accura-auth'] },
    ta3Uses: ['Build-time token package (HS256) of the EDC API and its consumers'],
    statement: null,
    evidence: { hashOnly: true, description: 'hash-only (test reports)' },
    gaps: [{ id: 'no-evidence', item: 'VAL-1', text: 'No validation evidence exists for the package' }],
  },
  {
    id: 'intelligence-layer', name: 'Intelligence Layer', location: { platformCandidates: ['IntellegenceLayer/EDCProtocolToECRF'] },
    ta3Uses: ['Protocol extraction, the per-design study build and the deviation spec', 'The eTMF, which files and approves the validation packages, and inspection intake'],
    statement: { file: 'docs/validation/validation-plan.md', literal: '**Status:** Stub' },
    evidence: {
      package: { categories: ['p13'] }, hashOnly: true,
      description: 'p13-qualification-attachment/1 inside a validation-evidence-package/1; hash-only evaluation results',
    },
    gaps: [
      { id: 'independent-review-and-gold-labels', item: 'VAL-1',
        text: 'Validating AI extraction needs independent reviewers and gold-standard labels, which take people\'s time, not code' },
      { id: 'tmf-decisions-attributed', item: 'N-TMFSIG',
        text: 'eTMF governance decisions are attributed by default; one is a Part 11 signature only under IL_TMF_SIGNATURE=required (F01-18, IR-418)',
        probe: { file: 'apps/api/src/projects/inspection-workflow-profile.ts', rule: 'contains', literal: 'environment[\'IL_TMF_SIGNATURE\'] ?? \'attributed\'' } },
    ],
  },
  {
    id: 'semantic-layer', name: 'Clinical Semantic Layer', location: { platformCandidates: ['ClinicalSemanticLayer'] },
    ta3Uses: ['Signed study releases with the deviation spec, custody of the EDC and OSB change streams, arm operations records and reconciliations'],
    statement: { file: 'README.md', literal: 'The full closed loop is not yet qualified.' },
    evidence: { hashOnly: true, description: 'hash-only (test reports and release receipts)' },
    gaps: [
      { id: 'governance-packages-not-production-eligible', item: 'VAL-1', text: 'Governance packages are built as not production eligible',
        probe: { file: 'apps/semantic-api/src/server.ts', rule: 'contains', literal: 'productionEligible: false' } },
      { id: 'production-edc-refused', item: 'D-02', text: 'The semantic layer refuses the production EDC by design; its TA3 evidence comes from test stacks' },
    ],
  },
  {
    id: 'command-center', name: 'Command Center', location: { platformCandidates: ['CommandCenter'] },
    ta3Uses: ['SSO gateway, control plane and readiness plans, the TA1 engine, and the synthetic trial harness that runs the O-7 benchmark'],
    statement: { file: 'README.md', literal: 'These V2 approvals remain prototype-only' },
    evidence: {
      package: { categories: ['benchmark'] },
      description: 'accura-benchmark-qualification/1 inside a validation-evidence-package/1',
    },
    gaps: [
      { id: 'control-plane-off-in-production', item: 'N-CCPROD', text: 'The control plane is off in production by default',
        probe: { file: 'server/config.js', rule: 'contains', literal: 'env.CC_CONTROL_PLANE_PROTOTYPE_ENABLED || (isProduction ? \'false\' : \'true\')' } },
      { id: 'server-tests-not-in-ci', item: 'VAL-1', text: 'The server tests do not run in CI (map/repo-cc.md issue 19)' },
    ],
  },
  {
    id: 'workbench', name: 'Biometrics Workbench', location: { platformCandidates: ['BiometricsWorkbench'] },
    ta3Uses: ['Frozen-cut import and analysis datasets, interim decisions, enrollment forecasts and the nine-metric report'],
    statement: { file: 'src/server.ts', literal: 'qualification:\'research-reference-only\'' },
    evidence: { hashOnly: true, description: 'hash-only (formal qualification records)' },
    gaps: [
      { id: 'printed-name-optional', item: 'VAL-1',
        text: 'A signature carries the signer\'s printed name only when an administrator recorded one, and requires it only under '
          + 'BW_REQUIRE_PRINTED_NAME=true (off by default), TA2 decision authorizations included (21 CFR 11.50)',
        probe: { file: 'src/storage.ts', rule: 'contains', literal: 'process.env.BW_REQUIRE_PRINTED_NAME!==\'true\'' } },
      { id: 'model-providers', item: 'K-3', text: 'Model providers are Bedrock or Anthropic only, against the Azure-only inference policy (BW-19)' },
    ],
  },
  {
    id: 'data-manager-tools', name: 'Data Manager Tools', location: { platformCandidates: ['datamanagertools'] },
    ta3Uses: ['Edit checks on snapshots and the query export a person re-keys into the EDC'],
    statement: { file: 'README.md', literal: '**Not qualified.**' },
    evidence: { hashOnly: true, description: 'hash-only (run dossiers)' },
    gaps: [
      { id: 'not-ready-for-commercial-production', item: 'VAL-1', text: 'The QA register states the tools are not ready for commercial production',
        probe: { file: 'docs/qa-commercial-readiness-2026-10-08.json', rule: 'contains', literal: 'NOT_READY_FOR_COMMERCIAL_PRODUCTION' } },
    ],
  },
  {
    // Read only: the summary only reads repositories, and this fork is never written by the platform lanes.
    id: 'openstudybuilder', name: 'OpenStudyBuilder', location: { platformCandidates: ['OpenSourceBuilder'] },
    ta3Uses: ['The study design graph: arms, regimens and the platform design export'],
    statement: { file: 'README.md', literal: 'until the governed native release package is implemented and validated' },
    evidence: { description: 'none: the inventory admits no evidence until the governed native release package exists' },
    gaps: [{ id: 'native-suites-not-in-ci', item: 'VAL-1', text: 'The native suites do not run in CI (map/repo-osb.md issue 11)' }],
  },
  {
    id: 'validation-framework', name: 'Validation framework', location: { workspaceCandidates: ['accuratrail-validation-framework'] },
    ta3Uses: ['Generates and retains the validation evidence of the EDC release and this summary'],
    statement: { file: 'README.md', literal: 'Programmatic generation of formal validation packages' },
    evidence: { hashOnly: true, description: 'hash-only (its own contract test output)' },
    gaps: [
      { id: 'tool-assurance', item: 'VAL-1',
        text: 'Tool assurance rests on the framework\'s own contract tests; no independent review of the framework exists' },
    ],
  },
] as const satisfies readonly PlatformSystem[];

export type PlatformSystemId = typeof PLATFORM_SYSTEMS[number]['id'];
export const PLATFORM_SYSTEM_IDS: readonly PlatformSystemId[] = PLATFORM_SYSTEMS.map(system => system.id);

/** A production setting a validated change turns on, read from the EDC API's production profile. */
export interface ChangeFlag { flag: 'ENABLE_DEVIATION_ENGINE' | 'ENABLE_DOMAIN_EVENTS' | 'ENABLE_DEVIATION_DECISIONS' }

/** A validated change that waits for change control (spec P20 VD-10). Software creates no
 * change-control record: it lists what the record must cite. */
export interface PendingValidatedChange {
  id: string;
  /** The owner decision that holds the change. */
  decision: string;
  change: string;
  /** The system whose production profile the flags belong to. */
  system: PlatformSystemId;
  /** Its production profile, posix path from the repository root. */
  productionProfile: string;
  flags: readonly ChangeFlag['flag'][];
  /** The OQ suites whose cases the change needs passed at the release to be deployed. */
  oqSuites: readonly number[];
  category: {
    name: string;
    reason: string;
    /** The SOP's category row, quoted from the system's current bytes. */
    sop: StatementLocator;
  };
  status: 'no-change-control-record';
  statusText: string;
}

export const PENDING_VALIDATED_CHANGES: readonly PendingValidatedChange[] = [
  {
    id: 'D-04', decision: 'D-04',
    change: 'Turn on the deviation engine, domain events and deviation decisions in the live trial',
    system: 'edc-api', productionProfile: '.env.production.example',
    flags: ['ENABLE_DEVIATION_ENGINE', 'ENABLE_DOMAIN_EVENTS', 'ENABLE_DEVIATION_DECISIONS'],
    // Detection on save and in the sweep with the follow-up task (13), applicability (14),
    // assessment and independence (15) and escalation (16).
    oqSuites: [13, 14, 15, 16],
    category: {
      name: 'Critical',
      reason: 'It changes e-signature logic (signed deviation assessments, closures and escalation policies), so the System Owner and QA approve it',
      sop: { file: 'docs/change-control-sop-and-fda-readiness.md', literal: '| Critical | Security patches, audit trail changes, e-signature logic | System Owner + QA |' },
    },
    status: 'no-change-control-record',
    statusText: 'No change-control record exists. The record is a person\'s act under SOP-CC-001; this framework creates none.',
  },
];
