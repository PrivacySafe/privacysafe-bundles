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
// A programmable stand-in for the slice of web3n.files.WritableFS that the
// contacts service's sync code actually touches. Everything is a vi.fn(), so a
// test can both script the platform's answers and assert on the calls made.
// Parameters are named for documentation only; the fakes ignore them.
/* eslint-disable @typescript-eslint/no-unused-vars */
import { vi } from 'vitest';
import type { ContactEvent } from '@main/types';

export interface FakeFolderEntry {
  name: string;
  isFile?: boolean;
  isFolder?: boolean;
}

export function fileEntry(name: string): FakeFolderEntry {
  return { name, isFile: true };
}

export function folderEntry(name: string): FakeFolderEntry {
  return { name, isFolder: true };
}

/** The exception shape the platform raises when it cannot reach the server. */
export function connectException(): web3n.ConnectException {
  return { runtimeException: true, type: 'connect' } as web3n.ConnectException;
}

/**
 * fs-sync exception saying a child object has never been uploaded, which
 * syncUpload answers with a delayed retry.
 */
export function childNeverUploadedException(): web3n.files.FSSyncException {
  return {
    runtimeException: true,
    type: 'fs-sync',
    childNeverUploaded: true,
  } as web3n.files.FSSyncException;
}

/**
 * fs-sync exception the platform raises when an upload of the same path is
 * already in flight. Carries the running task's id, just as a successful
 * startUpload result would.
 */
export function alreadyUploadingException(): web3n.files.FSSyncException {
  return {
    runtimeException: true,
    type: 'fs-sync',
    alreadyUploading: true,
    uploadTaskId: 42,
    message: 'Upload is in progress',
  } as web3n.files.FSSyncException;
}

/**
 * A stand-in for the ReadonlyFS/ReadonlyFile that the sync api hands out for a
 * child of a folder's REMOTE version. `entries` is what its listFolder answers,
 * `files` maps a name to the text its readTxtFile answers.
 */
export function makeFakeRemoteFolder(
  entries: FakeFolderEntry[] = [], files: Record<string, string> = {},
) {
  return {
    listFolder: vi.fn(async (_path: string) => entries),
    readTxtFile: vi.fn(async (name: string) => files[name] ?? ''),
    readBytes: vi.fn(async () => new Uint8Array()),
  };
}

/**
 * What the platform answers for a path it tracks and that has local changes to
 * publish. It is the DEFAULT of the fake, because a synced FS always answers
 * with a status object or throws - undefined means "no sync api" or a swallowed
 * failure, and syncUpload reads that as "the server is out of reach" and skips.
 * A test that wants that state says so explicitly.
 */
export function unsyncedStatus(latest = 1) {
  return { state: 'unsynced', local: { latest } };
}

export function makeFakeFs(folders: Record<string, FakeFolderEntry[]> = {}) {
  const sync = {
    status: vi.fn(async (_path: string) => unsyncedStatus() as unknown),
    upload: vi.fn(async (_path: string, _opts?: unknown) => ({
      uploadVersion: 1, uploadTaskId: 1,
    })),
    startUpload: vi.fn(async (_path: string, _opts?: unknown) => 1),
    startDownload: vi.fn(async (_path: string, _version?: number) => ({ downloadTaskId: 1 })),
    adoptRemote: vi.fn(async (_path: string, _opts?: unknown) => undefined),
    isRemoteVersionOnDisk: vi.fn(async (_path: string, _version: number) => 'complete'),
    absorbRemoteFolderChanges: vi.fn(async (_path: string, _opts?: unknown) => undefined),
    diffCurrentAndRemoteFolderVersions: vi.fn(
      async (_path: string, _remoteVersion?: number) => ({} as unknown),
    ),
    getRemoteFileItem: vi.fn(
      async (_path: string, _name: string, _remoteVersion?: number) => makeFakeRemoteFolder(),
    ),
    getRemoteFolderItem: vi.fn(
      async (_path: string, _name: string, _remoteVersion?: number) => makeFakeRemoteFolder(),
    ),
    whenConnected: vi.fn(async () => undefined),
  };

  const v = {
    sync,
    readBytes: vi.fn(async () => ({ bytes: new Uint8Array() })),
  };

  const fs = {
    v,
    listFolder: vi.fn(async (path: string) => folders[path] ?? []),
    deleteFile: vi.fn(async (_path: string) => undefined),
    writableFile: vi.fn(),
    writableSubRoot: vi.fn(),
    readJSONFile: vi.fn(),
    writeJSONFile: vi.fn(),
    readTxtFile: vi.fn(async (_path: string) => ''),
    writeTxtFile: vi.fn(async (_path: string, _txt: string) => 1),
    checkFilePresence: vi.fn(async (_path: string) => true),
    checkFolderPresence: vi.fn(async () => true),
    makeFolder: vi.fn(),
    watchTree: vi.fn(),
  };

  return {
    fs: fs as unknown as web3n.files.WritableFS,
    fsCalls: fs,
    sync,
    v,
    folders,
  };
}

export type FakeFs = ReturnType<typeof makeFakeFs>;

/**
 * Scripts fs.v.sync.status per path. Paths not listed answer "no status", which
 * is how the platform reports a path it does not track.
 */
export function scriptSyncStatuses(
  sync: FakeFs['sync'], byPath: Record<string, unknown>,
): void {
  sync.status.mockImplementation(async (path: string) => byPath[path]);
}

/** Collects emitted ContactEvents and answers questions about their pairing. */
export function makeEventCollector() {
  const events: ContactEvent[] = [];
  const emitStorageEvent = (event: ContactEvent) => {
    events.push(event);
  };

  return {
    events,
    emitStorageEvent,
    names: () => events.map(e => e.event),
    pathsOf: (name: ContactEvent['event']) => events
      .filter(e => e.event === name)
      .map(e => (e.payload as { path?: string } | undefined)?.path),
  };
}
