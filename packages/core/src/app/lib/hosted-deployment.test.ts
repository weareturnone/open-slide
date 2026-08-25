import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForHostedDeployment } from './hosted-deployment.ts';

describe('waitForHostedDeployment', () => {
  const targetSha = 'a'.repeat(40);
  const newerSha = 'b'.repeat(40);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { location: { origin: 'https://studio.example' } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps polling after a slow deployment and reports that it is delayed', async () => {
    let deployed = false;
    const onDelayed = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              draftSha: targetSha,
              mainSha: targetSha,
              deployedSha: deployed ? targetSha : 'previous-sha',
              hasDraftChanges: false,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const waiting = waitForHostedDeployment('/api/studio/version', targetSha, { onDelayed });
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 3_000);
    expect(onDelayed).toHaveBeenCalledTimes(1);

    deployed = true;
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(waiting).resolves.toBeUndefined();
  });

  it('accepts a newer fully deployed main when Vercel skips the exact target build', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request) =>
        new Response(
          JSON.stringify({
            draftSha: newerSha,
            mainSha: newerSha,
            deployedSha: newerSha,
            hasDraftChanges: false,
            targetRelation: 'descendant',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const waiting = waitForHostedDeployment('/api/studio/version', targetSha);
    await vi.advanceTimersByTimeAsync(6_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(waiting).resolves.toBeUndefined();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`targetSha=${targetSha}`);
  });

  it('does not accept an unrelated fully deployed main', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          draftSha: newerSha,
          mainSha: newerSha,
          deployedSha: newerSha,
          hasDraftChanges: false,
          targetRelation: 'unrelated',
        }),
      ),
    );

    const waiting = waitForHostedDeployment('/api/studio/version', targetSha, {
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(6_000);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not accept a descendant relation until the deployed SHA matches main', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          draftSha: newerSha,
          mainSha: newerSha,
          deployedSha: 'older-sha',
          hasDraftChanges: false,
          targetRelation: 'descendant',
        }),
      ),
    );

    const waiting = waitForHostedDeployment('/api/studio/version', targetSha, {
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(6_000);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('resets the required-match count after a deployment mismatch', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        const deployedSha = call === 2 ? newerSha : targetSha;
        return Response.json({
          draftSha: targetSha,
          mainSha: targetSha,
          deployedSha,
          hasDraftChanges: false,
          targetRelation: deployedSha === targetSha ? 'exact' : 'pending',
        });
      }),
    );

    let settled = false;
    const waiting = waitForHostedDeployment('/api/studio/version', targetSha).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(8_000);
    await waiting;
    expect(call).toBe(4);
  });

  it('recovers from a transient status request failure', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        if (call === 1) throw new Error('temporary network failure');
        return Response.json({
          draftSha: targetSha,
          mainSha: targetSha,
          deployedSha: targetSha,
          hasDraftChanges: false,
          targetRelation: 'exact',
        });
      }),
    );

    const waiting = waitForHostedDeployment('/api/studio/version', targetSha);
    await vi.advanceTimersByTimeAsync(14_000);
    await expect(waiting).resolves.toBeUndefined();
    expect(call).toBe(3);
  });

  it('rejects immediately when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      waitForHostedDeployment('/api/studio/version', targetSha, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts an in-flight status request', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string | URL | Request, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('cancelled', 'AbortError')),
              { once: true },
            );
          }),
      ),
    );

    const waiting = waitForHostedDeployment('/api/studio/version', targetSha, {
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('aborts during the final deployment settle delay', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          draftSha: targetSha,
          mainSha: targetSha,
          deployedSha: targetSha,
          hasDraftChanges: false,
          targetRelation: 'exact',
        }),
      ),
    );

    const waiting = waitForHostedDeployment('/api/studio/version', targetSha, {
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(6_000);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stops low-frequency polling after 30 minutes when deployment cannot be verified', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          draftSha: targetSha,
          mainSha: targetSha,
          deployedSha: newerSha,
          hasDraftChanges: false,
          targetRelation: 'pending',
        }),
      ),
    );

    const waiting = waitForHostedDeployment('/api/studio/version', targetSha);
    const rejection = expect(waiting).rejects.toMatchObject({
      code: 'DEPLOYMENT_STATUS_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 15_000);
    await rejection;
  });

  it('stops after 30 minutes when a status request never settles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string | URL | Request, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('deadline reached', 'AbortError')),
              { once: true },
            );
          }),
      ),
    );

    const waiting = waitForHostedDeployment('/api/studio/version', targetSha);
    const rejection = expect(waiting).rejects.toMatchObject({
      code: 'DEPLOYMENT_STATUS_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await rejection;
  });
});
