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
*/
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  base64ToBytes, bytesToBase64, bytesToUrlSafeBase64, urlSafeBase64ToBytes,
} from '@shared/utils/base64';
import { randomBytes, randomStr } from '@shared/utils/random-str';
import { round } from '@shared/utils/round';
import { removeWhitespaceInString } from '@shared/utils/remove-whitespace-in-string';
import { debounce } from '@shared/utils/debounce';
import { sleep } from '@shared/processes/sleep';

describe('base64', () => {

  function bytes(...values: number[]): Uint8Array {
    return new Uint8Array(values);
  }

  it('round-trips bytes of every length modulo three', () => {
    // The three branches of the encoder: whole triples, one octet left, two.
    for (const sample of [bytes(), bytes(1), bytes(1, 2), bytes(1, 2, 3), bytes(1, 2, 3, 4)]) {
      expect(Array.from(base64ToBytes(bytesToBase64(sample)))).toEqual(Array.from(sample));
    }
  });

  it('pads as base64 requires', () => {
    expect(bytesToBase64(bytes(1))).toMatch(/==$/);
    expect(bytesToBase64(bytes(1, 2))).toMatch(/[^=]=$/);
    expect(bytesToBase64(bytes(1, 2, 3))).not.toMatch(/=/);
  });

  it('round-trips every byte value', () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) {
      all[i] = i;
    }

    expect(Array.from(base64ToBytes(bytesToBase64(all)))).toEqual(Array.from(all));
  });

  it('agrees with the platform encoder', () => {
    const sample = new TextEncoder().encode('a passphrase, salted');

    expect(bytesToBase64(sample)).toBe(Buffer.from(sample).toString('base64'));
  });

  it('refuses a string that is not base64', () => {
    expect(() => base64ToBytes('12345')).toThrow(/base64/);
    expect(() => base64ToBytes('a=bc')).toThrow(/base64/);
    expect(() => base64ToBytes('!!!!')).toThrow(/base64/);
  });

  // The url-safe alphabet is what ids are built from, so it must not carry
  // characters that need escaping in a path.
  it('round-trips through the url-safe alphabet', () => {
    const sample = bytes(251, 255, 190, 63, 0, 128);
    const encoded = bytesToUrlSafeBase64(sample);

    expect(encoded).not.toMatch(/[+/=]/);
    expect(Array.from(urlSafeBase64ToBytes(encoded))).toEqual(Array.from(sample));
  });

});

describe('randomStr', () => {

  it('answers the requested length', () => {
    for (const len of [1, 8, 20, 64]) {
      expect(randomStr(len)).toHaveLength(len);
    }
  });

  it('uses only characters that are safe in a file name', () => {
    expect(randomStr(200)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  // Ids of records and images are made with it, and a collision would have one
  // record overwrite another.
  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 500 }, () => randomStr(20)));

    expect(ids.size).toBe(500);
  });

});

describe('randomBytes', () => {

  it('answers the requested number of bytes', () => {
    expect(randomBytes(0)).toHaveLength(0);
    expect(randomBytes(1)).toHaveLength(1);
    expect(randomBytes(16)).toHaveLength(16);
    // Not a multiple of four, which the math fallback fills in whole words.
    expect(randomBytes(7)).toHaveLength(7);
  });

  it('does not answer the same bytes twice', () => {
    expect(Array.from(randomBytes(32))).not.toEqual(Array.from(randomBytes(32)));
  });

});

// Note the sign of `precision`: decimal places are asked for as a NEGATIVE
// number, which is what the sync progress in treasure-deno-srv.ts passes.
describe('round', () => {

  it('rounds to the given number of decimal places', () => {
    expect(round(1.2345, -2)).toBe(1.23);
    expect(round(1.2355, -2)).toBe(1.24);
    expect(round(1.5, 0)).toBe(2);
  });

  it('rounds a sync progress to three places, as the service asks', () => {
    expect(round(1234 / 10000, -3)).toBe(0.123);
    expect(round(1 / 3, -3)).toBe(0.333);
    expect(round(2 / 3, -3)).toBe(0.667);
  });

  it('handles the halves floating point is bad at', () => {
    expect(round(1.005, -2)).toBe(1.01);
    expect(round(10.235, -2)).toBe(10.24);
  });

  it('leaves a number that is already round alone', () => {
    expect(round(5, -2)).toBe(5);
    expect(round(0, -2)).toBe(0);
  });

  it('keeps the sign', () => {
    expect(round(-1.2345, -2)).toBe(-1.23);
  });

  // A positive precision rounds the other way, to tens and hundreds.
  it('rounds to whole tens when the precision is positive', () => {
    expect(round(1234, 1)).toBe(1230);
  });

});

describe('removeWhitespaceInString', () => {

  it('removes spaces anywhere in the string', () => {
    expect(removeWhitespaceInString(' 1234 5678  ')).toBe('12345678');
  });

  it('removes tabs and newlines too', () => {
    expect(removeWhitespaceInString('a\tb\nc\r\nd')).toBe('abcd');
  });

  it('leaves a string without whitespace alone', () => {
    expect(removeWhitespaceInString('4111111111111111')).toBe('4111111111111111');
    expect(removeWhitespaceInString('')).toBe('');
  });

});

describe('debounce', () => {

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls once for a burst, with the last arguments', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('a');
    debounced('b');
    debounced('c');
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('restarts the wait on every call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(80);
    debounced();
    vi.advanceTimersByTime(80);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs the first call at once when asked to', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100, { immediate: true });

    debounced('a');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');

    debounced('b');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

});

describe('sleep', () => {

  it('resolves after the given delay', async () => {
    const startedAt = Date.now();

    await sleep(20);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);
  });

});
