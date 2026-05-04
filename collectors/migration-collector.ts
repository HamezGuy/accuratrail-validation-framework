import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';

export interface ColumnDef {
  name: string;
  type: string;
}

export type TableClassification =
  | 'audit'
  | 'signature'
  | 'clinical_data'
  | 'access_control'
  | 'phi'
  | 'system'
  | 'workflow';

export interface TableEntry {
  table: string;
  columns: ColumnDef[];
  isExtension: boolean;
  classification: TableClassification;
  sourceFile: string;
}

const CLASSIFICATION_RULES: { match: RegExp; classification: TableClassification }[] = [
  { match: /audit|trail/i, classification: 'audit' },
  { match: /signature|esign/i, classification: 'signature' },
  { match: /user|role|permission|session|login|credential|token/i, classification: 'access_control' },
  { match: /patient|subject|consent|phi|demographic/i, classification: 'phi' },
  { match: /workflow|task|sdv|review|assignment/i, classification: 'workflow' },
  { match: /form|crf|event|visit|query|lock|freeze|randomiz|rule|validation|transfer|wound|ae|epro/i, classification: 'clinical_data' },
];

/**
 * Reads libreclinicaapi/src/config/migrations.ts and all .sql files
 * in libreclinicaapi/migrations/ to extract table definitions.
 */
export function collectMigrations(workspaceRoot: string): TableEntry[] {
  const entries: TableEntry[] = [];
  const seen = new Set<string>();

  const migrationTs = path.join(
    workspaceRoot, 'libreclinicaapi', 'src', 'config', 'migrations.ts',
  );
  collectFromFile(migrationTs, 'config/migrations.ts', entries, seen);

  const sqlDir = path.join(workspaceRoot, 'libreclinicaapi', 'migrations');
  const sqlPattern = path.join(sqlDir, '*.sql').replace(/\\/g, '/');

  let sqlFiles: string[];
  try {
    sqlFiles = globSync(sqlPattern);
  } catch {
    sqlFiles = [];
  }

  for (const sqlFile of sqlFiles) {
    const relFile = path.relative(
      path.join(workspaceRoot, 'libreclinicaapi'),
      sqlFile,
    ).replace(/\\/g, '/');
    collectFromFile(sqlFile, relFile, entries, seen);
  }

  return entries;
}

function collectFromFile(
  filePath: string,
  sourceLabel: string,
  entries: TableEntry[],
  seen: Set<string>,
): void {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return;
  }

  const createTableRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\);/gi;

  let match: RegExpExecArray | null;
  while ((match = createTableRe.exec(content)) !== null) {
    const tableName = match[1].toLowerCase();
    if (seen.has(tableName)) continue;
    seen.add(tableName);

    const columnsBlock = match[2];
    const columns = parseColumns(columnsBlock);

    entries.push({
      table: tableName,
      columns,
      isExtension: tableName.startsWith('acc_'),
      classification: classifyTable(tableName),
      sourceFile: sourceLabel,
    });
  }
}

function parseColumns(block: string): ColumnDef[] {
  const columns: ColumnDef[] = [];
  const lines = block.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('--')) continue;

    if (/^(PRIMARY\s+KEY|UNIQUE|CHECK|CONSTRAINT|FOREIGN\s+KEY|CREATE\s+INDEX)/i.test(line)) {
      continue;
    }

    const colRe = /^(\w+)\s+(SERIAL|BIGSERIAL|SMALLSERIAL|INTEGER|BIGINT|SMALLINT|NUMERIC|DECIMAL|REAL|DOUBLE PRECISION|BOOLEAN|TEXT|VARCHAR\([^)]*\)|CHAR\([^)]*\)|DATE|TIME|TIMESTAMP(?:\s+WITH(?:OUT)?\s+TIME\s+ZONE)?|INTERVAL|UUID|JSON|JSONB|BYTEA|XML|INET|CIDR|MACADDR|BIT|BIT\s+VARYING\([^)]*\)|INT)/i;
    const m = colRe.exec(line);
    if (m) {
      columns.push({ name: m[1].toLowerCase(), type: m[2].toUpperCase() });
    }
  }

  return columns;
}

function classifyTable(tableName: string): TableClassification {
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.match.test(tableName)) {
      return rule.classification;
    }
  }
  return 'system';
}
