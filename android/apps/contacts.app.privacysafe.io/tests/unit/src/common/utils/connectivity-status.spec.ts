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
  type ConnectivityState,
  nextConnectivityState,
  toConnectivityStatus,
  withServerReachability,
} from '@main/common/utils/connectivity-status';

type WsType = 'connected' | 'heartbeat' | 'heartbeat-skip' | 'disconnected';

function wsEvent(
  service: 'storage' | 'inbox', type: WsType, isOnline = true,
): web3n.connectivity.ConnectivityEvent {
  return { isOnline, wsEvent: { service, type } };
}

const UNKNOWN: ConnectivityState = { network: true, server: 'unknown' };
const UP: ConnectivityState = { network: true, server: 'up' };
const DOWN: ConnectivityState = { network: true, server: 'down' };

describe('nextConnectivityState', () => {

  it.each<[WsType, ConnectivityState['server']]>([
    ['connected', 'up'],
    ['heartbeat', 'up'],
    ['disconnected', 'down'],
    ['heartbeat-skip', 'down'],
  ])('reads a storage %s as the server being %s', (type, server) => {
    expect(nextConnectivityState(UNKNOWN, wsEvent('storage', type))).toEqual({ network: true, server });
  });

  // The inbox socket belongs to another service, and says nothing about the
  // storage server the app synchronizes with.
  it('takes nothing about the server from the inbox socket', () => {
    expect(nextConnectivityState(UP, wsEvent('inbox', 'disconnected'))).toEqual(UP);
    expect(nextConnectivityState(DOWN, wsEvent('inbox', 'heartbeat'))).toEqual(DOWN);
  });

  it('takes only the network from a tick without a socket event', () => {
    expect(nextConnectivityState(DOWN, { isOnline: true })).toEqual(DOWN);
    expect(nextConnectivityState(UP, { isOnline: false })).toEqual({ network: false, server: 'up' });
  });

});

describe('withServerReachability', () => {

  // A server that answered proves the network as well.
  it('takes an answer of the server as proof of the network too', () => {
    expect(withServerReachability({ network: false, server: 'unknown' }, true)).toEqual(UP);
  });

  it('keeps the network as it was when the server does not answer', () => {
    expect(withServerReachability(UP, false)).toEqual(DOWN);
    expect(withServerReachability({ network: false, server: 'up' }, false))
      .toEqual({ network: false, server: 'down' });
  });

});

describe('toConnectivityStatus', () => {

  it('is offline without a network, whatever was last heard from the server', () => {
    expect(toConnectivityStatus({ network: false, server: 'up' })).toBe('offline');
    expect(toConnectivityStatus({ network: false, server: 'down' })).toBe('offline');
    expect(toConnectivityStatus({ network: false, server: 'unknown' })).toBe('offline');
  });

  it('is online only with the server answering', () => {
    expect(toConnectivityStatus(UP)).toBe('online');
  });

  // The case the app used to call online: the network is up, nothing syncs.
  it('tells a network without the server apart', () => {
    expect(toConnectivityStatus(DOWN)).toBe('server-unreachable');
  });

  // Online is a claim that changes get synchronized, which is not known yet.
  it('does not claim online before the server has been heard from', () => {
    expect(toConnectivityStatus(UNKNOWN)).toBe('server-unreachable');
  });

  it('follows a whole outage of the server and its recovery', () => {
    let state: ConnectivityState = { network: true, server: 'unknown' };
    const seen: string[] = [];
    for (const event of [
      wsEvent('storage', 'connected'),
      wsEvent('storage', 'heartbeat'),
      wsEvent('storage', 'heartbeat-skip'),
      { isOnline: true },
      wsEvent('storage', 'connected'),
      { isOnline: false },
    ] as web3n.connectivity.ConnectivityEvent[]) {
      state = nextConnectivityState(state, event);
      seen.push(toConnectivityStatus(state));
    }
    expect(seen).toEqual([
      'online', 'online', 'server-unreachable', 'server-unreachable', 'online', 'offline',
    ]);
  });

});
