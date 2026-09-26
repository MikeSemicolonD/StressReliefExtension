// Copies the files that ship in the extension into a directory (default pkg/).
// This is the single list of runtime files: CI packages from it and the e2e
// tests load the extension from it, so a file missing here fails the tests.
//
//   node scripts/package.js [outDir]
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'defaults.js',
  'lib.js',
  'matter.min.js',
  'settings.html',
  'settings.js',
  'settings.css',
  'styles.css',
  'images'
];

function packageExtension(outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of FILES) {
    fs.cpSync(path.join(ROOT, file), path.join(outDir, file), { recursive: true });
  }
  return outDir;
}

module.exports = { FILES, packageExtension };

if (require.main === module) {
  const outDir = path.resolve(process.argv[2] || 'pkg');
  packageExtension(outDir);
  console.log(`Packaged ${FILES.length} entries into ${outDir}`);
}
