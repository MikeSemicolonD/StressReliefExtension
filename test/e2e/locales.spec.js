// The extension in each of its translations: the browser runs in that
// language and the settings page and Restore page button must show it,
// laid out without overflowing (translations run longer than English), and
// mirrored in right-to-left languages.
const fs = require('fs');
const path = require('path');
const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect } = require('./fixtures');

const LOCALES_DIR = path.resolve(__dirname, '../../_locales');
const RTL = new Set(['ar', 'fa', 'he', 'ur']);

function messages(locale) {
  const read = (l) => JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, l, 'messages.json'), 'utf8'));
  const en = read('en');
  const own = read(locale);
  return (name) => (own[name] ?? en[name]).message;
}

// Elements whose content spills out of their box, as "tag#id.class: text"
function overflowing(page) {
  return page.evaluate(() => {
    const found = [];
    for (const el of document.querySelectorAll('h1, h2, label, .hint, .value, button, .tip p')) {
      if (el.scrollWidth > el.clientWidth + 1) {
        found.push(`${el.tagName.toLowerCase()}#${el.id}.${el.className}: ${el.textContent.trim()}`);
      }
    }
    if (document.documentElement.scrollWidth > innerWidth) found.push('page scrolls sideways');
    return found;
  });
}

for (const locale of fs.readdirSync(LOCALES_DIR)) {
  // Chrome knows Norwegian Bokmål as nb (Firefox's name, also shipped);
  // the "no" folder is for other browsers
  if (locale === 'no') continue;

  test.describe(`${locale} settings page`, () => {
    test.use({ lang: locale.replace('_', '-') });

    test('is in that language, fully translated, and fits', async ({ page, extension }) => {
      const msg = messages(locale);
      await extension.openSettings();
      await expect(page.locator('html')).toHaveAttribute('lang', locale.replace('_', '-'));
      await expect(page.locator('html')).toHaveAttribute('dir', RTL.has(locale) ? 'rtl' : 'ltr');
      await expect(page).toHaveTitle(msg('settingsPageTitle'));
      await expect(page.locator('h1')).toHaveText(msg('settingsHeading'));
      await expect(page.locator('#resetSettings')).toHaveText(msg('resetSettings'));
      // In the digits the browser uses for the language, e.g. ४ in Marathi
      // (asked of the browser: Node's locale data can differ)
      const four = await page.evaluate(() => new Intl.NumberFormat(document.documentElement.lang).format(4));
      await expect(page.locator('#timeWindow-hint span[data-value-of="requiredShakes"]')).toHaveText(four);

      const empty = await page.evaluate(() =>
        [...document.querySelectorAll('[data-i18n], [data-i18n-html]')]
          .filter(el => !el.textContent.trim())
          .map(el => el.dataset.i18n ?? el.dataset.i18nHtml));
      expect(empty).toEqual([]);

      expect(await overflowing(page)).toEqual([]);
      await page.setViewportSize({ width: 360, height: 800 });
      expect(await overflowing(page)).toEqual([]);
    });
  });
}

test.describe('right-to-left', () => {
  test.use({ lang: 'he' });

  test('the settings page has no accessibility violations', async ({ page, extension }) => {
    await extension.openSettings();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`)).toEqual([]);
  });

  test('sliders fill from the right', async ({ page, extension }) => {
    await extension.openSettings();
    const background = await page.locator('#gravity').evaluate(el => getComputedStyle(el).backgroundImage);
    expect(background).toMatch(/^linear-gradient\(to left,/);
  });

  test('the switch knob starts on the right and moves left when turned on', async ({ page, extension }) => {
    await extension.openSettings();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const knob = () => page.locator('.switch-track').evaluate(el => {
      const style = getComputedStyle(el, '::before');
      return { right: style.right, shift: new DOMMatrix(style.transform).m41 };
    });
    expect(await knob()).toEqual({ right: '2px', shift: 0 });
    await page.getByRole('switch').check();
    expect(await knob()).toEqual({ right: '2px', shift: -20 });
  });

  test('the Restore page button is in the top-left corner, in that language', async ({ page, extension }) => {
    await extension.open('article.html');
    await extension.start();
    const button = page.getByRole('button', { name: messages('he')('restorePage') });
    const box = await button.boundingBox();
    expect(box.x).toBeLessThan(100);
    expect(await page.locator('[data-physics-restore]').evaluate(el => [el.lang, el.dir]))
      .toEqual(['he', 'rtl']);
  });
});
