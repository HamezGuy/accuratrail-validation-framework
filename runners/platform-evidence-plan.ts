import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { isRecord, strictObject } from './evidence-capture';
import { PLATFORM_SYSTEMS, type EvidenceAdmission, type PlatformSystemId } from '../config/platform-inventory';

// The platform evidence plan (TA3 plan VAL-1, spec P20 3.3 and 3.7). A
// platform-validation-evidence-plan/1 names, per system of the platform
// inventory, the evidence the platform summary (generator 22) admits by hash: a
// sealed validation-evidence-package/1 by the SHA-256 of its package-manifest.json,
// which runners/evidence-package.ts verifies with verifyPackage, or any other
// file by its own SHA-256 alone. `synthetic` is required: for a package it must
// equal the verified manifest's, for any other file it is the preparer's
// declaration; any synthetic entry makes the documents package synthetic (VD-3).
// The plan refuses a system the inventory lacks and an entry the system does not
// admit. A retained package copies it to inputs/platform-evidence-plan.json.
// Contract: contracts/platform-validation-evidence-plan-v1.schema.json.

export const PLATFORM_EVIDENCE_PLAN_CONTRACT = 'platform-validation-evidence-plan/1';
/** The kind of a plan entry that cites a sealed package of this framework. */
export const PACKAGE_EVIDENCE_KIND = 'validation-evidence-package/1';
/** Required members of the plan and of its objects; the contract test compares them with the schema. */
export const PLATFORM_EVIDENCE_PLAN_REQUIRED = ['contract', 'preparedBy', 'systems'] as const;
export const PLATFORM_EVIDENCE_PLAN_MEMBERS = {
  system: { required: ['evidence'], optional: [] },
  entry: { required: ['kind', 'path', 'sha256', 'synthetic'], optional: ['note'] },
} as const;
/** At most this many entries per system. */
export const PLATFORM_EVIDENCE_ENTRY_LIMIT = 100;

export interface PlatformEvidenceEntry {
  /** validation-evidence-package/1, or any other kind, which is admitted by hash only. */
  kind: string;
  /** Absolute path: a package directory (or its package-manifest.json), or the file itself. */
  path: string;
  /** For a package, the SHA-256 of its package-manifest.json; otherwise the file's own. */
  sha256: string;
  synthetic: boolean;
  note?: string;
}

export interface PlatformEvidencePlan {
  contract: typeof PLATFORM_EVIDENCE_PLAN_CONTRACT;
  preparedBy: string;
  systems: Partial<Record<PlatformSystemId, { evidence: PlatformEvidenceEntry[] }>>;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
/** A contract-like label such as validation-evidence-package/1 or bw-formal-qualification/1. */
const KIND = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const PLAN_BYTE_LIMIT = 1024 * 1024;

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function printable(value: unknown, at: string, limit: number): string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value),
    `${at} must be printable text of 1 to ${limit} characters`);
  return value;
}

