import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { currentReleaseIdentity, type ReleaseIdentity } from '../../runners/release-identity';
import { ICH_E6_R3, E6_R3_SECTION_STATUS } from '../../config/regulatory-scope';

export interface DocumentMeta {
  generatedAt: string;
  frameworkVersion: string;
  systemVersion: string;
  outputDir: string;
  /** The validation framework's own commit, not the system under test. */
  gitHash?: string;
  /** API, UI and core release under test, when the run was given one. */
  releaseIdentity?: ReleaseIdentity;
}

export function getDocumentMeta(outputDir: string): DocumentMeta {
  let gitHash: string | undefined;
  try {
    // Ask the framework's own checkout, whatever the caller's working directory.
    const raw = execFileSync('git', ['-C', path.resolve(__dirname, '..', '..'), 'rev-parse', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
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
    releaseIdentity: currentReleaseIdentity(),
  };
}

/** Stated for any part of the environment under test that the run did not observe. */
export const RECORDED_AT_EXECUTION = 'Recorded at execution';

/** The API a protocol or execution record names as the environment under test:
 * the target the run's release identity observed, else "Recorded at execution".
 * Never the production URL from config/system-info.ts, whatever the target. */
export function recordedTargetUrl(release: ReleaseIdentity | undefined = currentReleaseIdentity()): string {
  const target = release?.target;
  if (!target?.url) return RECORDED_AT_EXECUTION;
  return `${target.url.replace(/\/health$/, '')} (target in the release identity, observed ${target.observedAt})`;
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
    lines.push(`| Framework Commit | ${meta.gitHash} |`);
  }
  const release = meta.releaseIdentity;
  if (release) {
    lines.push(`| Release Identity | ${release.identityHash} |`);
    for (const name of ['api', 'ui', 'core'] as const) {
      const component = release.components[name];
      lines.push(`| Release ${name.toUpperCase()} | ${component.kind} ${component.identity} |`);
    }
  } else {
    lines.push('| Release Identity | not recorded: no release under test was supplied |');
  }
  lines.push(`| ${ICH_E6_R3.citation} Section References | ${E6_R3_SECTION_STATUS} |`);

  lines.push('');
  return lines.join('\n');
}
