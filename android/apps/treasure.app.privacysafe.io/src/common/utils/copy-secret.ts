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
// Copying a value out of the vault. A password left in the clipboard is there
// for every app and every paste that comes after (audit of 2026-11-26), so it is
// taken back out after a while.
//
// Two clipboards, neither enough on its own:
// - the platform's (`w3n.shell.clipboard`) works from a window without focus,
//   but in core-platform-electron as of 2026-11-26 every call to it fails: the
//   gui side addresses `shell.clipboard.clipboard.<method>` (the segment is
//   added twice, clipboard-cap-ipc.ts). It is still tried first, so that the
//   fix in the platform is picked up without a change here.
// - the web one works, but writes only from a focused document. By the time a
//   value is to be cleared the user is usually pasting it elsewhere; then the
//   clearing is done when the window gets focus back.
export const CLIPBOARD_CLEAR_DELAY_MS = 30_000;

interface TextClipboard {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

function platformW3n(): web3n.caps.W3N | undefined {
  return (globalThis as { w3n?: web3n.caps.W3N }).w3n;
}

function platformClipboard(): TextClipboard | undefined {
  const clipboard = platformW3n()?.shell?.clipboard;
  if (typeof clipboard?.writeText !== 'function' || typeof clipboard?.readText !== 'function') {
    return undefined;
  }
  return clipboard as TextClipboard;
}

function webClipboard(): TextClipboard | undefined {
  return globalThis.navigator?.clipboard;
}

/** Writes through the platform if it can, through the web otherwise. Throws if neither did. */
async function writeText(text: string): Promise<void> {
  try {
    const platform = platformClipboard();
    if (platform) {
      await platform.writeText(text);
      return;
    }
  } catch {
    // See the note at the top: falls through to the web clipboard.
  }
  // Not the ui kit's copyToClipboard: it swallows the failure, and a clearing
  // that failed would then never be retried.
  const web = webClipboard();
  if (!web) {
    throw new Error('No clipboard is available');
  }
  await web.writeText(text);
}

/**
 * Reads what the clipboard holds. Undefined when it cannot be read: the value
 * is then cleared all the same, as leaving a password behind is worse than
 * clearing something copied after it.
 */
async function readText(): Promise<string | undefined> {
  for (const clipboard of [platformClipboard(), webClipboard()]) {
    if (!clipboard) {
      continue;
    }
    try {
      return await clipboard.readText();
    } catch {
      // Try the next one.
    }
  }
  return undefined;
}

let clearTimer: ReturnType<typeof setTimeout> | undefined;
let pendingOnFocus: (() => void) | undefined;

function cancelPending(): void {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = undefined;
  }
  if (pendingOnFocus) {
    globalThis.removeEventListener?.('focus', pendingOnFocus);
    pendingOnFocus = undefined;
  }
}

/** Answers false when the clipboard could not be written to. */
async function clearIfStill(value: string): Promise<boolean> {
  const current = await readText();
  if (current !== undefined && current !== value) {
    return true;
  }
  try {
    await writeText('');
    return true;
  } catch {
    return false;
  }
}

async function clearOrWaitForFocus(value: string): Promise<void> {
  if (await clearIfStill(value)) {
    return;
  }

  if (typeof globalThis.addEventListener !== 'function') {
    return;
  }
  pendingOnFocus = () => {
    cancelPending();
    void clearIfStill(value).then(cleared => {
      if (!cleared) {
        platformW3n()?.log('error', 'The clipboard could not be cleared after copying a value.');
      }
    });
  };
  globalThis.addEventListener('focus', pendingOnFocus, { once: true });
}

/** Copies the value, and clears the clipboard after a delay if it still holds it. */
export async function copySecret(value: string, delayMs = CLIPBOARD_CLEAR_DELAY_MS): Promise<void> {
  cancelPending();
  try {
    await writeText(value);
  } catch (err) {
    console.error('Error copying to clipboard. ', err);
    return;
  }

  clearTimer = setTimeout(() => {
    clearTimer = undefined;
    void clearOrWaitForFocus(value);
  }, delayMs);
}
