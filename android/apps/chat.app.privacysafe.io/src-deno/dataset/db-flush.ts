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
 * A hook that lets code with no access to the DB object still guarantee that
 * pending database changes are on disk.
 *
 * It exists for the sending layer: sending-primitives.ts is a set of plain
 * exported functions with no factory to inject a dependency into, and every
 * outgoing message funnels through one of them. Rather than turn that module
 * into a factory and thread a callback through thirteen callers, the database
 * layer publishes its flush here and the sending layer just calls it - so
 * knowledge about the database stays on this side.
 */

let flushFn: (() => Promise<void>) | undefined = undefined;

/**
 * Registered by dataset() when the databases are opened.
 */
export function setDbFlush(fn: () => Promise<void>): void {
  flushFn = fn;
}

/**
 * Resolves once pending database changes are in their files. A no-op before
 * dataset() has run.
 */
export function flushDb(): Promise<void> {
  return flushFn ? flushFn() : Promise.resolve();
}
