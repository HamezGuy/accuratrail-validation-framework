import { mappedCaseState, runnerCaseCheck, type MappedCaseState, type RunnerResult } from './evidence-linker';
import { E6_R3_REFERENCES, e6r3, type E6R3Key } from '../../config/regulatory-scope';
import { OQ_SUITES, oqSuiteCaseIds } from '../../config/oq-case-registry';
import { TA3_OQ_CASES } from '../../config/ta3-oq-cases';

/** The 21 CFR Part 11 and HIPAA technical-safeguard sections a qualification
 * record can verify, each mapped only to the executed runner cases that verify
 * it. Shared by the validation summary (12) and the regulatory map (18). */
export interface ComplianceMapping {
  section: string;
  title: string;
  testCaseIds: string[];
  evidenceRef: string;
}

/** Each section cites only catalogued runner cases (RUNNER_CASE_CHECKS) whose
 * actual check verifies it; evidenceRef says what those cases verify. A section
 * no executed case verifies stays Pending: written procedures, training, IQ and
 * transmission checks are outside this runner evidence. */
export const PART11_MAPPINGS: readonly ComplianceMapping[] = [
  { section: '11.10(a)', title: 'Validation', testCaseIds: [], evidenceRef: 'This validation package; validation is concluded only by its review and approval' },
  { section: '11.10(b)', title: 'Accurate and complete copies', testCaseIds: ['OQ-032', 'OQ-047', 'OQ-048', 'OQ-067'], evidenceRef: 'exact owned values in the audit CSV and data CSV exports and in the printed PDF record' },
  { section: '11.10(c)', title: 'Record protection', testCaseIds: ['OQ-030', 'OQ-031', 'PQ-031', 'PQ-034'], evidenceRef: 'audit-row edit and delete refusals; frozen and locked form write refusals (API refusals; retention and backup are not tested)' },
  { section: '11.10(d)', title: 'Limiting system access', testCaseIds: ['OQ-001', 'OQ-003', 'OQ-009', 'OQ-010', 'OQ-021', 'OQ-022', 'OQ-095'], evidenceRef: 'login, wrong-password refusal, lockout, logout, role-change and disable revocation, forged-token refusal' },
  { section: '11.10(e)', title: 'Audit trails', testCaseIds: ['PQ-036', 'PQ-037', 'OQ-027', 'OQ-028', 'OQ-121', 'OQ-122'], evidenceRef: 'scoped form audit holding the exact correction (old and new value, reason, actor, visit), event types, entity identities, timestamps and operators' },
  { section: '11.10(f)', title: 'Operational system checks', testCaseIds: ['PQ-022', 'OQ-061'], evidenceRef: 'a stale-observation write and a correction without a reason are refused' },
  { section: '11.10(g)', title: 'Authority checks', testCaseIds: ['OQ-021', 'OQ-053'], evidenceRef: 'a lowered role is refused a privileged read; unlock requires an authorized signed actor' },
  { section: '11.10(h)', title: 'Device checks', testCaseIds: ['OQ-007'], evidenceRef: 'manual readback of the per-session device fingerprint' },
  { section: '11.10(i)', title: 'Training', testCaseIds: [], evidenceRef: '15-training-matrix.md' },
  { section: '11.10(j)', title: 'Documentation accountability', testCaseIds: [], evidenceRef: 'written accountability policies (SOP review); no runner case' },
  { section: '11.10(k)(1)', title: 'Documentation controls — distribution', testCaseIds: [], evidenceRef: 'SOP review; no runner case' },
  { section: '11.10(k)(2)', title: 'Documentation controls — revision', testCaseIds: [], evidenceRef: 'SOP review; no runner case' },
  { section: '11.50', title: 'Signature manifestations', testCaseIds: ['PQ-028', 'OQ-048', 'OQ-067'], evidenceRef: 'signer, signing time and canonical meaning on the signature proof and on the printed record' },
  { section: '11.70', title: 'Signature/record linking', testCaseIds: ['PQ-029', 'PQ-039', 'OQ-042'], evidenceRef: 'a correction invalidates the signature and fresh signing re-binds it; the audit manifestation carries the content hash' },
  { section: '11.100', title: 'General e-signature requirements', testCaseIds: ['OQ-002', 'PQ-027'], evidenceRef: 'a username cannot be registered twice; the signature belongs to the named signer' },
  { section: '11.200', title: 'E-signature components and controls', testCaseIds: ['OQ-033', 'OQ-041', 'PQ-027'], evidenceRef: 'signing without or with a wrong password is refused; signing re-authenticates username and password' },
  { section: '11.300', title: 'Controls for ID codes/passwords', testCaseIds: ['OQ-004', 'OQ-009', 'OQ-071', 'OQ-092', 'OQ-093'], evidenceRef: 'password policy, lockout, password history and current-password verification' },
];

