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
// Stand-in for the platform's `w3n` global, covering only what the composables
// under test reach for. Installed on globalThis, since that is how the platform
// provides it.
// Parameters are named for documentation only; the default fakes ignore them.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { vi } from 'vitest';

/** What SystemSettings.watchConfig hands to file.watch(). */
export interface FsEventObserver {
  next?: (event: { type: string }) => Promise<void>;
}

export interface FakeW3nOpts {
  userId?: string;
  appVersion?: string;
  /** Command reported by getStartedCmd(), if the app was launched by one. */
  startedCmd?: { cmd: string; params: any[] };
  /** JSON answered by the launcher's ui-settings resource. */
  settings?: Record<string, unknown>;
}

export function installFakeW3n(opts: FakeW3nOpts = {}) {
  const settingsFile = {
    writable: false,
    readJSON: vi.fn(async () => ({
      lang: 'en',
      colorTheme: 'dark2',
      systemFoldersDisplaying: true,
      allowShowingDevtool: false,
      ...opts.settings,
    })),
    watch: vi.fn((_obs: FsEventObserver) => () => undefined),
  };

  const startCmdObservers: web3n.Observer<unknown>[] = [];
  const connectivityObservers: web3n.Observer<web3n.connectivity.ConnectivityEvent>[] = [];

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
      getFSResource: vi.fn(async () => settingsFile),
      watchStartCmds: vi.fn((obs: web3n.Observer<unknown>) => {
        startCmdObservers.push(obs);
        return () => undefined;
      }),
      getStartedCmd: vi.fn(async () => opts.startedCmd),
      startAppWithParams: vi.fn(async () => undefined),
      fileDialogs: {
        openFileDialog: vi.fn(async () => undefined),
        saveFileDialog: vi.fn(async () => undefined),
      },
    },
    connectivity: {
      isOnline: vi.fn(async () => 'online_80%'),
      watch: vi.fn((obs: web3n.Observer<web3n.connectivity.ConnectivityEvent>) => {
        connectivityObservers.push(obs);
        return () => {
          const i = connectivityObservers.indexOf(obs);
          if (i >= 0) {
            connectivityObservers.splice(i, 1);
          }
        };
      }),
    },
  };

  (globalThis as any).w3n = w3n;

  return {
    w3n,
    settingsFile,
    /**
     * Observers still subscribed to connectivity. Its length is how a test sees
     * whether the code under test unsubscribed.
     */
    connectivityObservers,
    /** Pushes a connectivity event as the platform's own watcher would. */
    emitConnectivity(event: Partial<web3n.connectivity.ConnectivityEvent>) {
      for (const obs of [...connectivityObservers]) {
        obs.next?.({ isOnline: false, ...event });
      }
    },
    /** Pushes a command as if the platform had sent it to a running app. */
    emitStartCmd(cmd: { cmd: string; params: any[] }) {
      for (const obs of startCmdObservers) {
        obs.next?.(cmd);
      }
    },
    uninstall() {
      delete (globalThis as any).w3n;
    },
  };
}
