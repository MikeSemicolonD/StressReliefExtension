const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect } = require('./fixtures');

const SLIDERS = [
  'gravity', 'frictionAir', 'restitution', 'friction', 'density', 'stiffness',
  'shakeDistance', 'requiredShakes', 'timeWindow'
];

test.describe('settings page', () => {
  test.beforeEach(async ({ extension }) => {
    await extension.openSettings();
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`has no accessibility violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`)).toEqual([]);
    });
  }

  test('Tab reaches every slider, then the reset button, in order', async ({ page }) => {
    const order = [];
    for (let i = 0; i < SLIDERS.length + 1; i++) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => document.activeElement.id));
    }
    expect(order).toEqual([...SLIDERS, 'resetSettings']);
  });

  test('keyboard focus is visible', async ({ page }) => {
    await page.keyboard.press('Tab');
    const outline = await page.locator('#gravity').evaluate(el => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('arrow keys change a setting and save it', async ({ page, extension }) => {
    await page.locator('#shakeDistance').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#shakeDistanceValue')).toHaveText('45 px');
    await expect.poll(async () => (await extension.getSettings()).shakeDistance).toBe(45);
  });

  test('sliders announce their value with its unit', async ({ page }) => {
    await expect(page.locator('#shakeDistance')).toHaveAttribute('aria-valuetext', '40 pixels');
    await expect(page.locator('#timeWindow')).toHaveAttribute('aria-valuetext', '1500 milliseconds');
    await expect(page.locator('#gravity')).toHaveAttribute('aria-valuetext', '0');
  });

  test('value chips are not announced a second time', async ({ page }) => {
    for (const id of SLIDERS) {
      await expect(page.locator(`#${id}Value`)).toHaveAttribute('aria-hidden', 'true');
    }
  });

  test('resetting is announced', async ({ page, extension }) => {
    await extension.setSettings({ gravity: 1.5 });
    await page.reload();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Reset to defaults' }).press('Enter');
    await expect(page.getByRole('status')).toHaveText('Settings reset to defaults.');
    await expect(page.locator('#gravity')).toHaveValue('0');
  });
});
