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
