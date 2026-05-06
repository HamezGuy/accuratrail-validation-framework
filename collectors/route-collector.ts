import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';
import { resolveLibreclinicaApiRoot } from './workspace-paths';

export interface RouteEntry {
  file: string;
  method: string;
  path: string;
  middlewares: string[];
  controllerRef: string;
}

/**
 * Reads all .ts files in libreclinicaapi/src/routes/ and extracts
 * router method calls, paths, middleware chains, and controller references.
 */
export function collectRoutes(workspaceRoot: string): RouteEntry[] {
  const apiRoot = resolveLibreclinicaApiRoot(workspaceRoot);
  const routesDir = path.join(apiRoot, 'src', 'routes');
  const pattern = path.join(routesDir, '*.ts').replace(/\\/g, '/');
  let files: string[];

  try {
    files = globSync(pattern);
  } catch {
    return [];
  }

  const entries: RouteEntry[] = [];

  const routerCallRe =
    /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]\s*,([^;]*)\)/g;

  for (const filePath of files) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const relFile = path.relative(routesDir, filePath);

    let match: RegExpExecArray | null;
    while ((match = routerCallRe.exec(content)) !== null) {
      const method = match[1];
      const routePath = match[2];
      const chainRaw = match[3];

      const parts = splitChainArgs(chainRaw);
      const middlewares: string[] = [];
      let controllerRef = '';

      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.startsWith('controller.')) {
          controllerRef = trimmed;
        } else if (isMiddlewareRef(trimmed)) {
          middlewares.push(extractMiddlewareName(trimmed));
        }
      }

      entries.push({
        file: relFile.replace(/\\/g, '/'),
        method,
        path: routePath,
        middlewares,
        controllerRef,
      });
    }
  }

  return entries;
}

/**
 * Split the comma-separated arguments in a router call chain,
 * respecting nested parentheses so that e.g. `requireRole('a','b')`
 * stays as a single token.
 */
function splitChainArgs(raw: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let current = '';

  for (const ch of raw) {
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      current += ch;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      results.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    results.push(current);
  }
  return results;
}

const KNOWN_MIDDLEWARE_PREFIXES = [
  'authMiddleware',
  'requireRole',
  'requirePart11',
  'validate',
  'asyncHandler',
  'authorize',
  'auditMiddleware',
  'rateLimiter',
  'studyScope',
];

function isMiddlewareRef(token: string): boolean {
  const t = token.trim();
  return KNOWN_MIDDLEWARE_PREFIXES.some((prefix) => t.startsWith(prefix));
}

function extractMiddlewareName(token: string): string {
  const t = token.trim();
  const parenIdx = t.indexOf('(');
  if (parenIdx === -1) return t;

  const name = t.substring(0, parenIdx);
  const argsRaw = t.substring(parenIdx + 1, t.lastIndexOf(')'));
  if (!argsRaw.trim()) return name + '()';

  return `${name}(${argsRaw.trim()})`;
}
