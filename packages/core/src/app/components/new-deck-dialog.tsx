import config from 'virtual:open-slide/config';
import { Loader2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  deployedStudioUrl,
  publishHostedDraft,
  waitForHostedDeployment,
} from '@/lib/hosted-deployment';
import type { ContentKind } from '@/lib/sdk';
import { useLocale } from '@/lib/use-locale';
import { cn } from '@/lib/utils';

type CatalogEntry = { id: string; name: string; description: string };

const catalogConfig = config.authoring?.catalog;
const deckConfig = config.authoring?.decks;
const publishConfig = config.authoring?.publish;

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function NewDeckDialog({
  open,
  onClose,
  kind = 'slide',
}: {
  open: boolean;
  onClose: () => void;
  kind?: ContentKind;
}) {
  const t = useLocale();
  const [title, setTitle] = useState('');
  const [deckId, setDeckId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !catalogConfig) return;
    let cancelled = false;
    setLoading(true);
    const endpoint = import.meta.env.DEV ? '/__catalog' : catalogConfig.listEndpoint;
    fetch(`${endpoint}?kind=${kind}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Catalog request failed with ${response.status}`);
        const body = (await response.json()) as { entries?: CatalogEntry[] };
        if (cancelled) return;
        const next = body.entries ?? [];
        setEntries(next);
        setTemplateId((current) =>
          next.some((entry) => entry.id === current) ? current : (next[0]?.id ?? ''),
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setEntries([]);
        setTemplateId('');
        toast.error(String((error as Error).message ?? error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, kind]);

  if (!deckConfig || !catalogConfig || (!import.meta.env.DEV && !publishConfig)) return null;

  const create = async () => {
    if (!title.trim() || !deckId || !templateId || creating) return;
    setCreating(true);
    try {
      const endpoint = import.meta.env.DEV ? '/__decks' : deckConfig.createEndpoint;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), deckId, templateId, kind }),
      });
      const created = (await response.json().catch(() => ({}))) as {
        error?: string;
        commitSha?: string;
      };
      if (!response.ok) throw new Error(created.error ?? `Create failed with ${response.status}`);
      if (import.meta.env.DEV) {
        toast.success(kind === 'document' ? t.studio.documentCreated : t.studio.deckCreated);
        setCreating(false);
        onClose();
        window.location.assign(`/${kind === 'document' ? 'd' : 's'}/${encodeURIComponent(deckId)}`);
        return;
      }
      if (!created.commitSha || !publishConfig) {
        throw new Error('Create response did not include a commit');
      }
      const targetSha = await publishHostedDraft(publishConfig, created.commitSha);
      toast.success(kind === 'document' ? t.studio.documentDeploying : t.studio.deckDeploying);
      setCreating(false);
      onClose();
      await waitForHostedDeployment(publishConfig.statusEndpoint, targetSha);
      const url = deployedStudioUrl(
        `/${kind === 'document' ? 'd' : 's'}/${encodeURIComponent(deckId)}`,
        targetSha,
      );
      window.location.assign(url.toString());
    } catch (error) {
      toast.error(String((error as Error).message ?? error));
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-y-auto p-0 sm:max-w-[600px]">
        <DialogHeader className="border-b border-hairline px-6 pt-7 pb-6 sm:px-8">
          <span className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <span className="size-1.5 bg-brand" />
            {kind === 'document' ? t.studio.newDocument : t.studio.newDeck}
          </span>
          <DialogTitle className="font-heading text-[32px] font-medium tracking-[-0.04em]">
            {kind === 'document' ? t.studio.startDocument : t.studio.startDeck}
          </DialogTitle>
          <DialogDescription>{t.studio.layoutDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 px-6 pt-6 sm:grid-cols-2 sm:px-8">
          <label htmlFor="new-deck-title" className="block space-y-2 text-sm">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {t.studio.title}
            </span>
            <Input
              id="new-deck-title"
              className="h-11 rounded-[2px] bg-card text-[15px]"
              value={title}
              maxLength={120}
              disabled={creating}
              onChange={(event) => {
                const next = event.target.value;
                setTitle(next);
                if (!idTouched) setDeckId(slugify(next));
              }}
              placeholder={t.studio.projectProposal}
            />
          </label>
          <label htmlFor="new-deck-id" className="block space-y-2 text-sm">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {kind === 'document' ? t.studio.documentId : t.studio.deckId}
            </span>
            <div className="flex h-11 items-center border border-input bg-card">
              <span className="shrink-0 pl-3 font-mono text-[12px] text-muted-foreground">
                {kind === 'document' ? 'documents/' : 'slides/'}
              </span>
              <Input
                id="new-deck-id"
                className="h-full min-w-0 rounded-none border-0 bg-transparent pl-1 font-mono text-[13px]"
                value={deckId}
                maxLength={64}
                disabled={creating}
                onChange={(event) => {
                  setIdTouched(true);
                  setDeckId(slugify(event.target.value));
                }}
                placeholder="project-proposal"
              />
            </div>
          </label>
        </div>
        <fieldset disabled={creating} className="min-w-0 px-6 pt-6 pb-7 sm:px-8">
          <legend className="float-left mb-3 flex w-full items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            {t.studio.startingLayout} <span>{String(entries.length).padStart(2, '0')}</span>
          </legend>
          {loading ? (
            <p className="clear-both py-8 text-sm text-muted-foreground">
              {t.studio.loadingLayouts}
            </p>
          ) : (
            <div className="clear-both grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
              {entries.map((entry) => (
                <label key={entry.id} className="group relative cursor-pointer">
                  <input
                    type="radio"
                    name="starting-layout"
                    value={entry.id}
                    checked={templateId === entry.id}
                    onChange={() => setTemplateId(entry.id)}
                    className="peer sr-only"
                  />
                  <div
                    className={cn(
                      'aspect-video overflow-hidden border border-border bg-card peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2',
                      templateId === entry.id
                        ? 'border-brand ring-1 ring-brand'
                        : 'group-hover:border-foreground/50',
                    )}
                  >
                    <CatalogLayoutPreview id={entry.id} />
                  </div>
                  <span className="mt-1.5 block text-[11px] leading-4">{entry.name}</span>
                </label>
              ))}
            </div>
          )}
          {!loading && entries.length === 0 && (
            <p className="clear-both py-4 text-sm text-muted-foreground">{t.studio.noLayouts}</p>
          )}
          {entries.find((entry) => entry.id === templateId)?.description && (
            <p className="mt-4 text-[12px] leading-5 text-muted-foreground">
              {entries.find((entry) => entry.id === templateId)?.description}
            </p>
          )}
        </fieldset>
        <DialogFooter className="border-t border-hairline px-6 py-4 sm:px-8">
          {!import.meta.env.DEV && (
            <span className="mr-auto self-center font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {t.studio.publishesImmediately}
            </span>
          )}
          <Button variant="ghost" onClick={onClose}>
            {creating ? t.common.close : t.common.cancel}
          </Button>
          <Button
            variant="brand"
            disabled={!title.trim() || deckId.length < 3 || !templateId || creating || loading}
            onClick={() => void create()}
          >
            {creating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {creating
              ? kind === 'document'
                ? t.studio.creatingDocument
                : t.studio.creatingDeck
              : kind === 'document'
                ? t.studio.createDocument
                : t.studio.createDeck}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CatalogLayoutPreview({ id }: { id: string }) {
  const columns =
    id === 'three-points' ? 3 : id === 'two-column' || id === 'document-proposal' ? 2 : 1;
  if (id === 'key-number')
    return (
      <div
        aria-hidden
        className="flex h-full items-center px-[10%] font-heading text-[clamp(24px,4vw,40px)] font-medium text-foreground"
      >
        42%
      </div>
    );
  if (id === 'process')
    return (
      <div aria-hidden className="flex h-full items-center gap-[6%] px-[10%]">
        <span className="size-2 shrink-0 bg-brand" />
        <span className="h-px flex-1 bg-border" />
        <span className="size-2 shrink-0 border border-foreground" />
        <span className="h-px flex-1 bg-border" />
        <span className="size-2 shrink-0 border border-foreground" />
      </div>
    );
  if (id === 'closing')
    return (
      <div aria-hidden className="flex h-full flex-col justify-between bg-foreground p-[9%]">
        <span className="h-1 w-3/4 bg-background" />
        <span className="h-3 w-1/3 bg-brand" />
      </div>
    );
  if (columns > 1)
    return (
      <div aria-hidden className="flex h-full flex-col gap-[12%] p-[9%]">
        <span className="h-1 w-1/2 bg-foreground" />
        <div
          className="grid flex-1 gap-[8%]"
          style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
        >
          {['first', 'second', 'third'].slice(0, columns).map((column) => (
            <span key={column} className="bg-muted" />
          ))}
        </div>
      </div>
    );
  return (
    <div
      aria-hidden
      className={cn(
        'flex h-full flex-col gap-[9%] p-[9%]',
        id === 'statement' ? 'justify-end' : 'justify-center',
      )}
    >
      {id === 'quote' && <span className="font-heading text-xl leading-none text-brand">“</span>}
      <span className="h-[7%] min-h-1 w-3/4 bg-foreground" />
      <span
        className={cn(
          'h-[7%] min-h-1 w-3/5',
          id === 'statement' || id === 'quote' ? 'bg-foreground' : 'bg-border',
        )}
      />
      {id.startsWith('document-') && (
        <>
          <span className="mt-1 h-px w-full bg-border" />
          <span className="h-px w-full bg-border" />
          <span className="h-px w-3/4 bg-border" />
        </>
      )}
    </div>
  );
}
