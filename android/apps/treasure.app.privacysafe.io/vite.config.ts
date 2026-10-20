/* eslint-disable @typescript-eslint/no-explicit-any */
import { defineConfig, type UserConfig, type ConfigEnv } from 'vite';
import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import vueDevTools from 'vite-plugin-vue-devtools';

function _resolve(dir: string) {
  return resolve(__dirname, dir);
}

export const makeConfig = ({ mode }: ConfigEnv): UserConfig => {
  const isDev = mode === 'development';

  return {
    server: {
      port: 3030,
      cors: { origin: '*' },
    },

    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
        } as any,
      },
    },

    plugins: [vue(), isDev && vueDevTools()].filter(Boolean),

    build: {
      outDir: 'app',
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
      },
      chunkSizeWarningLimit: 0,
    },

    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      global: 'globalThis',
    },

    resolve: {
      alias: {
        vue: 'vue/dist/vue.esm-bundler.js',
        '@': _resolve('./src'),
        '@shared': _resolve('./shared'),
        '@deno': _resolve('./src-deno'),
        'vue-ccard/src/style.css': _resolve('./node_modules/vue-ccard/src/style.css'),
      },
    },
  };
};

export default defineConfig(makeConfig);
