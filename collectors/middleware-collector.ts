import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';

export interface MiddlewareEntry {
  file: string;
  name: string;
  description: string;
  isAuthRelated: boolean;
  isAuditRelated: boolean;
  isAccessControl: boolean;
  isValidation: boolean;
  isPart11: boolean;
}

const AUTH_KEYWORDS = ['auth', 'jwt', 'token', 'login', 'session', 'password', 'credential'];
const AUDIT_KEYWORDS = ['audit', 'trail', 'log', 'track'];
const ACCESS_KEYWORDS = ['role', 'permission', 'authorize', 'authorization', 'access', 'rbac'];
const VALIDATION_KEYWORDS = ['validat', 'joi', 'schema', 'sanitiz'];
const PART11_KEYWORDS = ['part11', 'part 11', '21 cfr', 'cfr part', '§11', 'signature', 'compliance'];

/**
 * Reads each .ts file in libreclinicaapi/src/middleware/ and extracts
 * exported names, descriptions, and regulatory relevance flags.
 */
export function collectMiddleware(workspaceRoot: string): MiddlewareEntry[] {
  const middlewareDir = path.join(workspaceRoot, 'libreclinicaapi', 'src', 'middleware');
  const pattern = path.join(middlewareDir, '*.ts').replace(/\\/g, '/');
  let files: string[];

  try {
    files = globSync(pattern);
  } catch {
    return [];
  }

  const entries: MiddlewareEntry[] = [];

  for (const filePath of files) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const relFile = path.relative(middlewareDir, filePath).replace(/\\/g, '/');
    const exportedNames = extractExportedNames(content);
    const description = extractDescription(content);
    const lowerContent = content.toLowerCase();
    const lowerFile = relFile.toLowerCase();
    const searchText = lowerContent + ' ' + lowerFile;

    for (const name of exportedNames) {
      const lowerName = name.toLowerCase();
      const combined = searchText + ' ' + lowerName;

      entries.push({
        file: relFile,
        name,
        description,
        isAuthRelated: matchesAny(combined, AUTH_KEYWORDS),
        isAuditRelated: matchesAny(combined, AUDIT_KEYWORDS),
        isAccessControl: matchesAny(combined, ACCESS_KEYWORDS),
        isValidation: matchesAny(combined, VALIDATION_KEYWORDS),
        isPart11: matchesAny(combined, PART11_KEYWORDS),
      });
    }

    if (exportedNames.length === 0) {
      const baseName = path.basename(relFile, '.ts').replace('.middleware', '');
      entries.push({
        file: relFile,
        name: baseName,
        description,
        isAuthRelated: matchesAny(searchText, AUTH_KEYWORDS),
        isAuditRelated: matchesAny(searchText, AUDIT_KEYWORDS),
        isAccessControl: matchesAny(searchText, ACCESS_KEYWORDS),
        isValidation: matchesAny(searchText, VALIDATION_KEYWORDS),
        isPart11: matchesAny(searchText, PART11_KEYWORDS),
      });
    }
  }

  return entries;
}

function extractExportedNames(content: string): string[] {
  const names: string[] = [];
  const patterns = [
    /export\s+(?:const|let|var)\s+(\w+)/g,
    /export\s+(?:async\s+)?function\s+(\w+)/g,
    /export\s+class\s+(\w+)/g,
    /export\s+interface\s+(\w+)/g,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (!names.includes(m[1])) {
        names.push(m[1]);
      }
    }
  }

  return names;
}

/**
 * Extract the first JSDoc block comment or the first multi-line comment
 * as a trimmed one-liner description.
 */
function extractDescription(content: string): string {
  const jsdocRe = /\/\*\*([\s\S]*?)\*\//;
  const blockRe = /\/\*([\s\S]*?)\*\//;

  const jsdocMatch = jsdocRe.exec(content);
  const raw = jsdocMatch ? jsdocMatch[1] : blockRe.exec(content)?.[1];
  if (!raw) return '';

  return raw
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('@'))
    .join(' ')
    .substring(0, 500);
}

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}
