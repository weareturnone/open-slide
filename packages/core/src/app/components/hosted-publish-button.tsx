import config from 'virtual:open-slide/config';
import { CloudUpload, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useHostedOperation } from '@/components/hosted-operation-provider';
import { Button } from '@/components/ui/button';
import { AUTHORING_CHANGED_EVENT, authoringReadOnly } from '@/lib/authoring';
import {
  fetchHostedVersion,
  type HostedVersionState,
  publishHostedDraft,
} from '@/lib/hosted-deployment';

const publishConfig = config.authoring?.publish;

export function HostedPublishButton({ disabledReason }: { disabledReason?: string | null } = {}) {
  const [version, setVersion] = useState<HostedVersionState | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const mounted = useRef(true);
  const { runDeployment, structuralLocked } = useHostedOperation();

  const refresh = useCallback(async () => {
    if (!publishConfig || import.meta.env.DEV) return null;
    try {
      const next = await fetchHostedVersion(publishConfig.statusEndpoint);
      if (mounted.current) {
        setVersion(next);
        setStatusUnavailable(false);
      }
      return next;
    } catch (error) {
      if (mounted.current) setStatusUnavailable(true);
      throw error;
    }
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
      const deployed = await runDeployment({
        label: 'Publish saved draft',
        action: async () => ({
          targetSha: await publishHostedDraft(publishConfig, current.draftSha),
          result: null,
        }),
        destination: () => window.location.href,
      });
      toast.success('Published and deployed');
      const url = new URL(window.location.href);
      url.searchParams.set('studioVersion', deployed.targetSha.slice(0, 12));
      window.location.replace(url.toString());
    } catch (error) {
      setPublishing(false);
      toast.error(String((error as Error).message ?? error));
      refresh().catch(() => {});
    }
  };

  const statusLabel = publishing
    ? 'Publishing'
    : statusUnavailable
      ? 'Status unavailable'
      : !version
        ? 'Checking'
        : version.hasDraftChanges
          ? 'Draft saved · showing production'
          : 'Live';
  const statusTitle = statusUnavailable
    ? 'Studio could not check the repository state.'
    : version?.hasDraftChanges
      ? 'GitHub contains unpublished changes. This page still shows production.'
      : 'This page matches the published Studio source.';

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="hidden whitespace-nowrap text-[11px] text-muted-foreground lg:inline"
        role="status"
        aria-live="polite"
        title={statusTitle}
      >
        {statusLabel}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={
          !version?.hasDraftChanges ||
          publishing ||
          structuralLocked ||
          authoringReadOnly ||
          Boolean(disabledReason)
        }
        onClick={() => void publish()}
        title={
          disabledReason ??
          (version?.hasDraftChanges
            ? 'Publish all saved draft changes to production'
            : 'No unpublished draft changes')
        }
      >
        {publishing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <CloudUpload className="size-3.5" />
        )}
        {publishing ? 'Deploying' : 'Publish all'}
      </Button>
    </div>
  );
}
