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
import { h } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

vi.mock('@main/common/services/services-provider', () => ({
  appContactsSrvProxy: { getContactList: vi.fn(async () => []) },
  initializeServices: vi.fn(),
}));

const { useCommandHandler } = await import('@main/common/composables/use-command-handler.ts');
const { useContactsStore } = await import('@main/common/store/contacts.store');
const { NEW_POPULATED_CONTACT_ID } = await import('@main/common/constants');
const { withSetup } = await import('../../../helpers/app-context.ts');
const { installFakeW3n } = await import('../../../helpers/fake-w3n.ts');

const Blank = { render: () => h('div') };

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/list' },
      { path: '/list', name: 'contacts', component: Blank },
      { path: '/contact/:id', name: 'contact', component: Blank },
    ],
  });
}

async function boot(startedCmd?: { cmd: string; params: unknown[] }) {
  const platform = installFakeW3n({ startedCmd: startedCmd as never });
  const router = makeRouter();
  await router.push('/list');
  await router.isReady();
  const { result, app } = withSetup(() => ({
    handler: useCommandHandler(),
    store: useContactsStore(),
  }), { plugins: [router] });
  return { ...result, router, app, platform };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as unknown as Record<string, unknown>).w3n;
});

describe('useCommandHandler', () => {

  it('subscribes to start commands and asks for the launching one', async () => {
    const { handler, platform, app } = await boot();

    await handler.start();

    expect(platform.w3n.shell.watchStartCmds).toHaveBeenCalled();
    expect(platform.w3n.shell.getStartedCmd).toHaveBeenCalled();
    app.unmount();
  });

  it('does nothing when the app was not launched by a command', async () => {
    const { handler, store, router, app } = await boot(undefined);

    await handler.start();
    await vi.advanceTimersByTimeAsync(250);

    expect(store.contactDataFromCmd).toBeNull();
    expect(router.currentRoute.value.name).toBe('contacts');
    app.unmount();
  });

  describe('add-contact', () => {

    const cmd = {
      cmd: 'add-contact',
      params: [{ mail: 'ann@3nweb.com', name: 'Ann' }],
    };

    it('stages the incoming contact under the populated placeholder id', async () => {
      const { handler, store, app } = await boot(cmd);

      await handler.start();

      expect(store.contactDataFromCmd).toMatchObject({
        id: NEW_POPULATED_CONTACT_ID,
        mail: 'ann@3nweb.com',
        name: 'Ann',
      });
      expect(typeof store.contactDataFromCmd!.timestamp).toBe('number');
      app.unmount();
    });

    // The handler first routes to the list and only then, on a timer, to the
    // contact form. Without letting that timer run the form is never reached —
    // which is also why a spec cannot assert the final route synchronously.
    it('lands on the contact form in edit mode after the deferred push', async () => {
      const { handler, router, app } = await boot(cmd);

      await handler.start();
      expect(router.currentRoute.value.name).toBe('contacts');

      await vi.advanceTimersByTimeAsync(250);
      await router.isReady();

      expect(router.currentRoute.value.name).toBe('contact');
      expect(router.currentRoute.value.params.id).toBe(NEW_POPULATED_CONTACT_ID);
      expect(router.currentRoute.value.query.editMode).toBe('on');
      app.unmount();
    });

    it('accepts a command carrying only an address', async () => {
      const { handler, store, app } = await boot({
        cmd: 'add-contact', params: [{ mail: 'ann@3nweb.com' }],
      });

      await handler.start();

      expect(store.contactDataFromCmd).toMatchObject({ mail: 'ann@3nweb.com' });
      expect(store.contactDataFromCmd!.name).toBeUndefined();
      app.unmount();
    });

    it('handles a command arriving while the app is already running', async () => {
      const { handler, store, platform, app } = await boot(undefined);
      await handler.start();
      expect(store.contactDataFromCmd).toBeNull();

      platform.emitStartCmd(cmd);
      await vi.advanceTimersByTimeAsync(250);

      expect(store.contactDataFromCmd).toMatchObject({ mail: 'ann@3nweb.com' });
      app.unmount();
    });

  });

  it('logs an unknown command instead of failing', async () => {
    const { handler, platform, app } = await boot({ cmd: 'no-such-cmd', params: [] });

    await expect(handler.start()).resolves.toBeUndefined();

    expect(platform.w3n.log).toHaveBeenCalled();
    expect(platform.w3n.log.mock.calls[0][0]).toBe('error');
    app.unmount();
  });

});
