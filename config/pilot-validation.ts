import {
  PILOT_ACCEPTANCE_CONTRACT, PILOT_CONTROL_SYSTEMS, PILOT_IMPORT_SWITCH, PILOT_MIN_CRITICAL_INSTANCES, PILOT_PQ_CASES, PILOT_PUBLIC_DATA_BASIS_CONTRACT,
  PILOT_PUBLIC_DATA_SWITCH, PILOT_RECONSTRUCTION_ENTRY, PILOT_STUDY, PUBLIC_DATA_BASIS_NOT_ADMITTED, type Ta3PqCase,
} from './ta3-pq-cases';
import { PILOT_REQUIREMENTS } from './ta3-requirements';

/**
 * The validation plan and system risk assessment of the lab-to-endpoint pilot's intended use (backlog LE-7.2; plan
 * revision 3 section 9 "Computerised-system validation" and section 10). Data only: the pilot validation plan
 * (generators/23-pilot-validation-plan.ts) prints it, and `pilotCslMirror` derives the CSL PR-13 follow-up from the
 * same catalog. The requirements and cases are PILOT_REQUIREMENTS (config/ta3-requirements.ts) and PILOT_PQ_CASES
 * (config/ta3-pq-cases.ts); nothing here restates a pass criterion. Decision ids are those of the backlog's
 * DECISIONS.md (CommandCenter docs/lab-to-endpoint-backlog-2026-11-06).
 */

