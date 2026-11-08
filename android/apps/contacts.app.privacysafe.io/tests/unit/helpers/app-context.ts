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
import { createApp, type App, type Plugin } from 'vue';
import { createPinia } from 'pinia';
import i18n from '@main/common/data/i18';

/**
 * useAppSize() constructs a ResizeObserver during setup and jsdom has none, so
 * anything reaching useAppStore() needs this first.
 */
export function stubResizeObserver(): void {
  if ('ResizeObserver' in globalThis) {
    return;
  }
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() { /* no-op */ }
    unobserve() { /* no-op */ }
    disconnect() { /* no-op */ }
  };
}

/**
 * Runs a composable or store factory inside a real component setup, with pinia
 * and i18n installed. A component instance — not just an app context — is
 * required because vue-i18n's useI18n() refuses to run outside setup, and
 * contacts.store calls it.
 */
export function withSetup<T>(
  composable: () => T, opts: { plugins?: Plugin[] } = {},
): { result: T; app: App } {
  stubResizeObserver();

  let result: T | undefined;
  const app = createApp({
    setup() {
      result = composable();
      return () => null;
    },
  });
  app.use(createPinia());
  app.use(i18n);
  for (const plugin of (opts.plugins ?? [])) {
    app.use(plugin);
  }
  app.mount(document.createElement('div'));

  return { result: result as T, app };
}
