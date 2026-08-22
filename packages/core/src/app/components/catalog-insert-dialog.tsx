import config from 'virtual:open-slide/config';
import { Loader2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  deployedStudioUrl,
  publishHostedDraft,
  waitForHostedDeployment,
} from '@/lib/hosted-deployment';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type CatalogEntry = {
  id: string;
  name: string;
  description: string;
  category: string;
  accent: string;
};

const catalogConfig = config.authoring?.catalog;
const publishConfig = config.authoring?.publish;

export function CatalogInsertDialog({
  slideId,
  index,
  onClose,
}: {
  slideId: string;
  index: number | null;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    if (index === null || !catalogConfig) return;
    setLoading(true);
    fetch(catalogConfig.listEndpoint, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Catalog request failed with ${response.status}`);
        const body = (await response.json()) as { entries?: CatalogEntry[] };
        const next = body.entries ?? [];
        setEntries(next);
        setSelectedId(next[0]?.id ?? null);
      })
      .catch((error) => toast.error(String((error as Error).message ?? error)))
      .finally(() => setLoading(false));
  }, [index]);

  if (!catalogConfig || !publishConfig) return null;

  const insert = async () => {
    if (index === null || !selectedId || preparing) return;
    setPreparing(true);
    try {
      const insertResponse = await fetch(catalogConfig.insertEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slideId, index, templateId: selectedId }),
      });
      const inserted = (await insertResponse.json().catch(() => ({}))) as {
        error?: string;
        commitSha?: string;
      };
      if (!insertResponse.ok) {
        throw new Error(inserted.error ?? `Insert failed with ${insertResponse.status}`);
      }
      if (!inserted.commitSha) throw new Error('Insert response did not include a commit');
      const targetSha = await publishHostedDraft(publishConfig, inserted.commitSha);
      toast.success('Slide inserted. Deploying now.');
      setPreparing(false);
      onClose();
      await waitForHostedDeployment(publishConfig.statusEndpoint, targetSha);
      const url = new URL(window.location.href);
      url.searchParams.set('p', String(index + 1));
      window.location.assign(deployedStudioUrl(url, targetSha));
    } catch (error) {
      toast.error(String((error as Error).message ?? error));
      setPreparing(false);
    }
  };

  return (
    <Dialog open={index !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Insert a slide</DialogTitle>
          <DialogDescription>Choose a Turn.One layout for this exact position.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="grid min-h-72 place-items-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid max-h-[58vh] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                disabled={preparing}
                onClick={() => setSelectedId(entry.id)}
                className={cn(
                  'rounded-lg border bg-card p-2 text-left outline-none transition-colors',
                  selectedId === entry.id
                    ? 'border-brand ring-1 ring-brand'
                    : 'border-hairline hover:border-foreground/30',
                )}
              >
                <span
                  className="mb-3 grid aspect-video place-items-center rounded-md border border-white/10 bg-[#0d0f64] text-center text-lg font-semibold text-white"
                  style={{ boxShadow: `inset 0 -5px 0 ${entry.accent}` }}
                >
                  {entry.name}
                </span>
                <span className="block text-sm font-medium">{entry.name}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {entry.description}
                </span>
              </button>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {preparing ? 'Close' : 'Cancel'}
          </Button>
          <Button
            variant="brand"
            disabled={!selectedId || loading || preparing}
            onClick={() => void insert()}
          >
            {preparing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {preparing ? 'Preparing slide' : 'Insert slide'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
