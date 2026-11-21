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
import { describe, expect, it, vi } from 'vitest';
import {
  blacklistFingerprint,
  isBlacklistAffecting,
  makeBlacklistBroadcaster,
  selectBlacklisted,
} from '@deno/utils/contact-blacklist.ts';
import type { ContactEvent, Person, PersonSettings } from '@main/types/index.ts';

type Row = Pick<Person, 'id' | 'mail' | 'name' | 'avatarId' | 'settings' | 'timestamp'>;

function row(id: string, opts: Partial<Row> = {}): Row {
  return {
    id,
    mail: `${id}@example.com`,
    name: id,
    timestamp: 1000,
    ...opts,
  };
}

function blocked(id: string, opts: Partial<Row> = {}): Row {
  return row(id, { settings: { blockUser: true }, ...opts });
}

describe('isBlacklistAffecting', () => {

  it('accepts every event that can rewrite the contacts table', () => {
    const events: ContactEvent[] = [
      { event: 'add:contact', payload: { data: row('a') as Person } },
      { event: 'update:contact', payload: { data: row('a') as Person } },
      { event: 'remove:contact', payload: { id: 'a' } },
      { event: 'update:contact-list' },
    ];

    for (const event of events) {
      expect(isBlacklistAffecting(event)).toBe(true);
    }
  });

  it('ignores events that only report on synchronisation and archives', () => {
    const events: ContactEvent[] = [
      { event: 'sync:start', payload: { path: 'contacts-db' } },
      { event: 'sync:end', payload: { path: 'contacts-db' } },
      { event: 'sync:clean', payload: {} },
      { event: 'sync:stuck', payload: { isStuck: true } },
      {
        event: 'backup',
        payload: { stage: 'saving', totalFiles: 1, processedFiles: 1, percent: 100 },
      },
      {
        event: 'restore',
        payload: { stage: 'unpacking', totalFiles: 1, processedFiles: 0, percent: 0 },
      },
    ];

    for (const event of events) {
      expect(isBlacklistAffecting(event)).toBe(false);
    }
  });

});

describe('selectBlacklisted', () => {

  it('takes only the contacts whose blockUser flag is set', () => {
    const list = [blocked('a'), row('b'), blocked('c')];

    expect(selectBlacklisted(list).map(({ id }) => id)).toEqual(['a', 'c']);
  });

  it('tolerates settings that are missing, null or empty', () => {
    const list = [
      row('a'),
      row('b', { settings: null }),
      row('c', { settings: {} }),
      row('d', { settings: { blockUser: false } }),
    ];

    expect(selectBlacklisted(list)).toEqual([]);
  });

});

describe('blacklistFingerprint', () => {

  it('does not depend on the order rows come back in', () => {
    // The db is read without ORDER BY, so a DROP-and-refill of the table -
    // a restore, a conflict merge, a reload of a version from another device -
    // hands the same set back in another order.
    const a = blocked('a');
    const b = blocked('b');

    expect(blacklistFingerprint([a, b])).toBe(blacklistFingerprint([b, a]));
  });

  it('ignores the timestamp', () => {
    expect(blacklistFingerprint([blocked('a', { timestamp: 1 })]))
    .toBe(blacklistFingerprint([blocked('a', { timestamp: 2 })]));
  });

  it('ignores the key order within settings', () => {
    const first: PersonSettings = { blockUser: true, theme: 'dark' };
    const second: PersonSettings = { theme: 'dark', blockUser: true };

    expect(blacklistFingerprint([row('a', { settings: first })]))
    .toBe(blacklistFingerprint([row('a', { settings: second })]));
  });

  it('notices a changed name, mail or avatar', () => {
    const base = blacklistFingerprint([blocked('a')]);

    expect(blacklistFingerprint([blocked('a', { name: 'Renamed' })])).not.toBe(base);
    expect(blacklistFingerprint([blocked('a', { mail: 'other@example.com' })])).not.toBe(base);
    expect(blacklistFingerprint([blocked('a', { avatarId: 'pic' })])).not.toBe(base);
  });

  it('notices an added or removed entry', () => {
    const one = blacklistFingerprint([blocked('a')]);

    expect(blacklistFingerprint([blocked('a'), blocked('b')])).not.toBe(one);
    expect(blacklistFingerprint([])).not.toBe(one);
  });

  it('notices a changed value of another settings field', () => {
    expect(blacklistFingerprint([row('a', { settings: { blockUser: true, theme: 'dark' } })]))
    .not.toBe(blacklistFingerprint([row('a', { settings: { blockUser: true, theme: 'light' } })]));
  });

});

