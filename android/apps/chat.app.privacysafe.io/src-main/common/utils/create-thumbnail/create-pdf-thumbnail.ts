/*
 Copyright (C) 2025 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/
import * as pdfjs from 'pdfjs-dist';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import { schedulerYield } from '@v1nt1248/3nclient-lib/utils';
import { getFileByInfoFromMsg } from '@main/common/utils/files.helper';

export async function makePdfThumbnail(
  byteArray: Uint8Array,
  targetSize: number,
  pageNum = 1,
): Promise<string> {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

  const pdf = await pdfjs.getDocument({ data: byteArray }).promise;
  const page1 = await pdf.getPage(pageNum);

  const viewport = page1.getViewport({ scale: 1 });
  const scaledViewport = page1.getViewport({ scale: targetSize / viewport.width });

  const canvas = document.createElement('canvas');
  canvas.width = scaledViewport.width;
  canvas.height = scaledViewport.height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  await schedulerYield();
  await page1.render({
    canvasContext: ctx,
    canvas,
    viewport,
  }).promise;
  return canvas.toDataURL();
}

export async function createPdfThumbnail(
  { file3n, fileId, incomingMsgId, targetSize = 200 }:
  {
    file3n?: web3n.files.ReadonlyFile,
    fileId?: string;
    incomingMsgId?: string;
    targetSize?: number,
  },
): Promise<Nullable<string>> {
  const processedFile3n = file3n || await getFileByInfoFromMsg(fileId!, incomingMsgId);
  if (!processedFile3n) {
    return null;
  }
  await schedulerYield();

  const byteArray = await (processedFile3n as web3n.files.ReadonlyFile).readBytes();
  if (!byteArray) {
    return null;
  }
  await schedulerYield();

  return makePdfThumbnail(byteArray, targetSize);
}
