import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { StudyContent } from './study-definition-client';

export const SYNTHETIC_DOCUMENT_SHA256 = '8babd346e3e6b5ce39fe4946513a78110fc8482d36ad8bb9df6b9f06bedceb66';
const DEFINITION_SHA256 = '4ba4504abbd053b1d148170b277a5c35b00356d60712264d1e12bafccf74a3ef';

/** Gibbs' exact synthetic USDM document. Native identifiers are local fixture
 * routing only; changing one never rewrites or remints the validated USDM graph. */
export function syntheticStudyDefinition(nativeIdentifier: string): StudyContent {
  const relative = 'fixtures/synthetic-usdm4-core';
  const directory = [join(__dirname, '..', relative), join(__dirname, '..', '..', relative)]
    .find(candidate => existsSync(join(candidate, 'synthetic-usdm4.json')));
  if (!directory) throw new Error('Pinned synthetic USDM qualification fixture is missing.');
  const documentBytes = readFileSync(join(directory, 'synthetic-usdm4.json'));
  const definitionBytes = readFileSync(join(directory, 'synthetic-definition.json'));
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  if (hash(documentBytes) !== SYNTHETIC_DOCUMENT_SHA256 || hash(definitionBytes) !== DEFINITION_SHA256) {
    throw new Error('Pinned synthetic USDM qualification fixture failed its checksum.');
  }
  const definition = JSON.parse(definitionBytes.toString('utf8')) as StudyContent;
  if (!isDeepStrictEqual(definition.document, JSON.parse(documentBytes.toString('utf8')))) {
    throw new Error('Synthetic qualification envelope differs from the validated document.');
  }
  if (!nativeIdentifier.trim()) throw new Error('A local synthetic fixture identifier is required.');
  definition.execution.identification.nativeIdentifier = nativeIdentifier;
  return definition;
}

export function qualificationOptions(args: readonly string[], baseUrl: string): {
  acknowledgeUngoverned?: boolean; acknowledgeIncomplete?: boolean;
} {
  if (!args.includes('--synthetic-qualification')) throw new Error('Explicit --synthetic-qualification is required for release/activation testing.');
  const hostname = new URL(baseUrl).hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname) && !args.includes('--allow-production-qualification')) {
    throw new Error('Nonlocal qualification requires explicit --allow-production-qualification.');
  }
  // No inferred approval from a failed server response. Unknown governance or
  // missing forms remains a refusal unless the operator supplied the exact flag.
  return {
    ...(args.includes('--acknowledge-ungoverned') ? { acknowledgeUngoverned: true } : {}),
    ...(args.includes('--acknowledge-incomplete') ? { acknowledgeIncomplete: true } : {}),
  };
}
