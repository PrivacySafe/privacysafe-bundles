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
import { ENTITY_ICON_MAX_LENGTH, ENTITY_ICON_SIZE } from '@shared/constants';

/** The xattr with a custom icon of an entity. */
export const ENTITY_ICON_XATTR = 'icon';

const WEBP_QUALITIES = [0.85, 0.7, 0.5];

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Scales the center square of the source down to ENTITY_ICON_SIZE. A large
 * image is halved step by step: one big step skips pixels and looks jagged.
 */
function scaleToIconSize(source: HTMLCanvasElement): HTMLCanvasElement {
  const side = Math.min(source.width, source.height);
  let current = makeCanvas(side, side);
  current
    .getContext('2d')!
    .drawImage(source, (source.width - side) / 2, (source.height - side) / 2, side, side, 0, 0, side, side);

  while (current.width / 2 >= ENTITY_ICON_SIZE) {
    const half = makeCanvas(Math.round(current.width / 2), Math.round(current.height / 2));
    const ctx = half.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current, 0, 0, half.width, half.height);
    current = half;
  }

  const result = makeCanvas(ENTITY_ICON_SIZE, ENTITY_ICON_SIZE);
  const ctx = result.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current, 0, 0, ENTITY_ICON_SIZE, ENTITY_ICON_SIZE);
  return result;
}

/**
 * Makes a custom icon of an entity from a cropped image: an ENTITY_ICON_SIZE
 * square as a WebP data URL (PNG where WebP cannot be encoded), not longer than
 * ENTITY_ICON_MAX_LENGTH — the storage service drops longer ones.
 */
export function makeEntityIcon(source: HTMLCanvasElement): string {
  const canvas = scaleToIconSize(source);

  for (const quality of WEBP_QUALITIES) {
    const url = canvas.toDataURL('image/webp', quality);
    if (!url.startsWith('data:image/webp')) {
      break;
    }
    if (url.length <= ENTITY_ICON_MAX_LENGTH) {
      return url;
    }
  }

  const png = canvas.toDataURL('image/png');
  if (png.length <= ENTITY_ICON_MAX_LENGTH) {
    return png;
  }
  throw new Error(`The icon is larger than ${ENTITY_ICON_MAX_LENGTH} characters.`);
}
