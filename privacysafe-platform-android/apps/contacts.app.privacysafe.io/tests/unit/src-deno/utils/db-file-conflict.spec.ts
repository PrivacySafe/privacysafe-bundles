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
import { normalizeContactRow, resolveDbFileConflict } from '@deno/utils/db-file-conflict.ts';
import type { RawPerson } from '@main/types';

function rawPerson(over: Partial<RawPerson> = {}): RawPerson {
  return {
    id: 'x',
    mail: 'a@b.c',
    name: null,
    avatarId: null,
    timestamp: 0,
    notice: null,
    phone: null,
    activities: null,
    settings: null,
    ...over,
  } as RawPerson;
}

describe('normalizeContactRow', () => {

  // Regression guard for a `for...in` over Object.keys(): that iterates the
  // key array's INDICES ("0", "1", …), producing a row whose real fields are
  // all undefined. It is silent, and it feeds resolveDbFileConflict.
  it('copies every field of the row, keyed by field name', () => {
    const row = rawPerson({ id: 'c1', mail: 'ann@3nweb.com', name: 'Ann', timestamp: 42, phone: '+1' });

    const normalized = normalizeContactRow(row);

    expect(normalized.id).toBe('c1');
    expect(normalized.mail).toBe('ann@3nweb.com');
    expect(normalized.name).toBe('Ann');
    expect(normalized.timestamp).toBe(42);
    expect(normalized.phone).toBe('+1');
    expect(Object.keys(normalized)).toEqual(Object.keys(row));
  });

  it('does not introduce numeric keys', () => {
    const normalized = normalizeContactRow(rawPerson({ mail: 'ann@3nweb.com' }));

    expect(Object.keys(normalized).some(k => /^\d+$/.test(k))).toBe(false);
  });

  it('runs activities and settings through normalizeJsonField', () => {
    const normalized = normalizeContactRow(rawPerson({
      activities: '[]' as unknown as RawPerson['activities'],
      settings: '{}' as unknown as RawPerson['settings'],
    }));

    expect(normalized.activities).toBeNull();
    expect(normalized.settings).toBeNull();
  });

  it('keeps non-empty activities and settings', () => {
    const normalized = normalizeContactRow(rawPerson({
      activities: '[1]' as unknown as RawPerson['activities'],
      settings: '{"s":1}' as unknown as RawPerson['settings'],
    }));

    expect(normalized.activities).toBe('[1]');
    expect(normalized.settings).toBe('{"s":1}');
  });

});

