import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueDevTools from 'vite-plugin-vue-devtools';

function _resolve(dir: string) {
  return fileURLToPath(new URL(dir, import.meta.url));
}

// https://vitejs.dev/config/
export default defineConfig(config => {
  const isDev = config.mode === 'development';
  // const isProd = mode === 'production'

  const server = {
    port: 3030,
    cors: { origin: '*' },
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
    // the main chunk includes pdf.js and the component library; warn only beyond that
    chunkSizeWarningLimit: 1500,
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
    build,
    worker: {
      format: 'es',
    },
    define,
    plugins,
    optimizeDeps,
    resolve: {
      alias: {
        '@': _resolve('./src'),
        '@deno': _resolve('./src_deno'),
        '@shared': _resolve('./shared'),
        '@picker': _resolve('./src-file-picker'),
      },
    },
  };
});
