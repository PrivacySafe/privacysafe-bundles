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

// New contacts of a file another user shared are added only after the user
// has seen them (audit of 2026-11-26).

import { afterEach, describe, expect, it, vi } from 'vitest';

const { proxy } = vi.hoisted(() => ({
  proxy: {
    getSharedContactsImport: vi.fn(),
    finishSharedContactsImport: vi.fn(async () => undefined),
    upsertContact: vi.fn(async (c: { mail: string }) => ({ ...c, id: `id-${c.mail}`, timestamp: 1 })),
    getContact: vi.fn(async () => undefined),
    getContactList: vi.fn(async () => []),
    addImage: vi.fn(async () => 'img'),
  },
}));

vi.mock('@main/common/services/services-provider', () => ({
  appContactsSrvProxy: proxy,
  initializeServices: vi.fn(),
}));

const { useContactsImport } = await import('@main/common/composables/use-contacts-import.ts');
const { withSetup } = await import('../../../helpers/app-context.ts');
const { installFakeW3n } = await import('../../../helpers/fake-w3n.ts');

afterEach(() => {
  vi.clearAllMocks();
  delete (globalThis as unknown as Record<string, unknown>).w3n;
});

function start() {
  installFakeW3n({});
  const { result, app } = withSetup(() => useContactsImport('imp-1'));
  return { imp: result, app };
}

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; (i < 100) && !cond(); i += 1) {
    await new Promise(r => setTimeout(r, 1));
  }
}

describe('useContactsImport', () => {
  const incoming = [
    { mail: 'alice@3nweb.com', name: 'Alice (work)', dates: [], timestamp: 1, settings: null, activities: null, key: null },
  ];

  it('shows the new contacts and adds nothing before the user agrees', async () => {
    proxy.getSharedContactsImport.mockResolvedValue(incoming);
    const { imp, app } = start();

    const outcome = imp.run();
    await until(() => !!imp.newContacts.value);

    expect(imp.newContacts.value!.map(c => c.mail)).toEqual(['alice@3nweb.com']);
    expect(proxy.upsertContact).not.toHaveBeenCalled();

    imp.decideOnNewContacts(false);
    expect(await outcome).toBe('done');
    expect(proxy.upsertContact).not.toHaveBeenCalled();
    expect(imp.stats.value.skipped).toBe(1);
    app.unmount();
  });

  it('adds them once the user agrees', async () => {
    proxy.getSharedContactsImport.mockResolvedValue(incoming);
    const { imp, app } = start();

    const outcome = imp.run();
    await until(() => !!imp.newContacts.value);
    imp.decideOnNewContacts(true);

    expect(await outcome).toBe('done');
    expect(proxy.upsertContact).toHaveBeenCalledTimes(1);
    expect(imp.stats.value.added).toBe(1);
    app.unmount();
  });
});
