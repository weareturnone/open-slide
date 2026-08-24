import config from 'virtual:open-slide/config';
import { Loader2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CatalogPreview, type CatalogPreviewEntry } from '@/components/catalog-preview';
import { useHostedOperation } from '@/components/hosted-operation-provider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { authoringReadOnly } from '@/lib/authoring';
import { deployedStudioUrl } from '@/lib/hosted-deployment';
import type { ContentKind } from '@/lib/sdk';
import { cn } from '@/lib/utils';

type CatalogEntry = CatalogPreviewEntry;

const catalogConfig = config.authoring?.catalog;
const publishConfig = config.authoring?.publish;

export function CatalogInsertDialog({
  slideId,
  index,
  onClose,
  kind = 'slide',
}: {
  slideId: string;
  index: number | null;
  onClose: () => void;
  kind?: ContentKind;
}) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const { runStructuralMutation, structuralLocked } = useHostedOperation();

  useEffect(() => {
    if (index === null || !catalogConfig) return;
    setLoading(true);
    const endpoint = import.meta.env.DEV ? '/__catalog' : catalogConfig.listEndpoint;
    fetch(`${endpoint}?kind=${kind}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Catalog request failed with ${response.status}`);
        const body = (await response.json()) as { entries?: CatalogEntry[] };
        const next = body.entries ?? [];
        setEntries(next);
        setSelectedId(next[0]?.id ?? null);
      })
      .catch((error) => toast.error(String((error as Error).message ?? error)))
      .finally(() => setLoading(false));
  }, [index, kind]);

  if (!catalogConfig || (!import.meta.env.DEV && !publishConfig)) return null;

  const insert = async () => {
    if (index === null || !selectedId || preparing) return;
    setPreparing(true);
    try {
      const endpoint = import.meta.env.DEV ? '/__catalog' : catalogConfig.insertEndpoint;
      if (import.meta.env.DEV) {
        const insertResponse = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slideId, index, templateId: selectedId, kind }),
        });
        const inserted = (await insertResponse.json().catch(() => ({}))) as { error?: string };
        if (!insertResponse.ok) {
          throw new Error(inserted.error ?? `Insert failed with ${insertResponse.status}`);
        }
        toast.success(`${kind === 'document' ? 'Page' : 'Slide'} inserted.`);
        setPreparing(false);
        onClose();
        const url = new URL(window.location.href);
        url.searchParams.set('p', String(index + 1));
        window.location.assign(url);
        return;
      }
      const hosted = await runStructuralMutation<Record<string, unknown>>({
        label: `Insert ${kind === 'document' ? 'page' : 'slide'}`,
        endpoint,
        method: 'POST',
        body: { slideId, index, templateId: selectedId, kind },
        onCommitted: () => {
          setPreparing(false);
          onClose();
        },
        destination: (_result, status) => {
          const url = new URL(window.location.href);
          const resolved = status.resolvedPageIndex ?? index;
          url.searchParams.set('p', String(resolved + 1));
          return url;
        },
      });
      const url = new URL(window.location.href);
      const resolved = hosted.status.resolvedPageIndex ?? index;
      url.searchParams.set('p', String(resolved + 1));
      window.location.assign(
        deployedStudioUrl(
          url,
          hosted.status.operation.targetMainSha,
          hosted.status.operation.operationId,
        ),
      );
    } catch (error) {
      toast.error(String((error as Error).message ?? error));
      setPreparing(false);
    }
  };

  return (
    <Dialog open={index !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Insert a {kind === 'document' ? 'page' : 'slide'}</DialogTitle>
          <DialogDescription>Choose a Turn.One layout for this exact position.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="grid min-h-72 place-items-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div
            className="grid max-h-[58vh] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2"
            role="radiogroup"
            aria-label={`Choose a ${kind === 'document' ? 'page' : 'slide'} layout`}
          >
            {entries.map((entry) => (
              <label
                key={entry.id}
                className={cn(
                  'cursor-pointer rounded-lg border bg-card p-2 text-left outline-none transition-colors focus-within:ring-2 focus-within:ring-ring/40',
                  (preparing || structuralLocked || authoringReadOnly) &&
                    'cursor-not-allowed opacity-50',
                  selectedId === entry.id
                    ? 'border-brand ring-1 ring-brand'
                    : 'border-hairline hover:border-foreground/30',
                )}
              >
                <input
                  type="radio"
                  name="catalog-template"
                  value={entry.id}
                  checked={selectedId === entry.id}
                  disabled={preparing || structuralLocked || authoringReadOnly}
                  onChange={() => setSelectedId(entry.id)}
                  className="sr-only"
                />
                <CatalogPreview entry={entry} document={kind === 'document'} className="mb-3" />
                <span className="block text-sm font-medium">{entry.name}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {entry.description}
                </span>
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={preparing} onClick={onClose}>
            {preparing ? 'Close' : 'Cancel'}
          </Button>
          <Button
            variant="brand"
            disabled={!selectedId || loading || preparing || structuralLocked || authoringReadOnly}
            onClick={() => void insert()}
          >
            {preparing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {preparing
              ? `Saving ${kind === 'document' ? 'page' : 'slide'}`
              : `Insert ${kind === 'document' ? 'page' : 'slide'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
