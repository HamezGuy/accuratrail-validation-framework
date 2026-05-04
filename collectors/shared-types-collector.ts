import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';

export interface SharedTypeEntry {
  file: string;
  name: string;
  kind: 'interface' | 'type' | 'enum';
  exportLine: string;
}

/**
 * Reads all .ts files in shared-types/src/ and extracts exported
 * interfaces, types, and enums with their full export line.
 */
export function collectSharedTypes(workspaceRoot: string): SharedTypeEntry[] {
  const srcDir = path.join(workspaceRoot, 'shared-types', 'src');
  const pattern = path.join(srcDir, '*.ts').replace(/\\/g, '/');

  let files: string[];
  try {
    files = globSync(pattern);
  } catch {
    return [];
  }

  const entries: SharedTypeEntry[] = [];

  for (const filePath of files) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const relFile = path.relative(srcDir, filePath).replace(/\\/g, '/');
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
      re = /^(export\s+(?:const\s+)?enum\s+(\w+)[^\n]*)/gm;
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
