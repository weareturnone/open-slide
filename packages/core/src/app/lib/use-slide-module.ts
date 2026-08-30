import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentKind, SlideModule } from './sdk';
import { loadDocument, loadSlide, slideChangeIncludes } from './slides';

export function useSlideModule(slideId: string, kind: ContentKind = 'slide') {
  const [slide, setSlide] = useState<SlideModule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadSeqRef = useRef(0);

  const reload = useCallback(
    (reset: boolean) => {
      const seq = ++loadSeqRef.current;
      if (reset) setSlide(null);
      setError(null);
      (kind === 'document' ? loadDocument(slideId) : loadSlide(slideId))
        .then((mod) => {
          if (seq === loadSeqRef.current) setSlide(mod);
        })
        .catch((e) => {
          if (seq === loadSeqRef.current) setError(String(e?.message ?? e));
        });
    },
    [kind, slideId],
  );

  useEffect(() => {
    reload(true);
  }, [reload]);

  useEffect(() => {
    if (!import.meta.hot) return;
    let cancelled = false;
    const handler = (data: unknown) => {
      if (slideChangeIncludes(data, slideId, kind)) {
        queueMicrotask(() => {
          if (!cancelled) reload(false);
        });
      }
    };
    import.meta.hot.on('open-slide:slide-changed', handler);
    return () => {
      cancelled = true;
      import.meta.hot?.off('open-slide:slide-changed', handler);
    };
  }, [kind, slideId, reload]);

  return { slide, error };
}
