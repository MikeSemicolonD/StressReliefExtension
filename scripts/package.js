// Copies the files that ship in the extension into a directory, for one
// browser. This is the single list of runtime files: CI packages from it and
// the e2e tests load the extension from it, so a file missing here fails the
// tests.
//
//   node scripts/package.js [outDir] [--firefox]
//
// Both builds are Manifest V3. manifest.json is written for Chrome (a
// background service worker); Firefox's MV3 doesn't support service workers
// and declares background scripts instead, which Chrome warns about, so the
// Firefox build gets its own manifest.
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
  'images',
  'fonts',
  'LICENSE'
];

function firefoxManifest(manifest) {
  const { service_worker: worker, ...background } = manifest.background;
  return { ...manifest, background: { ...background, scripts: [worker] } };
}

function packageExtension(outDir, browser = 'chrome') {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of FILES) {
    fs.cpSync(path.join(ROOT, file), path.join(outDir, file), { recursive: true });
  }
  if (browser === 'firefox') {
    const manifestPath = path.join(outDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fs.writeFileSync(manifestPath, JSON.stringify(firefoxManifest(manifest), null, 2) + '\n');
  }
  return outDir;
}

module.exports = { FILES, packageExtension };

if (require.main === module) {
  const args = process.argv.slice(2);
  const browser = args.includes('--firefox') ? 'firefox' : 'chrome';
  const outDir = path.resolve(args.find(a => !a.startsWith('--')) || 'pkg');
  packageExtension(outDir, browser);
  console.log(`Packaged ${FILES.length} entries for ${browser} into ${outDir}`);
}
