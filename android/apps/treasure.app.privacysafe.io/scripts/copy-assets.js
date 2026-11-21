import fs from 'fs';
import path from 'path';

const srcDir = path.resolve(import.meta.dirname, '../node_modules/vue-ccard/dist');
const destDir = path.resolve(import.meta.dirname, '../public');

try {
  if (fs.existsSync(srcDir)) {
    fs.mkdirSync(destDir, { recursive: true });

    fs.readdirSync(srcDir).forEach(file => {
      if (file.endsWith('.svg')) {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      }
    });
    console.log('✅ Icons from vue-ccard have been successfully copied to public/');
  } else {
    console.warn('⚠️ The library folder was not found in the path:', srcDir);
  }
} catch (err) {
  console.error('❌ Error copying icons:', err);
}
