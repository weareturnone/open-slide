import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesignSystem } from '../../lib/design';
import type { ContentKind } from '../../lib/sdk';

type FetchedState = {
  design: DesignSystem | null;
  exists: boolean;
  warning: string | null;
  loaded: boolean;
};

export type UseDesignReturn = FetchedState & {
  refresh: () => Promise<void>;
  save: (patch: Partial<DesignSystem>) => Promise<{ ok: boolean; error?: string }>;
  reset: () => Promise<{ ok: boolean; error?: string }>;
};

export function useDesign(slideId: string, kind: ContentKind = 'slide'): UseDesignReturn {
  const [state, setState] = useState<FetchedState>({
    design: null,
    exists: false,
    warning: null,
    loaded: false,
  });
  const slideIdRef = useRef(slideId);
  slideIdRef.current = slideId;

  const refresh = useCallback(async () => {
    const id = slideIdRef.current;
    if (!id || !import.meta.env.DEV) return;
    try {
      const res = await fetch(
        `/__design?slideId=${encodeURIComponent(id)}${kind === 'document' ? '&kind=document' : ''}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        design: DesignSystem;
        exists: boolean;
        warning: string | null;
      };
      setState({
        design: body.design,
        exists: body.exists,
        warning: body.warning,
        loaded: true,
      });
    } catch (err) {
      setState((s) => ({ ...s, warning: String((err as Error).message), loaded: true }));
    }
  }, [kind]);

  useEffect(() => {
    setState({ design: null, exists: false, warning: null, loaded: false });
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (patch: Partial<DesignSystem>) => {
      const id = slideIdRef.current;
      if (!id) return { ok: false, error: 'no slide id' };
      try {
        const res = await fetch(
          `/__design?slideId=${encodeURIComponent(id)}${kind === 'document' ? '&kind=document' : ''}`,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ patch }),
          },
        );
        const body = (await res.json()) as {
          ok?: boolean;
          error?: string;
          design?: DesignSystem;
          created?: boolean;
        };
        if (!res.ok || !body.ok) {
          return { ok: false, error: body.error ?? `HTTP ${res.status}` };
        }
        if (body.design) {
          setState((s) => ({
            ...s,
            design: body.design ?? s.design,
            exists: true,
            warning: null,
          }));
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String((err as Error).message) };
      }
    },
    [kind],
  );

  const reset = useCallback(async () => {
    const id = slideIdRef.current;
    if (!id) return { ok: false, error: 'no slide id' };
    try {
      const res = await fetch(
        `/__design/reset?slideId=${encodeURIComponent(id)}${kind === 'document' ? '&kind=document' : ''}`,
        {
          method: 'POST',
        },
      );
      const body = (await res.json()) as { ok?: boolean; error?: string; design?: DesignSystem };
      if (!res.ok || !body.ok) {
        return { ok: false, error: body.error ?? `HTTP ${res.status}` };
      }
      if (body.design) {
        setState((s) => ({
          ...s,
          design: body.design ?? s.design,
          exists: true,
          warning: null,
        }));
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err as Error).message) };
    }
  }, [kind]);

  return { ...state, refresh, save, reset };
}
