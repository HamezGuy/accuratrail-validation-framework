import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Vendored package archives and their receipts (`<archive>.json`), as a package.json
// installs them. IQ-008 and IQ-035 read them in a checkout's working tree; the release
// identity reads them in the framework checkout and, at the --release-api commit, in the
// API checkout (IR-272). The IQ runner and the release identity share this one reader.

/** A package.json value that installs a vendored archive; no path separator may follow vendor/. */
export const VENDORED_SELECTOR = /^file:vendor\/[A-Za-z0-9._-]+\.tgz$/;

export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export const sha512Integrity = (bytes: Buffer) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** JSON text without a leading byte order mark, which JSON.parse refuses. */
export const withoutBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

export function safeParseJson(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** A dependency's declared version in dependencies, then devDependencies. */
export function declaredDependency(pkg: Record<string, unknown> | null, name: string): string {
  for (const group of ['dependencies', 'devDependencies']) {
    const deps = pkg?.[group];
    if (typeof deps === 'object' && deps !== null && !Array.isArray(deps)
      && typeof (deps as Record<string, unknown>)[name] === 'string') return (deps as Record<string, string>)[name];
  }
  return '';
}

/** Reads a file of a checkout by its absolute path; throws when it cannot be read. */
export type CheckoutFileReader = (file: string) => Buffer;

/** The files of a checkout's working tree. */
export const workingTreeFiles: CheckoutFileReader = file => fs.readFileSync(file);

/** The files of `commit` in the checkout at `root` (its git top level), as git show reads
 * them; a file the commit does not hold throws NOT_IN_COMMIT. The working tree is not read. */
export function commitFiles(root: string, commit: string): CheckoutFileReader {
  return file => {
    const relative = path.relative(root, file).split(path.sep).join('/');
    try {
      return execFileSync('git', ['-C', root, 'show', `${commit}:${relative}`],
        { stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
    } catch {
      throw Object.assign(new Error(`${relative} is not in commit ${commit}`), { code: 'NOT_IN_COMMIT' });
    }
  };
}

/** A vendored archive a package.json installs, read with its receipt (`<archive>.json`).
 * IQ-008 hands the receipt to the EDC's verifier; IQ-035 checks every vendored
 * dependency of the API with it. */
export interface VendoredArchive {
  packageName: string;
  selector: string;
  archive: string;
  receiptPath: string;
  receipt: Record<string, unknown> | null;
  bytes: number | null;
  sha256: string | null;
  /** The archive's SHA-512 in the lockfile's integrity form. */
  integrity: string | null;
  /** Empty when the receipt exists and its filename, byte count, SHA-256, integrity
   * and package name describe the archive's bytes. */
  problems: string[];
}

/** Reads the archive `selector` names under `root`, and its receipt, from the working tree
 * unless another reader (a commit's files) is given. */
export function readVendoredArchive(
  root: string, packageName: string, selector: string, files: CheckoutFileReader = workingTreeFiles,
): VendoredArchive {
  const archive = path.resolve(root, selector.replace(/^file:/, ''));
  const receiptPath = `${archive}.json`;
  const result: VendoredArchive = {
    packageName, selector, archive, receiptPath, receipt: null, bytes: null, sha256: null, integrity: null, problems: [],
  };
  if (!VENDORED_SELECTOR.test(selector)) {
    result.problems.push(`${packageName} is not installed from a vendored archive (${JSON.stringify(selector)})`);
    return result;
  }
  let bytes: Buffer | undefined;
  try {
    bytes = files(archive);
    result.bytes = bytes.length;
    result.sha256 = sha256(bytes);
    result.integrity = sha512Integrity(bytes);
  } catch (error) {
    result.problems.push(`archive ${archive} cannot be read (${(error as NodeJS.ErrnoException).code ?? errorText(error)})`);
  }
  let receiptText: string | null;
  try { receiptText = files(receiptPath).toString('utf-8'); }
  catch { receiptText = null; }
  if (receiptText === null) {
    result.problems.push(`no receipt ${receiptPath}`);
    return result;
  }
  result.receipt = safeParseJson(withoutBom(receiptText));
  if (!result.receipt) {
    result.problems.push(`receipt ${receiptPath} is not a JSON object`);
    return result;
  }
  if (!bytes) return result;
  const receipt = result.receipt;
  if (receipt.packageName !== packageName) result.problems.push(`receipt ${receiptPath} names package ${JSON.stringify(receipt.packageName)}`);
  if (receipt.filename !== path.basename(archive)) result.problems.push(`receipt ${receiptPath} names file ${JSON.stringify(receipt.filename)}`);
  if (receipt.byteLength !== bytes.length) result.problems.push(`archive ${archive} has ${bytes.length} bytes, its receipt ${JSON.stringify(receipt.byteLength)}`);
  if (receipt.sha256 !== result.sha256) result.problems.push(`archive ${archive} does not match its receipt's SHA-256`);
  if (receipt.integrity !== undefined && receipt.integrity !== result.integrity) {
    result.problems.push(`archive ${archive} does not match its receipt's integrity`);
  }
  return result;
}
