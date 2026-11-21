import * as esbuild from 'npm:esbuild';
import { denoPlugin } from 'jsr:@deno/esbuild-plugin';

const envMock = `
Deno.env = {
  get: function() {
    return undefined;
  }
};
`;

const isDev = Deno.args.includes('--dev');

try {
  const result = await esbuild.build({
    entryPoints: ['src-deno/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'esnext',
    write: false,
    ...(isDev ? {} : { drop: ['console'] }),
    external: ['path', 'fs', 'node:path', 'node:fs'],
    plugins: [
      denoPlugin(),
    ],
  });

  const bundledCode = result.outputFiles[0].text;

  await Deno.writeTextFile('app/background-instance.mjs', envMock + bundledCode);

  console.log(
    `✅ The bundle has been successfully compiled into app/background-instance.mjs` +
      `${isDev ? ' (development: console kept)' : ''}`,
  );
  Deno.exit(0);
} catch (error) {
  console.error('❌ Build error:', error);
  Deno.exit(1);
}
