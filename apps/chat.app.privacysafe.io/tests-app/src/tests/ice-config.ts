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
 * STUN/TURN configuration of calls (P2-5).
 *
 * The configuration is data now - `ice-servers.json` shipped in the app folder,
 * from which the platform initializes the FS resource that the background
 * instance reads and hands to a call window. So the two things worth a spec are
 * that the shipped file really is a usable configuration (a typo in it would
 * otherwise surface as calls that fail to connect) and that a broken one is
 * refused rather than passed on to `RTCPeerConnection`.
 *
 * The file is read here the way any app reads its own shipped file - by `fetch`
 * of its path - and not through the resource: the resource is granted to
 * `/background-instance.mjs`, while specs run in the main window. Nothing here
 * touches the network.
 */

import { itCond } from '../libs-for-tests/jasmine-utils.js';
import { iceConfigFrom } from '@deno/services/video-chat-service/utils/ice-servers-json.ts';

const SHIPPED_ICE_SERVERS_PATH = '/ice-servers.json';

describe(`ICE configuration of calls`, () => {

  itCond(`the configuration shipped with the app is usable`, async () => {
    const shipped = await (await fetch(SHIPPED_ICE_SERVERS_PATH)).json();
    const config = iceConfigFrom(shipped);

    expect(config)
      .withContext(`${SHIPPED_ICE_SERVERS_PATH} should parse into an RTCConfiguration`)
      .toBeTruthy();
    expect(config!.iceServers!.length)
      .withContext(`with at least one ICE server in it`)
      .toBeGreaterThan(0);

    for (const { urls } of config!.iceServers!) {
      const urlList = typeof urls === 'string' ? [urls] : urls;
      for (const url of urlList) {
        expect(/^(stuns?|turns?):/.test(url))
          .withContext(`url '${url}' should be a stun(s)/turn(s) one`)
          .toBe(true);
      }
    }
  }, 10000);

  itCond(`a file that is not a configuration is refused, so that the fallback is used`, async () => {
    const refused = [
      undefined,
      null,
      {},
      { iceServers: [] },
      { iceServers: 'stun:example.com' },
      { iceServers: [{}] },
      { iceServers: [{ urls: '' }] },
      { iceServers: [{ urls: [] }] },
      { iceServers: [{ urls: ['stun:example.com'] }, null] },
    ];

    for (const json of refused) {
      expect(iceConfigFrom(json))
        .withContext(`${JSON.stringify(json)} is not a usable ICE configuration`)
        .toBeUndefined();
    }
  }, 10000);

  itCond(`a valid file is taken as it is, and nothing beyond ICE settings is carried over`, async () => {
    const config = iceConfigFrom({
      iceServers: [{ urls: ['turns:relay.example.com:443'], username: 'u', credential: 'c' }],
      iceTransportPolicy: 'relay',
      // A configuration file must not be a way to set up the peer connection of
      // a call, so fields other than the ICE ones are dropped.
      certificates: ['not a certificate'],
    });

    expect(config)
      .withContext(`the entry has urls, so the configuration is usable`)
      .toBeTruthy();
    expect(config!.iceServers!.length).toBe(1);
    expect(config!.iceTransportPolicy)
      .withContext(`iceTransportPolicy comes from the file`)
      .toBe('relay');
    expect((config as Record<string, unknown>).certificates)
      .withContext(`anything else in the file is not passed on`)
      .toBeUndefined();
  }, 10000);

});
