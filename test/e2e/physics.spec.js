const { test, expect } = require('./fixtures');

// Spawned pieces should look the same as the page they replace (see
// diffRatio). Sub-pixel text antialiasing may differ slightly; this only
// catches visible problems such as reflowed text, missing or misplaced pieces.
const MAX_SPAWN_DIFF = 0.01;

test.describe('article page', () => {
  test.beforeEach(async ({ extension }) => {
    await extension.open('article.html');
  });

  test('pieces look exactly like the page they replace', async ({ extension }) => {
    // The Restore page button is meant to cover part of the page
    await extension.setSettings({ hideRestoreButton: true });
    const before = await extension.screenshot();
    await extension.start();
    const after = await extension.screenshot();
    expect(await extension.diffRatio(before, after)).toBeLessThan(MAX_SPAWN_DIFF);
  });

  test('every visible piece of text is thrown', async ({ extension }) => {
    expect(await extension.rememberVisibleText()).toBeGreaterThan(20);
    await extension.start();
    expect(await extension.uncoveredText()).toEqual([]);
  });

  test('no piece is spawned twice', async ({ page, extension }) => {
    await extension.start();
    const keys = await page.locator('.physics-clone').evaluateAll(els =>
      els.filter(el => el.textContent.trim()).map(el => el.textContent + '|' + el.style.transform));
    expect(keys.length).toBeGreaterThan(10);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('Esc restores the page exactly', async ({ page, extension }) => {
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    await extension.start();
    await extension.stop();
    expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(html);
  });

  test('a dragged piece gets thrown', async ({ page, extension }) => {
    await extension.start();
    const heading = page.locator('.physics-clone', { hasText: 'Article fixture' });
    const start = await heading.boundingBox();
    const x = start.x + start.width / 2;
    const y = start.y + start.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // Frame-paced like a real drag: the physics engine samples the mouse once
    // per step, so an instant drag would be over before it saw the press
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x + 30 * i, y + 25 * i);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const end = await heading.boundingBox();
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(150);
  });

  // Throws the heading clone down and to the right; returns its locator
  async function throwHeading(page) {
    const heading = page.locator('.physics-clone', { hasText: 'Article fixture' });
    const box = await heading.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x + 30 * i, y + 25 * i);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(200);
    return heading;
  }

  test("dragging over the page, double-clicking or Ctrl+A doesn't select its text", async ({ page, extension }) => {
    await extension.start();
    // From empty space, so nothing is grabbed, across the text
    await page.mouse.move(1260, 780);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(1260 - 120 * i, 780 - 70 * i);
    await page.mouse.up();
    await page.mouse.dblclick(200, 120);
    await page.keyboard.press('ControlOrMeta+A');
    expect(await page.evaluate(() => getSelection().toString())).toBe('');
  });

  test('pieces can still be thrown on a heavily throttled CPU', async ({ page, extension }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await extension.start();
    const heading = page.locator('.physics-clone', { hasText: 'Article fixture' });
    const start = await heading.boundingBox();
    await throwHeading(page);
    const end = await heading.boundingBox();
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(150);
    await extension.stop();
  });

  test('pieces still work after the tab was frozen in the background', async ({ page, extension }) => {
    // What Chrome does to background tabs: no timers, no animation frames
    const cdp = await page.context().newCDPSession(page);
    await extension.start();
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    await page.waitForTimeout(1000);
    await cdp.send('Page.setWebLifecycleState', { state: 'active' });
    const heading = page.locator('.physics-clone', { hasText: 'Article fixture' });
    const start = await heading.boundingBox();
    // Nothing flew off while the simulation caught up on the frozen second
    expect(await page.locator('.physics-clone').evaluateAll(els => els.every(el => {
      const r = el.getBoundingClientRect();
      return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
    }))).toBe(true);
    await throwHeading(page);
    const end = await heading.boundingBox();
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(150);
    await extension.stop();
  });

  test('restoring glides the pieces home, then gives the page back exactly', async ({ page, extension }) => {
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    await extension.start();
    const home = await page.locator('.physics-clone', { hasText: 'Article fixture' }).evaluate(el => el.style.transform);
    const heading = await throwHeading(page);
    await page.keyboard.press('Escape');
    // Still in flight: the pieces are on screen, heading for where they started
    await expect(page.locator('.physics-overlay')).toHaveCount(1);
    expect(await heading.evaluate(el => el.style.transform)).toBe(home);
    await expect.poll(() => extension.badgeText()).toBe('');
    await expect(page.locator('.physics-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(html);
  });

  test('restoring again mid-flight finishes at once', async ({ page, extension }) => {
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    await extension.start();
    await throwHeading(page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    expect(await page.locator('.physics-overlay').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(html);
  });

  test('turning physics on mid-flight starts again from the restored page', async ({ page, extension }) => {
    await extension.start();
    const count = await page.locator('.physics-clone').count();
    await throwHeading(page);
    await page.keyboard.press('Escape');
    await extension.start();
    await expect(page.locator('.physics-overlay')).toHaveCount(1);
    await expect(page.locator('.physics-clone')).toHaveCount(count);
  });

  test('with reduced motion, restoring is instant', async ({ page, extension }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await extension.start();
    await throwHeading(page);
    await page.keyboard.press('Escape');
    expect(await page.locator('.physics-overlay').count()).toBe(0);
  });

  test('pieces glide to where the page has scrolled to', async ({ page, extension }) => {
    await page.evaluate(() => { document.body.style.paddingBottom = '2000px'; });
    await extension.start();
    const heading = page.locator('.physics-clone', { hasText: 'Article fixture' });
    const home = await heading.evaluate(el => el.style.transform);
    await page.evaluate(() => window.scrollBy(0, 50));
    await page.keyboard.press('Escape');
    const [, x, y] = home.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/).map(Number);
    expect(await heading.evaluate(el => el.style.transform)).toBe(`translate(${x}px, ${y - 50}px) rotate(0rad)`);
  });

  test('settings apply live without respawning', async ({ page, extension }) => {
    await extension.start();
    const pieces = page.locator('.physics-clone');
    const count = await pieces.count();
    const meanY = () => pieces.evaluateAll(els =>
      els.reduce((sum, el) => sum + el.getBoundingClientRect().top, 0) / els.length);
    const before = await meanY();
    await extension.setSettings({ gravity: 1 });
    await page.waitForTimeout(800);
    expect(await pieces.count()).toBe(count);
    expect(await meanY()).toBeGreaterThan(before + 50);
  });

  test('form controls keep their current state', async ({ page, extension }) => {
    await page.fill('#name', 'typed by the user');
    await page.selectOption('#choice', 'Three');
    await page.check('#agree');
    await extension.start();
    const overlay = page.locator('.physics-overlay');
    expect(await overlay.locator('input:not([type=checkbox])').evaluate(el => el.value)).toBe('typed by the user');
    expect(await overlay.locator('select').evaluate(el => el.value)).toBe('Three');
    expect(await overlay.locator('input[type=checkbox]').evaluate(el => el.checked)).toBe(true);
  });

  test('the Restore page button restores the page', async ({ page, extension }) => {
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    await extension.start();
    await page.getByRole('button', { name: 'Restore page' }).click();
    await expect(page.locator('.physics-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(html);
  });

  test('the first time, a note explains how physics got turned on', async ({ page, extension }) => {
    const note = page.getByRole('status').filter({ hasText: 'Shaking your browser window' });
    await extension.start();
    await expect(note).toBeVisible();
    await extension.stop();
    await extension.start();
    await expect(page.getByRole('button', { name: 'Restore page' })).toBeVisible();
    await expect(note).toHaveCount(0);
  });

  test('the Restore page button is labelled for screen readers', async ({ page, extension }) => {
    await extension.start();
    const button = page.getByRole('button', { name: 'Restore page', exact: true });
    await expect(button).toHaveAttribute('aria-keyshortcuts', 'Escape');
    // After the first time, starting is still announced (without the note)
    await extension.stop();
    await extension.start();
    await expect(page.getByRole('status').filter({ hasText: 'Physics is on' })).toHaveCount(1);
  });

  test('the Restore page button can be hidden, even while physics is on', async ({ page, extension }) => {
    await extension.start();
    const button = page.getByRole('button', { name: 'Restore page' });
    await expect(button).toBeVisible();
    await extension.setSettings({ hideRestoreButton: true });
    await expect(button).toHaveCount(0);
  });

  test("copies don't rerun the page's inline event handlers", async ({ page, extension }) => {
    await expect.poll(() => page.evaluate(() => window.imageLoads)).toBe(1);
    await extension.start();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.imageLoads)).toBe(1);
  });

  test('reloading the extension restores the page', async ({ page, extension }) => {
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    await extension.start();
    await extension.reload();
    // The old content script can't reach the extension any more, so it gives
    // the page back rather than being left running (and shakeable) orphaned
    await expect(page.locator('.physics-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(html);
  });

  test('the toolbar badge shows when physics is on', async ({ extension }) => {
    await extension.start();
    await expect.poll(() => extension.badgeText()).toBe('ON');
    await extension.stop();
    await expect.poll(() => extension.badgeText()).toBe('');
  });
});

test.describe('shadow DOM page', () => {
  test.beforeEach(async ({ extension }) => {
    await extension.open('shadow.html');
  });

  test('component content is thrown, including closed and nested roots', async ({ extension }) => {
    await extension.start();
    // Compared without whitespace: spacing between separately positioned
    // words isn't what's under test
    const texts = (await extension.pieceTexts()).join('').replace(/\s+/g, '');
    for (const expected of [
      'Slotted title',
      'Slotted body paragraph.',
      'Card footer in the shadow root.',
      'Closed shadow content bold',
      'Outer shadow paragraph',
      'Nested button',
      'Text directly in a shadow root'
    ]) {
      expect(texts).toContain(expected.replace(/\s+/g, ''));
    }
  });

  test('pieces look exactly like the page they replace', async ({ extension }) => {
    // The Restore page button is meant to cover part of the page
    await extension.setSettings({ hideRestoreButton: true });
    const before = await extension.screenshot();
    await extension.start();
    const after = await extension.screenshot();
    expect(await extension.diffRatio(before, after)).toBeLessThan(MAX_SPAWN_DIFF);
  });

  test('copies never run component code', async ({ page, extension }) => {
    const constructed = await page.evaluate(() => window.constructedCount);
    await extension.start();
    expect(await page.evaluate(() => window.constructedCount)).toBe(constructed);
    const customInOverlay = await page.locator('.physics-overlay *').evaluateAll(els =>
      els.filter(el => el.localName.includes('-')).length);
    expect(customInOverlay).toBe(0);
  });

  test('Esc restores the page exactly', async ({ page, extension }) => {
    const snapshot = () => page.evaluate(() => [
      document.documentElement.outerHTML,
      document.querySelector('x-card').shadowRoot.innerHTML,
      document.querySelector('x-text').shadowRoot.adoptedStyleSheets.length
    ]);
    const before = await snapshot();
    await extension.start();
    await extension.stop();
    expect(await snapshot()).toEqual(before);
  });
});

test.describe('page with hidden and clipped content', () => {
  test.beforeEach(async ({ extension }) => {
    await extension.open('hidden.html');
  });

  test('text clipped out of sight is not thrown', async ({ extension }) => {
    await extension.start();
    const texts = (await extension.pieceTexts()).join('\n');
    expect(texts).toContain('Visible paragraph');
    expect(texts).toContain('First slide, showing');
    for (const hidden of ['Hidden by clip-path', 'Hidden at the edge', 'Hidden by clip', 'Hidden inside a span',
      'Inside a collapsed section', 'Second slide', 'Third slide']) {
      expect(texts).not.toContain(hidden);
    }
  });

  test('small icons in styled buttons are thrown, not left under the button', async ({ page, extension }) => {
    await extension.start();
    await expect(page.locator('.physics-overlay svg')).toHaveCount(3);
  });

  test('pieces look exactly like the page they replace', async ({ extension }) => {
    await extension.setSettings({ hideRestoreButton: true });
    const before = await extension.screenshot();
    await extension.start();
    const after = await extension.screenshot();
    expect(await extension.diffRatio(before, after)).toBeLessThan(MAX_SPAWN_DIFF);
  });

  test('a caret drawn on empty ::after content is kept, so centered contents stay put', async ({ page, extension }) => {
    const box = (root) => page.locator(`${root} .dropdown-text`).evaluate(el => {
      const r = el.getBoundingClientRect();
      return [r.left, r.top];
    });
    const before = await box('body');
    await extension.start();
    const after = await box('.physics-overlay');
    after.forEach((v, i) => expect(Math.abs(v - before[i])).toBeLessThanOrEqual(1));
    expect(await page.locator('.physics-overlay .dropdown > span').count()).toBe(2);
  });
});

test.describe('page with nothing to throw', () => {
  test.beforeEach(async ({ extension }) => {
    await extension.open('empty.html');
  });

  test("physics doesn't turn on or cover the page", async ({ page, extension }) => {
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    expect(await extension.message({ action: 'togglePhysics' })).toMatchObject({ isEnabled: false });
    await expect(page.locator('.physics-canvas, .physics-overlay')).toHaveCount(0);
    await page.mouse.click(200, 200);
    expect(await page.evaluate(() => window.bodyClicks)).toBe(1);
    expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(html);
    await expect.poll(() => extension.badgeText()).toBe('');
  });
});

test.describe('slow connection', () => {
  const SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='120'><rect width='160' height='120' fill='#6a6'/></svg>";

  // Holds back slow.svg until release() is called; returns release
  async function holdImage(page) {
    let release;
    const released = new Promise(r => { release = r; });
    await page.route('**/slow.svg', async route => {
      await released;
      await route.fulfill({ contentType: 'image/svg+xml', body: SVG }).catch(() => {});
    });
    return release;
  }

  test('physics works while the page is still loading, and the image arrives in its piece', async ({ page, extension }) => {
    const release = await holdImage(page);
    await page.goto('http://physics.test/slow.html', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => extension.message({ action: 'getPhysicsState' }).catch(() => null))
      .toMatchObject({ isEnabled: false });
    expect(await page.evaluate(() => document.readyState)).not.toBe('complete');
    const html = await page.evaluate(() => document.documentElement.outerHTML);

    await extension.start();
    const image = page.locator('.physics-overlay img');
    await expect(image).toHaveCount(1);
    release();
    await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth)).toBe(160);

    await extension.stop();
    expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(html);
  });

  test('physics can be turned off before the page finishes loading', async ({ page, extension }) => {
    const release = await holdImage(page);
    await page.goto('http://physics.test/slow.html', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => extension.message({ action: 'getPhysicsState' }).catch(() => null))
      .toMatchObject({ isEnabled: false });
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    await extension.start();
    await extension.stop();
    release();
    await page.waitForLoadState('load');
    expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(html);
    await expect(page.locator('img.slow')).toBeVisible();
  });
});

test.describe('scaled page', () => {
  test.beforeEach(async ({ extension }) => {
    await extension.open('scaled.html');
  });

  // Content shrunk with `scale` or a transform (its own or an ancestor's)
  // keeps that size in its piece
  test('pieces look exactly like the page they replace', async ({ extension }) => {
    await extension.setSettings({ hideRestoreButton: true });
    const before = await extension.screenshot();
    await extension.start();
    const after = await extension.screenshot();
    expect(await extension.diffRatio(before, after)).toBeLessThan(MAX_SPAWN_DIFF);
  });

  test('images land exactly where they were, at the same size', async ({ page, extension }) => {
    const boxes = (root) => page.locator(`${root} img`).evaluateAll(imgs => Object.fromEntries(imgs.map(img => {
      const r = img.getBoundingClientRect();
      return [img.alt, [r.left, r.top, r.width, r.height].map(v => Math.round(v))];
    })));
    const before = await boxes('body');
    await extension.start();
    const after = await boxes('.physics-overlay');
    for (const [alt, box] of Object.entries(before)) {
      after[alt].forEach((v, i) => expect(Math.abs(v - box[i]), `${alt} [${i}]`).toBeLessThanOrEqual(1));
    }
  });

  test('Esc restores the page exactly', async ({ page, extension }) => {
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    await extension.start();
    await extension.stop();
    expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(html);
  });
});