export const PILOT_PLAN = {
  documentId: 'PVP-CDISCPILOT01-LE',
  backlogItem: 'LE-7.2',
  study: PILOT_STUDY,
  intendedUse: 'The platform is used in the testing estate to run the CDISCPILOT01 lab-to-endpoint pilot: the public CDISC pilot study\'s '
    + 'laboratory, exposure, disposition and medication data are captured through the EDC; CSL holds the signed definitions and runs laboratory '
    + 'reconciliation, findings and decisions in its regional instance; CommandCenter coordinates signed actions and tasks; BiometricsWorkbench '
    + 'derives and quality-controls the endpoint, change from baseline in ALT (U/L) at Week 24 by arm, with ALT above 3x ULN as a secondary flag. '
    + 'People decide every consequential act; the platform writes no participant value.',
  decisionUse: 'A commercial pilot on public data (D-LE-1). It supports no regulatory submission and no decision about a real participant; its '
    + 'acceptance shows that the chain performs for this intended use on real public data and declared synthetic overlays.',
  outOfScope: [
    'The production EDC (D-A9) and any real participant data',
    'Automatic correction of participant data, which plan section 6 excludes rather than defers',
    'An Intelligence Layer extraction on the critical path (D-LE-3); IL is not a pilot leg',
    'External CTMS, IRT or safety systems and the HEALEY platform cases (workstream 8, Stage D)',
    'CDISC CORE for ADaM, which runs only when a pinned release ships adamig rules (OD-18); ADaM is declared not covered and the ADVS key defect is scored as a declared gap',
    'OSB strict and the IL source-fact consumer on R1, which R1 does not claim: the evidence package reports both as not applicable (OD-24)',
    'Scale tiers T1 and T2 (G5, G6), which their own runs measure (LE-2.9, LE-2.11)',
  ],
  data: {
    real: 'CDISCPILOT01 SDTM LB, EX, DS, CM, DM and SV (replayed from the pharmaversesdtm copy, D-LE-1), with ADLBC, ADLBHY and the CSR tables read '
      + 'unchanged by pinned SHA-256 in the evaluator zone only; the unchanged SDTM XPT files staged read-only for CORE V1.0 under pinned SHA-256, never parsed into BW '
      + 'records (OD-19), and the unchanged ADVS read by the standalone key check (OD-22); protocol H2Q-MC-LZZT(c), SAP and blank CRF',
    overlays: 'Declared synthetic overlays, versioned, digested and labelled in every report: consent records and an optional-consent analyte, an '
      + 'amendment at one site or open-label scope, a mid-study range change and a second-site laboratory, a partial date with an untimed dose, a hidden '
      + 'laboratory field and an unblinding event, a per-protocol rule, specimen ids and an ambiguous linkage, corrections, faults and timeouts, the vendor '
      + 'LB Dataset-JSON delivery with faults L1 to L11 and the sealed allocation list (backlog section 5.3)',
    scope: 'All three arms loaded; sites 701 and 710 carry the applicability tests; site 705 for the liver-injury case; arm scope only under the '
      + 'blinded-scope rule (D-LE-12)',
  },
  runs: [
    { run: 'R1', where: 'The one-command local qualification estate (LE-7.1) from one release lockfile, sandbox relaxations off, staged on this '
      + 'workstation\'s 4 GB VM (OD-1). Platform OIDC stays off for the R1 EDC, so the governed lane is reported not exercised, never passed (OD-23)', classification: 'Synthetic engineering evidence (D-LE-14)', keys: 'Mechanical for real cases, builder-declared for '
      + 'overlay cases, sealed before the run (D-LE-21)', when: 'Stage B exit (LE-7.5) and Stage C exit on the R2 lockfile (LE-7.10)' },
    { run: 'R2', where: 'The testing estate (D-A9, LE-0.5), after VERIFY_OK on every leg, pilot flags on by recorded owner decision, named role holders '
      + 'signing', classification: 'Declared-public-data basis the QA owner files (D-LE-14); retained under QA-RETENTION-ROOT, which the QA owner places',
      keys: 'Countersigned by an adjudicator who is not a feature developer (D-LE-21)', when: 'Run of record (LE-7.6)' },
  ],
  evidencePath: `The evaluator scores the replay as it scores any run. The LE-7.3 observer writes the per-case verdicts, their evidence and the sealed key set's manifest and seal record into a directory of its own, under the summary contract ${PILOT_ACCEPTANCE_CONTRACT}, because the scorer's own summary is write-once and compared byte for byte with a fresh scoring. `
    + `The CommandCenter entry ${PILOT_RECONSTRUCTION_ENTRY}, which LE-7.3 owns, reconstructs the scored run the summary names, compares its evaluator, gates and metrics with the summary's, re-hashes every cited file and re-derives the pilot block; until that entry exists an import records every case not executed. This framework imports the directory with --benchmark-run `
    + `while ${PILOT_IMPORT_SWITCH}=true, admits each verdict only with its evidence verified by SHA-256 and seals one validation-evidence-package/1. `
    + 'The framework classifies the package itself: an imported replay run is synthetic engineering evidence unless it is admitted under the declared-public-data basis.',
  retention: 'A package keeps the run summary, the metrics and the SHA-256 of every cited evidence and key set file, not those files. The run directory holds them, so for R2 the QA owner keeps a copy of it '
    + 'under the QA retention root beside the package, and npm run verify:package -- <package> --run-dir <run directory> rechecks every file against the rows before the package is filed: each file a row verified is re-hashed, and each one it refused must still be missing, mismatched or outside as recorded, so the directory of a failed run verifies too.',
  publicDataAdmission: `A package that imports a run is not synthetic only when ${PILOT_IMPORT_SWITCH} and ${PILOT_PUBLIC_DATA_SWITCH} are both exactly true, no other synthetic basis applies, the `
    + 'retain root is inside a tree holding QA-RETENTION-ROOT and outside any synthetic data root, the run summary states runKind R2 with classification '
    + `declared-public-data, and its basisRef and basisSha256 name a ${PILOT_PUBLIC_DATA_BASIS_CONTRACT} record the QA owner filed in that tree (a relative path, links resolved) before the run `
    + `started. The record names study ${PILOT_STUDY}, run kind R2, the decisions D-LE-1 and D-LE-14, the data-use manifest SHA-256, the sealed key set the run states, who filed it, in what role and when. No code creates it or the `
    + 'marker. The package keeps a byte copy (evidence/public-data-basis.json), every summary and document carries the declared public data notice, and npm run verify:package recomputes the rule '
    + `from the retained bytes. An R2 run not so admitted stays synthetic; each of its acceptance cases and controls records ${PUBLIC_DATA_BASIS_NOT_ADMITTED} and G3 records CRITICAL_FAILURE_BOUND_NOT_MET, so a pass is never recorded for an R2 run in a synthetic package. `
    + 'R1 is never admitted, whatever it states. Outcomes do not decide the classification: a failed R2 run is retained the same way.',
  approval: 'The QA owner (James Gui, interim, DECISIONS.md section 3) approves this plan in the eTMF as a governance decision on the filing of the '
    + 'documents package that holds it. The framework signs nothing, and the plan is not in force until that decision exists.',
} as const;

