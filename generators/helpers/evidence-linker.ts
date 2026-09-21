import { EVIDENCE_CATEGORIES, loadEvidence, type EvidenceCategory } from '../../runners/evidence-capture';

export interface RunnerResult {
  testCaseId: string;
  passed: boolean;
  notes: string;
  timestamp?: string;
}

/** Every runner result keyed by test case ID, read from each category's
 * `${category}-results.json` as written by `saveEvidence`. */
export function loadRunnerEvidence(outputDir: string): Map<string, RunnerResult> {
  const resultMap = new Map<string, RunnerResult>();
  for (const category of EVIDENCE_CATEGORIES) {
    for (const result of loadEvidence(outputDir, category)) {
      if (resultMap.has(result.testCaseId)) throw new Error(`Duplicate qualification test case: ${result.testCaseId}`);
      resultMap.set(result.testCaseId, result);
    }
  }
  return resultMap;
}

export interface EvidenceStats {
  total: number;
  pass: number;
  fail: number;
}

/** Pass/fail counts for one runner category from its `${category}-results.json`.
 * All zeros when that category has not been executed into this output directory. */
export function tryLoadEvidence(outputDir: string, category: EvidenceCategory): EvidenceStats {
  const results = loadEvidence(outputDir, category);
  return {
    total: results.length,
    pass: results.filter(result => result.passed).length,
    fail: results.filter(result => !result.passed).length,
  };
}
