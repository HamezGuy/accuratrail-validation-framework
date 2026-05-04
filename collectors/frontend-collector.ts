import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';

export interface FrontendServiceEntry {
  file: string;
  className: string;
  publicMethods: string[];
}

export interface ComponentEntry {
  file: string;
  componentName: string;
  injectedServices: string[];
}

export interface GuardEntry {
  file: string;
  guardName: string;
}

export interface FrontendCollectionResult {
  services: FrontendServiceEntry[];
  components: ComponentEntry[];
  guards: GuardEntry[];
}

/**
 * Reads Angular service, component, and guard files from the frontend
 * project and extracts class names, public methods, and injected services.
 */
export function collectFrontend(workspaceRoot: string): FrontendCollectionResult {
  const appDir = path.join(
    workspaceRoot, 'ElectronicDataCaptureReal', 'src', 'app',
  );

  return {
    services: collectServices(appDir),
    components: collectComponents(appDir),
    guards: collectGuards(appDir),
  };
}

function collectServices(appDir: string): FrontendServiceEntry[] {
  const pattern = path
    .join(appDir, 'services', '**', '*.ts')
    .replace(/\\/g, '/');

  let files: string[];
  try {
    files = globSync(pattern);
  } catch {
    return [];
  }

  const entries: FrontendServiceEntry[] = [];

  for (const filePath of files) {
    if (filePath.endsWith('.spec.ts')) continue;

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const relFile = path.relative(appDir, filePath).replace(/\\/g, '/');
    const classMatch = /export\s+class\s+(\w+)/.exec(content);
    if (!classMatch) continue;

    const className = classMatch[1];
    const publicMethods = extractPublicMethods(content);

    entries.push({ file: relFile, className, publicMethods });
  }

  return entries;
}

function collectComponents(appDir: string): ComponentEntry[] {
  const pattern = path
    .join(appDir, 'components', '**', '*.ts')
    .replace(/\\/g, '/');

  let files: string[];
  try {
    files = globSync(pattern);
  } catch {
    return [];
  }

  const entries: ComponentEntry[] = [];

  for (const filePath of files) {
    if (filePath.endsWith('.spec.ts')) continue;

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const relFile = path.relative(appDir, filePath).replace(/\\/g, '/');
    const classMatch = /export\s+class\s+(\w+)/.exec(content);
    if (!classMatch) continue;

    const componentName = classMatch[1];
    const injectedServices = extractInjectedServices(content);

    entries.push({ file: relFile, componentName, injectedServices });
  }

  return entries;
}

function collectGuards(appDir: string): GuardEntry[] {
  const pattern = path
    .join(appDir, 'guards', '*.ts')
    .replace(/\\/g, '/');

  let files: string[];
  try {
    files = globSync(pattern);
  } catch {
    return [];
  }

  const entries: GuardEntry[] = [];

  for (const filePath of files) {
    if (filePath.endsWith('.spec.ts')) continue;

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const relFile = path.relative(appDir, filePath).replace(/\\/g, '/');

    const classMatch = /export\s+class\s+(\w+)/.exec(content);
    const fnMatch = /export\s+(?:const|function)\s+(\w+)/.exec(content);
    const guardName = classMatch?.[1] ?? fnMatch?.[1] ?? path.basename(filePath, '.ts');

    entries.push({ file: relFile, guardName });
  }

  return entries;
}

/**
 * Extract public method names from an Angular service/class.
 * Matches methods that are NOT private/protected and do not start with `_`.
 */
function extractPublicMethods(content: string): string[] {
  const methods: string[] = [];

  const methodRe = /^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/gm;
  let m: RegExpExecArray | null;
  while ((m = methodRe.exec(content)) !== null) {
    const name = m[1];
    if (
      name === 'constructor' ||
      name === 'ngOnInit' ||
      name === 'ngOnDestroy' ||
      name === 'ngOnChanges' ||
      name === 'ngAfterViewInit' ||
      name.startsWith('_')
    ) {
      continue;
    }

    const lineStart = content.lastIndexOf('\n', m.index) + 1;
    const linePrefix = content.substring(lineStart, m.index);
    if (/\bprivate\b/.test(linePrefix) || /\bprotected\b/.test(linePrefix)) {
      continue;
    }

    if (!methods.includes(name)) {
      methods.push(name);
    }
  }

  return methods;
}

/**
 * Extract injected services from constructor params and `inject()` calls.
 */
function extractInjectedServices(content: string): string[] {
  const services: string[] = [];
  const seen = new Set<string>();

  const ctorRe = /constructor\s*\(([\s\S]*?)\)/;
  const ctorMatch = ctorRe.exec(content);
  if (ctorMatch) {
    const ctorParams = ctorMatch[1];
    const paramTypeRe = /:\s*(\w+)/g;
    let pm: RegExpExecArray | null;
    while ((pm = paramTypeRe.exec(ctorParams)) !== null) {
      const typeName = pm[1];
      if (!seen.has(typeName) && typeName !== 'string' && typeName !== 'number' && typeName !== 'boolean') {
        seen.add(typeName);
        services.push(typeName);
      }
    }
  }

  const injectRe = /=\s*inject\(\s*(\w+)\s*\)/g;
  let im: RegExpExecArray | null;
  while ((im = injectRe.exec(content)) !== null) {
    if (!seen.has(im[1])) {
      seen.add(im[1]);
      services.push(im[1]);
    }
  }

  return services;
}
