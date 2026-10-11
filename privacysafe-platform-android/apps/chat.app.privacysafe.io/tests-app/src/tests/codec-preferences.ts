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

/**
 * Codec preferences handed to `setCodecPreferences()`.
 *
 * What these guard is one rule: a codec may appear at most once. Browsers list
 * a codec once per profile, and offering two profiles of one codec is what
 * produced the payload-type collision that kept calls from connecting:
 *
 *   "A BUNDLE group contains a codec collision between
 *    {payload_type: 49, mime_type: video/H265, ...level-id: 186} and
 *    {payload_type: 49, mime_type: video/H265, ...level-id: 180}"
 *
 * The function is pure, so it is imported directly - no browser, no network,
 * the way `call-state.ts` is covered.
 */

import { itCond } from '../libs-for-tests/jasmine-utils.js';
import { buildPreferredCodecs } from '@video/common/services/webrtc-utils';

function codec(mimeType: string, sdpFmtpLine?: string): RTCRtpCodec {
  return { mimeType, clockRate: 90000, sdpFmtpLine } as RTCRtpCodec;
}

function mimeTypesOf(codecs: RTCRtpCodec[]): string[] {
  return codecs.map(c => (c.mimeType ?? '').toLowerCase());
}

/**
 * Shaped after what Chromium actually reports: several profiles of H264 and
 * H265, an RTX entry per media codec, and codecs the app does not want.
 */
const VIDEO_CAPABILITIES: RTCRtpCodec[] = [
  codec('video/H265', 'level-id=186;profile-id=1;tier-flag=0;tx-mode=SRST'),
  codec('video/H265', 'level-id=180;profile-id=1;tier-flag=0;tx-mode=SRST'),
  codec('video/H264', 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=64001f'),
  codec('video/H264', 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640034'),
  codec('video/H264', 'level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f'),
  codec('video/VP8'),
  codec('video/VP9', 'profile-id=0'),
  codec('video/VP9', 'profile-id=2'),
  codec('video/AV1'),
  codec('video/rtx', 'apt=96'),
  codec('video/rtx', 'apt=98'),
  codec('video/rtx', 'apt=100'),
  codec('video/red'),
  codec('video/ulpfec'),
  codec('video/flexfec-03'),
];

const AUDIO_CAPABILITIES: RTCRtpCodec[] = [
  codec('audio/opus', 'minptime=10;useinbandfec=1'),
  codec('audio/red', '111/111'),
  codec('audio/G722'),
  codec('audio/PCMU'),
  codec('audio/PCMA'),
  codec('audio/CN'),
  codec('audio/telephone-event'),
];

describe(`Codec preferences`, () => {

  itCond(`offers each video codec once, so payload types cannot collide`, async () => {
    const preferred = buildPreferredCodecs(VIDEO_CAPABILITIES, 'video');
    const mimeTypes = mimeTypesOf(preferred);

    const seen = new Set<string>();
    for (const mime of mimeTypes) {
      expect(seen.has(mime))
        .withContext(`'${mime}' appears more than once - this is the collision itself`)
        .toBe(false);
      seen.add(mime);
    }

    expect(mimeTypes.filter(m => m === 'video/h264').length)
      .withContext(`three H264 profiles were offered, one must come out`)
      .toBe(1);
    expect(mimeTypes.filter(m => m === 'video/vp9').length)
      .withContext(`two VP9 profiles were offered, one must come out`)
      .toBe(1);
    expect(mimeTypes.filter(m => m === 'video/rtx').length)
      .withContext(`at most one rtx entry`)
      .toBe(1);
  }, 10000);

  itCond(`leaves out codecs the app does not offer`, async () => {
    const mimeTypes = mimeTypesOf(buildPreferredCodecs(VIDEO_CAPABILITIES, 'video'));

    // H265 is the codec the observed collision was reported for, and it is not
    // in the app's preference list to begin with. Before this rule it still
    // reached setCodecPreferences(), both profiles of it.
    expect(mimeTypes).not.toContain('video/h265');
    expect(mimeTypes).not.toContain('video/flexfec-03');
  }, 10000);

  itCond(`orders video codecs by preference, auxiliary entries last`, async () => {
    const mimeTypes = mimeTypesOf(buildPreferredCodecs(VIDEO_CAPABILITIES, 'video'));

    expect(mimeTypes.slice(0, 4)).toEqual(['video/vp8', 'video/vp9', 'video/h264', 'video/av1']);
    expect(mimeTypes.slice(4)).toEqual(['video/rtx', 'video/red', 'video/ulpfec']);
  }, 10000);

  itCond(`does the same for audio`, async () => {
    const mimeTypes = mimeTypesOf(buildPreferredCodecs(AUDIO_CAPABILITIES, 'audio'));

    expect(mimeTypes).toEqual([
      'audio/opus', 'audio/g722', 'audio/pcmu', 'audio/pcma',
      'audio/cn', 'audio/telephone-event',
    ]);
    expect(mimeTypes)
      .withContext(`audio/red is not among the codecs the app offers`)
      .not.toContain('audio/red');
  }, 10000);

  itCond(`gives an empty list when there is no preferred codec, leaving the browser's own choice alone`, async () => {
    // Only auxiliary entries: pinning those alone would be worse than pinning
    // nothing, so the caller is meant to skip setCodecPreferences() entirely.
    expect(buildPreferredCodecs([codec('video/rtx', 'apt=96'), codec('video/red')], 'video')).toEqual([]);
    expect(buildPreferredCodecs([], 'video')).toEqual([]);
    expect(buildPreferredCodecs([], 'audio')).toEqual([]);
  }, 10000);

});
