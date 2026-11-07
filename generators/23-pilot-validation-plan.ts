import * as fs from 'fs';
import * as path from 'path';
import { SYSTEM_INFO } from '../config/system-info';
import {
  PILOT_ACCEPTANCE_CONTRACT, PILOT_ADVS_DUPLICATE_KEY_GROUPS, PILOT_ADVS_KEYS, PILOT_CONTROL_SYSTEMS, PILOT_IMPORT_SWITCH, PILOT_NON_CLAIMS, PILOT_PQ_CASES,
  PILOT_RECONSTRUCTION_ENTRY, UNSUPPORTED_PILOT_SUMMARY,
} from '../config/ta3-pq-cases';
import {
  CRITICAL_FAILURE_CLASSES, PILOT_FORBIDDEN_COMBINATIONS, PILOT_G3, PILOT_PLAN, PILOT_REVALIDATION_TRIGGERS, PILOT_RISKS, PILOT_ROLES,
  pilotCslMirror, pilotTraceability, riskClass, riskPriority,
} from '../config/pilot-validation';
import { approvalBlock, documentHeader, hr, markdownTable, riskBadge, section, tableOfContents } from './helpers/markdown-writer';
import { loadRunnerEvidence, mappedCaseState, runnerCaseCheck, type RunnerResult } from './helpers/evidence-linker';
import { isRecord, loadEvidence } from '../runners/evidence-capture';

/**
 * Document 23, the pilot validation plan and system risk assessment for the lab-to-endpoint pilot's intended use
 * (backlog LE-7.2; plan revision 3 section 9 "Computerised-system validation" and section 10). Everything it prints
 * comes from config/pilot-validation.ts, PILOT_REQUIREMENTS and PILOT_PQ_CASES, so no criterion is written twice;
 * the status column reads the retained benchmark evidence of the package (derivePilotResults). Approval is the QA
 * owner's governance decision in the eTMF; this file carries no signature.
 */

const DOC_DATE = new Date().toISOString().split('T')[0];
export const PILOT_PLAN_FILE = '23-pilot-validation-plan.md';

function caseStatus(testCaseId: string, evidence: Map<string, RunnerResult>): string {
  const code = evidence.get(testCaseId)?.outcomeCode;
  const coded = code ? ` (${code})` : '';
  switch (mappedCaseState(testCaseId, evidence)) {
    case 'passed': return 'PASS';
    case 'failed': return `FAIL${coded}`;
    case 'manual-pending': return 'Manual verification pending';
    case 'not-executed': return `Not executed${coded}`;
    default: return 'Pending: no pilot run imported in this package';
  }
}

/** What the imported run states it does not claim (pilot.nonClaims, copied into every pilot row); undefined with no pilot row. */
function importedNonClaims(outputDir: string): { claim: string; status: string; decision: string }[] | undefined {
  const row = loadEvidence(outputDir, 'benchmark').find(result => result.testCaseId === PILOT_PQ_CASES[0].id);
  const stated = isRecord(row?.responseBody) ? row.responseBody.nonClaims : undefined;
  return Array.isArray(stated) ? stated as { claim: string; status: string; decision: string }[] : undefined;
}

