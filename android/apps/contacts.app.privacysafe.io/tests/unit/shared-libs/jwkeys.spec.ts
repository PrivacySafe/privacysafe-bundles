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
  getKeyCert,
  getPrincipalAddress,
  getPubKey,
  isLikeJsonKey,
  isLikeKeyCert,
  isLikeSignedKeyCert,
  isLikeSignedLoad,
  keyToJson,
} from '@shared/jwkeys.ts';

type JsonKey = web3n.keys.JsonKey;
type KeyCert = web3n.keys.KeyCert;
type SignedLoad = web3n.keys.SignedLoad;

const jsonKey = (over: Partial<JsonKey> = {}): JsonKey => ({
  use: 'login-pub-key',
  alg: 'NaCl-box-CXSP',
  kid: 'kid-1',
  k: 'AAECAwQFBgcICQoLDA0ODw==',
  ...over,
} as JsonKey);

const keyCert = (over: Partial<KeyCert> = {}): KeyCert => ({
  issuedAt: 1000,
  expiresAt: 2000,
  issuer: '3nweb.com',
  cert: {
    principal: { address: 'ann@3nweb.com' },
    publicKey: jsonKey(),
  },
  ...over,
} as KeyCert);

const signedLoadOf = (payload: unknown, over: Partial<SignedLoad> = {}): SignedLoad => ({
  alg: 'NaCl-sign',
  kid: 'kid-1',
  sig: 'c2ln',
  load: btoa(JSON.stringify(payload)),
  ...over,
} as SignedLoad);

describe('isLikeJsonKey', () => {

  it('accepts a well formed key', () => {
    expect(isLikeJsonKey(jsonKey())).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isLikeJsonKey(null as unknown as JsonKey)).toBe(false);
    expect(isLikeJsonKey('key' as unknown as JsonKey)).toBe(false);
    expect(isLikeJsonKey(undefined as unknown as JsonKey)).toBe(false);
  });

  it('rejects a key with a missing or blank required field', () => {
    for (const field of ['alg', 'kid', 'k'] as const) {
      expect(isLikeJsonKey(jsonKey({ [field]: '' }))).toBe(false);
      expect(isLikeJsonKey(jsonKey({ [field]: undefined }))).toBe(false);
    }
  });

  // `use` is deliberately NOT part of the shape check — keyFromJson validates
  // it separately, against an expected use.
  it('accepts a key without a use', () => {
    expect(isLikeJsonKey(jsonKey({ use: undefined }))).toBe(true);
  });

});

describe('isLikeSignedLoad', () => {

  it('accepts a well formed signed load', () => {
    expect(isLikeSignedLoad(signedLoadOf({ a: 1 }))).toBe(true);
  });

  it('rejects a load with a missing field', () => {
    for (const field of ['alg', 'kid', 'sig', 'load'] as const) {
      expect(isLikeSignedLoad(signedLoadOf({ a: 1 }, { [field]: '' }))).toBe(false);
    }
  });

  it('rejects non-objects', () => {
    expect(isLikeSignedLoad(null as unknown as SignedLoad)).toBe(false);
  });

});

describe('isLikeKeyCert', () => {

  it('accepts a well formed certificate', () => {
    expect(isLikeKeyCert(keyCert())).toBe(true);
  });

  it('rejects a certificate that expires before it was issued', () => {
    expect(isLikeKeyCert(keyCert({ issuedAt: 2000, expiresAt: 1000 }))).toBe(false);
    expect(isLikeKeyCert(keyCert({ issuedAt: 1000, expiresAt: 1000 }))).toBe(false);
  });

  it('rejects a certificate without an issuer', () => {
    expect(isLikeKeyCert(keyCert({ issuer: '' }))).toBe(false);
  });

  it('rejects a certificate whose principal has no address', () => {
    expect(isLikeKeyCert(keyCert({
      cert: { principal: { address: '' }, publicKey: jsonKey() },
    } as Partial<KeyCert>))).toBe(false);
  });

  it('rejects a certificate carrying a malformed public key', () => {
    expect(isLikeKeyCert(keyCert({
      cert: { principal: { address: 'ann@3nweb.com' }, publicKey: jsonKey({ k: '' }) },
    } as Partial<KeyCert>))).toBe(false);
  });

});

describe('isLikeSignedKeyCert', () => {

  it('accepts a signed load carrying a valid certificate', () => {
    expect(isLikeSignedKeyCert(signedLoadOf(keyCert()))).toBe(true);
  });

  it('rejects a signed load whose payload is not a certificate', () => {
    expect(isLikeSignedKeyCert(signedLoadOf({ not: 'a cert' }))).toBe(false);
  });

  // The payload comes off the wire, so undecodable and unparseable payloads
  // have to come back as `false` rather than as an exception.
  it('returns false instead of throwing on an undecodable payload', () => {
    expect(isLikeSignedKeyCert({
      alg: 'NaCl-sign', kid: 'k', sig: 's', load: 'not-base64!!!',
    } as SignedLoad)).toBe(false);
  });

  it('returns false when the outer signed load itself is malformed', () => {
    expect(isLikeSignedKeyCert({ alg: '', kid: '', sig: '', load: '' } as SignedLoad)).toBe(false);
  });

});

describe('certificate readers', () => {

  it('decodes the certificate out of a signed load', () => {
    expect(getKeyCert(signedLoadOf(keyCert()))).toEqual(keyCert());
  });

  it('reads the public key and the principal address', () => {
    const signed = signedLoadOf(keyCert());

    expect(getPubKey(signed)).toEqual(jsonKey());
    expect(getPrincipalAddress(signed)).toBe('ann@3nweb.com');
  });

  // Unlike the isLike* validators these readers do not guard, so callers must
  // validate first. Pinned so the split of responsibility stays explicit.
  it('throws on a malformed payload rather than returning undefined', () => {
    expect(() => getKeyCert({ load: 'not-base64!!!' } as SignedLoad)).toThrow();
  });

});

describe('keyToJson', () => {

  it('base64-encodes the key bytes', () => {
    const json = keyToJson({
      use: 'login-pub-key',
      alg: 'NaCl-box-CXSP',
      kid: 'kid-1',
      k: new Uint8Array([0, 1, 2, 3]),
    } as web3n.keys.Key);

    expect(json.kid).toBe('kid-1');
    expect(json.k).toBe('AAECAw==');
  });

});
