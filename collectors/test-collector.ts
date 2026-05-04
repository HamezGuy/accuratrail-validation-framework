import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';

export interface TestEntry {
  file: string;
  name: string;
  endpoints: string[];
  featureKeywords: string[];
}

const FEATURE_KEYWORDS = [
  'signature', 'audit', 'login', 'query', 'lock', 'freeze',
  'export', 'form', 'patient', 'study', 'workflow', 'sdv',
  'validation', 'randomization',
] as const;

/**
 * Reads all .ts files in tests-live/scripts/ recursively and extracts
 * test metadata: name, API endpoints called, and feature keywords.
 */
export function collectTests(workspaceRoot: string): TestEntry[] {
  const scriptsDir = path.join(workspaceRoot, 'tests-live', 'scripts');
  const pattern = path.join(scriptsDir, '**', '*.ts').replace(/\\/g, '/');

  let files: string[];
  try {
    files = globSync(pattern);
  } catch {
    return [];
  }

  const entries: TestEntry[] = [];

  for (const filePath of files) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const relFile = path.relative(scriptsDir, filePath).replace(/\\/g, '/');
    const name = extractTestName(content, relFile);
    const endpoints = extractEndpoints(content);
    const featureKeywords = extractFeatureKeywords(content);

    entries.push({ file: relFile, name, endpoints, featureKeywords });
  }

  return entries;
}

/**
 * Try to find a test name from:
 * 1. `logHeader('...')` call
 * 2. First JSDoc comment summary line
 * 3. `const SCRIPT = '...'`
 * 4. Fall back to filename
 */
function extractTestName(content: string, relFile: string): string {
  const logHeaderRe = /logHeader\(\s*['"`]([^'"`]+)['"`]/;
  const logMatch = logHeaderRe.exec(content);
  if (logMatch) return logMatch[1];

  const jsdocRe = /\/\*\*\s*\n\s*\*\s*(.+)/;
  const jsdocMatch = jsdocRe.exec(content);
  if (jsdocMatch) return jsdocMatch[1].replace(/\s*\*\/$/, '').trim();

  const scriptRe = /const\s+SCRIPT\s*=\s*['"`]([^'"`]+)['"`]/;
  const scriptMatch = scriptRe.exec(content);
  if (scriptMatch) return scriptMatch[1];

  return path.basename(relFile, '.ts');
}

function extractEndpoints(content: string): string[] {
  const endpointRe = /['"`](\/api\/[^'"`\s]+)['"`]/g;
  const endpoints = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = endpointRe.exec(content)) !== null) {
    endpoints.add(m[1]);
  }

  const urlSegmentRe = /url:\s*['"`](\/[^'"`\s]+)['"`]/g;
  while ((m = urlSegmentRe.exec(content)) !== null) {
    const ep = m[1];
    if (!ep.startsWith('/api/')) {
      endpoints.add(`/api${ep.startsWith('/') ? '' : '/'}${ep}`);
    }
  }

  return Array.from(endpoints).sort();
}

function extractFeatureKeywords(content: string): string[] {
  const lower = content.toLowerCase();
  return FEATURE_KEYWORDS.filter((kw) => lower.includes(kw));
}