export interface PilotRole {
  role: string;
  holder: string;
  r1Account: string;
  responsibility: string;
}

/** DECISIONS.md section 3 (LE-0.2), with the R1 account names of OD-8. */
export const PILOT_ROLES: readonly PilotRole[] = [
  { role: 'QA owner', holder: 'James Gui (interim)', r1Account: 'le_qa', responsibility: 'Approves this plan and the pilot validation summary in the eTMF; places QA-RETENTION-ROOT and files the declared-public-data basis in that tree for R2' },
  { role: 'Computerised-system validation owner', holder: 'James Gui (interim)', r1Account: 'le_csv', responsibility: 'Runs the framework, files the packages, keeps the requirement-to-test matrix current' },
  { role: 'Owner, approver of record for decisions', holder: 'James Gui', r1Account: 'le_owner', responsibility: 'Records the decisions the pilot cites and switches pilot flags on for R2' },
  { role: 'Clinical data manager', holder: 'James Gui (interim)', r1Account: 'le_cdm', responsibility: 'Lab agreements, identity maps, reconciliations, queries and finalisation (D-P7)' },
  { role: 'Answer-key adjudicator', holder: 'Not assigned', r1Account: 'le_adjudicator', responsibility: 'Seals the keys before each run; for R2 countersigns every key and is not a feature developer (D-LE-21)' },
  { role: 'Blinded statistician', holder: 'Not assigned', r1Account: 'le_stat_blinded', responsibility: 'Reviews pooled outputs only' },
  { role: 'Independent unblinded statistician', holder: 'Not assigned', r1Account: 'le_stat_unblinded', responsibility: 'Confirms the by-arm ALT estimate within the declared tolerance (Stage B exit)' },
  { role: 'Safety owner or medical monitor', holder: 'Not assigned', r1Account: 'le_safety', responsibility: 'Receives potential safety signals (A20)' },
  { role: 'Site or investigator representative, sites 701, 705 and 710', holder: 'Not assigned', r1Account: 'le_site_701, le_site_705, le_site_710', responsibility: 'Corrections with reasons and endorsement (A3, A5, A12)' },
];

/** Plan section 10: one person may hold several roles, never these combinations. */
export const PILOT_FORBIDDEN_COMBINATIONS: readonly string[] = [
  'Blinded statistician and independent unblinded statistician',
  'Feature developer and answer-key author or adjudicator',
  'The author of a decision, query or unlock request and the person who reviews or approves it',
  'The person who files a validation package and the QA lead who approves it',
];

export type Level = 'High' | 'Medium' | 'Low';
export type RiskPriority = 'High' | 'Medium' | 'Low';

/** GAMP 5 risk class from severity and probability (1 highest). */
export function riskClass(severity: Level, probability: Level): 1 | 2 | 3 {
  const table: Record<Level, Record<Level, 1 | 2 | 3>> = {
    High: { High: 1, Medium: 1, Low: 2 },
    Medium: { High: 1, Medium: 2, Low: 3 },
    Low: { High: 2, Medium: 3, Low: 3 },
  };
  return table[severity][probability];
}

/** GAMP 5 risk priority from the risk class and detectability (a failure that is hard to detect raises the priority). */
export function riskPriority(cls: 1 | 2 | 3, detectability: Level): RiskPriority {
  const table: Record<1 | 2 | 3, Record<Level, RiskPriority>> = {
    1: { Low: 'High', Medium: 'High', High: 'Medium' },
    2: { Low: 'High', Medium: 'Medium', High: 'Low' },
    3: { Low: 'Medium', Medium: 'Low', High: 'Low' },
  };
  return table[cls][detectability];
}

