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
import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

function _resolve(dir: string) {
  return resolve(import.meta.dirname, dir);
}

// Kept in sync with the aliases in vite.config.ts. Note that `vue` is NOT
// aliased to the esm-bundler build here: unit tests need the runtime that
// vue-test-utils/testing-library expect, and no test compiles templates
// at runtime.
const alias = {
  '@main': _resolve('./src'),
  '@shared': _resolve('./shared-libs'),
  '@deno': _resolve('./src-deno'),
};

export default defineConfig({
  plugins: [vue()],
  resolve: { alias },
  test: {
    globals: true,
    // The html reporter's page needs to be served, not opened as a file, hence
    // the `test:report:view` script next to `test:report` in package.json.
    outputFile: { html: 'tests/report/index.html' },
    // Pure logic runs in node; anything touching pinia stores, composables or
    // components needs a DOM. Split by directory so a jsdom-only helper can
    // never silently leak into a node-environment spec.
    projects: [
      {
        plugins: [vue()],
        resolve: { alias },
        test: {
          name: 'node',
          globals: true,
          environment: 'node',
          include: ['tests/unit/{shared-libs,src-deno}/**/*.spec.ts'],
        },
      },
      {
        plugins: [vue()],
        resolve: { alias },
        test: {
          name: 'dom',
          globals: true,
          environment: 'jsdom',
          include: ['tests/unit/src/**/*.spec.ts'],
        },
      },
    ],
  },
});