describe('makeBlacklistBroadcaster', () => {

  function setup(initial: Row[]) {
    let rows = initial;
    const broadcast = vi.fn();
    const onError = vi.fn();
    const listContacts = vi.fn(() => rows);
    const broadcaster = makeBlacklistBroadcaster({ listContacts, broadcast, onError });

    return {
      broadcaster,
      broadcast,
      onError,
      listContacts,
      setRows: (value: Row[]) => { rows = value; },
    };
  }

  it('reports the block list as it is right now', () => {
    const { broadcaster } = setup([blocked('a'), row('b')]);

    expect(broadcaster.current().map(({ id }) => id)).toEqual(['a']);
  });

  it('broadcasts nothing when primed', () => {
    const { broadcaster, broadcast } = setup([blocked('a')]);

    broadcaster.prime();

    expect(broadcast).not.toHaveBeenCalled();
  });

  it('stays quiet when nothing changed since priming', () => {
    const { broadcaster, broadcast } = setup([blocked('a')]);
    broadcaster.prime();

    broadcaster.broadcastIfChanged();

    expect(broadcast).not.toHaveBeenCalled();
  });

  it('announces a newly blocked contact exactly once', () => {
    const { broadcaster, broadcast, setRows } = setup([row('a')]);
    broadcaster.prime();

    setRows([blocked('a')]);
    broadcaster.broadcastIfChanged();
    broadcaster.broadcastIfChanged();

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0].map(({ id }: Person) => id)).toEqual(['a']);
  });

  it('announces an empty list when the last blocked contact is unblocked', () => {
    const { broadcaster, broadcast, setRows } = setup([blocked('a')]);
    broadcaster.prime();

    setRows([row('a')]);
    broadcaster.broadcastIfChanged();

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0]).toEqual([]);
  });

  it('announces a rename of a blocked contact', () => {
    // This is the path that a plain edit takes, on this device and on the one
    // the change is synchronised to.
    const { broadcaster, broadcast, setRows } = setup([blocked('a')]);
    broadcaster.prime();

    setRows([blocked('a', { name: 'Renamed' })]);
    broadcaster.broadcastIfChanged();

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0][0].name).toBe('Renamed');
  });

  it('stays quiet when only contacts outside the block list change', () => {
    const { broadcaster, broadcast, setRows } = setup([blocked('a'), row('b')]);
    broadcaster.prime();

    setRows([blocked('a'), row('b', { name: 'Renamed', avatarId: 'pic' })]);
    broadcaster.broadcastIfChanged();

    expect(broadcast).not.toHaveBeenCalled();
  });

  it('reports a failure to read instead of throwing, and broadcasts nothing', () => {
    // emitStorageEvent calls this from inside the sync utils: an exception
    // escaping here would tear down a synchronisation phase that has already
    // done its work.
    const { broadcaster, broadcast, onError, listContacts } = setup([blocked('a')]);
    broadcaster.prime();
    listContacts.mockImplementationOnce(() => {
      throw new Error('no such column: settings');
    });

    expect(() => broadcaster.broadcastIfChanged()).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('announces the next real change after a failed read', () => {
    const { broadcaster, broadcast, listContacts, setRows } = setup([blocked('a')]);
    broadcaster.prime();
    listContacts.mockImplementationOnce(() => {
      throw new Error('no such column: settings');
    });
    broadcaster.broadcastIfChanged();

    setRows([blocked('a'), blocked('b')]);
    broadcaster.broadcastIfChanged();

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0].map(({ id }: Person) => id)).toEqual(['a', 'b']);
  });

});