/** The critical failure classes of plan section 10; G3 counts failures of these. */
export const CRITICAL_FAILURE_CLASSES = [
  'Wrong participant or specimen linkage',
  'Wrong value or unit in an analysis input',
  'Falsely verified action',
  'Unblinding of a blinded role',
  'Permitted consent-restricted use',
] as const;
export type CriticalFailureClass = typeof CRITICAL_FAILURE_CLASSES[number];

export interface PilotRisk {
  id: string;
  hazard: string;
  /** The critical-to-quality factor (ICH E6(R3) 3.10): a critical failure class, or the quality factor it protects. */
  ctq: CriticalFailureClass | string;
  causes: string;
  effect: string;
  severity: Level;
  probability: Level;
  detectability: Level;
  controls: string;
  cases: readonly string[];
}

/** The system risk assessment of the intended use. Severity is the effect on participant safety, data integrity or the
 * endpoint; probability is judged from the estate as read on 6 and 7 November 2026 (CODE-AND-MAPPINGS sections 6 and 11);
 * detectability is how likely the failure is found before it affects a decision. Class and priority are computed. */
export const PILOT_RISKS: readonly PilotRisk[] = [
  { id: 'PR-R01', hazard: 'A value is attributed to the wrong participant or specimen', ctq: 'Wrong participant or specimen linkage',
    causes: 'Ambiguous identity crosswalk; specimen id reuse; a relabel treated as a new record; label addressing of a CSL-built study (CODE-AND-MAPPINGS D-12 to D-17)',
    effect: 'A wrong ALT value in ADLB and in the by-arm estimate', severity: 'High', probability: 'Medium', detectability: 'Medium',
    controls: 'Ambiguity state refuses linkage (LE-3.8); natural key and key-change detection (LE-3.6); per-event_crf specimen fold; crosswalk conservation in the replay; comparator against ADLBC (LE-6.3)',
    cases: ['PQA-002', 'PQA-006', 'PQA-001', 'PQA-021'] },
  { id: 'PR-R02', hazard: 'A wrong value or unit enters an analysis input', ctq: 'Wrong value or unit in an analysis input',
    causes: 'Unit conversion error; a censored result coerced; a wrong reference range; a wrong baseline or window rule; a derivation defect',
    effect: 'A wrong endpoint or flag', severity: 'High', probability: 'Medium', detectability: 'Medium',
    controls: 'UCUM conversion (LE-3.7); censored values kept as character (D-LE-13); versioned ranges bound at collection (LE-3.5); mandatory independent R QC (LE-6.2); record-by-record comparison with ADLBC (LE-6.3)',
    cases: ['PQA-001', 'PQA-002', 'PQA-013', 'PQA-014', 'PQA-009', 'PQA-021'] },
  { id: 'PR-R03', hazard: 'An action is shown verified when it did not take effect', ctq: 'Falsely verified action',
    causes: 'An unknown outcome treated as success; verification read from the revision that raised the query; a stubbed EDC',
    effect: 'A discrepancy believed resolved stays wrong in the analysis', severity: 'High', probability: 'Medium', detectability: 'Low',
    controls: 'Outcome-unknown state with no path to verified without readback (LE-4.3); action and outcome verification apart (LE-4.4); the real EDC query path on R1 (LE-4.5)',
    cases: ['PQA-005', 'PQA-006', 'PQA-021'] },
  { id: 'PR-R04', hazard: 'A blinded role learns allocation', ctq: 'Unblinding of a blinded role',
    causes: 'A hidden laboratory field in a log, rationale or AI context; by-arm outputs shown to blinded roles; an arm-specific configuration visible to blinded roles',
    effect: 'Bias in decisions about data, deviations and analysis sets', severity: 'High', probability: 'Medium', detectability: 'Low',
    controls: 'Laboratory-field classes by allocation level (LE-5.2); unblinding event record (LE-5.3); per-study unblinded partition (LE-5.4); blinded-configuration check (LE-5.7); pooled impact only (LE-6.6)',
    cases: ['PQA-016', 'PQA-009', 'PQA-007', 'PQA-017', 'PQA-021'] },
  { id: 'PR-R05', hazard: 'A consent-restricted use is permitted', ctq: 'Permitted consent-restricted use',
    causes: 'Unknown consent defaulted to permitted; a restricted join or export not checked; a specimen used before consent',
    effect: 'Use of data without the participant\'s permission', severity: 'High', probability: 'Low', detectability: 'Medium',
    controls: 'Unknown blocks and raises a site query (D-LE-7, LE-5.1); export records and closed purposes (LE-5.6); consent-timing deviation rule (A15)',
    cases: ['PQA-008', 'PQA-015', 'PQA-021'] },
  { id: 'PR-R06', hazard: 'The platform writes a participant value', ctq: 'Attributable participant data',
    causes: 'An admin-write bypass that lets non-EDC values close findings (CODE-AND-MAPPINGS risk 9); automation writing corrections',
    effect: 'Participant data not attributable to the site; corrections outside the EDC', severity: 'High', probability: 'Medium', detectability: 'Medium',
    controls: 'CSL source-system provenance check (CSL-G3); corrections native to the EDC (BW ADR 001); no participant-value effect in inserted workflows (LE-1.2, LE-1.4); A19 census by writer class',
    cases: ['PQA-019'] },
  { id: 'PR-R07', hazard: 'A potential liver-injury signal is delayed', ctq: 'Participant safety signal',
    causes: 'The finding waits in a review queue; the evaluator misses unscheduled draws',
    effect: 'The safety owner learns of the signal late', severity: 'High', probability: 'Low', detectability: 'Medium',
    controls: 'dili-pattern@1 over scheduled and unscheduled draws (LE-1.6); safety routing outside every review queue with a protocol-timeline due time (LE-4.11)',
    cases: ['PQA-020'] },
  { id: 'PR-R08', hazard: 'A signature is not bound to the revision it signed', ctq: 'Signature integrity (21 CFR 11.70)',
    causes: 'A signature stored without the signed revision or its digest; bulk signing; a later change that leaves the signature in force',
    effect: 'A decision or completion that cannot be shown to apply to the record as signed', severity: 'High', probability: 'Low', detectability: 'Low',
    controls: 'One record, one meaning, one signer (D-LE-5); content digest at signing in the EDC (OQ-037, OQ-040, OQ-065); platform-wide signature census',
    cases: ['PQC-003', 'PQA-005', 'PQA-012'] },
  { id: 'PR-R09', hazard: 'Records are lost or cannot be restored', ctq: 'Record retention and availability',
    causes: 'Store failure; a backup never restored; a restore that differs from its source',
    effect: 'Loss of trial records or of the evidence of the run', severity: 'High', probability: 'Low', detectability: 'Low',
    controls: 'Backup of every pilot store; isolated restore test compared by digest, with recovery point and time; sealed, read-only evidence packages, which keep the summary, the metrics and each cited file\'s SHA-256; the R2 run directory holding the cited files, kept under the QA retention root and re-hashed against the rows at filing (verify:package --run-dir)',
    cases: ['PQC-002', 'PQA-010'] },
  { id: 'PR-R10', hazard: 'Unauthorised access or an unlogged account change', ctq: 'Access control and accountability',
    causes: 'A leg accepting a forged, expired or cross-tenant token; a role change with no log; shared accounts',
    effect: 'Actions that cannot be attributed, or data seen by the wrong person', severity: 'High', probability: 'Low', detectability: 'Medium',
    controls: 'Authentication and study scope on every leg; CC verified site ids (D-S1); access and account-change logs in every application, with the census comparing them with the declared accounts in both directions',
    cases: ['PQC-001', 'PQC-004'] },
  { id: 'PR-R11', hazard: 'The answer key is contaminated or written after the run', ctq: 'Independence of acceptance evidence',
    causes: 'The CDISC files are public, so a product could read ADLBC or the key; a key written or changed after the run; a developer adjudicating',
    effect: 'Acceptance that proves nothing', severity: 'High', probability: 'Medium', detectability: 'High',
    controls: 'Key isolation checked in code (LE-3.2, D-81); keys sealed and hashed before the run; the run cites the key set manifest and seal record, and the import reads the key set id, seal time, N, held cases and countersignatures from those bytes, so it refuses a key sealed at or after the run start, a key set that does not exist and a held case; R2 keys countersigned by a non-developer, recorded in the manifest (D-LE-21), and the R2 basis names the manifest before the run',
    cases: ['PQA-021'] },
  { id: 'PR-R12', hazard: 'A replaceable component changes after its evidence was taken', ctq: 'Validated state',
    causes: 'A new commit of a leg, a rule package or definition, the CORE version, the R runtime, a parser or model',
    effect: 'Evidence that no longer describes the running system', severity: 'Medium', probability: 'High', detectability: 'Medium',
    controls: 'One release lockfile per run; the run states its releases; the revalidation triggers below; a dirty framework checkout is never a run of record',
    cases: ['PQA-010', 'PQA-011'] },
  { id: 'PR-R13', hazard: 'An amendment changes collected data or a site outside its scope', ctq: 'Protocol version per site',
    causes: 'Template propagation rewriting collected instances; activation not scoped; a new requirement without a dependency edge',
    effect: 'Collected answers change meaning; sites run an unapproved version', severity: 'High', probability: 'Medium', detectability: 'Medium',
    controls: 'Instance form amendments (LE-4.10); impact assessment chain with scoped activation (LE-4.9)',
    cases: ['PQA-004', 'PQA-007'] },
  { id: 'PR-R14', hazard: 'Standards or rule coverage is overstated', ctq: 'Truthful validation coverage',
    causes: 'A skipped or erroring rule counted as verified; a coverage gap reported as pass',
    effect: 'Nonconformance that nobody looked for', severity: 'Medium', probability: 'Medium', detectability: 'Medium',
    controls: 'Issues, execution errors, skips and verified coverage counted apart (LE-6.8, LE-6.11); a defect is not covered only when the rule manifest shows no selected rule scope can include it (OD-18); incomplete coverage gives inconclusive, never pass',
    cases: ['PQA-011', 'PQA-018'] },
  { id: 'PR-R15', hazard: 'Deviations or analysis sets are decided by automation or after unblinding', ctq: 'Noncompliance handling',
    causes: 'Importance set by a rule without a person; an analysis-set decision after unblinding; a consent-timing breach missed',
    effect: 'Biased analysis sets; unreported important deviations', severity: 'High', probability: 'Low', detectability: 'Medium',
    controls: 'Candidates with importance unassessed and a named person\'s confirmation (LE-4.7); analysis-set determinations timed against unblinding; single producer of consent-timing and window deviations (LE-1.6)',
    cases: ['PQA-017', 'PQA-015', 'PQA-018'] },
];

