import * as fs from 'fs';
import * as path from 'path';

export type EvidenceResult = 'Pass' | 'Fail' | 'Not Tested';

export interface EvidenceLink {
  requirementId: string;
  testCaseId: string;
  evidenceFile: string;
  result: EvidenceResult;
  timestamp?: string;
}

export interface EvidenceSummary {
  total: number;
  pass: number;
  fail: number;
  notTested: number;
}

export type EvidenceCategory = 'iq' | 'oq' | 'pq';

export function loadEvidence(evidenceDir: string, category: EvidenceCategory): EvidenceLink[] {
  const filePath = path.join(evidenceDir, `${category}-evidence.json`);

  if (!fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(isValidEvidenceLink);
}

export function findEvidenceForRequirement(
  links: EvidenceLink[],
  reqId: string
): EvidenceLink[] {
  return links.filter((link) => link.requirementId === reqId);
}

export function summarizeEvidence(links: EvidenceLink[]): EvidenceSummary {
  let pass = 0;
  let fail = 0;
  let notTested = 0;

  for (const link of links) {
    switch (link.result) {
      case 'Pass':
        pass++;
        break;
      case 'Fail':
        fail++;
        break;
      case 'Not Tested':
        notTested++;
        break;
    }
  }

  return {
    total: links.length,
    pass,
    fail,
    notTested,
  };
}

export interface RunnerResult {
  testCaseId: string;
  passed: boolean;
  notes: string;
  timestamp?: string;
}

export function loadRunnerEvidence(outputDir: string): Map<string, RunnerResult> {
  const resultMap = new Map<string, RunnerResult>();
  for (const category of ['iq', 'oq', 'pq', 'security', 'dr', 'performance'] as const) {
    const filePath = path.join(outputDir, 'evidence', category, `${category}-results.json`);
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (typeof item === 'object' && item !== null && 'testCaseId' in item) {
          const r = item as Record<string, unknown>;
          resultMap.set(r.testCaseId as string, {
            testCaseId: r.testCaseId as string,
            passed: Boolean(r.passed),
            notes: (r.notes as string) || '',
            timestamp: (r.timestamp as string) || undefined,
          });
        }
      }
    } catch { /* skip unreadable files */ }
  }
  return resultMap;
}

function isValidEvidenceLink(value: unknown): value is EvidenceLink {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.requirementId === 'string' &&
    typeof obj.testCaseId === 'string' &&
    typeof obj.evidenceFile === 'string' &&
    (obj.result === 'Pass' || obj.result === 'Fail' || obj.result === 'Not Tested') &&
    (obj.timestamp === undefined || typeof obj.timestamp === 'string')
  );
}
