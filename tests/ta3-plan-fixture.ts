// A synthetic ta3-oq-plan/1 for the contract tests (tests/ta3-oq.contract.test.ts and the CLI
// scenarios). Every account names environment variables, never a credential.

export const TA3_TEST_ACCOUNTS = { operator: 'OP', reviewer: 'REV', thirdPerson: 'THIRD', blinded: 'BLIND', monitor: 'MON' } as const;

export function ta3PlanJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract: 'ta3-oq-plan/1', synthetic: true, runLabel: 'contract-test',
    study: { studyId: 100, siteStudyId: 101, expectedSpecHash: 'e'.repeat(64), expectedCslReleaseId: 'csl-release-synthetic-1', duplicateOf: 99 },
    accounts: Object.fromEntries(Object.entries(TA3_TEST_ACCOUNTS).map(([account, key]) => [account, { username: `TA3_TEST_${key}_USERNAME`, password: `TA3_TEST_${key}_PASSWORD` }])),
    saveRule: { ruleId: 'R-RANGE-1', eventDefinitionId: 21, crfVersionId: 31, itemId: 41, violatingValue: '999', compliantValue: '70', visitDate: '2026-10-20' },
    absenceRule: { ruleId: 'R-MISSED-1', kind: 'missed_visit', eventDefinitionId: 22, anchorDate: '2026-09-01' },
    followUpTask: { studyTaskId: 51 },
    applicability: { versions: [{ protocolVersion: 'v1', effectiveFrom: '2025-01-01' }, { protocolVersion: 'v2', effectiveFrom: '2026-01-01' }],
      versionedRuleId: 'R-WINDOW-1', earlyEnrollmentDate: '2025-06-01', lateEnrollmentDate: '2026-06-01' },
    sweep: { maxWaitMinutes: 5 },
    escalation: { maxWaitMinutes: 75, recipientRole: 'investigator', recipientUsername: 'ta3-recipient' },
    ...overrides,
  };
}
