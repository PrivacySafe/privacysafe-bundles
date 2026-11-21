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
// Passphrase protection for a backup archive. WebCrypto only - no dependency is
// pulled in for this.
//
// This lives in the gui and NOT in the deno service, unlike the same code in
// the contacts app. On android a component declared with `runtime: "deno"` is
// executed by androidx.javascriptengine - a bare V8 isolate with no Web APIs at
// all, so `crypto` is simply absent there. The gui is loaded over an https
// origin on android and over a scheme registered as secure in electron, so
// `crypto.subtle` is present on both platforms.
//
// Note what this does NOT protect against: an archive is only as secret as the
// place the user saves it to, and a passphrase that is forgotten makes the
// archive unreadable - there is no recovery path, by construction.
import { bytesToBase64, base64ToBytes } from '@shared/utils/base64';
import type { BackupEncryptionParams } from '@shared/utils/backup-archive';

const KEY_LENGTH = 256;
const SALT_BYTES = 16;
/** AES-GCM is specified for a 96-bit nonce; longer ones are hashed down. */
const IV_BYTES = 12;
const PBKDF2_ITERATIONS = 250000;

/**
 * Whether this runtime can encrypt at all. Checked rather than assumed: a
 * missing `crypto.subtle` must degrade to "encryption unavailable" instead of
 * failing a backup outright.
 */
export function isSubtleCryptoAvailable(): boolean {
  return !!(globalThis as Partial<typeof globalThis>).crypto?.subtle;
}

/**
 * Salt and iv come from here rather than from the shared `randomBytes`, which
 * falls back to Math.random when crypto is missing. That fallback is fine for
 * an id and unacceptable for a salt or a nonce, so a missing entropy source has
 * to be an error.
 */
function cryptoRandomBytes(numOfBytes: number): Uint8Array {
  if (!(globalThis as Partial<typeof globalThis>).crypto?.getRandomValues) {
    throw new Error('No cryptographic source of randomness is available');
  }

  const bytes = new Uint8Array(numOfBytes);
  crypto.getRandomValues(bytes);
  return bytes;
}

function utf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * WebCrypto's typings want a view backed by an ArrayBuffer, while a plain
 * Uint8Array is typed over ArrayBufferLike - which also covers
 * SharedArrayBuffer, and that is the whole of the mismatch.
 *
 * Nothing reaching these calls is ever backed by a shared buffer: the bytes
 * come from cryptoRandomBytes, TextEncoder, base64ToBytes and the zip writer,
 * each of which allocates a plain ArrayBuffer. Copying them just to satisfy the
 * declaration would mean an extra pass over the whole archive.
 */
function bufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', bufferSource(utf8(passphrase)), 'PBKDF2', false, ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: bufferSource(salt), iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypts the inner archive. The parameters come back alongside the bytes and
 * are written into the archive's plaintext metadata file - salt and iv are not
 * secret, and without them the archive could not be opened at all.
 */
export async function encryptPayload(
  bytes: Uint8Array,
  passphrase: string,
): Promise<{ cipher: Uint8Array; params: BackupEncryptionParams }> {
  if (!isSubtleCryptoAvailable()) {
    throw new Error('Encryption is not available in this runtime');
  }

  const salt = cryptoRandomBytes(SALT_BYTES);
  const iv = cryptoRandomBytes(IV_BYTES);
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);

  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bufferSource(iv) }, key, bufferSource(bytes),
  );

  return {
    cipher: new Uint8Array(cipher),
    params: {
      alg: 'AES-GCM',
      keyLen: KEY_LENGTH,
      kdf: 'PBKDF2',
      hash: 'SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
    },
  };
}

/**
 * Decrypts the inner archive.
 *
 * Throws on a wrong passphrase - AES-GCM refuses to hand back plaintext whose
 * tag does not verify, which is exactly the check that tells a wrong passphrase
 * from a right one. The caller turns that into `wrong_passphrase` rather than
 * letting it surface as a failed restore.
 */
export async function decryptPayload(
  cipher: Uint8Array,
  passphrase: string,
  params: BackupEncryptionParams,
): Promise<Uint8Array> {
  if (!isSubtleCryptoAvailable()) {
    throw new Error('Encryption is not available in this runtime');
  }

  // Read from the archive, so not to be trusted: an unknown algorithm has to
  // say so, rather than reach WebCrypto as a malformed parameter.
  if (params?.alg !== 'AES-GCM' || params?.kdf !== 'PBKDF2' || params?.hash !== 'SHA-256') {
    throw new Error('Unsupported encryption parameters in the backup archive');
  }

  const salt = base64ToBytes(params.salt);
  const iv = base64ToBytes(params.iv);
  // Taken from the archive rather than from the constant, so that raising the
  // cost of the kdf later does not make today's archives unreadable.
  const iterations = Number(params.iterations);
  if (!Number.isFinite(iterations) || iterations < 1) {
    throw new Error('Unsupported encryption parameters in the backup archive');
  }

  const key = await deriveKey(passphrase, salt, iterations);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bufferSource(iv) }, key, bufferSource(cipher),
  );

  return new Uint8Array(plain);
}
