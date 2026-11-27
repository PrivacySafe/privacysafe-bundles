import { describe, expect, it, vi } from 'vitest';

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs?url', () => ({ default: '' }));

const { PDF_THUMBNAIL_MAX_ASPECT, pdfThumbnailScale } = await import('../../../src/utils/pdf-actions.ts');

// Security audit 2026-11: the page size is written by the PDF author, and a very tall page
// scaled to the thumbnail width needed a canvas of any height.
describe('pdfThumbnailScale', () => {
  it('scales an ordinary page to the target width', () => {
    expect(pdfThumbnailScale(595, 842, 200)).toBeCloseTo(200 / 595);
  });

  it('bounds the longer side of an extreme page', () => {
    const scale = pdfThumbnailScale(1, 14400, 200);

    expect(14400 * scale).toBeCloseTo(200 * PDF_THUMBNAIL_MAX_ASPECT);
  });

  it('copes with an empty page size', () => {
    expect(pdfThumbnailScale(0, 0, 200)).toBe(1);
  });
});
