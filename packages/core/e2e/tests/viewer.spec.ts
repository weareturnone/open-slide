import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  deleteSlide,
  duplicateSlide,
  editorCanvas,
  openSlide,
  readSlideSource,
} from './helpers.ts';

test.describe('slide viewer', () => {
  test('opens on page one with the deck title in the toolbar', async ({ page }) => {
    await openSlide(page, 'alpha');
    await expect(editorCanvas(page).getByText('Alpha page one')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Alpha Deck' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go to page 1' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('arrow keys navigate pages and update the url', async ({ page }) => {
    await openSlide(page, 'alpha');
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/[?&]p=2/);
    await expect(editorCanvas(page).getByText('Alpha page two')).toBeVisible();

    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(/[?&]p=1/);
    await expect(editorCanvas(page).getByText('Alpha page one')).toBeVisible();

    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(/[?&]p=1/);
  });

  test('deep links clamp the page query param', async ({ page }) => {
    await openSlide(page, 'alpha', '?p=999');
    await expect(editorCanvas(page).getByText('Alpha page three')).toBeVisible();

    await openSlide(page, 'alpha', '?p=0');
    await expect(editorCanvas(page).getByText('Alpha page one')).toBeVisible();
  });

  test('clicking a thumbnail jumps to that page', async ({ page }) => {
    await openSlide(page, 'alpha');
    await page.getByRole('button', { name: 'Go to page 2' }).click();
    await expect(page).toHaveURL(/[?&]p=2/);
    await expect(page.getByRole('button', { name: 'Go to page 2' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('overview grid opens, navigates with the keyboard, and closes', async ({ page }) => {
    await openSlide(page, 'alpha');
    await page.keyboard.press('o');
    const overview = page.getByRole('dialog', { name: 'Slide overview' });
    await expect(overview).toBeVisible();
    await expect(overview.getByRole('button', { name: 'Go to slide 1' })).toHaveAttribute(
      'aria-current',
      'true',
    );

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(overview).toBeHidden();
    await expect(page).toHaveURL(/[?&]p=2/);

    await page.keyboard.press('o');
    await expect(overview).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(overview).toBeHidden();
  });

  test('wheel scrolling navigates pages', async ({ page }) => {
    await openSlide(page, 'alpha');
    await editorCanvas(page).hover();
    await page.mouse.wheel(0, 120);
    await expect(page).toHaveURL(/[?&]p=2/);
  });

  test('unknown slide ids show the load-failed state', async ({ page }) => {
    await page.goto('/s/does-not-exist');
    await expect(page.getByText('Failed to load slide')).toBeVisible();
  });

  test('back button returns to the home browser', async ({ page }) => {
    await openSlide(page, 'alpha');
    await page.getByRole('button', { name: 'Back to home' }).click();
    await expect(page.locator('li h3')).toHaveCount(4);
  });

  test('back returns to the previous browser location with its query intact', async ({ page }) => {
    await page.goto('/?f=draft');
    await page.waitForFunction(
      () => sessionStorage.getItem('open-slide:last-home-location') === '/?f=draft',
    );
    await page.locator('a[href="/s/alpha"]').first().click();
    await expect(page).toHaveURL(/\/s\/alpha/);
    await page.getByRole('button', { name: 'Back to home' }).click();
    await expect(page).toHaveURL(/[?&]f=draft/);
  });

  test('back falls back to the last home location, query included', async ({ page }) => {
    await page.goto('/?f=draft');
    await page.waitForFunction(
      () => sessionStorage.getItem('open-slide:last-home-location') === '/?f=draft',
    );
    await openSlide(page, 'alpha');
    await page.getByRole('button', { name: 'Back to home' }).click();
    await expect(page).toHaveURL(/[?&]f=draft/);
  });

  test('steps render fully revealed in the editor', async ({ page }) => {
    await openSlide(page, 'steps', '?p=2');
    await expect(editorCanvas(page).locator('[data-osd-step="revealed"]')).toHaveCount(2);
    await expect(editorCanvas(page).locator('[data-osd-step="pending"]')).toHaveCount(0);
  });

  test('thumbnail context menu duplicates and deletes a page', async ({ page, request }) => {
    try {
      await duplicateSlide(request, 'alpha', 'thumb-ops');
      await openSlide(page, 'thumb-ops');
      await expect(page.getByRole('button', { name: 'Go to page 3' })).toBeVisible();

      await page.getByRole('button', { name: 'Go to page 1' }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Duplicate' }).click();
      await expect(page.getByRole('button', { name: 'Go to page 4' })).toBeVisible();
      await expect.poll(() => readSlideSource('thumb-ops')).toContain("page('one-copy', One)");
      await expect(
        page.getByRole('button', { name: 'Go to page 1' }).locator('[data-slide-page-id]'),
      ).toHaveAttribute('data-slide-page-id', 'slides/thumb-ops/index.tsx#legacy:One');
      await expect(
        page.getByRole('button', { name: 'Go to page 2' }).locator('[data-slide-page-id]'),
      ).toHaveAttribute('data-slide-page-id', 'slides/thumb-ops/index.tsx#one-copy');

      await page.getByRole('button', { name: 'Go to page 4' }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await expect(page.getByRole('button', { name: 'Go to page 4' })).toHaveCount(0);
    } finally {
      await deleteSlide(request, 'thumb-ops');
    }
  });

  test('HTML, PDF, and PPTX export roots keep the authored page id', async ({ page, request }) => {
    const slideId = 'export-identity';
    const pageId = `slides/${slideId}/index.tsx#only`;
    try {
      await duplicateSlide(request, 'edit-target', slideId);
      await openSlide(page, slideId);

      const htmlDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download' }).click();
      await page.getByRole('menuitem', { name: 'Export as HTML' }).click();
      const htmlPath = await (await htmlDownload).path();
      expect(htmlPath).not.toBeNull();
      expect(await fs.readFile(htmlPath as string, 'utf8')).toContain(
        `data-slide-page-id="${pageId}"`,
      );

      await page.evaluate(() => {
        const state = window as typeof window & { __pdfPageIds?: string[] };
        state.__pdfPageIds = [];
        window.print = () => {
          state.__pdfPageIds = Array.from(
            document.querySelectorAll<HTMLElement>('.os-print-frame[data-slide-page-id]'),
            (element) => element.dataset.slidePageId ?? '',
          );
          window.dispatchEvent(new Event('afterprint'));
        };
      });
      await page.getByRole('button', { name: 'Download' }).click();
      await page.getByRole('menuitem', { name: 'Export as PDF' }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as typeof window & { __pdfPageIds?: string[] }).__pdfPageIds ?? [],
          ),
        )
        .toEqual([pageId]);

      await page.evaluate(() => {
        const state = window as typeof window & { __pptxPageIds?: string[] };
        state.__pptxPageIds = [];
        const observer = new MutationObserver(() => {
          const ids = Array.from(
            document.querySelectorAll<HTMLElement>('.os-pptx-capture [data-slide-page-id]'),
            (element) => element.dataset.slidePageId ?? '',
          );
          if (ids.length > 0) state.__pptxPageIds = ids;
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
      const pptxDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download' }).click();
      await page.getByRole('menuitem', { name: 'Export as image PPTX' }).click();
      await pptxDownload;
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as typeof window & { __pptxPageIds?: string[] }).__pptxPageIds ?? [],
          ),
        )
        .toEqual([pageId]);
    } finally {
      await deleteSlide(request, slideId);
    }
  });

  test('toolbar title editor renames the deck and saves to disk', async ({ page, request }) => {
    try {
      await duplicateSlide(request, 'edit-target', 'rename-ui');
      await openSlide(page, 'rename-ui');

      const titleButton = page.getByRole('button', { name: 'Rename slide' });
      await titleButton.click();
      await page.keyboard.type('Renamed Deck');
      await page.keyboard.press('Enter');

      await expect(titleButton).toContainText('Renamed Deck');
      await expect.poll(() => readSlideSource('rename-ui')).toContain('Renamed Deck');
    } finally {
      await deleteSlide(request, 'rename-ui');
    }
  });

  test('notes drawer autosaves speaker notes to the slide source', async ({ page, request }) => {
    try {
      await duplicateSlide(request, 'edit-target', 'notes-ui');
      await openSlide(page, 'notes-ui');
      const toggle = page.getByRole('button', { name: /Notes/ });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');

      const saved = page.waitForResponse(
        (res) => res.url().includes('/__notes') && res.request().method() === 'PUT',
      );
      await page.getByPlaceholder('Write speaker notes for this slide…').fill('Drawer note text');
      expect((await saved).status()).toBe(200);
      await expect.poll(() => readSlideSource('notes-ui')).toContain('Drawer note text');
    } finally {
      await deleteSlide(request, 'notes-ui');
    }
  });
});
