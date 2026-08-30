import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

test.describe('native documents', () => {
  test('discovers A4 documents separately from slide decks', async ({ page }) => {
    await page.goto('/documents');

    await expect(page.locator('li h3')).toHaveCount(1);
    await expect(page.locator('li h3').filter({ hasText: 'A4 Report' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'A4 Report' }).first()).toHaveAttribute(
      'href',
      '/d/a4-report',
    );
  });

  test('renders the document viewer at native A4 output dimensions', async ({ page }) => {
    await page.goto('/d/a4-report');
    const editor = page.locator('main[data-inspector-root]');
    await expect(editor.getByText('A4 report page')).toBeVisible({ timeout: 30_000 });

    const canvas = editor.locator('[data-osd-canvas]').filter({ hasText: 'A4 report page' });
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toHaveCSS('width', '794px');
    await expect(canvas).toHaveCSS('height', '1123px');
    await expect
      .poll(() => canvas.evaluate((element) => [element.clientWidth, element.clientHeight]))
      .toEqual([794, 1123]);
  });

  test('exports standalone HTML with the native A4 frame dimensions', async ({ page }) => {
    await page.goto('/d/a4-report');
    await expect(page.locator('main[data-inspector-root]').getByText('A4 report page')).toBeVisible(
      {
        timeout: 30_000,
      },
    );

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download' }).click();
    await page.getByRole('menuitem', { name: 'Export as HTML' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('a4-report.zip');

    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const archive = unzipSync(await fs.readFile(downloadPath as string));
    const htmlBytes = archive['a4-report.html'];
    expect(htmlBytes).toBeDefined();
    if (!htmlBytes) throw new Error('Expected a4-report.html in the exported archive');
    const html = strFromU8(htmlBytes);
    expect(html).toContain('.os-frame { width: 794px; height: 1123px;');
    expect(html).toContain('window.innerWidth / 794');
    expect(html).toContain('window.innerHeight / 1123');
  });
});
