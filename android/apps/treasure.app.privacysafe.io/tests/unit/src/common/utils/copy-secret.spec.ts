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
// A password copied out of the vault is taken back out of the clipboard
// (audit of 2026-11-26).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copySecret, CLIPBOARD_CLEAR_DELAY_MS } from '@/common/utils/copy-secret';

/** The system clipboard both apis write to. */
let held = '';
let focused = true;

const notFocused = () => new Error('Document is not focused');

/** The web clipboard: reads and writes only from a focused window. */
const web = {
  readText: vi.fn(async () => {
    if (!focused) {throw notFocused();}
    return held;
  }),
  writeText: vi.fn(async (text: string) => {
    if (!focused) {throw notFocused();}
    held = text;
  }),
};

/** The platform's clipboard, working regardless of focus. */
const platform = {
  readText: vi.fn(async () => held),
  writeText: vi.fn(async (text: string) => {
    held = text;
  }),
};

/** The platform's clipboard as core-platform-electron has it on 2026-11-26. */
const brokenPlatform = {
  readText: vi.fn(async (): Promise<string> => {
    throw new Error('no such method: shell.clipboard.clipboard.readText');
  }),
  writeText: vi.fn(async (): Promise<void> => {
    throw new Error('no such method: shell.clipboard.clipboard.writeText');
  }),
};

function windowStub() {
  const listeners = new Set<() => void>();
  return {
    addEventListener: vi.fn((type: string, fn: () => void) => {
      if (type === 'focus') {listeners.add(fn);}
    }),
    removeEventListener: vi.fn((type: string, fn: () => void) => {
      listeners.delete(fn);
    }),
    focus() {
      focused = true;
      [...listeners].forEach(fn => {
        listeners.delete(fn);
        fn();
      });
    },
  };
}

describe('copySecret', () => {

  let win: ReturnType<typeof windowStub>;

  beforeEach(() => {
    vi.useFakeTimers();
    held = '';
    focused = true;
    win = windowStub();
    vi.stubGlobal('navigator', { clipboard: web });
    vi.stubGlobal('addEventListener', win.addEventListener);
    vi.stubGlobal('removeEventListener', win.removeEventListener);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('with the web clipboard only', () => {

    it('clears the clipboard after the delay', async () => {
      await copySecret('hunter2');
      expect(held).toBe('hunter2');

      await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_DELAY_MS);

      expect(held).toBe('');
    });

    it('leaves alone what was copied after it', async () => {
      await copySecret('hunter2');
      held = 'something else';

      await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_DELAY_MS);

      expect(held).toBe('something else');
    });

    // The user has gone to paste the value elsewhere.
    it('clears when the window gets focus back, if it had none', async () => {
      await copySecret('hunter2');
      focused = false;

      await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_DELAY_MS);
      expect(held).toBe('hunter2');

      win.focus();
      await vi.advanceTimersByTimeAsync(0);

      expect(held).toBe('');
    });

    it('on focus, leaves alone what was copied in the meantime', async () => {
      await copySecret('hunter2');
      focused = false;
      await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_DELAY_MS);
      held = 'something else';

      win.focus();
      await vi.advanceTimersByTimeAsync(0);

      expect(held).toBe('something else');
    });

    it('counts the delay from the latest copy', async () => {
      await copySecret('first');
      await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_DELAY_MS - 1000);
      await copySecret('second');
      await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_DELAY_MS - 1000);

      expect(held).toBe('second');

      await vi.advanceTimersByTimeAsync(1000);
      expect(held).toBe('');
    });

  });

  describe('with a working platform clipboard', () => {

    beforeEach(() => {
      vi.stubGlobal('w3n', { shell: { clipboard: platform }, log: vi.fn() });
    });

    it('copies and clears through it, even without focus', async () => {
      await copySecret('hunter2');
      focused = false;

      await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_DELAY_MS);

      expect(held).toBe('');
      expect(web.writeText).not.toHaveBeenCalled();
    });

  });

  // Copying stopped working when the platform's clipboard was used alone.
  describe('with the platform clipboard failing every call', () => {

    beforeEach(() => {
      vi.stubGlobal('w3n', { shell: { clipboard: brokenPlatform }, log: vi.fn() });
    });

    it('copies through the web clipboard', async () => {
      await copySecret('hunter2');

      expect(held).toBe('hunter2');
    });

    it('clears through the web clipboard, on focus if need be', async () => {
      await copySecret('hunter2');
      focused = false;
      await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_DELAY_MS);
      expect(held).toBe('hunter2');

      win.focus();
      await vi.advanceTimersByTimeAsync(0);

      expect(held).toBe('');
    });

  });

});
