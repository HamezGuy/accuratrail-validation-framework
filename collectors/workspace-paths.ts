import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve canonical project roots under the AccuraTrial workspace.
 * Supports both historical folder names (libreclinicaapi, interop-middleware)
 * and the names used in this workspace (libreclinica-api, accuratrial-interop-middleware).
 */
function firstExisting(
  workspaceRoot: string,
  candidates: readonly string[],
): string | null {
  for (const rel of candidates) {
    const full = path.join(workspaceRoot, rel);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
        return full;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/** Root of the main REST API (libreclinica-api). */
export function resolveLibreclinicaApiRoot(workspaceRoot: string): string {
  const found = firstExisting(workspaceRoot, ['libreclinica-api', 'libreclinicaapi']);
  return found ?? path.join(workspaceRoot, 'libreclinica-api');
}

/** Root of FHIR ↔ EDC interop middleware, if present. */
export function resolveInteropMiddlewareRoot(workspaceRoot: string): string | null {
  return firstExisting(workspaceRoot, [
    'accuratrial-interop-middleware',
    'interop-middleware',
  ]);
}

/** Root of standalone training service, if present. */
export function resolveTrainingModuleRoot(workspaceRoot: string): string | null {
  return firstExisting(workspaceRoot, ['accura-training-module', 'training-module']);
}
