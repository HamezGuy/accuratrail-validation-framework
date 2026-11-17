import { isRecord, SHA256_HEX } from './evidence-capture';
import { sha256 as hash } from './vendored-archive';
import { summaryContractOf } from './benchmark-evidence';
import { pilotRunBlock } from './pilot-evidence';
import { isInstant, isText, membersProblem } from './summary-reading';
import { PILOT_ACCEPTANCE_CONTRACT, PILOT_PUBLIC_DATA_BASIS_CONTRACT, PILOT_STUDY } from '../config/pilot-cases';

/*
 * The D-LE-14 admission rule of the lab-to-endpoint pilot (contracts/pilot-declared-public-data-basis-v1.schema.json): which
 * imported run makes a package that is not synthetic. Pure, on the bytes of a run summary and of the basis it cites, so that
 * the decision taken before a package exists (admitPublicDataRun, runners/evidence-package.ts, which reads the filed basis in
 * the QA retention root), the import that records the run (runners/benchmark-evidence.ts) and the package verifier, which
 * recomputes it from the retained bytes, apply one rule.
 */

/** The D-LE-14 decision on an imported run. Only an admitted run makes a package that is not synthetic. `claimed` says
 * whether the summary claims the declared-public-data basis at all; a run that does not stays synthetic silently. */
export type PublicDataAdmission =
  | { admitted: true; claimed: true; basisRef: string; basisSha256: string; summarySha256: string; filedBy: string; filedAt: string; bytes: Buffer }
  | { admitted: false; claimed: boolean; code: string; reason: string };

/** The members of a filed basis (contracts/pilot-declared-public-data-basis-v1.schema.json). */
export const PILOT_PUBLIC_DATA_BASIS_MEMBERS = ['contract', 'study', 'runKind', 'classification', 'decisions', 'dataUseManifestSha256', 'keySetManifestSha256', 'filedBy', 'filedRole', 'filedAt'] as const;
/** The decisions a basis must cite: the CDISC data use (D-LE-1) and the evidence classification (D-LE-14). */
const PILOT_PUBLIC_DATA_DECISIONS = ['D-LE-1', 'D-LE-14'];

const notAdmitted = (claimed: boolean, code: string, reason: string): PublicDataAdmission => ({ admitted: false, claimed, code, reason });

/** What a run summary claims. Not a claim: a summary that is not the pilot contract, or whose classification is not
 * declared-public-data. A claim the rule refuses before any basis is read carries its refusal. Pure. */
export function publicDataClaim(summaryBytes: Buffer):
  { claimed: false } | { claimed: true; refusal: PublicDataAdmission } | { claimed: true; basisRef: string; basisSha256: string; startedAt: string; keySetManifestSha256: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(summaryBytes.toString('utf8')); } catch { return { claimed: false }; }
  if (!isRecord(parsed)) return { claimed: false };
  const dispatch = summaryContractOf(summaryBytes, { pilot: true });
  const pilot = parsed.pilot;
  const kind = isRecord(pilot) && isRecord(pilot.classification) ? pilot.classification.kind : undefined;
  if (dispatch.contract !== PILOT_ACCEPTANCE_CONTRACT || kind !== 'declared-public-data') return { claimed: false };
  const refused = (code: string, reason: string) => ({ claimed: true as const, refusal: notAdmitted(true, code, reason) });
  if (dispatch.conflict) return refused('PUBLIC_DATA_SUMMARY_UNSUPPORTED', dispatch.conflict);
  if (isRecord(pilot) && pilot.runKind === 'R1') return refused('PUBLIC_DATA_NOT_R2', 'only an R2 run is admitted under the declared-public-data basis; this summary states R1 (D-LE-14)');
  const { run, problems } = pilotRunBlock(parsed);
  if (!run) return refused('PUBLIC_DATA_SUMMARY_UNSUPPORTED', problems.join('; '));
  return { claimed: true, basisRef: run.classification.basisRef!, basisSha256: run.classification.basisSha256!, startedAt: run.startedAt, keySetManifestSha256: run.keySet.manifestSha256 };
}

