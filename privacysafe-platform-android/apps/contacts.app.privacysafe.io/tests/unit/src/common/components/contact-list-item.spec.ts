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
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { render, cleanup } from '@testing-library/vue';
import { VUEBUS_KEY } from '@v1nt1248/3nclient-lib/plugins';

vi.mock('@main/common/services/services-provider', () => ({
  appContactsSrvProxy: { getImage: vi.fn() },
  initializeServices: vi.fn(),
}));

const { appContactsSrvProxy } = await import('@main/common/services/services-provider');
const ListItem = (await import('@main/common/components/contact-list-item.vue')).default;
const { stubResizeObserver } = await import('../../../helpers/app-context.ts');
const i18n = (await import('@main/common/data/i18')).default;

const getImage = (appContactsSrvProxy as unknown as { getImage: ReturnType<typeof vi.fn> })
  .getImage;

const Blank = { render: () => h('div') };

/**
 * Stand-in for the app's event bus plugin. Handlers are kept so that a test can
 * fire the event the app fires when a download lands, and can see whether the
 * component unsubscribed.
 */
function makeFakeBus() {
  const handlers = new Map<string, Set<(payload?: unknown) => unknown>>();
  return {
    handlers,
    plugin: {
      $emitter: {
        on(event: string, handler: (payload?: unknown) => unknown) {
          if (!handlers.has(event)) {
            handlers.set(event, new Set());
          }
          handlers.get(event)!.add(handler);
        },
        off(event: string, handler: (payload?: unknown) => unknown) {
          handlers.get(event)?.delete(handler);
        },
        emit: vi.fn(),
      },
    },
    async fire(event: string) {
      for (const handler of [...(handlers.get(event) ?? [])]) {
        await handler();
      }
    },
  };
}

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/list', name: 'contacts', component: Blank },
      { path: '/contact/:id', name: 'contact', component: Blank },
    ],
  });
}

function contact(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    name: 'Ann',
    displayName: 'Ann',
    mail: 'ann@3nweb.com',
    avatarId: 'av1',
    avatarImage: '',
    timestamp: 1,
    ...over,
  };
}

async function renderItem(item = contact(), bus = makeFakeBus()) {
  const router = makeRouter();
  await router.push('/list');
  await router.isReady();
  const rendered = render(ListItem, {
    props: { item },
    global: {
      plugins: [createPinia(), i18n, router],
      provide: { [VUEBUS_KEY as unknown as string]: bus.plugin },
      config: {
        compilerOptions: { isCustomElement: (tag: string) => tag.startsWith('ui3n-') },
      },
    },
  });
  return { ...rendered, bus };
}

beforeEach(() => {
  stubResizeObserver();
  vi.useFakeTimers();
  getImage.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('contact-list-item', () => {

  it('asks the service for the -mini avatar of the contact', async () => {
    getImage.mockResolvedValue('data:image/gif;base64,AAAA');

    await renderItem();
    await vi.advanceTimersByTimeAsync(0);

    expect(getImage).toHaveBeenCalledWith('av1-mini');
  });

  it('does not fetch anything for a contact without an avatar', async () => {
    await renderItem(contact({ avatarId: '' }));
    await vi.advanceTimersByTimeAsync(0);

    expect(getImage).not.toHaveBeenCalled();
  });

  // The image may not have been downloaded yet, in which case the service
  // answers '[error]' and the component retries on a 30s timer. Retrying
  // forever would keep one failing avatar polling for the whole session, so the
  // attempts are capped at 3.
  it('retries a not-yet-available avatar and stops after three attempts', async () => {
    getImage.mockResolvedValue('[error]');

    await renderItem();
    await vi.advanceTimersByTimeAsync(0);
    expect(getImage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(getImage).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(getImage).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(30_000 * 5);
    expect(getImage).toHaveBeenCalledTimes(3);
  });

  it('stops retrying as soon as the avatar arrives', async () => {
    getImage.mockResolvedValueOnce('[error]');
    getImage.mockResolvedValue('data:image/gif;base64,AAAA');

    await renderItem();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getImage).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30_000 * 5);

    expect(getImage).toHaveBeenCalledTimes(2);
  });

  // The three blind retries above cover about a minute and a half. An avatar
  // downloaded later than that used to stay blank until this item was built
  // again; the service now reports a finished download, and that is the one
  // moment a fresh attempt can succeed.
  it('tries again when the contact list is reported updated', async () => {
    getImage.mockResolvedValue('[error]');

    const { bus } = await renderItem();
    await vi.advanceTimersByTimeAsync(30_000 * 5);
    expect(getImage).toHaveBeenCalledTimes(3);

    getImage.mockResolvedValue('data:image/gif;base64,AAAA');
    await bus.fire('contact-list:updated');

    expect(getImage).toHaveBeenCalledTimes(4);
  });

  it('does not refetch an avatar it already shows', async () => {
    getImage.mockResolvedValue('data:image/gif;base64,AAAA');

    const { bus } = await renderItem();
    await vi.advanceTimersByTimeAsync(0);
    expect(getImage).toHaveBeenCalledTimes(1);

    await bus.fire('contact-list:updated');

    expect(getImage).toHaveBeenCalledTimes(1);
  });

  it('ignores the event for a contact without an avatar', async () => {
    const { bus } = await renderItem(contact({ avatarId: '' }));

    await bus.fire('contact-list:updated');

    expect(getImage).not.toHaveBeenCalled();
  });

  it('stops listening once unmounted', async () => {
    getImage.mockResolvedValue('[error]');

    const { bus } = await renderItem();
    await vi.advanceTimersByTimeAsync(0);
    cleanup();

    expect(bus.handlers.get('contact-list:updated')?.size ?? 0).toBe(0);
  });

});