describe('resolveDbFileConflict', () => {

  it('keeps a contact that exists only locally, reporting no differences', () => {
    const local = rawPerson({ id: 'L1', name: 'Ann' });

    const { areThereDifferences, resolvedContactList } = resolveDbFileConflict([], [local]);

    expect(areThereDifferences).toBe(false);
    expect(resolvedContactList).toEqual([local]);
  });

  it('adds a contact that exists only remotely, reporting differences', () => {
    const remote = rawPerson({ id: 'R1', name: 'Bob' });

    const { areThereDifferences, resolvedContactList } = resolveDbFileConflict([remote], []);

    expect(areThereDifferences).toBe(true);
    expect(resolvedContactList).toEqual([remote]);
  });

  it('takes a field present only on the remote side and reports differences', () => {
    const { areThereDifferences, resolvedContactList } = resolveDbFileConflict(
      [rawPerson({ id: 'R1', name: 'Bob', timestamp: 5 })],
      [rawPerson({ id: 'L1', timestamp: 5 })],
    );

    expect(resolvedContactList[0].name).toBe('Bob');
    expect(areThereDifferences).toBe(true);
  });

  it('keeps a field present only on the local side without reporting differences', () => {
    const { areThereDifferences, resolvedContactList } = resolveDbFileConflict(
      [rawPerson({ id: 'R1', timestamp: 5 })],
      [rawPerson({ id: 'L1', name: 'Ann', timestamp: 5 })],
    );

    expect(resolvedContactList[0].name).toBe('Ann');
    expect(areThereDifferences).toBe(false);
  });

  it('lets the newer record win when both sides have the field', () => {
    const { areThereDifferences, resolvedContactList } = resolveDbFileConflict(
      [rawPerson({ id: 'R1', name: 'Bob', timestamp: 9 })],
      [rawPerson({ id: 'L1', name: 'Ann', timestamp: 5 })],
    );

    expect(resolvedContactList[0].name).toBe('Bob');
    expect(resolvedContactList[0].timestamp).toBe(9);
    expect(areThereDifferences).toBe(true);
  });

  it('keeps the local value when the local record is newer', () => {
    const { areThereDifferences, resolvedContactList } = resolveDbFileConflict(
      [rawPerson({ id: 'R1', name: 'Bob', timestamp: 5 })],
      [rawPerson({ id: 'L1', name: 'Ann', timestamp: 9 })],
    );

    expect(resolvedContactList[0].name).toBe('Ann');
    expect(areThereDifferences).toBe(false);
  });

  // The comparison is `local.timestamp >= remote.timestamp`, so an exact tie
  // resolves in favour of the local side. Pinned because flipping it to `>`
  // would make every equal-timestamp conflict adopt remote data.
  it('resolves an exact timestamp tie in favour of the local record', () => {
    const { areThereDifferences, resolvedContactList } = resolveDbFileConflict(
      [rawPerson({ id: 'R1', name: 'Bob', timestamp: 7 })],
      [rawPerson({ id: 'L1', name: 'Ann', timestamp: 7 })],
    );

    expect(resolvedContactList[0].name).toBe('Ann');
    expect(areThereDifferences).toBe(false);
  });

  // isLocalAheadOfRemote is what keeps the caller from adopting the remote
  // version over a local-only row. Before it existed, a contact created while
  // offline was dropped the moment the other device's version arrived: the
  // remote had brought nothing new, so the merge reported no differences and
  // the caller adopted the server's table wholesale.
  describe('isLocalAheadOfRemote', () => {

    it('is set by a contact that exists only locally', () => {
      const { areThereDifferences, isLocalAheadOfRemote } = resolveDbFileConflict(
        [rawPerson({ id: 'R1', mail: 'bob@3nweb.com', timestamp: 5 })],
        [
          rawPerson({ id: 'R1', mail: 'bob@3nweb.com', timestamp: 5 }),
          rawPerson({ id: 'L2', mail: 'cid@3nweb.com', timestamp: 6 }),
        ],
      );

      expect(isLocalAheadOfRemote).toBe(true);
      expect(areThereDifferences).toBe(false);
    });

    it('is not set by a contact that exists only remotely', () => {
      const { isLocalAheadOfRemote } = resolveDbFileConflict(
        [rawPerson({ id: 'R1', name: 'Bob' })], [],
      );

      expect(isLocalAheadOfRemote).toBe(false);
    });

    it('is set by a field only the local side has', () => {
      const { isLocalAheadOfRemote } = resolveDbFileConflict(
        [rawPerson({ id: 'R1', timestamp: 5 })],
        [rawPerson({ id: 'L1', name: 'Ann', timestamp: 5 })],
      );

      expect(isLocalAheadOfRemote).toBe(true);
    });

    it('is not set by a field only the remote side has', () => {
      const { isLocalAheadOfRemote } = resolveDbFileConflict(
        [rawPerson({ id: 'R1', name: 'Bob', timestamp: 5 })],
        [rawPerson({ id: 'L1', timestamp: 5 })],
      );

      expect(isLocalAheadOfRemote).toBe(false);
    });

    it('is set when the local record is the newer one', () => {
      const { isLocalAheadOfRemote } = resolveDbFileConflict(
        [rawPerson({ id: 'R1', name: 'Bob', timestamp: 5 })],
        [rawPerson({ id: 'L1', name: 'Ann', timestamp: 9 })],
      );

      expect(isLocalAheadOfRemote).toBe(true);
    });

    it('is not set when the remote record is the newer one', () => {
      const { isLocalAheadOfRemote } = resolveDbFileConflict(
        [rawPerson({ id: 'R1', name: 'Bob', timestamp: 9 })],
        [rawPerson({ id: 'L1', name: 'Ann', timestamp: 5 })],
      );

      expect(isLocalAheadOfRemote).toBe(false);
    });

    // The tie resolves in favour of the local record, and that is not a reason
    // to publish a version: both sides are taken to hold the same row.
    it('is not set by an exact timestamp tie', () => {
      const { isLocalAheadOfRemote } = resolveDbFileConflict(
        [rawPerson({ id: 'R1', name: 'Bob', timestamp: 7 })],
        [rawPerson({ id: 'L1', name: 'Ann', timestamp: 7 })],
      );

      expect(isLocalAheadOfRemote).toBe(false);
    });

    // Both devices adding a contact of their own while offline: each side has
    // something the other lacks, so the merge must be both rewritten AND
    // published.
    it('is set together with areThereDifferences when both sides added a row', () => {
      const { areThereDifferences, isLocalAheadOfRemote, resolvedContactList } =
        resolveDbFileConflict(
          [rawPerson({ id: 'R1', mail: 'dan@3nweb.com', timestamp: 6 })],
          [rawPerson({ id: 'L1', mail: 'cid@3nweb.com', timestamp: 5 })],
        );

      expect(isLocalAheadOfRemote).toBe(true);
      expect(areThereDifferences).toBe(true);
      expect(resolvedContactList.map(c => c.mail))
      .toEqual(['cid@3nweb.com', 'dan@3nweb.com']);
    });

    it('is not set when the two sides hold the same row', () => {
      const { areThereDifferences, isLocalAheadOfRemote } = resolveDbFileConflict(
        [rawPerson({ id: 'c1', mail: 'ann@3nweb.com', name: 'Ann', timestamp: 5 })],
        [rawPerson({ id: 'c1', mail: 'ann@3nweb.com', name: 'Ann', timestamp: 5 })],
      );

      expect(isLocalAheadOfRemote).toBe(false);
      expect(areThereDifferences).toBe(false);
    });

  });

  it('nulls a field that is empty on both sides', () => {
    const { resolvedContactList } = resolveDbFileConflict(
      [rawPerson({ id: 'R1', timestamp: 1 })],
      [rawPerson({ id: 'L1', timestamp: 1 })],
    );

    expect(resolvedContactList[0].name).toBeNull();
    expect(resolvedContactList[0].phone).toBeNull();
  });

  // timestamp is itself one of the merged fields, and 0 is falsy, so a pair of
  // never-stamped records comes out with a NULL timestamp rather than 0.
  // Harmless today (personValueToSqlInsertParams maps it back to 0), but a
  // trap for anyone reading resolvedContactList directly.
  it('nulls the timestamp when it is 0 on both sides', () => {
    const { resolvedContactList } = resolveDbFileConflict(
      [rawPerson({ id: 'R1', timestamp: 0 })],
      [rawPerson({ id: 'L1', timestamp: 0 })],
    );

    expect(resolvedContactList[0].timestamp).toBeNull();
  });

  it('merges by mail address while keeping the local id', () => {
    const { resolvedContactList } = resolveDbFileConflict(
      [rawPerson({ id: 'remote-id', mail: 'ann@3nweb.com', name: 'Bob', timestamp: 9 })],
      [rawPerson({ id: 'local-id', mail: 'ann@3nweb.com', name: 'Ann', timestamp: 5 })],
    );

    expect(resolvedContactList).toHaveLength(1);
    expect(resolvedContactList[0].id).toBe('local-id');
    expect(resolvedContactList[0].name).toBe('Bob');
  });

  // Merging by mail while carrying ids over verbatim means a remote-only row
  // keeps its remote id. Two devices that generated the same random id for
  // different contacts would collide on the primary key. Pinned so the risk
  // is visible rather than latent.
  it('keeps the remote id for a remote-only contact', () => {
    const { resolvedContactList } = resolveDbFileConflict(
      [rawPerson({ id: 'remote-id', mail: 'bob@3nweb.com' })],
      [rawPerson({ id: 'local-id', mail: 'ann@3nweb.com' })],
    );

    expect(resolvedContactList.map(c => c.id)).toEqual(['local-id', 'remote-id']);
  });

  // The remote row is consumed by the FIRST local row sharing its mail, so a
  // second local row with the same address is passed through unmerged.
  it('merges a duplicated mail address only into the first local row', () => {
    const { areThereDifferences, resolvedContactList } = resolveDbFileConflict(
      [rawPerson({ id: 'R1', name: 'Bob', timestamp: 5 })],
      [
        rawPerson({ id: 'L1', name: 'Ann', timestamp: 5 }),
        rawPerson({ id: 'L2', name: 'Cid', timestamp: 5 }),
      ],
    );

    expect(resolvedContactList.map(c => c.name)).toEqual(['Ann', 'Cid']);
    expect(areThereDifferences).toBe(false);
  });

  it('handles both sides being empty', () => {
    const { areThereDifferences, resolvedContactList } = resolveDbFileConflict([], []);

    expect(areThereDifferences).toBe(false);
    expect(resolvedContactList).toEqual([]);
  });

});
