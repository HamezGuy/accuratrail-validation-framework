import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';

export interface SOPEntry {
  file: string;
  sopNumber: string;
  title: string;
  version: string;
  directory: 'operational' | 'compliance';
}

const SOP_DIRS: { rel: string; label: 'operational' | 'compliance' }[] = [
  { rel: 'ElectronicDataCaptureReal/SOPs_For_Email', label: 'operational' },
  { rel: 'ElectronicDataCaptureReal/COMPLIANCE_DOCUMENTATION', label: 'compliance' },
];

/**
 * Reads all .md files from both SOP directories and extracts
 * title, SOP number, version, and directory classification.
 */
export function collectSOPs(workspaceRoot: string): SOPEntry[] {
  const entries: SOPEntry[] = [];

  for (const dir of SOP_DIRS) {
    const fullDir = path.join(workspaceRoot, dir.rel);
    const pattern = path.join(fullDir, '*.md').replace(/\\/g, '/');

    let files: string[];
    try {
      files = globSync(pattern);
    } catch {
      continue;
    }

    for (const filePath of files) {
      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      const fileName = path.basename(filePath);
      const relFile = path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
      const sopNumber = extractSopNumber(fileName);
      const title = extractTitle(content);
      const version = extractVersion(content);

      entries.push({
        file: relFile,
        sopNumber,
        title,
        version,
        directory: dir.label,
      });
    }
  }

  return entries;
}

function extractSopNumber(fileName: string): string {
  const m = /SOP[-_]?(\d{3})/i.exec(fileName);
  return m ? `SOP-${m[1]}` : '';
}

function extractTitle(content: string): string {
  const headingRe = /^#\s+(.+)$/m;
  const m = headingRe.exec(content);
  return m ? m[1].trim() : '';
}

/**
 * Search the first 20 lines for a version pattern:
 * - "Document Version: X.Y"
 * - "Version: X.Y"
 * - "vX.Y" or "V X.Y"
 */
function extractVersion(content: string): string {
  const lines = content.split('\n').slice(0, 20);
  const versionRe = /(?:Document\s+)?Version[:\s]+(\d+(?:\.\d+)*)/i;
  const shortRe = /\bv\s*(\d+(?:\.\d+)+)\b/i;

  for (const line of lines) {
    const m = versionRe.exec(line);
    if (m) return m[1];

    const sm = shortRe.exec(line);
    if (sm) return sm[1];
  }

  return '';
}
