/*
 Copyright (C) 2025 3NSoft Inc.

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

/* eslint-disable @typescript-eslint/no-explicit-any */

// @deno-types="../../shared-libs/sqlite-on-3nstorage/index.d.ts"
import { QueryExecResult, objectFromQueryExecResult } from '../../shared-libs/sqlite-on-3nstorage/index.js';
import type { Database } from '../../shared-libs/sqlite-on-3nstorage/index.d.ts';
import type { ParamsObject, SqlValue } from '../../shared-libs/sqlite-on-3nstorage/sqljs.d.ts';

/**
 * Column names of an existing table, empty when the table does not exist.
 * The check must go by the `name` field of PRAGMA table_info rows: matching a
 * whole row against a substring also matches type or default-value cells.
 */
export function tableColumnNames(db: Database, table: string): string[] {
  const [res] = db.exec(`PRAGMA table_info(${table})`);
  return res ? objectFromQueryExecResult<{ name: string }>(res).map(c => c.name) : [];
}

export type TransformDefinition<T> = {
  [field in keyof T]:
    | {
        toSQLValue: (v: any) => SqlValue;
        fromSQLValue: (sv: SqlValue) => any;
      }
    | 'as-is';
};

export function queryParamsFrom<T>(
  record: Partial<T>,
  transforms: TransformDefinition<T>,
  omit?: (keyof T)[],
): ParamsObject {
  const params = {} as ParamsObject;
  for (const field of Object.keys(record)) {
    if (omit?.includes(field as keyof T)) {
      continue;
    }
    const value = record[field as keyof T];
    const transform = transforms[field as keyof T];
    if (!transform) {
      throw new Error(`Field ${field} is not present in TransformDefinition object`);
    } else if (transform === 'as-is') {
      params[`$${field}`] = value as SqlValue;
    } else {
      const { toSQLValue } = transform;
      params[`$${field}`] = toSQLValue(value);
    }
  }
  return params;
}

export function fromQueryResult<T extends object>(
  queryResult: QueryExecResult,
  transforms: TransformDefinition<T>,
): T[] {
  const records = objectFromQueryExecResult<{
    [field in keyof T]: SqlValue;
  }>(queryResult);
  const objs: T[] = [];
  for (const record of records) {
    const obj = {} as T;
    for (const field of Object.keys(record)) {
      const transform = transforms[field as keyof T];
      if (!transform || transform === 'as-is') {
        obj[field as keyof T] = record[field as keyof T] as any;
      } else {
        const { fromSQLValue } = transform;
        obj[field as keyof T] = fromSQLValue(record[field as keyof T]);
      }
    }
    objs.push(obj);
  }
  return objs;
}

export function queryParamsFromComplete<T>(record: T, transforms: TransformDefinition<T>): ParamsObject {
  const params = queryParamsFrom(record, transforms);
  if (Object.keys(params).length < Object.keys(transforms).length) {
    throw new Error(`Not all fields are present in the record`);
  }
  return params;
}

export function forTableInsert<T extends object>(
  record: T,
  transforms: TransformDefinition<T>,
): {
  orderedColumns: string;
  orderedValues: string;
  insertParams: ParamsObject;
} {
  const insertParams = queryParamsFromComplete(record, transforms);
  const columns: string[] = [];
  const values: string[] = [];
  for (const field of Object.keys(record)) {
    const paramField = `$${field}`;
    if (insertParams[paramField] === undefined) {
      throw new Error(`Mismatch in expected parameters`);
    } else {
      columns.push(field);
      values.push(paramField);
    }
  }
  return {
    insertParams,
    orderedColumns: columns.join(', '),
    orderedValues: values.join(', '),
  };
}

export function setExprFor<T extends object>(params: ParamsObject, omit?: (keyof T)[]): string {
  const setPairs: string[] = [];
  for (const paramField of Object.keys(params)) {
    const field = paramField.substring(1);
    if (!omit?.includes(field as keyof T)) {
      setPairs.push(`${field}=${paramField}`);
    }
  }
  return setPairs.join(', ');
}

export function andEqualExprFor<T extends object>(params: ParamsObject, omit?: (keyof T)[]): string {
  const pairs: string[] = [];
  for (const paramField of Object.keys(params)) {
    const field = paramField.substring(1);
    if (!omit?.includes(field as keyof T)) {
      pairs.push(`${field}=${paramField}`);
    }
  }
  return pairs.join(' AND ');
}

export const optJsonTransform = {
  toSQLValue: (v: object | null): string | null => (v ? JSON.stringify(v) : null),
  fromSQLValue: (sv: SqlValue): object | null => {
    if (!sv || typeof sv !== 'string') {
      return null;
    }
    try {
      return JSON.parse(sv);
    } catch {
      return null;
    }
  },
};

export const jsonTransform = {
  toSQLValue: (v: object): string => JSON.stringify(v),
  fromSQLValue: (sv: SqlValue): object => {
    if (!sv || typeof sv !== 'string') {
      return {};
    }
    try {
      return JSON.parse(sv);
    } catch {
      return {};
    }
  },
};

export const booleanTransform = {
  toSQLValue: (b: boolean): 1 | 0 => (b ? 1 : 0),
  fromSQLValue: (flag: SqlValue): boolean => (flag === 0 ? false : true),
};

export const optStringAsEmptyTransform = {
  toSQLValue: (s: string | null): string => (s ? s : ''),
  fromSQLValue: (s: SqlValue): string | null => (s ? (s as string) : ''),
};
