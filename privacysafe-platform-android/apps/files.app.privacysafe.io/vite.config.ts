import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueDevTools from 'vite-plugin-vue-devtools';

function _resolve(dir: string) {
  return resolve(__dirname, dir);
}

// https://vitejs.dev/config/
// @ts-ignore
export default defineConfig(config => {
  const isDev = config.mode === 'development';
  // const isProd = mode === 'production'

  const server = {
    port: '3030',
    cors: { origin: '*' },
  };

  const css = {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  };

  const define = { 'process.env': {} };

  const plugins = [vue(), vueDevTools()];

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
        'file-picker': _resolve('./index-file-picker.html'),
        'file-picker-mobile': _resolve('./index-file-picker-mobile.html'),
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
    worker: {
      format: 'es',
    },
    define,
    plugins,
    optimizeDeps,
    resolve: {
      alias: {
        vue: 'vue/dist/vue.esm-bundler.js',
        '@': _resolve('./src'),
        '@deno': _resolve('./src_deno'),
        '@shared': _resolve('./shared'),
        '@picker': _resolve('./src-file-picker'),
      },
    },
  };
});