export function generate(outputDir: string, _workspaceRoot: string): void {
  const evidence = loadRunnerEvidence(outputDir);
  const trace = pilotTraceability();
  // Every printed case must have a verified check text; an uncatalogued case throws here, not in review.
  for (const { pqCase } of trace) runnerCaseCheck(pqCase.id);

  let c = documentHeader({
    title: 'Pilot Validation Plan and System Risk Assessment: CDISCPILOT01 Lab-to-Endpoint',
    documentId: PILOT_PLAN.documentId,
    version: '1.0',
    date: DOC_DATE,
    system: `${SYSTEM_INFO.fullName} and the platform legs of the pilot (${PILOT_CONTROL_SYSTEMS.join(', ')})`,
    classification: 'Confidential, Regulatory',
  });
  c += tableOfContents([
    { level: 1, title: 'Status and Approval' },
    { level: 1, title: 'Intended Use' },
    { level: 1, title: 'Scope' },
    { level: 1, title: 'Validation Approach' },
    { level: 1, title: 'System Risk Assessment' },
    { level: 1, title: 'Requirement-to-Test Matrix' },
    { level: 1, title: 'Computerised-System Controls' },
    { level: 1, title: 'Stage Exits and Acceptance' },
    { level: 1, title: 'Revalidation Triggers' },
    { level: 1, title: 'Roles and Segregation of Duties' },
    { level: 1, title: 'CSL PR-13 Mirror' },
    { level: 1, title: 'Deviations and Deliverables' },
    { level: 1, title: 'Approval Signatures' },
  ]) + '\n';
  c += hr();

  c += section(2, 'Status and Approval');
  c += `This plan is backlog item ${PILOT_PLAN.backlogItem}. ${PILOT_PLAN.approval}\n\n`;
  c += `Done when: the QA owner approves the plan, and every case has a requirement id. All ${trace.length} cases below name `
    + 'exactly one requirement, and each requirement cites exactly that case back (checked when this document is generated).\n\n';
  c += hr();

  c += section(2, 'Intended Use');
  c += `${PILOT_PLAN.intendedUse}\n\n`;
  c += `**Decision use:** ${PILOT_PLAN.decisionUse}\n\n`;
  c += hr();

  c += section(2, 'Scope');
  c += section(3, 'Systems');
  c += `The pilot legs are ${PILOT_CONTROL_SYSTEMS.join(', ')} (EDC; Clinical Semantic Layer with its regional instance; CommandCenter; `
    + 'Biometrics Workbench), with this framework sealing the evidence. Each system\'s qualification status, evidence and gaps are '
    + 'stated once, in the platform validation summary (22-platform-validation-summary.md); this plan does not restate them.\n\n';
  c += section(3, 'Data');
  c += markdownTable(['Kind', 'What'], [
    ['Real', PILOT_PLAN.data.real],
    ['Declared synthetic overlay', PILOT_PLAN.data.overlays],
    ['Pilot scope', PILOT_PLAN.data.scope],
  ]);
  c += '\n';
  c += section(3, 'Out of Scope');
  for (const item of PILOT_PLAN.outOfScope) c += `- ${item}\n`;
  c += '\n';
  c += hr();

  c += section(2, 'Validation Approach');
  c += 'Risk-based (GAMP 5, FDA Computer Software Assurance): the depth of each check follows the risk it controls, and the critical '
    + 'cases are verified on real public data through the product path, never by unit tests. Two runs carry the evidence:\n\n';
  c += markdownTable(['Run', 'Where', 'Evidence classification', 'Answer keys', 'When'],
    PILOT_PLAN.runs.map(run => [run.run, run.where, run.classification, run.keys, run.when]));
  c += '\n';
  c += `**Evidence path.** ${PILOT_PLAN.evidencePath}\n\n`;
  c += `**Evidence classification (D-LE-14).** ${PILOT_PLAN.publicDataAdmission}\n\n`;
  c += `**Retention.** ${PILOT_PLAN.retention}\n\n`;
  c += `The import reconstructs the run through \`${PILOT_RECONSTRUCTION_ENTRY}\`. A summary member or value it does not recognise `
    + `records \`${UNSUPPORTED_PILOT_SUMMARY}\`; an inconclusive or incomplete result never passes; a case the run did not run is recorded `
    + `not executed. Without \`${PILOT_IMPORT_SWITCH}=true\` a pilot run imports as a plain benchmark run and no pilot case is recorded.\n\n`;
  c += hr();

  c += section(2, 'System Risk Assessment');
  c += 'The critical-to-quality factors of the intended use (ICH E6(R3) Annex 1, 3.10) are the five critical failure classes of plan '
    + `revision 3 section 10 (${CRITICAL_FAILURE_CLASSES.join('; ')}), and the quality factors that protect them. Severity is the effect on `
    + 'participant safety, data integrity or the endpoint; probability is judged from the estate as read on 6 and 7 November 2026; '
    + 'detectability is how likely the failure is found before it affects a decision. Risk class (severity by probability) and '
    + 'priority (class by detectability) follow GAMP 5 and are computed, never chosen.\n\n';
  c += markdownTable(['Risk', 'Hazard', 'Critical-to-quality factor', 'Severity', 'Probability', 'Detectability', 'Class', 'Priority', 'Verified by'],
    PILOT_RISKS.map(risk => {
      const cls = riskClass(risk.severity, risk.probability);
      return [risk.id, risk.hazard, risk.ctq, risk.severity, risk.probability, risk.detectability, String(cls),
        riskPriority(cls, risk.detectability), risk.cases.join(', ')];
    }));
  c += '\n';
  for (const risk of PILOT_RISKS) {
    c += `**${risk.id}: ${risk.hazard}.** Causes: ${risk.causes}. Effect: ${risk.effect}. Controls: ${risk.controls}.\n\n`;
  }
  const unverified = PILOT_RISKS.filter(risk => !risk.cases.length).map(risk => risk.id);
  c += unverified.length ? `Risks without a verifying case: ${unverified.join(', ')}.\n\n` : 'Every risk has at least one verifying case.\n\n';
  c += hr();

  c += section(2, 'Requirement-to-Test Matrix');
  c += 'One row per pilot case: the acceptance case of plan section 10, its user and functional requirement, the stage whose exit '
    + 'requires it, what it runs on, the backlog items whose code produces its evidence, and its state in this package.\n\n';
  c += markdownTable(['Case', 'Acceptance case', 'Requirement', 'FRS', 'Stage', 'Source', 'Risk', 'Produced by', 'Status'],
    trace.map(({ pqCase, requirementId, frsId }) => [pqCase.id, pqCase.acceptanceCase ?? '', requirementId, frsId, pqCase.stage ?? '',
      pqCase.source ?? '', riskBadge(pqCase.riskLevel), (pqCase.items ?? []).join(', '), caseStatus(pqCase.id, evidence)]));
  c += '\n';
  c += 'Each case\'s pass criterion is printed in the PQ protocol (09-pq-protocol.md, section "Lab-to-Endpoint Pilot") and each '
    + 'requirement in the URS and FRS (category "Lab-to-Endpoint Pilot (CDISCPILOT01)").\n\n';
  c += section(3, 'What a Run Does Not Claim');
  c += 'An R1 summary states these in pilot.nonClaims, exactly so, or every case records the unrecognised summary code; the import copies them into every pilot row. '
    + 'None of them can read as a pass. R2 exercises the governed lane end to end, so it cannot state that one.\n\n';
  c += markdownTable(['Claim', 'On R1', 'Decision', 'Why'], PILOT_NON_CLAIMS.map(item => [item.claim, item.status, item.decision, item.what]));
  c += '\n';
  const stated = importedNonClaims(outputDir);
  if (stated) {
    c += 'The run imported in this package states:\n\n';
    c += stated.length ? markdownTable(['Claim', 'Status', 'Decision'], stated.map(item => [item.claim, item.status, item.decision])) : 'Nothing: it states no non-claim.\n';
    c += '\n';
  }
  c += hr();

  c += section(2, 'Computerised-System Controls');
  c += 'Plan revision 3 section 9 names four controls as missing for the pilot. Each is a pilot case with its own requirement, '
    + `reported per pilot leg (${PILOT_CONTROL_SYSTEMS.join(', ')}); a leg not reported leaves the control inconclusive, never passed.\n\n`;
  c += markdownTable(['Case', 'Control', 'Requirement', 'Passes when'],
    PILOT_PQ_CASES.filter(entry => entry.id.startsWith('PQC-')).map(entry => [entry.id, entry.title, entry.requirement, entry.passesWhen]));
  c += '\n';
  c += 'The EDC\'s own controls stay qualified by their existing cases (signature linking OQ-037, OQ-040, OQ-065; security SEC-001 to '
    + 'SEC-010; disaster recovery DR-001 to DR-005, whose restore case DR-005 is manual). These pilot controls add the other legs and an '
    + 'executed restore.\n\n';
  c += hr();

  // The stage of each acceptance case is on its catalog entry (plan section 10); nothing restates it.
  const stageCases = (stage: 'B' | 'C') => PILOT_PQ_CASES.filter(entry => /^A\d+$/.test(entry.acceptanceCase ?? '') && entry.stage === stage)
    .map(entry => entry.acceptanceCase!).join(', ');
  c += section(2, 'Stage Exits and Acceptance');
  c += markdownTable(['Exit', 'Cases that must pass', 'Run'], [
    ['Stage B (LE-7.5)', `${stageCases('B')}; and G1 on R1`, 'R1, synthetic classification'],
    ['Stage C (LE-7.10)', `${stageCases('C')}; with every Stage B case again, G3 and the four controls`, 'R1 on the lockfile R2 will deploy'],
    ['Run of record (LE-7.6)', 'A1 to A20, G3 and the four controls', 'R2, admitted under the filed declared-public-data basis, countersigned keys, retained under QA-RETENTION-ROOT'],
  ]);
  c += '\n';
  c += `**G3.** ${PILOT_G3.statement}\n\n`;
  c += `**A11(c) keys (OD-22).** The standalone ADVS duplicate-key check runs over the unchanged file pinned in the data-use manifest, on the keys ${PILOT_ADVS_KEYS.join(', ')}, `
    + `and must find ${PILOT_ADVS_DUPLICATE_KEY_GROUPS} duplicate key groups. It parses nothing into BW records. No CORE ADaM rule exists yet, so ADVS is scored separately as a declared gap (OD-18).\n\n`;
  c += hr();

  c += section(2, 'Revalidation Triggers');
  c += 'A replaceable component that changes after its evidence was taken invalidates that evidence for the intended use until the '
    + 'cases below pass again on the changed release.\n\n';
  c += markdownTable(['Change', 'Re-run before relying on it'], PILOT_REVALIDATION_TRIGGERS.map(trigger => [trigger.change, trigger.rerun.join('; ')]));
  c += '\n';
  c += hr();

  c += section(2, 'Roles and Segregation of Duties');
  c += markdownTable(['Role', 'Holder for R2', 'R1 test account', 'Responsibility'],
    PILOT_ROLES.map(role => [role.role, role.holder, role.r1Account, role.responsibility]));
  c += '\n';
  c += 'One person may hold several roles, never these combinations:\n\n';
  for (const item of PILOT_FORBIDDEN_COMBINATIONS) c += `- ${item}\n`;
  c += '\nR2 needs at least two more named people than are assigned today (DECISIONS.md section 3). Unassigned roles block R2 only. '
    + 'While one person holds both the QA owner and the computerised-system validation owner roles, the documents package that '
    + 'holds this plan is filed in the eTMF by another person, so that the QA owner\'s approval is not a review of their own filing '
    + '(TMF-FILING.md).\n\n';
  c += hr();

  const mirror = pilotCslMirror();
  c += section(2, 'CSL PR-13 Mirror');
  c += 'Every one of A1 to A20 is required in the CSL PR-13.A acceptance matrix, under the plan\'s case id: by the CSL semantic-module pilot feature its path runs through, '
    + `or, when no single feature owns it, by the chain row ${mirror.chainRow.featureId}, which depends on every feature below. The CSL lane applies this mapping; this framework does not write CSL.\n\n`;
  c += markdownTable(['CSL feature', 'Acceptance cases (framework case, requirement)'],
    mirror.features.map(feature => [feature.featureId, feature.addCases.map(item => `${item.caseId} (${item.frameworkCaseId}, ${item.requirementId})`).join('; ')]));
  c += '\n';
  c += markdownTable([`Required by ${mirror.chainRow.featureId}`, 'Why no single feature owns it'], mirror.chainRow.addCases.map(item => [`${item.caseId} (${item.frameworkCaseId}, ${item.requirementId})`, item.reason]));
  c += '\n';
  c += hr();

  c += section(2, 'Deviations and Deliverables');
  c += '- A failed or inconclusive case is recorded with its outcome code, kept with its run (failed runs are kept) and handled in the deviation log (10) and, where a fix is needed, a CAPA record (11).\n';
  c += `- Each run is sealed as one validation-evidence-package/1 whose ${PILOT_ACCEPTANCE_CONTRACT} import records the pilot cases in evidence/benchmark/.\n`;
  c += '- The Stage C exit adds the validation summary for the pilot\'s intended use (plan section 9), extending the validation summary (12) and the platform summary (22).\n\n';
  c += hr();

  c += approvalBlock(['QA owner (James Gui, interim)']);
  c += '\n---\n*End of Document*\n';

  fs.writeFileSync(path.join(outputDir, PILOT_PLAN_FILE), c);
}
