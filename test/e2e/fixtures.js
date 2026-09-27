// Playwright fixtures that run the real, packaged extension in Chromium.
//
// Pages come from test/fixtures, served at http://physics.test/ by a route
// handler (no server, no network). Physics is toggled by messaging the tab
// from the extension's own service worker -- the same path a toolbar click
// takes. The content script runs in an isolated world, so tests observe only
// what it does to the shared DOM, like a user would.
const { test: base, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { packageExtension } = require('../../scripts/package.js');

const FIXTURES = path.resolve(__dirname, '../fixtures');
const ORIGIN = 'http://physics.test';

class Extension {
  constructor(context, page, worker) {
    this.context = context;
    this.page = page;
    this.worker = worker;
  }

  // Turns the extension off and on again in chrome://extensions, which leaves
  // the open tab's content script orphaned just like an update or a reload
  // does. (chrome.runtime.reload() doesn't bring back an extension loaded
  // with --load-extension.)
  async reload() {
    const manager = await this.context.newPage();
    await manager.goto('chrome://extensions');
    const toggle = manager.locator('extensions-item #enableToggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    const restarted = this.context.waitForEvent('serviceworker');
    await toggle.click();
    this.worker = await restarted;
    await manager.close();
    await this.page.bringToFront();
  }

  // Opens a fixture page and waits until the content script answers
  async open(fixture) {
    await this.page.goto(`${ORIGIN}/${fixture}`);
    await expect.poll(() => this.message({ action: 'getPhysicsState' }).catch(() => null))
      .toMatchObject({ isEnabled: false });
  }

  message(msg) {
    return this.worker.evaluate(async (msg) => {
      const [tab] = await chrome.tabs.query({ active: true });
      return chrome.tabs.sendMessage(tab.id, msg);
    }, msg);
  }

  async start() {
    await expect(await this.message({ action: 'togglePhysics' })).toMatchObject({ isEnabled: true });
    await this.page.locator('.physics-clone').first().waitFor();
    // Let a couple of frames render the pieces in place
    await this.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  }

  async stop() {
    await this.page.keyboard.press('Escape');
    await expect(this.page.locator('.physics-overlay')).toHaveCount(0);
  }

  setSettings(settings) {
    return this.worker.evaluate((s) => chrome.storage.local.set(s), settings);
  }

  getSettings() {
    return this.worker.evaluate(() => chrome.storage.local.get(null));
  }

  // Opens the extension's own settings page and waits for saved values to load
  async openSettings() {
    await this.page.goto(`chrome-extension://${new URL(this.worker.url()).host}/settings.html`);
    await expect(this.page.locator('#gravity')).toHaveAttribute('aria-valuetext', /.+/);
  }

  badgeText() {
    return this.worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true });
      return chrome.action.getBadgeText({ tabId: tab.id });
    });
  }

  // caret: 'initial' -- the default hides carets by writing inline styles,
  // which would show up as DOM changes in restore tests.
  screenshot() {
    return this.page.screenshot({ caret: 'initial' });
  }

  // Fraction of 4x4-pixel blocks whose average brightness differs noticeably
  // between two screenshots. Averaging over blocks ignores glyph-edge
  // antialiasing (text on a GPU layer rasterizes slightly differently) but
  // still catches anything a person would see: moved, missing or reflowed
  // content.
  diffRatio(a, b) {
    return this.page.evaluate(async ([a, b]) => {
      const BLOCK = 4;
      const blocks = async (b64) => {
        const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d');
        ctx.drawImage(img, 0, 0);
        const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);
        const cols = Math.ceil(width / BLOCK);
        const sums = new Float64Array(cols * Math.ceil(height / BLOCK));
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            sums[Math.floor(y / BLOCK) * cols + Math.floor(x / BLOCK)] += data[i] + data[i + 1] + data[i + 2];
          }
        }
        return sums.map(v => v / (BLOCK * BLOCK * 3));
      };
      const [ba, bb] = await Promise.all([blocks(a), blocks(b)]);
      let differing = 0;
      for (let i = 0; i < ba.length; i++) if (Math.abs(ba[i] - bb[i]) > 16) differing++;
      return differing / ba.length;
    }, [a.toString('base64'), b.toString('base64')]);
  }

  // Text of every piece in the overlay, whitespace-normalized
  pieceTexts() {
    return this.page.locator('.physics-clone').evaluateAll(els =>
      els.map(el => el.textContent.replace(/\s+/g, ' ').trim()));
  }

  // Remembers the page's visible text nodes (call before start())
  rememberVisibleText() {
    return this.page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const range = document.createRange();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      window.__visibleText = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!/\S/.test(n.data) || getComputedStyle(n.parentElement).visibility !== 'visible') continue;
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        if (r.width && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw) window.__visibleText.push(n);
      }
      return window.__visibleText.length;
    });
  }

  // Remembered text nodes that are still visible on the page itself
  uncoveredText() {
    return this.page.evaluate(() => {
      const hidden = new Set();
      for (const r of CSS.highlights.get('physics-hidden-text') ?? []) hidden.add(r.startContainer);
      return window.__visibleText
        .filter(n => !hidden.has(n) && getComputedStyle(n.parentElement).visibility === 'visible')
        .map(n => n.data.trim());
    });
  }
}

const test = base.extend({
  // Packaged once per worker, so tests run exactly the files that ship
  extensionDir: [async ({}, use, workerInfo) => {
    const dir = path.join(os.tmpdir(), `physics-extension-${process.pid}-${workerInfo.workerIndex}`);
    packageExtension(dir);
    await use(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }, { scope: 'worker' }],

  context: async ({ extensionDir }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', // extensions need full Chromium, not the headless shell
      viewport: { width: 1280, height: 800 },
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        // Pieces live on GPU layers, where Chrome draws text with grayscale
        // antialiasing instead of subpixel (LCD). Use grayscale everywhere so
        // spawn screenshots compare what a person would actually notice.
        '--disable-lcd-text'
      ]
    });
    await context.route(`${ORIGIN}/**`, route =>
      route.fulfill({ path: path.join(FIXTURES, new URL(route.request().url()).pathname) }));
    await use(context);
    await context.close();
  },

  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? await context.newPage());
  },

  extension: async ({ context, page }, use) => {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await use(new Extension(context, page, worker));
  }
});

module.exports = { test, expect };
