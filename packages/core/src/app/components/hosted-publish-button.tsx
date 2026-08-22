import config from 'virtual:open-slide/config';
import { CloudUpload, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AUTHORING_CHANGED_EVENT } from '@/lib/authoring';
import {
  deployedStudioUrl,
  fetchHostedVersion,
  type HostedVersionState,
  publishHostedDraft,
  waitForHostedDeployment,
} from '@/lib/hosted-deployment';

const publishConfig = config.authoring?.publish;

export function HostedPublishButton() {
  const [version, setVersion] = useState<HostedVersionState | null>(null);
  const [publishing, setPublishing] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!publishConfig || import.meta.env.DEV) return null;
    const next = await fetchHostedVersion(publishConfig.statusEndpoint);
    if (mounted.current) setVersion(next);
    return next;
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh().catch(() => {});
    const onAuthoringChanged = () => {
      refresh().catch(() => {});
    };
    window.addEventListener(AUTHORING_CHANGED_EVENT, onAuthoringChanged);
    return () => {
      mounted.current = false;
      window.removeEventListener(AUTHORING_CHANGED_EVENT, onAuthoringChanged);
    };
  }, [refresh]);

  if (!publishConfig || import.meta.env.DEV) return null;

  const publish = async () => {
    if (!version?.hasDraftChanges || publishing) return;
    setPublishing(true);
    try {
      const current = await refresh();
      if (!current?.hasDraftChanges) {
        setPublishing(false);
        return;
      }
      const targetSha = await publishHostedDraft(publishConfig, current.draftSha);
      toast.success('Published. Waiting for deployment.');
      await waitForHostedDeployment(publishConfig.statusEndpoint, targetSha);
      toast.success('Published and deployed');
      window.location.replace(deployedStudioUrl(window.location.href, targetSha).toString());
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
