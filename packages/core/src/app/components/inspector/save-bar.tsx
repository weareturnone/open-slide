import config from 'virtual:open-slide/config';
import { useState } from 'react';
import { toast } from 'sonner';
import { useHistory } from '@/components/history-provider';
import { SaveCard } from '@/components/panel/save-card';
import { useDesignPanelState } from '@/components/style-panel/design-provider';
import {
  deployedStudioUrl,
  fetchHostedVersion,
  publishHostedDraft,
  waitForHostedDeployment,
} from '@/lib/hosted-deployment';
import { format, plural, useLocale } from '@/lib/use-locale';
import { useInspector } from './inspector-provider';

export function SaveBar() {
  const insp = useInspector();
  const design = useDesignPanelState();
  const history = useHistory();
  const t = useLocale();
  const [deploying, setDeploying] = useState(false);

  const inspectorCount = insp.pendingCount;
  const designCount = design.dirty ? 1 : 0;
  const total = inspectorCount + designCount;

  const dirty = total > 0;
  const committing = insp.committing || design.committing || deploying;

  const onSave = async () => {
    const tasks: Promise<void>[] = [];
    if (inspectorCount > 0) tasks.push(Promise.resolve(insp.commitEdits()));
    if (designCount > 0) tasks.push(Promise.resolve(design.commit()));
    // Each provider surfaces its own errors via toast; swallow here so
    // one failure doesn't reject the combined save.
    await Promise.all(tasks).catch(() => {});
    const publishConfig = config.authoring?.publish;
    if (!publishConfig || import.meta.env.DEV) return;
    setDeploying(true);
    try {
      const version = await fetchHostedVersion(publishConfig.statusEndpoint);
      if (!version.hasDraftChanges) return;
      const targetSha = await publishHostedDraft(publishConfig, version.draftSha);
      toast.success('Saved to GitHub. Deploying now.');
      await waitForHostedDeployment(publishConfig.statusEndpoint, targetSha);
      window.location.replace(deployedStudioUrl(window.location.href, targetSha).toString());
    } catch (error) {
      toast.error(String((error as Error).message ?? error));
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
      committing={committing}
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
