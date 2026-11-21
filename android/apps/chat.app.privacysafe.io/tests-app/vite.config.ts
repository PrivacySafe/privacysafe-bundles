import { makeConfig as originalConfigMaker } from '../vite.config';
import { defineConfig } from 'vite';
import { resolve } from 'path';

// https://vitejs.dev/config/
// @ts-ignore
export default defineConfig(conf => {
  const appConf = originalConfigMaker(conf);
  appConf.build!.outDir = 'build/app';
  appConf.build!.rolldownOptions = {
    input: {
       testApp: resolve(__dirname, './index.html'),
    },
  };

  // @ts-ignore
  appConf.resolve!.alias!['@tests'] = resolve(__dirname, './src');
  return appConf;
});
