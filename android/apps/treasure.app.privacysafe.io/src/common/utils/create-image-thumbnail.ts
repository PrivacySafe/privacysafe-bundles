/*
 Copyright (C) 2026 3NSoft Inc.

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
import { appTreasureDenoSrv } from '@/common/services/service-provider';

export async function createImageThumbnail(imageId: string, size = 44): Promise<string> {
  const imageBytes = await appTreasureDenoSrv.loadImage(imageId);
  if (!imageBytes) {
    return '';
  }

  const blob = new Blob([imageBytes as BlobPart]);

  const bitmap = await createImageBitmap(blob, {
    imageOrientation: 'from-image',
    premultiplyAlpha: 'none',
  });

  try {
    const scale = size / Math.max(bitmap.width, bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      throw new Error('Canvas context failed');
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(bitmap, 0, 0, width, height);

    return canvas.toDataURL('image/webp', 0.8);
  } finally {
    bitmap.close();
  }
}