/** Strict reading of a platform-validation-evidence-plan/1. A refusal names the member, never a value the file held. */
export function parsePlatformEvidencePlan(value: unknown, at = 'The platform evidence plan'): PlatformEvidencePlan {
  const plan = strictObject(value, at, PLATFORM_EVIDENCE_PLAN_REQUIRED);
  check(plan.contract === PLATFORM_EVIDENCE_PLAN_CONTRACT, `${at} contract must be ${PLATFORM_EVIDENCE_PLAN_CONTRACT}`);
  printable(plan.preparedBy, `${at} preparedBy`, 200);
  // Keyed by system id; every key is checked against the inventory below.
  check(isRecord(plan.systems), `${at} systems must be an object`);
  const systems = plan.systems;
  const ids = Object.keys(systems);
  check(ids.length > 0, `${at} systems names no system; without evidence, omit --platform-evidence and every system shows its gap`);
  for (const id of ids) {
    const system = PLATFORM_SYSTEMS.find(entry => entry.id === id);
    check(system, `${at} systems names ${JSON.stringify(id)}, which is not a system of the platform inventory (config/platform-inventory.ts)`);
    const { required, optional } = PLATFORM_EVIDENCE_PLAN_MEMBERS.system;
    const evidence = strictObject(systems[id], `${at} systems.${id}`, required, optional).evidence;
    check(Array.isArray(evidence) && evidence.length > 0 && evidence.length <= PLATFORM_EVIDENCE_ENTRY_LIMIT,
      `${at} systems.${id}.evidence must list 1 to ${PLATFORM_EVIDENCE_ENTRY_LIMIT} entries`);
    const admission: EvidenceAdmission = system.evidence;
    const seen = new Set<string>();
    evidence.forEach((item, index) => {
      const where = `${at} systems.${id}.evidence[${index}]`;
      const entry = strictObject(item, where, PLATFORM_EVIDENCE_PLAN_MEMBERS.entry.required, PLATFORM_EVIDENCE_PLAN_MEMBERS.entry.optional);
      check(typeof entry.kind === 'string' && KIND.test(entry.kind), `${where}.kind must be a kind label such as ${PACKAGE_EVIDENCE_KIND}`);
      const file = printable(entry.path, `${where}.path`, 1024);
      check(path.isAbsolute(file), `${where}.path must be an absolute path`);
      check(typeof entry.sha256 === 'string' && SHA256_HEX.test(entry.sha256), `${where}.sha256 must be 64 lower-case hex digits`);
      check(typeof entry.synthetic === 'boolean', `${where}.synthetic must be true or false`);
      if (entry.note !== undefined) printable(entry.note, `${where}.note`, 500);
      // The inventory decides what counts for each system; an entry it does not admit is an error in the plan.
      if (entry.kind === PACKAGE_EVIDENCE_KIND) {
        check(admission.package, `${where} cites a ${PACKAGE_EVIDENCE_KIND}, which the inventory does not admit for ${id} (${system.evidence.description})`);
      } else {
        check(admission.hashOnly, `${where} cites ${entry.kind} by hash only, which the inventory does not admit for ${id} (${system.evidence.description})`);
      }
      const key = path.resolve(file).toLowerCase();
      check(!seen.has(key), `${where}.path repeats an entry of ${id}`);
      seen.add(key);
    });
  }
  return plan as unknown as PlatformEvidencePlan;
}

export interface LoadedPlatformEvidencePlan {
  /** The absolute path read. */
  file: string;
  /** SHA-256 of the plan's bytes. */
  sha256: string;
  plan: PlatformEvidencePlan;
}

/** Reads a plan file (at most 1 MiB of JSON) and refuses one that breaks the contract. */
export function loadPlatformEvidencePlan(file: string): LoadedPlatformEvidencePlan {
  const resolved = path.resolve(file);
  let bytes: Buffer;
  try {
    const stat = fs.statSync(resolved);
    check(stat.isFile() && stat.size <= PLAN_BYTE_LIMIT, `The platform evidence plan ${resolved} is not a file of at most ${PLAN_BYTE_LIMIT} bytes.`);
    bytes = fs.readFileSync(resolved);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('The platform evidence plan ')) throw error;
    throw new Error(`The platform evidence plan ${resolved} cannot be read (${(error as NodeJS.ErrnoException).code ?? String(error)}).`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw new Error(`The platform evidence plan ${resolved} is not JSON.`); }
  return { file: resolved, sha256: sha256(bytes), plan: parsePlatformEvidencePlan(parsed, `The platform evidence plan ${resolved}`) };
}

/** The plan's entries in inventory order, then in plan order. */
export function planEntries(plan: PlatformEvidencePlan): Array<{ system: PlatformSystemId; index: number; entry: PlatformEvidenceEntry }> {
  return PLATFORM_SYSTEMS.flatMap(system => (plan.systems[system.id]?.evidence ?? [])
    .map((entry, index) => ({ system: system.id, index, entry })));
}
