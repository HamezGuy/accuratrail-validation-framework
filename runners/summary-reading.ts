import { strictObject } from './evidence-capture';

/*
 * Strict reading of a reconstructed run summary, shared by the two derivations of PQ rows from one: the O-7 PQT cases
 * (runners/benchmark-evidence.ts, derivePqtResults) and the lab-to-endpoint pilot cases (runners/pilot-evidence.ts,
 * derivePilotResults). Pure: no file, clock or process. A member or value a reader does not recognise is a reason
 * (membersProblem), never a guess.
 */

/** What a derivation receives from the import: the reconstructed summary, or why there is none, and the hashes read. */
export interface SummaryDerivationInput {
  runDir: string;
  timestamp: string;
  /** The reconstructed summary; absent when BENCHMARK-RECONSTRUCTION failed. */
  summary?: Record<string, unknown>;
  /** Why the reconstruction failed, when it did. */
  reconstructionError?: string;
  summarySha256: string | null;
  metricsSha256: string | null;
}

/** One case's reading of the reconstructed summary. */
export interface CaseOutcome { passed: boolean; code?: string; detail: string; body: Record<string, unknown> }
export const casePass = (detail: string, body: Record<string, unknown>): CaseOutcome => ({ passed: true, detail, body });
export const caseFail = (code: string, detail: string, body: Record<string, unknown> = {}): CaseOutcome => ({ passed: false, code, detail, body });

export const isCount = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && (value as number) >= min;
export const isRate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
export const isRateOrNull = (value: unknown) => value === null || isRate(value);
export const isText = (value: unknown, max = 2048): value is string => typeof value === 'string' && value.trim().length > 0
  && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
/** Equal within the rounding of a JSON number; a ratio is compared, never recomputed into the record. */
export const same = (left: number, right: number) => Math.abs(left - right) <= 1e-9;

/** The strict reading of one part of the summary: undefined when it holds exactly the members named, else why not. */
export function membersProblem(value: unknown, at: string, required: readonly string[], optional: readonly string[] = []): string | undefined {
  try {
    strictObject(value, at, required, optional);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** An RFC 3339 instant. */
export const isInstant = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