export const HIPAA_MAPPINGS: readonly ComplianceMapping[] = [
  { section: '164.312(a)(1)', title: 'Access control', testCaseIds: ['OQ-001', 'OQ-010', 'OQ-021', 'OQ-022'], evidenceRef: 'authenticated access, logout, role-change and disable revocation' },
  { section: '164.312(a)(2)(i)', title: 'Unique user identification', testCaseIds: ['OQ-002'], evidenceRef: 'a username cannot be registered twice' },
  { section: '164.312(a)(2)(ii)', title: 'Emergency access procedure', testCaseIds: [], evidenceRef: '14-hipaa-assessment.md' },
  { section: '164.312(a)(2)(iii)', title: 'Automatic logoff', testCaseIds: [], evidenceRef: 'no case lets a session idle out (OQ-086 bounds only the absolute token lifetime)' },
  { section: '164.312(a)(2)(iv)', title: 'Encryption and decryption', testCaseIds: [], evidenceRef: 'IQ storage-encryption checks; no runner case' },
  { section: '164.312(b)', title: 'Audit controls', testCaseIds: ['PQ-036', 'PQ-037', 'OQ-121'], evidenceRef: 'scoped audit rows with the exact correction and parseable timestamps' },
  { section: '164.312(c)(1)', title: 'Integrity', testCaseIds: ['PQ-022', 'PQ-031', 'PQ-034'], evidenceRef: 'stale, frozen and locked writes are refused with the record unchanged' },
  { section: '164.312(c)(2)', title: 'Mechanism to authenticate ePHI', testCaseIds: ['PQ-029', 'PQ-039'], evidenceRef: 'a content-bound signature is invalidated by a change and verified on the final record' },
  { section: '164.312(d)', title: 'Person or entity authentication', testCaseIds: ['OQ-001', 'OQ-003', 'OQ-095'], evidenceRef: 'login, wrong-password refusal, forged-token refusal' },
  { section: '164.312(e)(1)', title: 'Transmission security', testCaseIds: [], evidenceRef: 'IQ TLS checks; no runner case' },
  { section: '164.312(e)(2)(i)', title: 'Integrity controls', testCaseIds: [], evidenceRef: 'transmission integrity; no runner case' },
  { section: '164.312(e)(2)(ii)', title: 'Encryption', testCaseIds: [], evidenceRef: 'IQ HTTPS checks; no runner case' },
];

/** An ICH E6(R3) topic of the one mapping (config/regulatory-scope.ts), keyed as that mapping is. */
export interface E6R3Mapping extends ComplianceMapping {
  key: E6R3Key;
}

/** The cases of an ICH E6(R3) topic: the base-suite cases whose actual check verifies it, then every TA3 case
 * whose catalog entry (config/ta3-oq-cases.ts) cites the topic, so the TA3 part is never listed twice. */
