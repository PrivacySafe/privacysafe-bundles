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
 * STUN/TURN configuration of calls.
 *
 * It is data, not code: the shipped values live in `public/ice-servers.json`,
 * which the platform copies into this app's storage on first use (manifest,
 * `exposedFSResources.ice-servers`) and this module reads back from there.
 * Rotating credentials therefore means replacing a JSON file - no code change,
 * and nothing to rebuild in the windows, which never see this file at all: the
 * window of a call is given `rtcConfig` in `ChatInfoForCall` when the call
 * starts (see doc/05-video-calls.md §2.1).
 *
 * The same JSON is imported here as the last-resort fallback. That keeps the
 * repository single-sourced - the fallback cannot drift away from the shipped
 * file - and means a storage or platform hiccup degrades to today's behaviour
 * instead of dropping relayed calls, which is what a config-less run would do.
 */

import bundledIceServers from '../../../public/ice-servers.json' with { type: 'json' };
import { makeLogger } from '../../../shared-libs/logger.ts';
import { iceConfigFrom } from './utils/ice-servers-json.ts';

const log = makeLogger('IceConfig');

/**
 * Resource name, as declared in `exposedFSResources` of the app manifest. The
 * file itself sits at `/constants/ice-servers.json` of this app's local
 * storage; the platform initializes it from the copy shipped in the app.
 */
const ICE_SERVERS_RESOURCE = 'ice-servers';

// Built via the same reader as the stored resource, so the shipped file's
// shape (with or without iceTransportPolicy) is honoured identically on both
// paths. No policy in the file means the WebRTC default 'all': host/srflx
// candidates allowed, TURN as a fallback — direct LAN connections work even
// when the TURN server is down.
const BUNDLED_ICE_CONFIG: RTCConfiguration = iceConfigFrom(bundledIceServers)
  ?? { iceServers: bundledIceServers.iceServers };

/**
 * What this call will actually dial with, whichever path produced it.
 *
 * The stored resource is initialized from the shipped copy ONCE, so an app
 * update does not refresh it — an old relay-only config can outlive the fix
 * that removed it, and only this line makes that visible next to the call's own
 * logs. Which means the fallback needs it just as much: a device whose resource
 * is missing used to leave no record of what it dialled with at all.
 */
function logIceConfig(source: 'stored' | 'shipped', config: RTCConfiguration): void {
  log.info(
    `ICE config for call: ${config.iceServers?.length ?? 0} server(s), `
      + `policy=${config.iceTransportPolicy ?? 'all (default)'} (${source})`,
  );
}

/**
 * ICE configuration for a call that is about to start.
 *
 * Read on every call rather than cached, so that an edited file takes effect
 * without restarting the background instance: calls are started by a human, and
 * one read of a small local file per call is nothing next to the call itself.
 */
export async function iceConfigForNewCall(): Promise<RTCConfiguration> {
  try {
    const file = (await w3n.shell!.getFSResource!(
      undefined, // this app's own resource
      ICE_SERVERS_RESOURCE,
    )) as web3n.files.ReadonlyFile;
    const config = iceConfigFrom(await file.readJSON());
    if (config) {
      logIceConfig('stored', config);
      return config;
    }
    log.error(`ICE configuration resource '${ICE_SERVERS_RESOURCE}' has no usable iceServers; using the shipped one`);
  } catch (err) {
    log.error(`Failed to read ICE configuration resource '${ICE_SERVERS_RESOURCE}'; using the shipped one`, err);
  }
  logIceConfig('shipped', BUNDLED_ICE_CONFIG);
  return BUNDLED_ICE_CONFIG;
}
