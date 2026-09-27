const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect } = require('./fixtures');

const SLIDERS = [
  'gravity', 'frictionAir', 'restitution', 'friction', 'density', 'stiffness',
  'shakeDistance', 'minShakeSpeed', 'requiredShakes', 'timeWindow'
];

test.describe('settings page', () => {
  test.beforeEach(async ({ extension }) => {
    await extension.openSettings();
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`has no accessibility violations (${colorScheme})`, async ({ page }) => {
      // Reduced motion turns off colour transitions, so axe measures the
      // settled colours rather than a fade between themes
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`)).toEqual([]);
    });
  }

  test('Tab reaches each number field and its slider, the switch, then the reset button', async ({ page }) => {
    // Reading order: the field sits on the label's row, the slider below it
    const expected = [...SLIDERS.flatMap(id => [`${id}Value`, id]), 'hideRestoreButton', 'resetSettings'];
    const order = [];
    for (let i = 0; i < expected.length; i++) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => document.activeElement.id));
    }
    expect(order).toEqual(expected);
  });

  test('keyboard focus is visible', async ({ page }) => {
    const outline = (selector) => page.locator(selector).evaluate(el => getComputedStyle(el).outlineStyle);
    await page.keyboard.press('Tab');
    expect(await outline('.value:has(#gravityValue)')).not.toBe('none');
    await page.keyboard.press('Tab');
    expect(await outline('#gravity')).not.toBe('none');
  });

  test('arrow keys change a setting and save it', async ({ page, extension }) => {
    await page.locator('#shakeDistance').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#shakeDistanceValue')).toHaveValue('45');
    await expect.poll(async () => (await extension.getSettings()).shakeDistance).toBe(45);
  });

  test('sliders announce their value with its unit', async ({ page }) => {
    await expect(page.locator('#shakeDistance')).toHaveAttribute('aria-valuetext', '40 pixels');
    await expect(page.locator('#minShakeSpeed')).toHaveAttribute('aria-valuetext', '150 pixels per second');
    await expect(page.locator('#timeWindow')).toHaveAttribute('aria-valuetext', '1500 milliseconds');
    await expect(page.locator('#gravity')).toHaveAttribute('aria-valuetext', '0');
  });

  test('typing a number moves the slider and saves it', async ({ page, extension }) => {
    await page.locator('#timeWindowValue').fill('2200');
    await expect(page.locator('#timeWindow')).toHaveValue('2200');
    await expect.poll(async () => (await extension.getSettings()).timeWindow).toBe(2200);
  });

  test('out-of-range numbers are clamped and junk is reverted', async ({ page }) => {
    const field = page.locator('#shakeDistanceValue');
    await field.fill('999');
    await field.press('Enter');
    await expect(field).toHaveValue('150');
    await expect(page.locator('#shakeDistance')).toHaveValue('150');

    await field.fill('');
    await field.press('Tab');
    await expect(field).toHaveValue('150');
  });

  test('number fields have names that include their unit', async ({ page }) => {
    await expect(page.getByRole('spinbutton', { name: 'Minimum shake distance in pixels' })).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Gravity' })).toBeVisible();
  });

  test('the Restore page button switch toggles with the keyboard and saves', async ({ page, extension }) => {
    const toggle = page.getByRole('switch', { name: 'Hide Restore page button' });
    await expect(toggle).not.toBeChecked();
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await expect.poll(async () => (await extension.getSettings()).hideRestoreButton).toBe(true);
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
