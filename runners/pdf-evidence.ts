import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export interface ParsedPdf { pages: number; text: string }

/** PDF.js splits a word where the glyph run changes: Chromium sets "fi" as a
 * ligature run, so "confirm" arrives as "con", "fi", "rm" abutting on one
 * line. Abutting items join without a space; a line end, a new line or a
 * visible gap is a space. The parser worker embeds this exact function. */
export function joinPdfTextItems(items: ReadonlyArray<{ str?: unknown; width?: number; hasEOL?: boolean; transform?: number[] }>): string {
  let text = '';
  let previous: { width?: number; hasEOL?: boolean; transform?: number[] } | null = null;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    if (previous) {
      const before = previous.transform, after = item.transform;
      const abutting = !previous.hasEOL && Array.isArray(before) && Array.isArray(after)
        && Math.abs(after[5] - before[5]) < 0.5 && Math.abs(after[4] - (before[4] + (previous.width ?? 0))) <= 0.5;
      if (!abutting) text += ' ';
    }
    text += item.str;
    previous = item;
  }
  return text;
}

/** Parse retained bytes in a bounded process. A PDF-looking envelope is insufficient.
 * No URL or document script is evaluated; font assets come from the pinned package.
 * Native font-library faults must not terminate the qualification controller.
 * Parsing verifies content, not visible layout, which still needs rendered review. */
export async function parsePdfEvidence(bytes: Buffer): Promise<ParsedPdf> {
  if (bytes.length < 20 || bytes.length > 25 * 1024 * 1024
    || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
    || !bytes.subarray(-1024).includes(Buffer.from('%%EOF'))) {
    throw new Error('Downloaded PDF has no complete bounded PDF envelope.');
  }
  const script = `
    const path = require('node:path');
    const joinPdfTextItems = ${joinPdfTextItems.toString()};
    process.once('message', async (workerData) => {
      let loading;
      try {
        const pdfjs = await import(workerData.moduleUrl);
        loading = pdfjs.getDocument({ data: new Uint8Array(workerData.bytes),
          isEvalSupported: false, stopAtErrors: true, useSystemFonts: false,
          useWorkerFetch: false, disableFontFace: true, enableXfa: false,
          standardFontDataUrl: path.join(workerData.packageRoot, 'standard_fonts') + path.sep,
          cMapUrl: path.join(workerData.packageRoot, 'cmaps') + path.sep, cMapPacked: true,
          verbosity: 0 });
        const document = await loading.promise;
        if (!Number.isSafeInteger(document.numPages) || document.numPages < 1 || document.numPages > 200)
          throw new Error('PDF page count is outside the qualification bound.');
        const parts = []; let length = 0;
        for (let index = 1; index <= document.numPages; index++) {
          const page = await document.getPage(index);
          const content = await page.getTextContent();
          const text = joinPdfTextItems(content.items);
          length += text.length;
          if (length > 1000000) throw new Error('PDF text exceeds the qualification bound.');
          parts.push(text); page.cleanup();
        }
        const result = { pages: document.numPages, text: parts.join('\\n') };
        await loading.destroy(); loading = undefined;
        process.send({ result }, () => process.disconnect());
      } catch (error) {
        try { if (loading) await loading.destroy(); } catch {}
        process.send({ error: error instanceof Error ? error.message : 'PDF parsing failed.' }, () => process.disconnect());
      }
    });
  `;
  // Resolve every dependency before creating a child that needs cleanup custody.
  const input = { bytes,
    moduleUrl: pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href,
    packageRoot: require('node:path').dirname(require.resolve('pdfjs-dist/package.json')) };
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL']) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  const child = spawn(process.execPath, ['--max-old-space-size=128', '-e', script], {
    env, windowsHide: true, serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let closed = false;
  const exit = new Promise<void>(resolve => child.once('close', () => { closed = true; resolve(); }));
  let timer: NodeJS.Timeout | undefined;
  try {
    return await new Promise<ParsedPdf>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('PDF parsing exceeded its 15-second deadline.')), 15000);
      let output: { result?: ParsedPdf; error?: string } | undefined;
      child.once('error', () => reject(new Error('PDF parsing process failed to start.')));
      child.once('message', message => { output = message as typeof output; });
      // A result is not accepted until the exact child has exited successfully.
      child.once('close', (code, signal) => {
        if (code !== 0) reject(new Error(`PDF parsing process failed (${signal ?? code}).`));
        else if (output?.error || !output?.result || typeof output.result.text !== 'string' || !output.result.text.trim()
          || output.result.text.length > 1000000 || !Number.isSafeInteger(output.result.pages)
          || output.result.pages < 1 || output.result.pages > 200)
          reject(new Error(typeof output?.error === 'string' ? output.error : 'PDF has no readable text or a malformed parser result.'));
        else resolve(output.result);
      });
      child.send(input, error => { if (error) reject(new Error('PDF parsing input could not be delivered.')); });
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (!closed) {
      child.kill('SIGKILL');
      let cleanupTimer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([exit, new Promise<never>((_, reject) => {
          cleanupTimer = setTimeout(() => reject(new Error('PDF parsing process termination could not be confirmed.')), 5000);
        })]);
      } finally { if (cleanupTimer) clearTimeout(cleanupTimer); }
    }
  }
}

export const normalizedPdfText = (text: string): string => text.normalize('NFC').replace(/\s+/gu, ' ').trim();

/** A value must appear beside its field label, not somewhere in a date or audit row. */
export function requirePrintedRow(text: string, cells: string[], description: string): void {
  const escape = (value: string) => normalizedPdfText(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = cells.map(escape).join('\\s+(?:\\*\\s*)?(?:○\\s*)?');
  if (!cells.length || cells.some(cell => !normalizedPdfText(cell))
    || !new RegExp(`(?:^|\\s)${pattern}(?=\\s|$)`, 'u').test(normalizedPdfText(text))) {
    throw new Error(`PDF does not preserve ${description}.`);
  }
}