export interface RevalidationTrigger {
  change: string;
  rerun: readonly string[];
}

/** Plan section 9: revalidation whenever a replaceable component changes. Each change names the acceptance cases to re-run
 * before the changed component is relied on; any change of a leg's commit moves the run to a new release lockfile. */
export const PILOT_REVALIDATION_TRIGGERS: readonly RevalidationTrigger[] = [
  { change: 'Any leg\'s commit in the release lockfile (EDC, CSL, CC, BW) or this framework', rerun: ['R1 on the new lockfile: every case of the stage already passed'] },
  { change: 'CSL definitions, mapping rules or rule packages (laboratory profile, range sets, UCUM essence, dili-pattern@1, schedule check)', rerun: ['A1', 'A2', 'A13', 'A18', 'A20', 'G3'] },
  { change: 'The EDC deviation specification or deviation engine', rerun: ['A15', 'A17'] },
  { change: 'The BW standards package, derivation, R runtime image or QC program', rerun: ['A1', 'A9', 'A10', 'A14'] },
  { change: 'The CORE V1.0 engine image, rule cache or CT package (LE-6.10), or ADaM or Define-XML rules adopted by pinned commit (LE-6.15)', rerun: ['A11'] },
  { change: 'The answer keys or their rules', rerun: ['Reseal before the run; every case the key covers', 'G3'] },
  { change: 'An IL parser, model or prompt', rerun: ['None for this intended use (IL is not a pilot leg, D-LE-3); any IL use enters only after the held-out evaluation re-runs (plan section 9)'] },
  { change: 'A pilot flag or CSL feature allowlist', rerun: ['The cases of the features it enables, from the CSL PR-13 mirror', 'Security (PQC-001)'] },
];

