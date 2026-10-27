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
import { generateColor } from '@main/common/utils/generate-color';
import { algToHumanString } from '@main/common/utils/keys-info';
import { randomStr } from '@main/common/services/base/random';

describe('generateColor', () => {

  const hsl = /^hsl\((\d{1,3}), 60%, 40%\)$/;

  it('produces a well formed hsl colour', () => {
    expect(generateColor('Ann')).toMatch(hsl);
  });

  it('keeps the hue inside 0..359', () => {
    for (const input of ['', 'A', 'Ann', 'Ann Tester', 'ann@3nweb.com', 'Ы', '😀']) {
      const hue = Number(generateColor(input).match(hsl)![1]);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  // Avatars are coloured by initials on every render, so the mapping has to be
  // stable across calls — otherwise a contact's avatar changes colour as the
  // list re-renders.
  it('is deterministic', () => {
    expect(generateColor('Ann')).toBe(generateColor('Ann'));
  });

  it('distinguishes different inputs', () => {
    expect(generateColor('Ann')).not.toBe(generateColor('Bob'));
  });

});

describe('algToHumanString', () => {

  it('spells out the known algorithm', () => {
    expect(algToHumanString('NaCl-box-CXSP'))
    .toBe('Curve25519 + XSalsa20 + Poly1305 (from NaCl library packing)');
  });

  it('passes an unknown algorithm through unchanged', () => {
    expect(algToHumanString('some-future-alg')).toBe('some-future-alg');
  });

});

describe('randomStr', () => {

  it('produces a string of the requested length', () => {
    expect(randomStr(8)).toHaveLength(8);
    expect(randomStr(20)).toHaveLength(20);
  });

  // Contact ids and avatar file ids both come from here, and contact ids are a
  // sqlite PRIMARY KEY, so a collision means a lost contact.
  it('does not collide over many draws', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10000; i += 1) {
      ids.add(randomStr(8));
    }

    expect(ids.size).toBe(10000);
  });

  it('stays within a url- and filename-safe alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(randomStr(20)).toMatch(/^[A-Za-z0-9\-_]+$/);
    }
  });

});
