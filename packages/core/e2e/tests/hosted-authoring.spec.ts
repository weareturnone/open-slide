import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page, type Route, test } from '@playwright/test';
import {
  prepareScratchProject,
  runCli,
  startCliServer,
  stopServer,
  waitForHttpOk,
} from './helpers.ts';

const DRAFT_SHA = '1111111111111111111111111111111111111111';
const MAIN_SHA = '2222222222222222222222222222222222222222';
const TARGET_SHA = '3333333333333333333333333333333333333333';

const variants = {
  writable: { config: 'hosted-writable', port: 43123 },
  readOnly: { config: 'hosted-read-only', port: 43125 },
} as const;

const servers: ChildProcess[] = [];

test.beforeAll(async () => {
  test.setTimeout(600_000);
  for (const [name, variant] of Object.entries(variants)) {
    const projectDir = prepareScratchProject(`hosted-${name}`);
    await fs.writeFile(
      path.join(projectDir, 'open-slide.config.ts'),
      `export { default } from './configs/${variant.config}.ts';\n`,
    );
    const result = await runCli(['build'], projectDir);
    expect(result.code, result.stderr).toBe(0);
    const server = startCliServer(
      ['preview', '--host', '127.0.0.1', '--port', String(variant.port)],
      projectDir,
    );
    servers.push(server);
    await waitForHttpOk(`http://127.0.0.1:${variant.port}/`);
  }
});

test.afterAll(async () => {
  for (const server of servers) await stopServer(server);
});

function baseUrl(variant: keyof typeof variants): string {
  return `http://127.0.0.1:${variants[variant].port}`;
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockVersionStatus(page: Page, readOnly = false): Promise<void> {
  await page.route('**/studio/status**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('deploymentOnly')) {
      await fulfillJson(route, { deployedSha: TARGET_SHA });
      return;
    }
    if (url.searchParams.has('operationId')) {
      const operationId = url.searchParams.get('operationId') ?? '';
      await fulfillJson(route, {
        ok: true,
        state: 'ready',
        operation: operationReceipt(operationId, 'fixture'),
        draftSha: DRAFT_SHA,
        mainSha: TARGET_SHA,
        deployedSha: TARGET_SHA,
        relation: 'exact',
        proof: { ok: true, resolvedPageIndex: null },
        resolvedPageIndex: null,
        allowedActions: [],
      });
      return;
    }
    await fulfillJson(route, {
      draftSha: DRAFT_SHA,
      mainSha: MAIN_SHA,
      deployedSha: MAIN_SHA,
      hasDraftChanges: false,
      readOnly,
    });
  });
}

function operationReceipt(operationId: string, artifactId: string) {
  return {
    version: 1,
    operationId,
    requestHash: `request-${operationId}`,
    kind: 'structural-fixture',
    artifactId,
    baseMainSha: MAIN_SHA,
    draftCommitSha: DRAFT_SHA,
    targetMainSha: TARGET_SHA,
    proof: {},
  };
}

