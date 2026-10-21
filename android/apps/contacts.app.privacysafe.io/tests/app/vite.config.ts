import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { makeConfig as originalConfigMaker } from '../../vite.config';

function _resolve(dir: string) {
  return resolve(import.meta.dirname, dir);
}

// https://vitejs.dev/config/
export default defineConfig(conf => {
  const appConf = originalConfigMaker(conf);
  const build = appConf.build!;
  // Root config sets build.rolldownOptions with the main/main-mobile html inputs.
  // Setting the deprecated build.rollupOptions here does NOT override them — vite
  // keeps the rolldownOptions and tries to build the root's index.html against
  // tests/app as root, which fails on /src/desktop/main.ts. Override the same
  // field the root config uses, and redirect outDir away from the app's own 'app'.
  return {
    ...appConf,
    build: {
      ...build,
      outDir: 'build/app',
      rolldownOptions: {
        ...build.rolldownOptions,
        input: {
          testApp: _resolve('./index.html'),
        },
      },
    },
    resolve: {
      ...appConf.resolve,
      alias: {
        ...(appConf.resolve!.alias as Record<string, string>),
        '@tests': _resolve('./src'),
      },
    },
  };
});
