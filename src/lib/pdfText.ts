// Text out of a resume PDF, on your device, with pdf.js. Loaded only when you click
// Read resume, so the Options page doesn't carry it otherwise.
import { linesFromItems, type Line, type LinkTarget, type PdfItem } from './resumeParse';

/** Every page's lines in reading order, plus the PDF's link targets (a "LinkedIn" word can hide the address). */
export async function readPdfLines(data: ArrayBuffer): Promise<{ lines: Line[]; links: LinkTarget[] }> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  try {
    return await linesFromDoc(await task.promise);
  } finally {
    await task.destroy();
  }
}

interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<{
    view: number[];
    getTextContent(): Promise<{ items: unknown[] }>;
    getAnnotations(): Promise<{ subtype?: string; url?: string; unsafeUrl?: string; rect?: number[] }[]>;
  }>;
}

/** Shared with the tests, which load pdf.js's Node build. */
export async function linesFromDoc(doc: PdfDoc): Promise<{ lines: Line[]; links: LinkTarget[] }> {
  const lines: Line[] = [];
  const links: LinkTarget[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items = content.items.filter((it): it is PdfItem => typeof (it as PdfItem).str === 'string');
    lines.push(...linesFromItems(items, n - 1, page.view[3]));
    for (const a of await page.getAnnotations()) {
      const url = a.url ?? a.unsafeUrl;
      if (a.subtype === 'Link' && url) links.push({ url, page: n - 1, y: page.view[3] - (a.rect?.[3] ?? 0) });
    }
  }
  // Pages in order, then top to bottom.
  lines.sort((p, q) => p.page - q.page || p.y - q.y);
  return { lines, links };
}
