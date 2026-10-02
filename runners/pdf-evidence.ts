import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

export interface ParsedPdf { pages: number; text: string }

/** Parse retained bytes in a bounded worker. A PDF-looking envelope is insufficient.
 * No URL or document script is evaluated; font assets come from the pinned package.
 * Parsing verifies content, not visible layout, which still needs rendered review. */
export async function parsePdfEvidence(bytes: Buffer): Promise<ParsedPdf> {
  if (bytes.length < 20 || bytes.length > 25 * 1024 * 1024
    || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
    || !bytes.subarray(-1024).includes(Buffer.from('%%EOF'))) {
    throw new Error('Downloaded PDF has no complete bounded PDF envelope.');
  }
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const path = require('node:path');
    (async () => {
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
          const text = content.items.filter(item => typeof item.str === 'string').map(item => item.str).join(' ');
          length += text.length;
          if (length > 1000000) throw new Error('PDF text exceeds the qualification bound.');
          parts.push(text); page.cleanup();
        }
        const result = { pages: document.numPages, text: parts.join('\\n') };
        await loading.destroy(); loading = undefined;
        parentPort.postMessage({ result });
      } catch (error) {
        try { if (loading) await loading.destroy(); } catch {}
        parentPort.postMessage({ error: error instanceof Error ? error.message : 'PDF parsing failed.' });
      }
    })();
  `, { eval: true, workerData: { bytes,
    moduleUrl: pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href,
    packageRoot: require('node:path').dirname(require.resolve('pdfjs-dist/package.json')) },
    resourceLimits: { maxOldGenerationSizeMb: 128 } });
  let timer: NodeJS.Timeout | undefined;
  try {
    return await new Promise<ParsedPdf>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('PDF parsing exceeded its 15-second deadline.')), 15000);
      worker.once('error', () => reject(new Error('PDF parsing worker failed.')));
      worker.once('exit', code => reject(new Error(`PDF parsing worker exited before returning content (${code}).`)));
      worker.once('message', (message: { result?: ParsedPdf; error?: string }) => {
        if (message.error || !message.result || !message.result.text.trim()) reject(new Error(message.error || 'PDF has no readable text.'));
        else resolve(message.result);
      });
    });
  } finally {
    if (timer) clearTimeout(timer);
    await worker.terminate();
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
