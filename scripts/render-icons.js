// Renders the extension icons in images/ from the SVG sources in design/.
// Small sizes use a simplified drawing that stays legible in the toolbar.
//
//   node scripts/render-icons.js
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ICONS = [
  { size: 16, source: 'icon-small.svg' },
  { size: 32, source: 'icon-small.svg' },
  { size: 48, source: 'icon.svg' },
  { size: 128, source: 'icon.svg' }
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const { size, source } of ICONS) {
    const svg = fs.readFileSync(path.join(ROOT, 'design', source), 'utf8');
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0"><img width="${size}" height="${size}" ` +
      `src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body>`);
    await page.locator('img').screenshot({
      path: path.join(ROOT, 'images', `icon${size}.png`),
      omitBackground: true
    });
    console.log(`images/icon${size}.png`);
  }
  await browser.close();
})();
