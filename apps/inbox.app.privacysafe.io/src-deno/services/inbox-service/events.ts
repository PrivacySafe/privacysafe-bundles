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
import { ObserversSet } from '../../../shared/utils/observer-utils.ts';
import type { InboxUpdateEvent, StartupEvent } from '../../types/inbox-srv.types.ts';

/**
 * Entities a single `lists`/`reload` event covers, and which therefore need not
 * be reported one by one while a bulk replay is going on.
 *
 * `sending`, `app-state` and `sync` are deliberately absent: the synchronization
 * indicator and the list of messages being sent have to keep working during the
 * replay - the indicator above all, since the replay is exactly what it is
 * there to explain.
 */
const COALESCED_ENTITIES: ReadonlySet<InboxUpdateEvent['entity']> = new Set([
  'message',
  'folder',
]);

export function createInboxEvents() {
  const observers = new ObserversSet<InboxUpdateEvent>();

  /**
   * Depth of the bulk-replay window, and whether anything was held back in it.
   *
   * A counter rather than a flag so that nesting cannot end the window early.
   */
  let bulkReplayDepth = 0;
  let heldBackAnything = false;

  function emit(event: InboxUpdateEvent): void {
    if ((bulkReplayDepth > 0) && COALESCED_ENTITIES.has(event.entity)) {
      heldBackAnything = true;
      return;
    }
    if (!observers.isEmpty()) {
      observers.next(event);
    }
  }

  /**
   * Opens a window in which per-record changes are not reported individually.
   *
   * The start-up replay of a backlog of phantoms is the whole history of each
   * message it touches - several saves of a draft, then sending, then sent - and
   * reporting each step walks the row through that history in front of the user.
   * The final state is the same either way; only the journey is spared.
   */
  function beginBulkReplay(): void {
    bulkReplayDepth += 1;
  }

  /**
   * Closes the window and, if anything was held back, asks the GUI to re-read
   * its lists.
   *
   * "Re-read" rather than a batch of the held-back changes, and necessarily: the
   * GUI takes its own first snapshot while this window is open (the service
   * answers before the replay begins), so there is no telling what its lists
   * already contain.
   */
  function endBulkReplay(): void {
    bulkReplayDepth = Math.max(bulkReplayDepth - 1, 0);
    if ((bulkReplayDepth > 0) || !heldBackAnything) {
      return;
    }
    heldBackAnything = false;
    emit({ entity: 'lists', event: 'reload' });
  }

  function watch(obs: web3n.Observer<InboxUpdateEvent>): () => void {
    observers.add(obs);
    return () => observers.delete(obs);
  }

  return { emit, watch, beginBulkReplay, endBulkReplay };
}

export type InboxEvents = ReturnType<typeof createInboxEvents>;

export type InboxEmit = (event: InboxUpdateEvent) => void;

/**
 * Startup stages, kept apart from the update events because they are emitted
 * before the service that carries those exists.
 *
 * The GUI can only subscribe once the platform has spawned this component, i.e.
 * after the first stages have already gone by, so the current stage is replayed
 * to every new subscriber. Without that, a subscriber attaching in the middle of
 * a long migration would see nothing until the next file was moved.
 */
export function createStartupEvents() {
  const observers = new ObserversSet<StartupEvent>();
  let current: StartupEvent = { stage: 'starting' };

  function emit(event: StartupEvent): void {
    current = event;
    if (!observers.isEmpty()) {
      observers.next(event);
    }
  }

  function watch(obs: web3n.Observer<StartupEvent>): () => void {
    obs.next?.(current);
    if (current.stage === 'ready') {
      obs.complete?.();
      return noop;
    }
    observers.add(obs);
    return () => observers.delete(obs);
  }

  function done(): void {
    emit({ stage: 'ready' });
    observers.complete();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function fail(err: any): void {
    observers.error(err);
  }

  return { emit, watch, done, fail };
}

function noop() {}
