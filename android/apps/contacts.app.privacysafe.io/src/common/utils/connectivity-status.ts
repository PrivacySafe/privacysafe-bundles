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
// What the status line calls online. The platform's isOnline only says that
// the device has a network - it is net.isOnline(), read every 30s - and the
// app said "online" on it while the storage server was out of reach and
// nothing could be synchronized. Online here means the storage server can be
// reached, which the platform tells through the events of its storage socket,
// and the service through the outcome of its own requests to the server.
import type { ConnectivityStatus } from '@main/types';

/** How the platform names the storage service in a connectivity event. */
const STORAGE_SERVICE = 'storage';

export type ServerReachability = 'unknown' | 'up' | 'down';

export interface ConnectivityState {
  /** The device has a network, as the platform's isOnline reports it. */
  network: boolean;
  /** The latest evidence about the storage server; 'unknown' until there is any. */
  server: ServerReachability;
}

/**
 * The state after one connectivity event of the platform.
 *
 * Only events of the storage socket say anything about the server. Those of
 * the inbox socket concern another service, and the periodic ticks carry no
 * socket event at all, so both leave the server as it was. A skipped heartbeat
 * is read as a break, the same as watchStorageReconnection in the service does.
 */
export function nextConnectivityState(
  prev: ConnectivityState,
  event: web3n.connectivity.ConnectivityEvent,
): ConnectivityState {
  const network = !!event.isOnline;
  const { wsEvent } = event;
  if (!wsEvent || (wsEvent.service !== STORAGE_SERVICE)) {
    return { network, server: prev.server };
  }

  switch (wsEvent.type) {
    case 'connected':
    case 'heartbeat':
      return { network, server: 'up' };
    case 'disconnected':
    case 'heartbeat-skip':
      return { network, server: 'down' };
    default:
      return { network, server: prev.server };
  }
}

/**
 * The state after the service reported the outcome of a request to the server.
 * An answer from the server proves the network too; no answer says nothing
 * about the network, which keeps what the platform last reported.
 */
export function withServerReachability(
  prev: ConnectivityState,
  reachable: boolean,
): ConnectivityState {
  return reachable
    ? { network: true, server: 'up' }
    : { network: prev.network, server: 'down' };
}

/**
 * What the status line shows. A server not heard from yet is not shown as
 * reachable: online is a claim that changes get synchronized, and that is not
 * known until the server has answered.
 */
export function toConnectivityStatus(state: ConnectivityState): ConnectivityStatus {
  if (!state.network) {
    return 'offline';
  }
  return (state.server === 'up') ? 'online' : 'server-unreachable';
}