function e6r3Mapping(key: E6R3Key, baseCases: string[], evidenceRef: string): E6R3Mapping {
  const ta3 = TA3_OQ_CASES.filter(entry => entry.e6r3.includes(key)).map(entry => entry.id);
  return { key, section: e6r3(key), title: E6_R3_REFERENCES[key].topic, testCaseIds: [...baseCases, ...ta3], evidenceRef };
}

/** Every topic of the ICH E6(R3) mapping, in its order, with what the mapped cases verify. A topic no executed
 * case verifies stays Pending; the section references themselves are pending QA verification. */
export const E6_R3_MAPPINGS: readonly E6R3Mapping[] = [
  e6r3Mapping('gcp', [], 'good clinical practice as a whole is concluded only by review and approval of the complete package; no runner case verifies it'),
  e6r3Mapping('auditTrails', ['PQ-036', 'PQ-037', 'OQ-027', 'OQ-028', 'OQ-121', 'OQ-122'],
    'scoped form audit holding the exact correction, event types, entity identities, timestamps and operators; deviation evaluation receipts refused change through the API'),
  e6r3Mapping('dataCorrections', ['OQ-061', 'PQ-013', 'PQ-037'],
    'a correction without a reason is refused, and a correction with its reason is saved and audited with old and new value; a corrected deviation value keeps its violated history'),
  e6r3Mapping('signatures', ['PQ-027', 'PQ-028', 'OQ-033', 'OQ-041', 'OQ-042'],
    'signing re-authenticates and is refused without or with a wrong password, and names signer, time and meaning; signed deviation assessments, closures and milestones by a person other than the recorder'),
  e6r3Mapping('dataCapture', ['PQ-011', 'PQ-012', 'PQ-015'],
    'eCRF values saved and read back for five field types; deviation rules evaluated on save without blocking it'),
  e6r3Mapping('protocolAndRecords', [],
    'protocol version applicability: restricted recording, stated dates, the governing version by planned visit date and explicit unresolved applicability'),
  e6r3Mapping('reviewOfData', [], 'no runner case verifies a review of data or metadata'),
  e6r3Mapping('validation', [], 'this validation package; validation is concluded only by its review and approval'),
  e6r3Mapping('essentialRecords', [],
    'inspection copies: the flat copy byte for byte with its hash, deviation records, the TA3 inventory, segmented receipts and the role restriction'),
  e6r3Mapping('training', [],
    '15-training-matrix.md; a training refusal of a clinical write is recorded as a setup gap (TRAINING_NOT_CURRENT), not verified as a control'),
  e6r3Mapping('nonCompliance', [],
    'deviation detection on save and in the sweep, applicability, complete and signed deviation records, independent closure and review, escalation, and deviation records in the inspection copy'),
  e6r3Mapping('qualityManagement', [],
    'the follow-up task, independent corrective-action review and escalation under a signed, independently reviewed policy'),
  e6r3Mapping('blinding', [], 'escalation records and measurement documents carry no arm for blinded readers, and the blinded TA3 ledger is withheld'),
  e6r3Mapping('retention', [],
    'milestones and measurement documents retained as exact, hash-identified bytes that replay and are never rewritten; inspection copies retrievable byte for byte'),
];

/** A TA3 use VAL-1 qualifies (TA3 plan section 5), verified by one OQ suite. `section` names the TA3 plan
 * section the use belongs to. */
export interface Ta3UseMapping extends ComplianceMapping {
  suite: number;
}

function ta3Use(suite: number, planSection: string, title: string, evidenceRef: string): Ta3UseMapping {
  const entry = OQ_SUITES.find(candidate => candidate.suite === suite);
  if (!entry) throw new Error(`No OQ suite ${suite} is registered.`);
  return { suite, section: planSection, title, testCaseIds: oqSuiteCaseIds(entry), evidenceRef };
}

/** The TA3 uses and the suites 13 to 18 that verify them. A use whose cases met a feature switched off or absent
 * at the release fails; one whose cases recorded a setup gap (NO_TA3_PLAN and the like) is not executed. */
