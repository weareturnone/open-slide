import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createViteConfig } from './config.ts';

describe('createViteConfig', () => {
  it('serves the consumer public directory while keeping the packaged app root', async () => {
    const userCwd = path.resolve('/tmp/open-slide-consumer');
    const config = await createViteConfig({ userCwd, config: {} });

    expect(config.publicDir).toBe(path.join(userCwd, 'public'));
    expect(config.root).not.toBe(userCwd);
  });

  it('runs branding before Vite fingerprints the packaged default favicon', async () => {
    const config = await createViteConfig({
      userCwd: path.resolve('/tmp/open-slide-branded-consumer'),
      config: { branding: { appName: 'Acme', icons: [] } },
    });
    const plugins = (config.plugins ?? []) as Array<{
      name?: string;
      transformIndexHtml?: unknown;
    }>;
    const openSlidePlugin = plugins.find((plugin) => plugin.name === 'open-slide');

    expect(openSlidePlugin).toBeTruthy();
    expect(openSlidePlugin?.transformIndexHtml).toMatchObject({ order: 'pre' });
  });
});
