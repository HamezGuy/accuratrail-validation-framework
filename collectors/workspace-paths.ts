import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve canonical project roots under the AccuraTrial workspace.
 * Supports both historical folder names (libreclinicaapi, interop-middleware,
 * ElectronicDataCaptureReal, shared-types) and the names used in this workspace
 * (libreclinica-api, accuratrial-interop-middleware, EDCProjectCompliant,
 * accuratrial-shared-types).
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

/** The AccuraTrial workspace containing this framework checkout. Runners fall back
 * to it when generate.ts does not hand them an explicit workspace root. */
export function defaultWorkspaceRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

/** Root of the main REST API (libreclinica-api). */
export function resolveLibreclinicaApiRoot(workspaceRoot: string): string {
  const found = firstExisting(workspaceRoot, ['libreclinica-api', 'libreclinicaapi']);
  return found ?? path.join(workspaceRoot, 'libreclinica-api');
}

/** Root of the Angular frontend (EDCProjectCompliant; ElectronicDataCaptureReal is
 * its historical name). Like the API, a missing frontend resolves to the current
 * name, so a check that reads it fails naming that path. */
export function resolveFrontendRoot(workspaceRoot: string): string {
  const found = firstExisting(workspaceRoot, ['EDCProjectCompliant', 'ElectronicDataCaptureReal']);
  return found ?? path.join(workspaceRoot, 'EDCProjectCompliant');
}

/** Source checkout of @accura-trial/shared-types, if present. Consumers install the
 * package from vendored archives, so the IQ never reads this tree; it serves the
 * platform inventory. */
export function resolveSharedTypesRoot(workspaceRoot: string): string | null {
  return firstExisting(workspaceRoot, ['accuratrial-shared-types', 'shared-types']);
}

/** Root of FHIR ↔ EDC interop middleware, if present. */
export function resolveInteropMiddlewareRoot(workspaceRoot: string): string | null {
  return firstExisting(workspaceRoot, [
    'accuratrial-interop-middleware',
    'interop-middleware',
  ]);
}

/** Root of the live workflow suite (accuratrial-tests-live), if present. */
export function resolveTestsLiveRoot(workspaceRoot: string): string | null {
  return firstExisting(workspaceRoot, ['accuratrial-tests-live', 'tests-live']);
}

/** Root of standalone training service, if present. */
export function resolveTrainingModuleRoot(workspaceRoot: string): string | null {
  return firstExisting(workspaceRoot, ['accura-training-module', 'training-module']);
}