/** The CSL PR-13.A row that requires the acceptance cases no single CSL module feature owns, so that the matrix leaves none of
 * A1 to A20 unscored (the backlog row says A1 to A20). A CSL feature's status comes only from its required cases, so a case
 * on no row is required by nothing. The row depends on every feature that carries a case and enables nothing, as the
 * matrix never does; semantic-read, which every other feature depends on, gives it its allowlist scope. */
export const PILOT_CSL_CHAIN_ROW = {
  featureId: 'PR-13-LAB-TO-ENDPOINT',
  moduleFeature: 'semantic-read',
  intendedUse: 'The CDISCPILOT01 lab-to-endpoint chain accepted as a whole: the acceptance cases that run through the EDC, BW or the observer rather than one CSL module feature.',
} as const;

/** The CSL PR-13 pilot feature each acceptance case runs through (CSL apps/semantic-api/src/semantic-module/pilot-service.ts
 * PILOT_FEATURE_DEFINITIONS_V1), or, with the reason, the chain row. CSL owns the edit; this is the mapping it takes. */
export const PILOT_CSL_FEATURES: Readonly<Record<string, { features: readonly string[]; reason?: string }>> = {
  A1: { features: ['PR-05'] },
  A2: { features: ['PR-06'] },
  A3: { features: ['PR-06'] },
  A4: { features: ['PR-12'], reason: 'The overlay amendment enters through PR-12 scoped adoption; the EDC keeps the form versions (LE-4.10)' },
  A5: { features: ['PR-11'] },
  A6: { features: ['PR-06', 'PR-11'] },
  A7: { features: ['PR-12'] },
  A8: { features: ['PR-05'], reason: 'The CSL regional plane refuses restricted uses under the PR-01 data-use policy, a task PR-05 depends on; BW and the EDC enforce the rest' },
  A9: { features: [], reason: 'BW scoped analysis version (LE-6.6)' },
  A10: { features: [], reason: 'BW analysis release and reproduction gate (LE-6.4)' },
  A11: { features: [], reason: 'BW CORE V1.0 runner and finding trace (LE-6.11, LE-6.8)' },
  A12: { features: [], reason: 'EDC finalisation record (LE-5.5)' },
  A13: { features: ['PR-07'] },
  A14: { features: [], reason: 'BW derivation (LE-6.2)' },
  A15: { features: [], reason: 'EDC deviation engine is the single producer (LE-1.6); CSL authors the specification only' },
  A16: { features: ['PR-07-display'] },
  A17: { features: [], reason: 'EDC deviation engine and BW analysis sets (LE-4.7)' },
  A18: { features: ['PR-07'] },
  A19: { features: [], reason: 'Observer census across stores (LE-7.3), not a CSL module feature' },
  A20: { features: ['PR-07', 'PR-08'] },
};

