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
export function generateUniqueImgPlaceholder(size = 44) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return '';
  }

  // Dark base background (simulates depth/shadow)
  const baseHue = Math.random() * 360;
  ctx.fillStyle = `hsl(${baseHue}, 20%, 25%)`;
  ctx.fillRect(0, 0, size, size);

  // Generation of many SMALL details (simulation of objects)
  // We increase the number of iterations and decrease the size of the figures.
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;

    // We make objects small: from 2 to 15 pixels
    const w = Math.random() * (size / 3) + 2;
    const h = Math.random() * (size / 3) + 2;

    const isLight = Math.random() > 0.6; // 40% light objects (glare, faces, light)
    const lightness = isLight ? Math.random() * 50 + 40 : Math.random() * 15;
    const opacity = Math.random() * 0.7;

    ctx.fillStyle = `hsla(${baseHue + (Math.random() * 80 - 40)}, 40%, ${lightness}%, ${opacity})`;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.random() * Math.PI);

    if (Math.random() > 0.4) {
      // Rectangular shapes better imitate man-made objects
      ctx.fillRect(-w / 2, -h / 2, w, h);
    } else {
      // Thin "sticks" (imitation of interior details/branches)
      ctx.fillRect(-w / 2, 0, w, 1.5);
    }
    ctx.restore();
  }

  // Adding a "noisy texture" through pixels (Grain)
  // At small sizes, noise is critical to the "photographic" feel.
  const imageData = ctx.getImageData(0, 0, size, size);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 80; // High noise intensity
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL('image/webp', 0.7);
}
