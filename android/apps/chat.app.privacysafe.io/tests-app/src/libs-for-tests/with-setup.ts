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

import { createApp } from 'vue';
import i18n from '@main/common/data/i18';

/**
 * Runs a composable inside a component's setup, and hands back what it
 * returned.
 *
 * Needed because most of this app's composables call `useI18n()`, which
 * demands an active component instance with the i18n plugin installed. Called
 * from a bare spec it throws - and it throws as a vue-i18n error code, so the
 * failure reads as a bare `SyntaxError: 26` with nothing in it to go on. That
 * is what one spec here spent a whole run reporting.
 *
 * The component is mounted on a detached element, so nothing of it reaches the
 * page; `teardown()` unmounts it, which also runs whatever the composable
 * registered in `onBeforeUnmount`.
 */
export function withSetup<T>(composable: () => T): { result: T; teardown: () => void } {
  let result: T | undefined = undefined;
  const app = createApp({
    setup() {
      result = composable();
      // A render function is required, and there is nothing to render.
      return () => null;
    },
  });
  app.use(i18n);
  app.mount(document.createElement('div'));
  return {
    result: result as T,
    teardown: () => app.unmount(),
  };
}
