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

  const optimizeDeps = {
    exclude: ['pdfjs-dist'],
    include: [] as string[],
  };
  if (isDev) {
    optimizeDeps.include = ['vue', 'vue-router', 'pinia', 'lodash', 'dayjs'];
  }

  const build = {
    outDir: 'app',
    chunkSizeWarningLimit: 0,
    target: 'esnext',
    commonjsOptions: {
      include: [/pdfjs-dist/],
    },
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
    optimizeDeps,
    resolve: {
      alias: {
        vue: 'vue/dist/vue.esm-bundler.js',
        '@': _resolve('./src'),
        '@common': _resolve('./src/common'),
        '@desktop': _resolve('./src/desktop'),
        '@mobile': _resolve('./src/mobile'),
        '@shared': _resolve('./shared'),
        '@deno': _resolve('./src-deno'),
      },
    },
  };
};

export default defineConfig(makeConfig);
