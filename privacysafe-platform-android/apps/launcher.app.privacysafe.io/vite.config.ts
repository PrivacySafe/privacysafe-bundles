/* eslint-disable @typescript-eslint/no-explicit-any */
import { resolve } from 'node:path';
import { defineConfig, type UserConfig, type ConfigEnv } from 'vite';
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
          'system-map': _resolve('./index-map.html'),
        },
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name].[ext]',
        },
      },
    },

    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
    },

    resolve: {
      alias: {
        vue: 'vue/dist/vue.esm-bundler.js',
        '@': _resolve('./src'),
        '@sys-map': _resolve('./src-system-map'),
      },
    },
  };
};

export default defineConfig(makeConfig);