export interface CslMirrorCase {
  caseId: string;
  frameworkCaseId: string;
  requirementId: string;
  stage: string;
  title: string;
  passesWhen: string;
}

export interface CslMirror {
  contract: 'accura-pilot-csl-pr13-mirror/1';
  generatedFrom: string;
  instruction: string;
  features: { featureId: string; addCases: CslMirrorCase[] }[];
  /** A new matrix row for the cases no single feature owns; with features, every one of A1 to A20 is required. */
  chainRow: { featureId: string; moduleFeature: string; intendedUse: string; dependencies: string[]; addCases: (CslMirrorCase & { reason: string })[] };
  scenarioResultBasis: string;
}

/** The CSL PR-13 mirror of the acceptance cases, derived from the catalog (the follow-up for the CSL lane). */
export function pilotCslMirror(): CslMirror {
  const acceptanceCases = PILOT_PQ_CASES.filter(entry => /^A\d+$/.test(entry.acceptanceCase ?? ''));
  const entry = (pqCase: Ta3PqCase): CslMirrorCase => ({
    caseId: pqCase.acceptanceCase!, frameworkCaseId: pqCase.id, requirementId: pqCase.requirement, stage: pqCase.stage!,
    title: pqCase.title, passesWhen: pqCase.passesWhen,
  });
  const byFeature = new Map<string, CslMirrorCase[]>();
  const chainCases: (CslMirrorCase & { reason: string })[] = [];
  for (const pqCase of acceptanceCases) {
    const mapping = PILOT_CSL_FEATURES[pqCase.acceptanceCase!];
    if (!mapping) throw new Error(`${pqCase.acceptanceCase} has no CSL feature mapping.`);
    if (!mapping.features.length) {
      if (!mapping.reason) throw new Error(`${pqCase.acceptanceCase} is on the chain row with no reason.`);
      chainCases.push({ ...entry(pqCase), reason: mapping.reason });
    }
    for (const featureId of mapping.features) byFeature.set(featureId, [...(byFeature.get(featureId) ?? []), entry(pqCase)]);
  }
  const features = [...byFeature.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([featureId, addCases]) => ({ featureId, addCases }));
  return {
    contract: 'accura-pilot-csl-pr13-mirror/1',
    generatedFrom: 'accuratrail-validation-framework config/pilot-validation.ts pilotCslMirror (PILOT_PQ_CASES, PILOT_REQUIREMENTS)',
    instruction: 'For each feature, append each caseId to that feature\'s cases in PILOT_FEATURE_DEFINITIONS_V1 (CSL apps/semantic-api/src/semantic-module/pilot-service.ts), '
      + 'and add chainRow as one more entry of that list (feature = moduleFeature, dependencies, cases = its caseIds, no limitations), so the PR-13.A matrix requires every one of A1 to A20. '
      + 'The caseId is the plan revision 3 acceptance case id, unchanged. Record each result as a PilotScenarioResultRecordV1 '
      + 'with basis real-source only from a package admitted under the declared-public-data basis (R2), naming the validation package manifest SHA-256 and '
      + 'evidence/benchmark/<frameworkCaseId>.json in evidenceRefs; an R1 result or any other synthetic package result is basis fixture.',
    features,
    chainRow: { ...PILOT_CSL_CHAIN_ROW, dependencies: features.map(feature => feature.featureId), addCases: chainCases },
    scenarioResultBasis: `R1 is synthetic engineering evidence (D-LE-14); its results enter CSL as basis fixture. R2 results from a package admitted under the declared-public-data basis enter as real-source. The pilot import admits ${PILOT_CONTROL_SYSTEMS.join(', ')} control results only from the reconstructed run.`,
  };
}

