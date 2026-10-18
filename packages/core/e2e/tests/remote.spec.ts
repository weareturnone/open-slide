import { test as base, expect, type Page } from '@playwright/test';
import { editorCanvas, enterPlayMode, openSlide } from './helpers.ts';

const test = base.extend<{ phone: Page }>({
  phone: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    await use(await context.newPage());
    await context.close();
  },
});

async function pair(host: Page, phone: Page): Promise<string> {
  await openSlide(host, 'steps');
  await host.getByRole('button', { name: 'Bedienen met telefoon' }).click();
  const code = host.getByTestId('remote-code');
  await expect(code).toHaveText(/^\d{6}$/);
  const value = (await code.innerText()).trim();

  await phone.goto('/remote');
  await phone.getByLabel('Koppelcode', { exact: true }).fill(value);
  await phone.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(host.getByRole('dialog').getByRole('status')).toContainText('Telefoon verbonden');
  await expect(phone.getByRole('status')).toHaveText('Start of hervat de presentatie op je laptop');
  await expect(phone.getByRole('button', { name: 'Volgende slide' })).toBeDisabled();

  await host.getByRole('button', { name: 'Start presentatie', exact: true }).click();
  await expect(editorCanvas(host)).toBeHidden();
  await expect(phone.getByRole('status')).toHaveText('Verbonden');
  await expect(phone.getByTestId('remote-position')).toHaveText('1 / 3');
  await expect(phone.getByRole('button', { name: 'Volgende slide' })).toBeEnabled();
  return value;
}

async function expectPosition(host: Page, phone: Page, position: number): Promise<void> {
  await expect(host).toHaveURL(new RegExp(`[?&]p=${position}(?:&|$)`));
  await expect(phone.getByTestId('remote-position')).toHaveText(`${position} / 3`);
}

async function jump(phone: Page, position: number): Promise<void> {
  await phone.getByRole('button', { name: 'Alle slides', exact: true }).click();
  await phone.getByRole('button', { name: `Toon slide ${position}`, exact: true }).click();
  await expect(phone.getByRole('button', { name: 'Alle slides', exact: true })).toBeVisible();
}

