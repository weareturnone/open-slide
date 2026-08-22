import config from 'virtual:open-slide/config';
import { CloudUpload, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

type VersionState = {
  draftSha: string;
  mainSha: string;
  deployedSha?: string;
  hasDraftChanges: boolean;
};

const publishConfig = config.authoring?.publish;

export function HostedPublishButton() {
  const [version, setVersion] = useState<VersionState | null>(null);
  const [publishing, setPublishing] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!publishConfig || import.meta.env.DEV) return null;
    const response = await fetch(publishConfig.statusEndpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Status request failed with ${response.status}`);
    const next = (await response.json()) as VersionState;
    setVersion(next);
    return next;
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [refresh]);

  if (!publishConfig || import.meta.env.DEV) return null;

  const waitForDeployment = () => {
    const poll = async () => {
      try {
        const next = await refresh();
        if (next?.deployedSha && next.deployedSha === next.mainSha) {
          setPublishing(false);
          toast.success('Published and deployed');
          window.location.reload();
          return;
        }
      } catch {
        // A deployment switch can briefly interrupt the old function.
      }
      pollTimer.current = setTimeout(poll, 3000);
    };
    pollTimer.current = setTimeout(poll, 3000);
  };

  const publish = async () => {
    if (!version?.hasDraftChanges || publishing) return;
    setPublishing(true);
    try {
      const response = await fetch(publishConfig.publishEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedDraftHead: version.draftSha }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Publish failed with ${response.status}`);
      toast.success('Published. Waiting for deployment.');
      waitForDeployment();
    } catch (error) {
      setPublishing(false);
      toast.error(String((error as Error).message ?? error));
      refresh().catch(() => {});
    }
  };

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={!version?.hasDraftChanges || publishing}
      onClick={() => void publish()}
      title={version?.hasDraftChanges ? 'Publish draft to main' : 'No unpublished draft changes'}
    >
      {publishing ? <Loader2 className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}
      {publishing ? 'Deploying' : 'Publish'}
    </Button>
  );
}
