import * as fs from 'fs';
import * as path from 'path';
import { resolveLibreclinicaApiRoot } from './workspace-paths';

export interface SharedTypeEntry {
  file: string;
  name: string;
  kind: 'interface' | 'type' | 'enum';
  exportLine: string;
}

/** Where the API installs the shared types build it runs (a vendored archive with its
 * receipt; IQ-008 verifies the installation against that receipt). */
export function installedSharedTypesRoot(workspaceRoot: string): string {
  return path.join(resolveLibreclinicaApiRoot(workspaceRoot), 'node_modules', '@accura-trial', 'shared-types');
}

/**
 * Reads the declaration files of the shared types build the API installs, the
 * top-level dist/*.d.ts files its release-manifest.json lists, and extracts
 * exported interfaces, types, and enums with their full export line. So the
 * design specification describes the build under test, not a source checkout.
 */
export function collectSharedTypes(workspaceRoot: string): SharedTypeEntry[] {
  const installed = installedSharedTypesRoot(workspaceRoot);

  let files: string[];
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(installed, 'release-manifest.json'), 'utf-8')) as {
      runtimeFiles?: Array<{ path?: unknown }>;
    };
    files = (manifest.runtimeFiles ?? [])
      .map(file => file.path)
      .filter((file): file is string => typeof file === 'string' && /^dist\/[^/]+\.d\.ts$/.test(file))
      .sort();
  } catch {
    return [];
  }

  const entries: SharedTypeEntry[] = [];

  for (const relFile of files) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(installed, ...relFile.split('/')), 'utf-8');
    } catch {
      continue;
    }

    extractKind(content, relFile, 'interface', entries);
    extractKind(content, relFile, 'type', entries);
    extractKind(content, relFile, 'enum', entries);
  }

  return entries;
}

function extractKind(
  content: string,
  relFile: string,
  kind: 'interface' | 'type' | 'enum',
  entries: SharedTypeEntry[],
): void {
  let re: RegExp;
  switch (kind) {
    case 'interface':
      re = /^(export\s+interface\s+(\w+)[^\n]*)/gm;
      break;
    case 'type':
      re = /^(export\s+type\s+(\w+)[^\n]*)/gm;
      break;
    case 'enum':
      // Declaration files emit enums as `export declare enum` or `export declare const enum`.
      re = /^(export\s+(?:declare\s+)?(?:const\s+)?enum\s+(\w+)[^\n]*)/gm;
      break;
  }

  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    entries.push({
      file: relFile,
      name: m[2],
      kind,
      exportLine: m[1].trim(),
    });
  }
}
