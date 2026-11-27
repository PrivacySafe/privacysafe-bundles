import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { schedulerYield } from '@v1nt1248/3nclient-lib/utils';
import { makeLogger } from '@shared/utils/logger';

const log = makeLogger('PdfActions');

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/*
 * !!! byteArray will be consumed
 * */
export async function createPdfThumbnail(byteArray: Uint8Array, targetSize: number): Promise<string> {
  let loadingTask: pdfjs.PDFDocumentLoadingTask | undefined;
  try {
    loadingTask = pdfjs.getDocument({
      data: byteArray,
      disableFontFace: true,
      verbosity: 0,
    });
    const pdf = await loadingTask.promise;
    // !!! in this code line byte array is already empty
    const page1 = await pdf.getPage(1);
    const viewport = page1.getViewport({ scale: 1 });
    // A page size is written by the PDF author: a 1 × 14400 pt page scaled to the
    // target width would need a huge canvas, so the longer side is bounded too.
    const scaledViewport = page1.getViewport({ scale: pdfThumbnailScale(viewport.width, viewport.height, targetSize) });

    const canvas = document.createElement('canvas');
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    const ctx = canvas.getContext('2d')!;

    await schedulerYield();

    await page1.render({
      canvas,
      canvasContext: ctx,
      viewport: scaledViewport,
    }).promise;

    return canvas.toDataURL();
  } catch (e) {
    log.error('Error generating PDF preview:', e);
    throw e;
  } finally {
    if (loadingTask) {
      await loadingTask.destroy();
    }
  }
}

/** The longest side of a PDF thumbnail canvas, in multiples of the target size. */
export const PDF_THUMBNAIL_MAX_ASPECT = 4;

/**
 * The scale that makes the page `targetSize` wide, unless its longer side would
 * then exceed PDF_THUMBNAIL_MAX_ASPECT × targetSize (then the longer side is that).
 */
export function pdfThumbnailScale(width: number, height: number, targetSize: number): number {
  if (!(width > 0) || !(height > 0)) {
    return 1;
  }
  const maxSide = targetSize * PDF_THUMBNAIL_MAX_ASPECT;
  return Math.min(targetSize / width, maxSide / Math.max(width, height));
}
