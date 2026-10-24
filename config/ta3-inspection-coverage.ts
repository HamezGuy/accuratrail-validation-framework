/**
 * W-1's own TA3 inventory of the EDC inspection copy (spec P17 2.2.1), the list
 * OQ-241 and OQ-242 judge the copy against (TA3 plan VAL-1, spec P20 3.4 suite
 * 18). Data only. The 39 tables are appended, in this order, at the end of the
 * EDC's INSPECTION_STORES with `ta3: true`; tables 17 and 18 are in the segmented
 * representation (edc-inspection-copy/3) only. The late block follows in the
 * order its migrations land, each table once its owning item's DDL is on main,
 * so a late table is required in a copy only when the run observed that item's
 * feature. npm run test:cross-repo checks every non-late table against an EDC
 * CREATE TABLE statement and, once W-1 has landed, this list against the EDC's
 * `ta3: true` declarations.
 */

export interface Ta3CoverageTable {
  table: string;
  /** Only in the segmented representation (P17 2.2.2). */
  segmentedOnly?: true;
  /** A late extension (W-1/edcapi-late) and the plan item that owns its table. */
  late?: { item: string };
}

export const TA3_INSPECTION_COVERAGE: readonly Ta3CoverageTable[] = [
  { table: 'acc_deviation_specs' },
  { table: 'acc_deviation_spec_sources' },
  { table: 'acc_deviation_configuration_witnesses' },
  { table: 'acc_deviation_rule_activations' },
  { table: 'acc_deviation_rule_id_map' },
  { table: 'acc_deviation_form_aliases' },
  { table: 'acc_deviation_provenance' },
  { table: 'acc_deviation_anchor_bindings' },
  { table: 'acc_deviation_assessment_bindings' },
  { table: 'acc_deviation_assessment_coverage' },
  { table: 'acc_protocol_version_applicability' },
  { table: 'acc_deviation_rule_outcomes' },
  { table: 'acc_deviation_outcome_history' },
  { table: 'acc_deviation_evaluation_request' },
  { table: 'acc_deviation_evaluation_trigger' },
  { table: 'acc_deviation_evidence_schema' },
  { table: 'acc_deviation_evaluations', segmentedOnly: true },
  { table: 'acc_deviation_evidence_blobs', segmentedOnly: true },
  { table: 'acc_operational_milestone_event' },
  { table: 'acc_effort_interval' },
  { table: 'acc_retained_document' },
  { table: 'acc_latency_measurement' },
  { table: 'acc_data_cut' },
  { table: 'acc_data_cut_dataset' },
  { table: 'acc_data_cut_treatment_release' },
  { table: 'acc_interim_schedule_event' },
  { table: 'acc_interim_schedule_run' },
  { table: 'acc_artifact' },
  { table: 'acc_ta2_decision' },
  { table: 'acc_randomization_ratio_decision' },
  { table: 'acc_randomization_ratio_history' },
  { table: 'acc_randomization_succession' },
  { table: 'acc_participant_arm_eligibility' },
  { table: 'acc_coding_case' },
  { table: 'acc_coding_revision' },
  { table: 'acc_coding_native_query' },
  { table: 'acc_coding_dictionary_revocation' },
  { table: 'acc_audit_chain_scope' },
  { table: 'acc_audit_chain_checkpoint' },
  // The late extension block (P17 2.2.1), with the item that owns each table.
  { table: 'acc_approval_gate_policy_event', late: { item: 'C-3' } },
  { table: 'acc_deviation_escalation_policy_event', late: { item: 'O-2' } },
  { table: 'acc_deviation_escalation_attempt', late: { item: 'O-2' } },
  { table: 'acc_ta2_adaptation_policy_event', late: { item: 'U-2' } },
  { table: 'acc_collection_policy_event', late: { item: 'H-1' } },
  { table: 'acc_external_query_intake', late: { item: 'I-2' } },
  { table: 'acc_external_query_intake_item', late: { item: 'I-2' } },
  { table: 'acc_irb_approval_coverage', late: { item: 'F-2' } },
  { table: 'acc_central_monitoring_document', late: { item: 'N-6' } },
  { table: 'acc_central_monitoring_signal', late: { item: 'N-6' } },
  { table: 'acc_recruitment_criteria_template', late: { item: 'MR-1' } },
  { table: 'acc_arm_recruitment_target_event', late: { item: 'MR-3' } },
];

/** The limitation a flat copy states when INSPECTION_COPY_TA3_INVENTORY is on (P17 2.2.2). */
export const W1_SEGMENTED_LIMITATION =
  'Deviation evaluation receipts and their evidence blobs, the audit-chain verification result and the regimen-level index are retained only in the segmented representation edc-inspection-copy/3.';

/** The two deviation tables the inspection copy carried before W-1 (fda-inspection-export.service.ts INSPECTION_STORES). */
export const FLAT_DEVIATION_TABLES = ['acc_protocol_deviations', 'acc_deviation_action_events'] as const;
