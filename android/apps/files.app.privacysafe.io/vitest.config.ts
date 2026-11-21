import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

function _resolve(dir: string) {
  return fileURLToPath(new URL(dir, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: {
      '@': _resolve('./src'),
      '@deno': _resolve('./src_deno'),
      '@shared': _resolve('./shared'),
      '@picker': _resolve('./src-file-picker'),
    },
  },
  test: {
    include: ['tests/unit/**/*.spec.ts'],
    environment: 'node',
    setupFiles: ['tests/unit/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
});
