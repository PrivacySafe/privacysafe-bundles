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

import { describe, expect, it } from 'vitest';
import { cssImageUrl } from '@main/common/utils/css-image-url';

describe('cssImageUrl', () => {
  it('quotes a raster data URL or a blob URL', () => {
    expect(cssImageUrl('data:image/png;base64,AAAA')).toBe('url("data:image/png;base64,AAAA")');
    expect(cssImageUrl('blob:w3n-app://x/1-2')).toBe('url("blob:w3n-app://x/1-2")');
  });

  it('gives nothing for anything else', () => {
    for (const v of ['x), url(https://tracker/p', 'https://x/a.png', 'data:image/svg+xml;base64,AA', '', undefined]) {
      expect(cssImageUrl(v), String(v)).toBeUndefined();
    }
  });
});
