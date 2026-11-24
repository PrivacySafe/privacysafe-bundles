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
// The `dates` column on a real sqlite (sql.js from the bundle of
// sqlite-on-3nstorage): a table made by an older version of the app has no such
// column, and it can come back at any time through synchronisation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactDate, RawPerson } from '@main/types';

// The bundle decodes its wasm with Uint8Array.fromBase64, which this Node lacks.
const U8 = Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array };
U8.fromBase64 ??= (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

const { SQLiteOn3NStorage } = await import('@shared/sqlite-on-3nstorage/index.js');
const { contactDb } = await import('@deno/dataset/contacts-db.ts');

const OWN_ADDR = 'me@3nweb.com';

const OLD_TABLE = `CREATE TABLE contacts (
  id TEXT PRIMARY KEY UNIQUE, mail TEXT NOT NULL, name TEXT, avatarId TEXT,
  timestamp INTEGER, notice TEXT, phone TEXT, activities TEXT, settings TEXT
)`;

type Db = Awaited<ReturnType<typeof SQLiteOn3NStorage.makeReadonly>>['db'];

async function makeSqlite() {
  const { db } = await SQLiteOn3NStorage.makeReadonly(new Uint8Array(0) as never);
  return {
    db,
    saveToFile: vi.fn(async () => undefined),
    listTables: () => {
      const [res] = db.exec(`SELECT name FROM sqlite_master WHERE type = 'table'`);
      return res ? res.values.map(row => row[0] as string) : [];
    },
  };
}

function columnsOf(db: Db): string[] {
  const [res] = db.exec('PRAGMA table_info(contacts)');
  return res.values.map(row => row[1] as string);
}

const birthday: ContactDate = { id: 'b1', type: 'birthday', month: 3, day: 15, year: 1990, notify: true };

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).w3n = {
    mailerid: { getUserId: vi.fn(async () => OWN_ADDR) },
  };
});

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).w3n;
});

describe('contacts db: dates', () => {

  it('makes a new table with the dates column', async () => {
    const sqlite = await makeSqlite();
    await contactDb(sqlite as never);

    expect(columnsOf(sqlite.db)).toContain('dates');
  });

  it('adds the column to a table of an older version, and saves the file', async () => {
    const sqlite = await makeSqlite();
    sqlite.db.exec(OLD_TABLE);
    sqlite.db.exec(`INSERT INTO contacts (id, mail, timestamp) VALUES ('c1', 'ann@3nweb.com', 1)`);
    sqlite.db.exec(`CREATE TABLE activities (id TEXT PRIMARY KEY, type TEXT NOT NULL, timestamp INTEGER NOT NULL)`);

    const db = await contactDb(sqlite as never);

    expect(columnsOf(sqlite.db)).toContain('dates');
    expect(sqlite.saveToFile).toHaveBeenCalled();
    expect(db.getContactFrom('c1')).toMatchObject({ mail: 'ann@3nweb.com', dates: [] });
  });

  it('stores the dates and reads them back', async () => {
    const sqlite = await makeSqlite();
    const db = await contactDb(sqlite as never);

    await db.insertContactInto({
      contact: { id: 'c1', mail: 'ann@3nweb.com', timestamp: 1, dates: [birthday] },
    });

    expect(db.getContactFrom('c1')?.dates).toEqual([birthday]);
  });

  it('drops malformed dates on the way in', async () => {
    const sqlite = await makeSqlite();
    const db = await contactDb(sqlite as never);

    await db.insertContactInto({
      contact: {
        id: 'c1',
        mail: 'ann@3nweb.com',
        timestamp: 1,
        dates: [birthday, { id: 'x', type: 'birthday', month: 2, day: 30 } as ContactDate],
      },
    });

    expect(db.getContactFrom('c1')?.dates).toEqual([birthday]);
  });

  it('writes into a table that lost the column on a reload of an older file', async () => {
    const sqlite = await makeSqlite();
    const db = await contactDb(sqlite as never);
    await db.insertContactInto({ contact: { id: 'c1', mail: 'ann@3nweb.com', timestamp: 1 } });

    // What reloadDb leaves after adopting a file uploaded by an older version.
    sqlite.db.exec('DROP TABLE contacts');
    sqlite.db.exec(OLD_TABLE);
    sqlite.db.exec(`INSERT INTO contacts (id, mail, timestamp) VALUES ('c1', 'ann@3nweb.com', 1)`);
    expect(db.listContactsWithDates()).toEqual([]);

    const updated = await db.updateContactInto({ id: 'c1', mail: 'ann@3nweb.com', dates: [birthday] });
    expect(updated.dates).toEqual([birthday]);
    await db.insertContactInto({ contact: { id: 'c2', mail: 'bob@3nweb.com', timestamp: 1, dates: [birthday] } });

    expect(columnsOf(sqlite.db)).toContain('dates');
    expect(db.getContactFrom('c1')?.dates).toEqual([birthday]);
    expect(db.getContactFrom('c2')?.dates).toEqual([birthday]);
  });

  it('lists only the contacts that have dates', async () => {
    const sqlite = await makeSqlite();
    const db = await contactDb(sqlite as never);
    await db.insertContactInto({ contact: { id: 'c1', mail: 'ann@3nweb.com', name: 'Ann', timestamp: 1, dates: [birthday] } });
    await db.insertContactInto({ contact: { id: 'c2', mail: 'bob@3nweb.com', timestamp: 1, dates: [] } });

    expect(db.listContactsWithDates()).toEqual([
      { id: 'c1', name: 'Ann', mail: 'ann@3nweb.com', dates: [birthday] },
    ]);
  });

  it('keeps the dates through a rewrite of the whole table', async () => {
    const sqlite = await makeSqlite();
    const db = await contactDb(sqlite as never);
    await db.insertContactInto({ contact: { id: 'c1', mail: 'ann@3nweb.com', timestamp: 1, dates: [birthday] } });

    const [rows] = sqlite.db.exec('SELECT * FROM contacts');
    const { objectFromQueryExecResult } = await import('@deno/dataset/contact-row-mapping.ts');
    await db.updateContactsTable(objectFromQueryExecResult<RawPerson>(rows), true);

    expect(db.getContactFrom('c1')?.dates).toEqual([birthday]);
  });

});
