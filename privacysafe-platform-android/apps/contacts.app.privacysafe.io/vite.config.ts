/* eslint-disable @typescript-eslint/no-explicit-any */
import { resolve } from 'node:path';
import { defineConfig, type UserConfig, type ConfigEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueDevTools from 'vite-plugin-vue-devtools';

function _resolve(dir: string) {
  return resolve(import.meta.dirname, dir);
}

export const makeConfig = ({ mode }: ConfigEnv): UserConfig => {
  const isDev = mode === 'development';
  // const isProd = mode === 'production'

  const server = {
    port: 3030,
    cors: { origin: '*' },
  };

  const css = {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      } as any,
    },
  };

  const define = {
    'process.env.NODE_ENV': JSON.stringify(mode),
    global: 'globalThis',
  };

  const plugins = [vue(), isDev && vueDevTools()].filter(Boolean);

  const build = {
    outDir: 'app',
    // Keeps all the css in a single file with a stable name, instead of letting
    // the chunk layout decide where the library's tokens end up.
    cssCodeSplit: false,
    rolldownOptions: {
      input: {
        main: _resolve('./index.html'),
        'main-mobile': _resolve('./index-mobile.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
      treeshake: {
        manualPureFunctions: ['console.log'],
      },
    },
  };

  return {
    server,
    css,
    build,
    define,
    plugins,
    resolve: {
      alias: {
        vue: 'vue/dist/vue.esm-bundler.js',
        '@main': _resolve('./src'),
        '@shared': _resolve('./shared-libs'),
        '@deno': _resolve('./src-deno'),
      },
    },
  };
};

export default defineConfig(makeConfig);