/** The D-LE-14 rule on the bytes of a run summary and of the basis it cites: an R2 pilot summary classified
 * declared-public-data, whose basisSha256 is these bytes, a record in the basis contract naming the pilot study and the
 * sealed key set this run states (so a rehearsal under another key set cannot borrow it), filed before the run started. Pure: `admitPublicDataRun` reads the filed bytes, the package verifier the retained ones. */
export function publicDataAdmissionOf(summaryBytes: Buffer, basisBytes: Buffer): PublicDataAdmission {
  const claim = publicDataClaim(summaryBytes);
  if (!claim.claimed) return notAdmitted(false, 'PUBLIC_DATA_NOT_CLAIMED', 'the run summary claims no declared-public-data basis');
  if ('refusal' in claim) return claim.refusal;
  const actual = hash(basisBytes);
  if (actual !== claim.basisSha256) {
    return notAdmitted(true, 'PUBLIC_DATA_BASIS_HASH_MISMATCH', `the summary cites basis SHA-256 ${claim.basisSha256}; the filed bytes are ${actual}`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(basisBytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { return notAdmitted(true, 'PUBLIC_DATA_BASIS_UNSUPPORTED', 'the filed basis is not JSON'); }
  const shape = membersProblem(parsed, 'the filed basis', PILOT_PUBLIC_DATA_BASIS_MEMBERS);
  if (shape) return notAdmitted(true, 'PUBLIC_DATA_BASIS_UNSUPPORTED', shape);
  const basis = parsed as Record<string, unknown>;
  const gaps = [
    ...(basis.contract === PILOT_PUBLIC_DATA_BASIS_CONTRACT ? [] : [`contract is not ${PILOT_PUBLIC_DATA_BASIS_CONTRACT}`]),
    ...(basis.study === PILOT_STUDY ? [] : [`study is not ${PILOT_STUDY}`]),
    ...(basis.runKind === 'R2' ? [] : ['runKind is not R2']),
    ...(basis.classification === 'declared-public-data' ? [] : ['classification is not declared-public-data']),
    ...(Array.isArray(basis.decisions) && basis.decisions.every(id => isText(id, 64)) && new Set(basis.decisions).size === basis.decisions.length
      && PILOT_PUBLIC_DATA_DECISIONS.every(id => (basis.decisions as unknown[]).includes(id)) ? [] : [`decisions are not distinct ids citing ${PILOT_PUBLIC_DATA_DECISIONS.join(' and ')}`]),
    ...(typeof basis.dataUseManifestSha256 === 'string' && SHA256_HEX.test(basis.dataUseManifestSha256) ? [] : ['dataUseManifestSha256 is not a SHA-256 hex']),
    ...(typeof basis.keySetManifestSha256 === 'string' && SHA256_HEX.test(basis.keySetManifestSha256) ? [] : ['keySetManifestSha256 is not a SHA-256 hex']),
    ...(isText(basis.filedBy, 200) ? [] : ['filedBy is not text']),
    ...(isText(basis.filedRole, 200) ? [] : ['filedRole is not text']),
    ...(isInstant(basis.filedAt) ? [] : ['filedAt is not an RFC 3339 instant']),
  ];
  if (gaps.length) return notAdmitted(true, 'PUBLIC_DATA_BASIS_UNSUPPORTED', gaps.join('; '));
  if (basis.keySetManifestSha256 !== claim.keySetManifestSha256) {
    return notAdmitted(true, 'PUBLIC_DATA_BASIS_KEY_SET_MISMATCH', `the basis covers the sealed key set ${basis.keySetManifestSha256}; this run states ${claim.keySetManifestSha256}`);
  }
  if (Date.parse(basis.filedAt as string) >= Date.parse(claim.startedAt)) {
    return notAdmitted(true, 'PUBLIC_DATA_BASIS_FILED_AFTER_RUN_START', `the basis was filed at ${basis.filedAt}, not before the run started at ${claim.startedAt}`);
  }
  return { admitted: true, claimed: true, basisRef: claim.basisRef, basisSha256: actual, summarySha256: hash(summaryBytes),
    filedBy: basis.filedBy as string, filedAt: basis.filedAt as string, bytes: basisBytes };
}
