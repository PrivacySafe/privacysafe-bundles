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
import {
  decryptPayload, encryptPayload, isSubtleCryptoAvailable,
} from '@main/common/utils/backup-crypto';

const PASSPHRASE = 'correct horse battery staple';

function payload(): Uint8Array {
  return new TextEncoder().encode('the inner zip of a backup archive');
}

// The derivation runs 250k PBKDF2 rounds; a handful of them per case is still
// fast, but not at the default 5s timeout on a loaded machine.
const TIMEOUT = 30000;

describe('backup encryption', () => {

  it('is available in this runtime', () => {
    expect(isSubtleCryptoAvailable()).toBe(true);
  });

  it('round-trips the payload', async () => {
    const { cipher, params } = await encryptPayload(payload(), PASSPHRASE);

    expect(cipher).not.toEqual(payload());

    const plain = await decryptPayload(cipher, PASSPHRASE, params);
    // Compared as plain arrays: WebCrypto hands back a buffer from the host
    // realm, and a jsdom Uint8Array over it is not `toEqual` a node one even
    // when every byte matches.
    expect(Array.from(plain)).toEqual(Array.from(payload()));
  }, TIMEOUT);

  // This rejection IS the wrong-passphrase check: AES-GCM refuses to hand back
  // plaintext whose tag does not verify.
  it('refuses a wrong passphrase', async () => {
    const { cipher, params } = await encryptPayload(payload(), PASSPHRASE);

    await expect(decryptPayload(cipher, 'not the passphrase', params)).rejects.toThrow();
  }, TIMEOUT);

  it('never reuses a salt or an iv', async () => {
    const first = await encryptPayload(payload(), PASSPHRASE);
    const second = await encryptPayload(payload(), PASSPHRASE);

    expect(first.params.salt).not.toBe(second.params.salt);
    expect(first.params.iv).not.toBe(second.params.iv);
    expect(first.cipher).not.toEqual(second.cipher);
  }, TIMEOUT);

  // Parameters come out of the archive, so they are not to be trusted: an
  // unknown algorithm must be named as such, not passed on to WebCrypto.
  it('rejects encryption parameters it does not implement', async () => {
    const { cipher, params } = await encryptPayload(payload(), PASSPHRASE);

    await expect(decryptPayload(cipher, PASSPHRASE, {
      ...params, alg: 'AES-CBC' as unknown as 'AES-GCM',
    })).rejects.toThrow(/Unsupported encryption parameters/);

    await expect(decryptPayload(cipher, PASSPHRASE, {
      ...params, iterations: 0,
    })).rejects.toThrow(/Unsupported encryption parameters/);
  }, TIMEOUT);

});
