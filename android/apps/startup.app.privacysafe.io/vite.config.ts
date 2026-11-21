import {resolve} from 'node:path';
import {type UserConfig, defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import vueDevTools from 'vite-plugin-vue-devtools';

// https://vitejs.dev/config/
// @ts-ignore
export default defineConfig(({mode}: UserConfig) => {
  const isDev = mode === 'development';

  const server = {
    port: '3030',
    cors: {origin: '*'},
  };
  const define = {
    'process.env': {},
    global: 'globalThis',
  };

  const plugins = [vue(), vueDevTools()];

  let optimizeDeps = {};
  if (isDev) {
    optimizeDeps = {
      include: ['vue', 'vue-router', 'pinia'],
    };
  }

  return {
    server,

    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
        },
      },
    },

    build: {
      // reference: https://rollupjs.org/configuration-options/
      rollupOptions: {
        input: {
          main: resolve(__dirname, './index.html'),
        },
        output: [
          {
            name: 'main',
            dir: 'app'
          },
        ]
      },
    },
    define,

    plugins,

    optimizeDeps,

    resolve: {
      alias: {
        vue: 'vue/dist/vue.esm-bundler.js',
        '@': resolve(__dirname, './src')
      },
    },
  };
});
