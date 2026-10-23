import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { schedulerYield } from '@v1nt1248/3nclient-lib/utils';

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
    const scaledViewport = page1.getViewport({ scale: targetSize / viewport.width });

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
    console.error('Error generating PDF preview:', e);
    throw e;
  } finally {
    if (loadingTask) {
      await loadingTask.destroy();
    }
  }
}
