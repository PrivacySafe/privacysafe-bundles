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
*/
// An in-memory stand-in for the slice of web3n.files.WritableFS the services
// touch. Real enough to write a file and read it back, so a service can be
// exercised end to end rather than against a script of expected calls.
// Parameters are named for documentation only where the fake ignores them.
import { vi } from 'vitest';

/** The exception shape the platform raises for a path that is not there. */
export function notFoundException(path: string): web3n.files.FileException {
  return {
    runtimeException: true,
    type: 'file',
    code: 'ENOENT',
    path,
    notFound: true,
  } as web3n.files.FileException;
}

export interface FakeFS {
  fs: web3n.files.WritableFS;
  /** Every file currently held, by path. */
  files: Map<string, Uint8Array>;
  /** Folders that exist, including ones made through makeFolder. */
  folders: Set<string>;
  /** Reads a file back as parsed json, for assertions. */
  readJSON<T>(path: string): T;
  /** Whether a path is held. */
  has(path: string): boolean;
}

/**
 * @param initial files the storage starts with; a value is either bytes or a
 * json-serialisable object, which is stored as its utf8 json.
 */
export function makeFakeFS(initial: Record<string, Uint8Array | unknown> = {}): FakeFS {
  const files = new Map<string, Uint8Array>();
  const folders = new Set<string>(['']);

  function toBytes(value: Uint8Array | unknown): Uint8Array {
    return (value instanceof Uint8Array)
      ? value
      : new TextEncoder().encode(JSON.stringify(value));
  }

  function rememberFoldersOf(path: string): void {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i += 1) {
      folders.add(parts.slice(0, i).join('/'));
    }
  }

  function put(path: string, value: Uint8Array | unknown): void {
    files.set(path, toBytes(value));
    rememberFoldersOf(path);
  }

  for (const [path, value] of Object.entries(initial)) {
    put(path, value);
  }

  function read(path: string): Uint8Array {
    const bytes = files.get(path);
    if (!bytes) {
      throw notFoundException(path);
    }
    return bytes;
  }

  const fs = {
    writeJSONFile: vi.fn(async (path: string, json: unknown) => {
      put(path, json);
    }),
    readJSONFile: vi.fn(async (path: string) => JSON.parse(new TextDecoder().decode(read(path)))),
    writeBytes: vi.fn(async (path: string, bytes: Uint8Array) => {
      put(path, bytes);
    }),
    readBytes: vi.fn(async (path: string) => read(path)),
    writeTxtFile: vi.fn(async (path: string, txt: string) => {
      put(path, new TextEncoder().encode(txt));
    }),
    readTxtFile: vi.fn(async (path: string) => new TextDecoder().decode(read(path))),
    deleteFile: vi.fn(async (path: string) => {
      if (!files.delete(path)) {
        throw notFoundException(path);
      }
    }),
    checkFilePresence: vi.fn(async (path: string) => files.has(path)),
    checkFolderPresence: vi.fn(async (path: string) => folders.has(path)),
    makeFolder: vi.fn(async (path: string) => {
      folders.add(path);
      rememberFoldersOf(`${path}/x`);
    }),
    // Lists the immediate children of a folder, as the platform's own does.
    listFolder: vi.fn(async (dir: string) => {
      const prefix = dir ? `${dir}/` : '';
      const seen = new Map<string, { name: string; isFile: boolean; isFolder: boolean }>();

      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) {
          continue;
        }
        const rest = path.slice(prefix.length);
        if (!rest) {
          continue;
        }
        const slash = rest.indexOf('/');
        const name = (slash === -1) ? rest : rest.slice(0, slash);
        seen.set(name, { name, isFile: slash === -1, isFolder: slash !== -1 });
      }

      for (const folder of folders) {
        if (!folder || !folder.startsWith(prefix)) {
          continue;
        }
        const rest = folder.slice(prefix.length);
        if (!rest || rest.includes('/')) {
          continue;
        }
        if (!seen.has(rest)) {
          seen.set(rest, { name: rest, isFile: false, isFolder: true });
        }
      }

      return [...seen.values()];
    }),
  } as unknown as web3n.files.WritableFS;

  return {
    fs,
    files,
    folders,
    readJSON<T>(path: string): T {
      return JSON.parse(new TextDecoder().decode(read(path))) as T;
    },
    has(path: string): boolean {
      return files.has(path);
    },
  };
}