/** Every pilot case paired with its requirement; a case without one, or a requirement citing another case, is a defect. */
export function pilotTraceability(): { pqCase: Ta3PqCase; requirementId: string; frsId: string; title: string }[] {
  return PILOT_PQ_CASES.map(pqCase => {
    const requirement = PILOT_REQUIREMENTS.find(candidate => candidate.id === pqCase.requirement);
    if (!requirement) throw new Error(`${pqCase.id} names ${pqCase.requirement}, which PILOT_REQUIREMENTS lacks.`);
    const cited = requirement.planned.flatMap(item => item.cases);
    if (cited.length !== 1 || cited[0] !== pqCase.id) throw new Error(`${requirement.id} cites ${cited.join(', ') || 'nothing'}, not ${pqCase.id}.`);
    return { pqCase, requirementId: requirement.id, frsId: requirement.frs.id, title: requirement.title };
  });
}

export const PILOT_G3 = {
  minimumN: PILOT_MIN_CRITICAL_INSTANCES,
  statement: 'G3 holds when the run of record shows zero critical failures in N scored critical case instances across A1 to A20, N fixed in the sealed key '
    + `before the run and at least ${PILOT_MIN_CRITICAL_INSTANCES}; the report states the 95% upper bound 3/N (below 1% at N = 300) and never a universal accuracy claim.`,
} as const;
