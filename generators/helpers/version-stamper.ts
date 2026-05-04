import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface DocumentMeta {
  generatedAt: string;
  frameworkVersion: string;
  systemVersion: string;
  outputDir: string;
  gitHash?: string;
}

export function getDocumentMeta(outputDir: string): DocumentMeta {
  let gitHash: string | undefined;
  try {
    const raw = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (raw.length > 0) {
      gitHash = raw;
    }
  } catch {
    gitHash = undefined;
  }

  let frameworkVersion = '1.0.0';
  try {
    const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
    if (fs.existsSync(pkgPath)) {
      const raw = fs.readFileSync(pkgPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'version' in parsed &&
        typeof (parsed as Record<string, unknown>).version === 'string'
      ) {
        frameworkVersion = (parsed as Record<string, unknown>).version as string;
      }
    }
  } catch {
    // Fall back to default version
  }

  let systemVersion = '1.0.0';
  try {
    const sysInfoPath = path.resolve(__dirname, '..', '..', 'config', 'system-info.ts');
    if (fs.existsSync(sysInfoPath)) {
      const content = fs.readFileSync(sysInfoPath, 'utf-8');
      const match = content.match(/version:\s*['"]([^'"]+)['"]/);
      if (match && match[1]) {
        systemVersion = match[1];
      }
    }
  } catch {
    // Fall back to default version
  }

  return {
    generatedAt: new Date().toISOString(),
    frameworkVersion,
    systemVersion,
    outputDir,
    gitHash,
  };
}

export function stampDocument(content: string, meta: DocumentMeta): string {
  const lines: string[] = [
    content.trimEnd(),
    '',
    '---',
    '',
    '*Document Metadata (auto-generated — do not edit)*',
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Generated At | ${meta.generatedAt} |`,
    `| Framework Version | ${meta.frameworkVersion} |`,
    `| System Version | ${meta.systemVersion} |`,
    `| Output Directory | ${meta.outputDir} |`,
  ];

  if (meta.gitHash) {
    lines.push(`| Git Commit | ${meta.gitHash} |`);
  }

  lines.push('');
  return lines.join('\n');
}

export function createOutputDir(baseOutputDir: string, versionLabel?: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const dirName = versionLabel
    ? `${timestamp}_${versionLabel}`
    : timestamp;
  const fullPath = path.join(baseOutputDir, dirName);

  fs.mkdirSync(fullPath, { recursive: true });

  return fullPath;
}
