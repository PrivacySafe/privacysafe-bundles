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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function load(lang?: string) {
  vi.resetModules();
  (globalThis as unknown as Record<string, unknown>).w3n = {
    shell: {
      getFSResource: vi.fn(async () => {
        if (!lang) {
          throw new Error('no resource');
        }
        return { readJSON: async () => ({ lang }) };
      }),
    },
  };
  return import('@main/common/services/startup-status');
}

function statusLine(): HTMLElement | null {
  return document.querySelector('.app-init .app-init-status');
}

beforeEach(() => {
  document.body.innerHTML = '<div id="main"><div class="app-init"><div class="app-init-stage"></div></div></div>';
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (globalThis as unknown as Record<string, unknown>).w3n;
});

describe('startup status', () => {

  it('puts a line under the start-up animation and updates it', async () => {
    const { setStartupStatus } = await load('en');

    setStartupStatus('one');
    setStartupStatus('two');

    expect(document.querySelectorAll('.app-init-status')).toHaveLength(1);
    expect(statusLine()?.textContent).toBe('two');
    expect(statusLine()?.getAttribute('role')).toBe('status');
  });

  it('does nothing once the app is mounted over the animation', async () => {
    const { setStartupStatus } = await load('en');
    document.body.innerHTML = '<div id="main"><div class="app"></div></div>';

    setStartupStatus('late');

    expect(document.querySelector('.app-init-status')).toBeNull();
  });

  it('tells which attempt comes next, in the language of the launcher', async () => {
    const { showServiceWaitStatus } = await load('es');

    await showServiceWaitStatus(2, 3);

    expect(statusLine()?.textContent).toContain('intento 2 de 3');
  });

  it('speaks English when the language cannot be read', async () => {
    const { showServiceWaitStatus } = await load(undefined);

    await showServiceWaitStatus(3, 3);

    expect(statusLine()?.textContent).toContain('attempt 3 of 3');
  });

});
