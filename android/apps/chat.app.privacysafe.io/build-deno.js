import * as esbuild from 'esbuild';
import { denoPlugin } from 'jsr:@deno/esbuild-plugin';

const envMock = `
Deno.env = {
  get: function() {
    return undefined;
  }
};
`;

// Silences the console for everything in the component's process, the
// platform's own code included - which `drop` below cannot reach.
//
// The platform spawns a deno component with its stdout/stderr as pipes and
// reads them only when started with --devtools; and its preload echoes every
// w3n.log line into console.log/warn/error. In a production run nobody reads
// those pipes, so after ~64KB of log lines a console write blocks the
// component's main thread for good: the process stays alive and silent, and
// the window says "The chat background service is not responding". Seen on
// 2026-10-07: stdout's Recv-Q at 65509 bytes, main thread in write(). The
// lines still reach the log file, through w3n.log's own capability call.
//
// Replaced at call time is enough: the echo looks console.log up on every call.
const consoleMute = `
for (const m of ['log', 'info', 'debug', 'warn', 'error', 'trace', 'dir', 'table']) {
  globalThis.console[m] = () => {};
}
`;

// A development bundle keeps console output; a production one has none at all.
// Diagnostics that are worth keeping go through shared-libs/logger.ts, which
// writes to w3n.log and is switched on at runtime - so dropping console costs
// no information and removes per-signal string building from hot paths.
const isDev = Deno.args.includes('--dev');

try {
  // Building the main code using esbuild with the Deno plugin
  const result = await esbuild.build({
    entryPoints: ['src-deno/index.ts'],
    bundle: true,
    platform: 'node', // esbuild will understand the structure of module calls
    format: 'esm',
    target: 'esnext',
    write: false, // We intercept the result into RAM
    ...(isDev ? {} : { drop: ['console'] }),
    // Leave node:path and node:fs external, Deno will automatically insert polyfills at startup
    external: ['path', 'fs', 'node:path', 'node:fs'],
    plugins: [
      // The plugin takes care of all the work with JSR, NPM and HTTP imports inside TS files.
      denoPlugin(),
    ],
  });

  const bundledCode = result.outputFiles[0].text;

  // Combine the mock environment and the compiled code, saving it as .mjs
  await Deno.writeTextFile(
    'app/background-instance.mjs', (isDev ? '' : consoleMute) + envMock + bundledCode,
  );

  console.log(
    `✅ The bundle has been successfully compiled into app/background-instance.mjs` +
      `${isDev ? ' (development: console kept)' : ''}`,
  );
  Deno.exit(0);
} catch (error) {
  console.error('❌ Build error:', error);
  Deno.exit(1);
}
