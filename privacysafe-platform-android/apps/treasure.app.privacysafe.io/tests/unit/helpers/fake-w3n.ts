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
// Stand-in for the platform's `w3n` global, covering only what the code under
// test reaches for. Installed on globalThis, since that is how the platform
// provides it.
// Parameters are named for documentation only; the default fakes ignore them.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { vi } from 'vitest';

export interface FakeW3nOpts {
  userId?: string;
  appVersion?: string;
}

export function installFakeW3n(opts: FakeW3nOpts = {}) {
  const w3n = {
    myVersion: vi.fn(async () => opts.appVersion ?? '0.0.0-test'),
    closeSelf: vi.fn(),
    log: vi.fn(async (
      _type: 'error' | 'info' | 'warning', _msg: string, _err?: unknown,
    ) => undefined),
    mailerid: {
      getUserId: vi.fn(async () => opts.userId ?? 'me@3nweb.com'),
    },
    shell: {
      // Parameters are spelled out so that a test can assert on the shape of
      // the call, which is what the platform is particular about.
      fileDialogs: {
        openFileDialog: vi.fn(async (
          _title: string, _btnLabel: string, _multiSelections: boolean,
          _opts?: { filters?: { name: string; extensions: string[] }[] },
        ): Promise<unknown> => undefined),
        saveFileDialog: vi.fn(async (
          _title: string, _btnLabel: string, _defaultPath: string,
          _opts?: { filters?: { name: string; extensions: string[] }[] },
        ): Promise<unknown> => undefined),
      },
    },
    connectivity: {
      isOnline: vi.fn(async () => 'online_80%'),
    },
  };

  (globalThis as any).w3n = w3n;

  return {
    w3n,
    /** Makes the open dialog answer a file holding these bytes, or nothing. */
    openDialogAnswering(bytes: Uint8Array | null) {
      w3n.shell.fileDialogs.openFileDialog.mockResolvedValue(
        (bytes ? [{ readBytes: async () => bytes }] : undefined) as any,
      );
    },
    /** Makes the save dialog answer this file, or nothing when declined. */
    saveDialogAnswering(file: { name?: string; writeBytes: (b: Uint8Array) => Promise<void> } | undefined) {
      w3n.shell.fileDialogs.saveFileDialog.mockResolvedValue(file as any);
    },
    uninstall() {
      delete (globalThis as any).w3n;
    },
  };
}