test.describe('local phone remote', () => {
  test('stopping while pairing starts disposes the late session and allows a new pairing', async ({
    page: host,
    request,
  }) => {
    await openSlide(host, 'steps');
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let created = (_session: { id: string; token: string }) => {};
    const sessionCreated = new Promise<{ id: string; token: string }>((resolve) => {
      created = resolve;
    });
    await host.route('**/__remote/create', async (route) => {
      const response = await route.fetch();
      created(await response.json());
      await held;
      await route.fulfill({ response });
    });

    try {
      await host.getByRole('button', { name: 'Bedienen met telefoon' }).click();
      const session = await sessionCreated;
      await expect(host.getByRole('dialog').getByRole('status')).toHaveText('Sessie starten…');
      await host.getByRole('button', { name: 'Koppeling stoppen', exact: true }).click();
      const ended = host.waitForResponse((response) =>
        response.url().endsWith(`/__remote/${session.id}/end`),
      );
      release();
      expect((await ended).ok()).toBe(true);
      await expect(host.getByTestId('remote-code')).toHaveCount(0);
      const stale = await request.post(`/__remote/${session.id}/state`, {
        headers: { authorization: `Bearer ${session.token}` },
        data: { active: false, state: null },
      });
      expect(stale.status()).toBe(404);
      await host.unroute('**/__remote/create');
      await host.getByRole('button', { name: 'Bedienen met telefoon' }).click();
      await expect(host.getByTestId('remote-code')).toHaveText(/^\d{6}$/);
    } finally {
      release();
    }
  });

  test('choosing a new pairing while the previous join is delayed keeps the latest choice', async ({
    page: firstHost,
    phone,
  }) => {
    await openSlide(firstHost, 'steps');
    await firstHost.getByRole('button', { name: 'Bedienen met telefoon' }).click();
    await expect(firstHost.getByTestId('remote-code')).toHaveText(/^\d{6}$/);
    const firstCode = (await firstHost.getByTestId('remote-code').innerText()).trim();
    const secondHost = await firstHost.context().newPage();
    await openSlide(secondHost, 'alpha');
    await secondHost.getByRole('button', { name: 'Bedienen met telefoon' }).click();
    await expect(secondHost.getByTestId('remote-code')).toHaveText(/^\d{6}$/);
    const secondCode = (await secondHost.getByTestId('remote-code').innerText()).trim();

    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let joined = () => {};
    const firstJoined = new Promise<void>((resolve) => {
      joined = resolve;
    });
    await phone.route('**/__remote/join', async (route) => {
      const response = await route.fetch();
      if (route.request().postDataJSON().code === firstCode) {
        joined();
        await held;
      }
      await route.fulfill({ response });
    });
    try {
      await phone.goto(`/remote#${firstCode}`);
      await firstJoined;
      await phone.evaluate((code) => {
        window.location.hash = code;
      }, secondCode);
      await expect(phone.getByLabel('Koppelcode', { exact: true })).toHaveValue(secondCode);
      release();
      await expect(phone.getByRole('heading', { name: 'Alpha Deck', exact: true })).toBeVisible();
      await expect(phone).toHaveURL(new RegExp(`#${secondCode}$`));
      await secondHost.getByRole('button', { name: 'Start presentatie', exact: true }).click();
      await expect(phone.getByRole('status')).toHaveText('Verbonden');
      await phone.getByRole('button', { name: 'Volgende slide' }).click();
      await expectPosition(secondHost, phone, 2);
      await expect(firstHost.getByRole('dialog').getByRole('status')).toHaveText(
        'Wachten op je telefoon',
      );
    } finally {
      release();
    }
  });

  test('pairs independent browsers and confirms navigation, step reveals, index jumps and blackout', async ({
    page: host,
    phone,
  }) => {
    test.setTimeout(60_000);
    await pair(host, phone);
    const otherPresentation = await host.context().newPage();
    await openSlide(otherPresentation, 'steps');
    await enterPlayMode(otherPresentation);
    const next = phone.getByRole('button', { name: 'Volgende slide' });
    const previous = phone.getByRole('button', { name: 'Vorige slide' });
    await expect(previous).toBeDisabled();

    await next.click();
    await expectPosition(host, phone, 2);
    await expect(host.locator('[data-osd-step="pending"]')).toHaveCount(2);
    await expect(phone.locator('[data-osd-step="pending"]')).toHaveCount(2);
    await next.click();
    await expect(host.locator('[data-osd-step="revealed"]')).toHaveCount(1);
    await expect(phone.locator('[data-osd-step="revealed"]')).toHaveCount(1);
    await previous.click();
    await expect(host.locator('[data-osd-step="pending"]')).toHaveCount(2);
    await expect(phone.locator('[data-osd-step="pending"]')).toHaveCount(2);

    await jump(phone, 2);
    await expectPosition(host, phone, 2);
    await expect(host.locator('[data-osd-step="revealed"]')).toHaveCount(2);
    await expect(phone.locator('[data-osd-step="revealed"]')).toHaveCount(2);
    await jump(phone, 1);
    await expectPosition(host, phone, 1);
    await jump(phone, 2);
    await expectPosition(host, phone, 2);
    await expect(host.locator('[data-osd-step="revealed"]')).toHaveCount(2);
    await expect(phone.locator('[data-osd-step="revealed"]')).toHaveCount(2);

    await jump(phone, 1);
    await expectPosition(host, phone, 1);
    await jump(phone, 3);
    await expectPosition(host, phone, 3);
    await expect(next).toBeDisabled();
    await previous.click();
    await expectPosition(host, phone, 2);
    await expect(host.locator('[data-osd-step="revealed"]')).toHaveCount(2);

    await phone.getByRole('button', { name: 'Zwart beeld', exact: true }).click();
    await expect(host.locator('div.absolute.inset-0.bg-black')).toBeVisible();
    await expect(
      phone.getByRole('button', { name: 'Beeld hervatten', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await phone.getByRole('button', { name: 'Beeld hervatten', exact: true }).click();
    await expect(host.locator('div.absolute.inset-0.bg-black')).toBeHidden();
    await expect(phone.getByRole('button', { name: 'Zwart beeld', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(otherPresentation.getByText('Steps page one')).toBeVisible();
    await expect(otherPresentation.locator('div.absolute.inset-0.bg-black')).toBeHidden();
    await expect(otherPresentation).not.toHaveURL(/[?&]p=[23](?:&|$)/);
  });

  test('retains pairing on pause and refresh, reconnects to current state and discards offline clicks', async ({
    page: host,
    phone,
  }) => {
    test.setTimeout(60_000);
    const code = await pair(host, phone);
    const next = phone.getByRole('button', { name: 'Volgende slide' });
    const previous = phone.getByRole('button', { name: 'Vorige slide' });
    await jump(phone, 3);
    await expectPosition(host, phone, 3);

    await host.keyboard.press('Escape');
    await expect(editorCanvas(host)).toBeVisible();
    await expect(phone.getByRole('status')).toHaveText(
      'Start of hervat de presentatie op je laptop',
    );
    await expect(previous).toBeDisabled();
    await phone.reload();
    await expect(phone).toHaveURL(new RegExp(`#${code}$`));
    await expect(phone.getByTestId('remote-position')).toHaveText('3 / 3');
    await expect(previous).toBeDisabled();
    await enterPlayMode(host);
    await expect(phone.getByRole('status')).toHaveText('Verbonden');
    await expect(previous).toBeEnabled();

    const commands: string[] = [];
    phone.on('request', (request) => {
      if (request.method() === 'POST' && /\/__remote\/[^/]+\/command$/.test(request.url())) {
        commands.push(request.postData() ?? '');
      }
    });
    await phone.context().setOffline(true);
    await expect(phone.getByRole('status')).toHaveText('Opnieuw verbinden…', { timeout: 15_000 });
    await expect(next).toBeDisabled();
    await expect(previous).toBeDisabled();
    await previous.dispatchEvent('click');
    await next.dispatchEvent('click');
    await host.keyboard.press('Home');
    await expect(host).toHaveURL(/[?&]p=1(?:&|$)/);
    expect(commands).toEqual([]);

    await phone.context().setOffline(false);
    await expect(phone.getByRole('status')).toHaveText('Verbonden', { timeout: 15_000 });
    await expectPosition(host, phone, 1);
    await expect(next).toBeEnabled();
    expect(commands).toEqual([]);
    await next.click();
    await expectPosition(host, phone, 2);
    await expect(host.locator('[data-osd-step="pending"]')).toHaveCount(2);
    expect(commands).toHaveLength(1);
  });

  test('ending the pairing and leaving the deck invalidate the previous phone', async ({
    page: host,
    phone,
  }) => {
    await pair(host, phone);
    await host.keyboard.press('Escape');
    await host.getByRole('button', { name: 'Bedienen met telefoon' }).click();
    await host.getByRole('button', { name: 'Koppeling stoppen', exact: true }).click();
    await expect(phone.getByLabel('Koppelcode', { exact: true })).toBeVisible();
    await expect(phone.getByRole('alert')).toContainText('Sessie beëindigd');

    const code = await pair(host, phone);
    await host.keyboard.press('Escape');
    await host.getByLabel('Back to home', { exact: true }).click();
    await host.getByRole('link', { name: 'Alpha Deck', exact: true }).click();
    await expect(editorCanvas(host)).toBeVisible();
    await expect(phone.getByLabel('Koppelcode', { exact: true })).toBeVisible();
    await expect(phone.getByRole('alert')).toContainText('Sessie beëindigd');
    await phone.getByLabel('Koppelcode', { exact: true }).fill(code);
    await phone.getByRole('button', { name: 'Verbinden', exact: true }).click();
    await expect(phone.getByRole('alert')).toContainText('Code niet gevonden');
    await expect(phone.getByRole('button', { name: 'Volgende slide' })).toHaveCount(0);
  });
});
