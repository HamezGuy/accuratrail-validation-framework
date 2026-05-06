import * as path from 'path';
import { globSync } from 'glob';
import { resolveInteropMiddlewareRoot } from './workspace-paths';

export interface InteropSourceEntry {
  file: string;
}

/**
 * Indexes TypeScript sources under the FHIR ↔ EDC interop middleware (if cloned).
 */
export function collectInteropSources(workspaceRoot: string): InteropSourceEntry[] {
  const root = resolveInteropMiddlewareRoot(workspaceRoot);
  if (!root) return [];

  const pattern = path.join(root, 'src', '**', '*.ts').replace(/\\/g, '/');
  let files: string[];
  try {
    files = globSync(pattern, { ignore: ['**/*.test.ts', '**/__mocks__/**'] });
  } catch {
    return [];
  }

  const srcBase = path.join(root, 'src');
  return files.map((filePath) => ({
    file: path.relative(srcBase, filePath).replace(/\\/g, '/'),
  }));
}
