import type { PresenterState } from '../components/present/use-presenter-channel';

export type RemoteCommand =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'goto'; index: number }
  | { type: 'blackout'; enabled: boolean };

export type RemoteSnapshot = {
  slideId: string;
  title: string;
  state: PresenterState | null;
  active: boolean;
  hostConnected: boolean;
  remoteConnected: boolean;
  revision: number;
  commandExpiresAt: number;
  ack?: string;
};

export type RemoteEnvelope = { id: string; command: RemoteCommand; expiresAt: number };

export type RemoteBridge = {
  publish: (state: PresenterState, ack?: string) => void;
  subscribe: (handler: (message: RemoteEnvelope) => void) => () => void;
};

export type RemoteSession = {
  id: string;
  token: string;
  code: string;
  urls: string[];
};

export async function remoteRequest<T>(
  path: string,
  body: unknown,
  token?: string,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 5000);
  try {
    const response = await fetch(`/__remote${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Verbinding niet beschikbaar');
    return result as T;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
