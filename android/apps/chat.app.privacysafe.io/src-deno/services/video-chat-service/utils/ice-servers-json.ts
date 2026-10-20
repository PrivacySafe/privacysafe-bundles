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
 * The shape of `ice-servers.json` and its reading into an `RTCConfiguration`.
 *
 * Kept apart from ice-config.ts, which does the platform side of it: this file
 * is a plain function over parsed JSON, so a spec can check it directly without
 * a resource to read or a fallback compiled in
 * (see tests-app/src/tests/ice-config.ts).
 */

export interface IceServersJSON {
  iceServers: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
}

function hasUsableUrls({ urls }: RTCIceServer): boolean {
  return typeof urls === 'string' ? urls.length > 0 : Array.isArray(urls) && urls.length > 0;
}

/**
 * Turns a parsed JSON into an RTCConfiguration, or gives undefined if the JSON
 * isn't one. Only the fields this app sets are carried over: an ICE
 * configuration goes into `RTCPeerConnection` in the call window, so passing
 * whatever else the file happens to contain would make the file a way to
 * configure that connection from outside.
 */
export function iceConfigFrom(json: unknown): RTCConfiguration | undefined {
  const { iceServers, iceTransportPolicy } = (json ?? {}) as Partial<IceServersJSON>;
  if (!Array.isArray(iceServers) || iceServers.length === 0) {
    return undefined;
  }
  if (iceServers.some(server => !server || typeof server !== 'object' || !hasUsableUrls(server))) {
    return undefined;
  }
  return {
    iceServers,
    ...(iceTransportPolicy ? { iceTransportPolicy } : {}),
  };
}
