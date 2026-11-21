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
 * Tells whether the error means that the IPC connection to the platform is gone
 * for good: the platform does not reconnect it, so every later call fails as well
 * until the app is restarted.
 */
export function isIpcConnectionLost(err: unknown): boolean {
  const exc = err as { type?: string; ipcNotConnected?: boolean; connectorStop?: boolean } | undefined;
  return exc?.type === 'ipc' && (!!exc.ipcNotConnected || !!exc.connectorStop);
}