export const TA3_USE_MAPPINGS: readonly Ta3UseMapping[] = [
  ta3Use(13, 'o. Protocol deviations', 'Deviation detection on save and in the sweep',
    'the engine armed for the study, save-time detection with exactly one machine deviation and its negative control, unevaluated subjects never passed, sweep detection of an absence rule, no duplicate, append-only receipts, correction history and the follow-up task'),
  ta3Use(14, 'o. Protocol deviations', 'The governing protocol version per site and planned visit',
    'restricted recording, stated dates, the governing version by planned visit date and explicit unresolved applicability'),
  ta3Use(15, 'o. Protocol deviations', 'Complete deviation records, signed assessment and independent closure',
    'the platform list with site deviations, occurrence date and basis, signed assessment by another person, importance rules, second-person not-a-deviation closure, independent corrective-action review and refused stale decisions'),
  ta3Use(16, 'o. Protocol deviations', 'Timed escalation under a signed, reviewed policy',
    'a policy in force only after another person\'s signed review, one escalation and task per level for unassessed deviations and overdue corrective actions, and codes with no arm'),
  ta3Use(17, '3. The metrics ledger', 'Signed milestones, retained measurement documents and the TA3 ledger',
    'signed milestones in force after independent review; milestone, effort and latency documents as exact bytes that replay and are never rewritten; withheld documents for blinded readers; the one-snapshot TA3 ledger'),
  ta3Use(18, 'w. Inspection-ready documentation', 'Inspection copies of the TA3 records',
    'the flat copy byte for byte, deviation records, the TA3 inventory and its flag, segmented-only receipts, segmented content and the role restriction'),
];

for (const mapping of [...PART11_MAPPINGS, ...HIPAA_MAPPINGS, ...E6_R3_MAPPINGS, ...TA3_USE_MAPPINGS]) {
  for (const id of mapping.testCaseIds) runnerCaseCheck(id);
}

/** A section's status is the retained state of its mapped cases; PASS means
 * every mapped case passed in this run and is not a compliance determination. */
export function deriveComplianceStatus(mapping: ComplianceMapping, evidenceMap: Map<string, RunnerResult>): string {
  if (mapping.testCaseIds.length === 0) return 'Pending — no executed case verifies this section';
  const states = mapping.testCaseIds.map(id => [id, mappedCaseState(id, evidenceMap)] as const);
  const named = (...wanted: MappedCaseState[]) => states.filter(([, state]) => wanted.includes(state)).map(([id]) => id).join(', ');
  if (states.some(([, state]) => state === 'failed')) return `FAIL (${named('failed')})`;
  if (states.every(([, state]) => state === 'passed')) return 'PASS — every mapped case passed';
  if (states.every(([, state]) => state === 'missing' || state === 'not-executed')) return 'Pending — mapped cases not executed';
  if (states.some(([, state]) => state === 'manual-pending')) return `Manual verification pending (${named('manual-pending')})`;
  return `Incomplete — not executed: ${named('missing', 'not-executed')}`;
}

export const complianceRow = (mapping: ComplianceMapping, evidenceMap: Map<string, RunnerResult>): string[] => [
  mapping.section, mapping.title, deriveComplianceStatus(mapping, evidenceMap),
  mapping.testCaseIds.length ? `${mapping.testCaseIds.join(', ')} — ${mapping.evidenceRef}` : mapping.evidenceRef,
];

/** The mapping for a regulatory section ID as the documents spell it, with or
 * without the section sign (for example '§11.70' or '164.312(a)(1)'). */
export function complianceMappingFor(sectionId: string): ComplianceMapping | undefined {
  const key = sectionId.replace(/^§\s*/, '');
  return [...PART11_MAPPINGS, ...HIPAA_MAPPINGS].find(mapping => mapping.section === key);
}
