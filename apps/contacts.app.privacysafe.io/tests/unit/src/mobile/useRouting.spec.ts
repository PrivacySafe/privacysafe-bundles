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
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { h } from 'vue';
import { useRouting } from '@main/mobile/composables/useRouting';
import { NEW_EMPTY_CONTACT_ID } from '@main/common/constants';
import { withSetup } from '../../helpers/app-context.ts';

const Blank = { render: () => h('div') };

/**
 * Mirrors the route table of src/mobile/router.ts, with the page components
 * replaced by blanks — importing the real module would pull both pages in, and
 * with them the store and the whole component library. Names and paths are kept
 * identical, since those are what useRouting builds its route objects from.
 */
function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/list' },
      { path: '/index-mobile.html', redirect: '/list' },
      { path: '/list', name: 'contacts', component: Blank },
      { path: '/contact/:id', name: 'contact', component: Blank },
    ],
  });
}

/**
 * router.back() navigates asynchronously and isReady() only covers the initial
 * navigation, so waiting for the guard hook is the only way to observe the
 * result. Resolves anyway after `settleMs` for the case where no navigation
 * happens at all.
 */
function waitForNavigation(router: Router, settleMs = 50): Promise<void> {
  return new Promise(resolve => {
    const stop = router.afterEach(() => {
      stop();
      resolve();
    });
    setTimeout(() => {
      stop();
      resolve();
    }, settleMs);
  });
}

async function bootRouting(startAt = '/list') {
  const router = makeRouter();
  await router.push(startAt);
  await router.isReady();
  const { result, app } = withSetup(() => useRouting(), { plugins: [router] });
  return { routing: result, router, app };
}

describe('useRouting', () => {

  it('navigates to the contact list', async () => {
    const { routing, router, app } = await bootRouting('/contact/a1');

    await routing.goToList();

    expect(router.currentRoute.value.name).toBe('contacts');
    app.unmount();
  });

  it('navigates to a contact', async () => {
    const { routing, router, app } = await bootRouting();

    await routing.goToContact('a1');

    expect(router.currentRoute.value.name).toBe('contact');
    expect(router.currentRoute.value.params.id).toBe('a1');
    expect(router.currentRoute.value.query.editMode).toBeUndefined();
    app.unmount();
  });

  it('opens a contact straight in edit mode when asked', async () => {
    const { routing, router, app } = await bootRouting();

    await routing.goToContact('a1', { edit: true });

    expect(router.currentRoute.value.query.editMode).toBe('on');
    app.unmount();
  });

  it('opens a new contact in edit mode', async () => {
    const { routing, router, app } = await bootRouting();

    await routing.goToNew();

    expect(router.currentRoute.value.params.id).toBe(NEW_EMPTY_CONTACT_ID);
    expect(router.currentRoute.value.query.editMode).toBe('on');
    app.unmount();
  });

  it('reads the contact id from the current route', async () => {
    const { routing, app } = await bootRouting('/contact/a1');

    expect(routing.getContactIdFromRoute()).toBe('a1');
    app.unmount();
  });

  it('reads the contact id from given params', async () => {
    const { routing, app } = await bootRouting('/contact/a1');

    expect(routing.getContactIdFromRoute({ id: 'other' })).toBe('other');
    app.unmount();
  });

  it('reads the edit state from the current route', async () => {
    const { routing, app } = await bootRouting('/contact/a1?editMode=on');

    expect(routing.getEditStateFromRoute()).toBe(true);
    app.unmount();
  });

  it('reports no edit state when the query is absent', async () => {
    const { routing, app } = await bootRouting('/contact/a1');

    expect(routing.getEditStateFromRoute()).toBe(false);
    app.unmount();
  });

  it('reads the edit state from a given query', async () => {
    const { routing, app } = await bootRouting('/contact/a1');

    expect(routing.getEditStateFromRoute({ editMode: 'on' })).toBe(true);
    app.unmount();
  });

  describe('goBack', () => {

    // Added in commit 8c171cd, replacing an unconditional goToList().
    it('returns to the list a contact was opened from', async () => {
      const { routing, router, app } = await bootRouting('/list');
      await routing.goToContact('a1');
      expect(router.currentRoute.value.name).toBe('contact');

      const navigated = waitForNavigation(router);
      routing.goBack();
      await navigated;

      expect(router.currentRoute.value.name).toBe('contacts');
      app.unmount();
    });

    it('steps back one entry at a time', async () => {
      const { routing, router, app } = await bootRouting('/list');
      await routing.goToContact('a1');
      await routing.goToContact('a2');

      const navigated = waitForNavigation(router);
      routing.goBack();
      await navigated;

      expect(router.currentRoute.value.params.id).toBe('a1');
      app.unmount();
    });

    // This is the risk the change carries: entering through the add-contact
    // deep link leaves nothing behind the current entry, so router.back() has
    // no in-app entry to return to. With no history the route simply stays put
    // here; on the real platform going back past the first entry is what would
    // leave the app.
    it('has nowhere to go when the contact route is the first entry', async () => {
      const { routing, router, app } = await bootRouting('/contact/new?editMode=on');

      const navigated = waitForNavigation(router);
      routing.goBack();
      await navigated;

      expect(router.currentRoute.value.name).toBe('contact');
      app.unmount();
    });

  });

});
