import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';

export interface ServiceExport {
  name: string;
  signature: string;
  isAsync: boolean;
}

export interface ServiceEntry {
  file: string;
  category: ServiceCategory;
  exports: ServiceExport[];
}

export type ServiceCategory =
  | 'database'
  | 'hybrid'
  | 'soap'
  | 'ai'
  | 'backup'
  | 'email'
  | 'export'
  | 'import'
  | 'consent'
  | 'ae'
  | 'pdf'
  | 'other';

const CATEGORY_DIRS: Record<string, ServiceCategory> = {
  database: 'database',
  hybrid: 'hybrid',
  soap: 'soap',
  ai: 'ai',
  backup: 'backup',
  email: 'email',
  export: 'export',
  import: 'import',
  consent: 'consent',
  ae: 'ae',
  pdf: 'pdf',
};

/**
 * Reads all .ts files recursively under libreclinicaapi/src/services/
 * and extracts service metadata, categories, and exported function signatures.
 */
export function collectServices(workspaceRoot: string): ServiceEntry[] {
  const servicesDir = path.join(workspaceRoot, 'libreclinicaapi', 'src', 'services');
  const pattern = path.join(servicesDir, '**', '*.ts').replace(/\\/g, '/');
  let files: string[];

  try {
    files = globSync(pattern);
  } catch {
    return [];
  }

  const entries: ServiceEntry[] = [];

  for (const filePath of files) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const relFile = path.relative(servicesDir, filePath).replace(/\\/g, '/');
    const category = inferCategory(relFile);
    const exports = extractServiceExports(content);

    entries.push({ file: relFile, category, exports });
  }

  return entries;
}

function inferCategory(relPath: string): ServiceCategory {
  const firstSegment = relPath.split('/')[0];
  return CATEGORY_DIRS[firstSegment] ?? 'other';
}

function extractServiceExports(content: string): ServiceExport[] {
  const exports: ServiceExport[] = [];
  const seen = new Set<string>();

  const asyncFnRe = /export\s+async\s+function\s+(\w+)\s*(\([^)]*\))/g;
  let m: RegExpExecArray | null;
  while ((m = asyncFnRe.exec(content)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      exports.push({
        name: m[1],
        signature: `${m[1]}${m[2]}`,
        isAsync: true,
      });
    }
  }

  const syncFnRe = /export\s+function\s+(\w+)\s*(\([^)]*\))/g;
  while ((m = syncFnRe.exec(content)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      exports.push({
        name: m[1],
        signature: `${m[1]}${m[2]}`,
        isAsync: false,
      });
    }
  }

  const classRe = /export\s+class\s+(\w+)/g;
  while ((m = classRe.exec(content)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      exports.push({
        name: m[1],
        signature: `class ${m[1]}`,
        isAsync: false,
      });
    }
  }

  return exports;
}