test.describe('hosted authoring adapters', () => {
  test('routes catalog and deck creation through configured endpoints with a durable receipt', async ({
    page,
  }) => {
    await mockVersionStatus(page);
    const catalogRequests: URL[] = [];
    const createBodies: Record<string, unknown>[] = [];

    await page.route('**/studio/catalog**', async (route) => {
      catalogRequests.push(new URL(route.request().url()));
      await fulfillJson(route, {
        entries: [
          {
            id: 'statement',
            name: 'Statement',
            description: 'One statement page.',
            preview: { kind: 'text', title: 'Statement', body: 'One statement page.' },
          },
        ],
      });
    });
    await page.route('**/studio/decks', async (route) => {
      const createBody = route.request().postDataJSON() as Record<string, unknown>;
      createBodies.push(createBody);
      await fulfillJson(route, {
        operation: operationReceipt(String(createBody.operationId), String(createBody.deckId)),
      });
    });

    await page.goto(baseUrl('writable'));
    await page.getByRole('button', { name: 'New deck' }).click();
    await expect(page.getByRole('radiogroup', { name: 'Starting layout' })).toBeVisible();
    await page.getByLabel('Title').fill('Hosted launch');
    await page.getByRole('button', { name: 'Create deck' }).click();

    await expect.poll(() => createBodies.length).toBe(1);
    const createBody = createBodies[0];
    expect(createBody).toBeDefined();
    if (!createBody) throw new Error('Expected one captured create-deck request');
    expect(catalogRequests).toHaveLength(1);
    expect(catalogRequests[0]?.pathname).toBe('/studio/catalog');
    expect(catalogRequests[0]?.searchParams.get('kind')).toBe('slide');
    expect(createBody).toMatchObject({
      title: 'Hosted launch',
      deckId: 'hosted-launch',
      templateId: 'statement',
      kind: 'slide',
      expectedDraftSha: DRAFT_SHA,
      expectedMainSha: MAIN_SHA,
    });
    expect(createBody.operationId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page.getByText('Waiting for Studio deployment')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = sessionStorage.getItem('open-slide:hosted-operation:v1');
          return raw ? JSON.parse(raw) : null;
        }),
      )
      .toMatchObject({
        phase: 'waiting',
        receipt: { operationId: createBody.operationId, targetMainSha: TARGET_SHA },
      });
  });

  test('routes structural operations through the host contract with optimistic heads', async ({
    page,
  }) => {
    await mockVersionStatus(page);
    const duplicateBodies: Record<string, unknown>[] = [];

    await page.route('**/__slides/alpha/duplicate', async (route) => {
      const duplicateBody = route.request().postDataJSON() as Record<string, unknown>;
      duplicateBodies.push(duplicateBody);
      await fulfillJson(route, {
        slideId: duplicateBody.newId,
        operation: operationReceipt(String(duplicateBody.operationId), String(duplicateBody.newId)),
      });
    });

    await page.goto(baseUrl('writable'));
    const alphaCard = page.locator('li').filter({
      has: page.getByRole('heading', { name: 'Alpha Deck' }),
    });
    await alphaCard.hover();
    await alphaCard.getByRole('button', { name: 'Slide actions' }).click();
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();

    await expect.poll(() => duplicateBodies.length).toBe(1);
    const duplicateBody = duplicateBodies[0];
    expect(duplicateBody).toBeDefined();
    if (!duplicateBody) throw new Error('Expected one captured duplicate request');
    expect(duplicateBody).toMatchObject({
      expectedDraftSha: DRAFT_SHA,
      expectedMainSha: MAIN_SHA,
    });
    expect(duplicateBody.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(duplicateBody.newId).toBe(`alpha-copy-${String(duplicateBody.operationId).slice(0, 8)}`);
    await expect(page.getByText('Waiting for Studio deployment')).toBeVisible();
  });

  test('blocks mutation dispatch in read-only previews', async ({ page }) => {
    await mockVersionStatus(page, true);
    const mutationRequests: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET') mutationRequests.push(`${request.method()} ${request.url()}`);
    });
    await page.route('**/studio/catalog**', async (route) => {
      await fulfillJson(route, {
        entries: [
          {
            id: 'statement',
            name: 'Statement',
            description: 'One statement page.',
            preview: { kind: 'text', title: 'Statement', body: 'One statement page.' },
          },
        ],
      });
    });

    await page.goto(baseUrl('readOnly'));
    await expect(page.getByText('Read-only preview')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish all' })).toBeDisabled();

    await page.getByRole('button', { name: 'New deck' }).click();
    await expect(page.getByRole('button', { name: 'Create deck' })).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel' }).click();

    const alphaCard = page.locator('li').filter({
      has: page.getByRole('heading', { name: 'Alpha Deck' }),
    });
    await alphaCard.hover();
    await alphaCard.getByRole('button', { name: 'Slide actions' }).click();
    const duplicate = page.getByRole('menuitem', { name: 'Duplicate' });
    await expect(duplicate).toHaveAttribute('aria-disabled', 'true');
    await duplicate.evaluate((element: HTMLElement) => element.click());
    await page.waitForTimeout(100);
    expect(mutationRequests).toEqual([]);
  });
});
