import config from 'virtual:open-slide/config';
import { CloudUpload, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useHostedOperation } from '@/components/hosted-operation-provider';
import { Button } from '@/components/ui/button';
import {
  AUTHORING_CHANGED_EVENT,
  type AuthoringChangedDetail,
  authoringReadOnly,
} from '@/lib/authoring';
import {
  fetchHostedVersion,
  type HostedVersionState,
  publishHostedDraft,
} from '@/lib/hosted-deployment';

const publishConfig = config.authoring?.publish;

export function HostedPublishButton({
  disabledReason,
  localDraftState,
}: {
  disabledReason?: string | null;
  localDraftState?: 'unsaved' | 'saving' | null;
} = {}) {
  const [version, setVersion] = useState<HostedVersionState | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [previewingDraft, setPreviewingDraft] = useState(false);
  const mounted = useRef(true);
  const refreshSequence = useRef(0);
  const { runDeployment, structuralLocked } = useHostedOperation();

  const refresh = useCallback(async () => {
    if (!publishConfig || import.meta.env.DEV) return null;
    const sequence = ++refreshSequence.current;
    try {
      const next = await fetchHostedVersion(publishConfig.statusEndpoint);
      if (mounted.current && sequence === refreshSequence.current) {
        setVersion(next);
        setStatusUnavailable(false);
      }
      return next;
    } catch (error) {
      if (mounted.current && sequence === refreshSequence.current) setStatusUnavailable(true);
      throw error;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh().catch(() => {});
    const onAuthoringChanged = (event: Event) => {
      const detail = (event as CustomEvent<AuthoringChangedDetail>).detail;
      if (detail?.previewingDraft) setPreviewingDraft(true);
      if (detail?.version) {
        refreshSequence.current++;
        setVersion(detail.version);
        setStatusUnavailable(false);
      } else {
        refresh().catch(() => {});
      }
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
      const deployed = await runDeployment({
        label: 'Publish saved draft',
        action: async () => {
          const current = await refresh();
          if (!current) throw new Error('Studio could not check the saved draft.');
          return {
            targetSha: current.hasDraftChanges
              ? await publishHostedDraft(publishConfig, current.draftSha)
              : current.mainSha,
            result: null,
          };
        },
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

  const status = publishing
    ? 'publishing'
    : localDraftState === 'saving'
      ? 'saving-draft'
      : localDraftState === 'unsaved'
        ? 'unsaved'
        : statusUnavailable
          ? 'unavailable'
          : !version
            ? 'checking'
            : version.hasDraftChanges
              ? previewingDraft
                ? 'draft-preview'
                : 'draft-production'
              : version.deployedSha !== version.mainSha
                ? 'deployment-pending'
                : 'live';
  const statusCopy = {
    publishing: {
      label: 'Publishing',
      title: 'Studio is publishing the saved draft to production.',
    },
    'saving-draft': {
      label: 'Saving draft',
      title: 'Studio is saving the changes from this tab to the private draft.',
    },
    unsaved: {
      label: 'Unsaved changes · only in this tab',
      title: 'Save or discard these changes before publishing.',
    },
    unavailable: {
      label: 'Status unavailable',
      title: 'Studio could not check the repository state.',
    },
    checking: {
      label: 'Checking',
      title: 'Studio is checking whether this page matches the published source.',
    },
    'draft-preview': {
      label: 'Draft saved · previewing in this tab',
      title: 'This tab previews the saved draft. Production has not changed.',
    },
    'draft-production': {
      label: 'Draft saved · showing production',
      title: 'GitHub contains unpublished changes. This page still shows production.',
    },
    'deployment-pending': {
      label: 'Production update pending · showing previous live version',
      title: 'GitHub is published, but this page is still served by the previous deployment.',
    },
    live: {
      label: 'Live',
      title: 'This page matches the published Studio source.',
    },
  } as const;
  const disabledExplanation =
    disabledReason ??
    (statusUnavailable
      ? 'Studio could not check the saved draft. Retry status before publishing.'
      : version?.hasDraftChanges
        ? undefined
        : 'No unpublished draft changes');

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="max-w-44 truncate whitespace-nowrap text-[11px] text-muted-foreground sm:max-w-none"
        role="status"
        aria-live="polite"
        title={statusCopy[status].title}
      >
        {statusCopy[status].label}
      </span>
      {statusUnavailable && (
        <Button size="sm" variant="ghost" onClick={() => void refresh().catch(() => {})}>
          Retry status
        </Button>
      )}
      <fieldset
        className="m-0 border-0 p-0"
        tabIndex={disabledExplanation ? 0 : undefined}
        aria-label={disabledExplanation ?? 'Publish all saved draft changes to production'}
      >
        <Button
          size="sm"
          variant="outline"
          disabled={
            !version?.hasDraftChanges ||
            publishing ||
            structuralLocked ||
            statusUnavailable ||
            authoringReadOnly ||
            Boolean(disabledReason)
          }
          onClick={() => void publish()}
          title={disabledExplanation ?? 'Publish all saved draft changes to production'}
        >
          {publishing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <CloudUpload className="size-3.5" />
          )}
          {publishing ? 'Publishing' : 'Publish all'}
        </Button>
      </fieldset>
    </div>
  );
}
