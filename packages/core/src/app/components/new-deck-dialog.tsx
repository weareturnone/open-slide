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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  deployedStudioUrl,
  publishHostedDraft,
  waitForHostedDeployment,
} from '@/lib/hosted-deployment';
import type { ContentKind } from '@/lib/sdk';

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
  const [title, setTitle] = useState('');
  const [deckId, setDeckId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open || !catalogConfig) return;
    const endpoint = import.meta.env.DEV ? '/__catalog' : catalogConfig.listEndpoint;
    fetch(`${endpoint}?kind=${kind}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Catalog request failed with ${response.status}`);
        const body = (await response.json()) as { entries?: CatalogEntry[] };
        const next = body.entries ?? [];
        setEntries(next);
        setTemplateId((current) => current || next[0]?.id || '');
      })
      .catch((error) => toast.error(String((error as Error).message ?? error)));
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
        toast.success(`${kind === 'document' ? 'Document' : 'Deck'} created.`);
        setCreating(false);
        onClose();
        window.location.assign(`/${kind === 'document' ? 'd' : 's'}/${encodeURIComponent(deckId)}`);
        return;
      }
      if (!created.commitSha || !publishConfig) {
        throw new Error('Create response did not include a commit');
      }
      const targetSha = await publishHostedDraft(publishConfig, created.commitSha);
      toast.success(`${kind === 'document' ? 'Document' : 'Deck'} created. Deploying now.`);
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New {kind === 'document' ? 'document' : 'deck'}</DialogTitle>
          <DialogDescription>
            Create a repository-backed {kind === 'document' ? 'document' : 'deck'} from a Turn.One
            layout.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label htmlFor="new-deck-title" className="block space-y-1.5 text-sm">
            <span className="font-medium">Title</span>
            <Input
              id="new-deck-title"
              value={title}
              maxLength={120}
              disabled={creating}
              onChange={(event) => {
                const next = event.target.value;
                setTitle(next);
                if (!idTouched) setDeckId(slugify(next));
              }}
              placeholder="Project proposal"
            />
          </label>
          <label htmlFor="new-deck-id" className="block space-y-1.5 text-sm">
            <span className="font-medium">{kind === 'document' ? 'Document' : 'Deck'} ID</span>
            <Input
              id="new-deck-id"
              value={deckId}
              maxLength={64}
              disabled={creating}
              onChange={(event) => {
                setIdTouched(true);
                setDeckId(slugify(event.target.value));
              }}
              placeholder="project-proposal"
            />
          </label>
          <div className="block space-y-1.5 text-sm">
            <span className="font-medium">Starting layout</span>
            <Select
              items={Object.fromEntries(entries.map((entry) => [entry.id, entry.name]))}
              value={templateId}
              onValueChange={(value) => setTemplateId(value ?? '')}
              disabled={creating}
            >
              <SelectTrigger aria-label="Starting layout" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {entries.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {creating ? 'Close' : 'Cancel'}
          </Button>
          <Button
            variant="brand"
            disabled={!title.trim() || deckId.length < 3 || !templateId || creating}
            onClick={() => void create()}
          >
            {creating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {creating
              ? `Creating ${kind === 'document' ? 'document' : 'deck'}`
              : `Create ${kind === 'document' ? 'document' : 'deck'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
