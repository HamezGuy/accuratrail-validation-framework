import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  currentReleaseIdentity, releaseComponent, releaseComponentText, RELEASE_COMPONENTS, type ReleaseIdentity,
} from '../../runners/release-identity';
import { e6r3StatusRow } from './markdown-writer';
import { SYSTEM_INFO } from '../../config/system-info';
import { currentEvidenceMarking, DEVELOPMENT_RUN_NOTICE, SYNTHETIC_NOTICE } from '../../runners/evidence-capture';

/** The metadata row of a document written into a retained evidence package. */
export const RETAINED_PACKAGE_TEXT = 'Retained evidence package, sealed by its package-manifest.json';

export interface DocumentMeta {
  generatedAt: string;
  frameworkVersion: string;
  systemVersion: string;
  outputDir: string;
  /** The validation framework's own commit, not the system under test. */
  gitHash?: string;
  /** API, UI, core and (version 2) training release under test, when the run was given one. */
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
 * Never the production URL from config/system-info.ts, whatever the target. A
 * version endpoint that did not answer, or answered with an error status, is
 * stated as such: the target was named, not observed (RF-012). */
export function recordedTargetUrl(release: ReleaseIdentity | undefined = currentReleaseIdentity()): string {
  const target = release?.target;
  if (!target?.url) return RECORDED_AT_EXECUTION;
  const url = target.url.replace(/\/health$/, '');
  if (target.error || target.status < 200 || target.status > 299) {
    // Printed in table cells and list items: no cell separator or line break of the message survives.
    const why = target.error ? target.error.replace(/[|\s]+/g, ' ').trim().slice(0, 200) : `HTTP ${target.status}`;
    return `${url} (target named in the release identity; its version endpoint failed at ${target.observedAt}: ${why})`;
  }
  return `${url} (target in the release identity, observed ${target.observedAt})`;
}

/** The system version a record states: the EDC's version label, which names no build, and the
 * release identity that does when the run was given one (IR-041). */
export function systemVersionText(release: ReleaseIdentity | undefined = currentReleaseIdentity()): string {
  return release
    ? `${SYSTEM_INFO.version} (version label); release under test ${release.identityHash}`
    : `${SYSTEM_INFO.version} (version label); release under test not recorded: no release identity was supplied`;
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
    // A version 1 identity names no training release, so its row reads "not recorded".
    for (const name of RELEASE_COMPONENTS) {
      lines.push(`| Release ${name.toUpperCase()} | ${releaseComponentText(releaseComponent(release, name))} |`);
    }
  } else {
    lines.push('| Release Identity | not recorded: no release under test was supplied |');
  }
  lines.push(e6r3StatusRow());
  // The synthetic and not-retained banners, also stated at the top of the document.
  const run = currentEvidenceMarking();
  if (run?.synthetic) lines.push(`| Evidence Classification | ${SYNTHETIC_NOTICE} |`);
  if (run) lines.push(`| Retention | ${run.retained ? RETAINED_PACKAGE_TEXT : DEVELOPMENT_RUN_NOTICE} |`);

  lines.push('');
  return lines.join('\n');
}
