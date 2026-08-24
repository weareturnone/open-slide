import config from 'virtual:open-slide/config';
import { useState } from 'react';
import { toast } from 'sonner';
import { useHistory } from '@/components/history-provider';
import { useHostedOperation } from '@/components/hosted-operation-provider';
import { SaveCard } from '@/components/panel/save-card';
import { useDesignPanelState } from '@/components/style-panel/design-provider';
import { authoringReadOnly } from '@/lib/authoring';
import { fetchHostedVersion, publishHostedDraft } from '@/lib/hosted-deployment';
import { format, plural, useLocale } from '@/lib/use-locale';
import { useInspector } from './inspector-provider';

export function SaveBar() {
  const insp = useInspector();
  const design = useDesignPanelState();
  const history = useHistory();
  const t = useLocale();
  const [deploying, setDeploying] = useState(false);
  const { runDeployment, structuralLocked } = useHostedOperation();

  const inspectorCount = insp.pendingCount;
  const designCount = design.dirty ? 1 : 0;
  const total = inspectorCount + designCount;

  const dirty = total > 0;
  const committing = insp.committing || design.committing || deploying;

  const onSave = async () => {
    const publishConfig = config.authoring?.publish;
    if (!publishConfig || import.meta.env.DEV) {
      const tasks: Promise<void>[] = [];
      if (inspectorCount > 0) tasks.push(Promise.resolve(insp.commitEdits()));
      if (designCount > 0) tasks.push(Promise.resolve(design.commit()));
      try {
        await Promise.all(tasks);
      } catch {
        return false;
      }
      return true;
    }
    setDeploying(true);
    try {
      const deployed = await runDeployment({
        label: 'Save edits',
        action: async () => {
          const tasks: Promise<void>[] = [];
          if (inspectorCount > 0) tasks.push(Promise.resolve(insp.commitEdits()));
          if (designCount > 0) tasks.push(Promise.resolve(design.commit()));
          await Promise.all(tasks);
          const version = await fetchHostedVersion(publishConfig.statusEndpoint);
          const targetSha = version.hasDraftChanges
            ? await publishHostedDraft(publishConfig, version.draftSha)
            : version.mainSha;
          return { targetSha, result: null };
        },
        destination: () => window.location.href,
      });
      const url = new URL(window.location.href);
      url.searchParams.set('studioVersion', deployed.targetSha.slice(0, 12));
      window.location.replace(url.toString());
      return true;
    } catch (error) {
      toast.error(String((error as Error).message ?? error));
      return false;
    } finally {
      setDeploying(false);
    }
  };

  const onDiscard = () => {
    if (inspectorCount > 0) insp.cancelEdits();
    if (designCount > 0) design.discard();
  };

  return (
    <SaveCard
      uiAttr="inspector"
      dirty={dirty}
      committing={committing || structuralLocked || authoringReadOnly}
      onSave={onSave}
      onDiscard={onDiscard}
      unsavedLabel={format(plural(total, t.inspector.unsavedChanges), { count: total })}
      onUndo={history.undo}
      onRedo={history.redo}
      canUndo={history.canUndo}
      canRedo={history.canRedo}
    />
  );
}
