import config from 'virtual:open-slide/config';
import { useHistory } from '@/components/history-provider';
import { useHostedOperation } from '@/components/hosted-operation-provider';
import { SaveCard } from '@/components/panel/save-card';
import { useDesignPanelState } from '@/components/style-panel/design-provider';
import { authoringReadOnly } from '@/lib/authoring';
import { format, plural, useLocale } from '@/lib/use-locale';
import { useInspector } from './inspector-provider';

export function SaveBar() {
  const insp = useInspector();
  const design = useDesignPanelState();
  const history = useHistory();
  const t = useLocale();
  const { structuralLocked } = useHostedOperation();

  const inspectorCount = insp.pendingCount;
  const designCount = design.dirty ? 1 : 0;
  const total = inspectorCount + designCount;

  const dirty = total > 0;
  const committing = insp.committing || design.committing;
  const hostedDraftSave = Boolean(config.authoring?.publish && !import.meta.env.DEV);

  const onSave = async () => {
    const tasks: Promise<void>[] = [];
    if (inspectorCount > 0) tasks.push(Promise.resolve(insp.commitEdits()));
    if (designCount > 0) tasks.push(Promise.resolve(design.commit()));
    try {
      await Promise.all(tasks);
      return !insp.hasPendingEdits();
    } catch {
      return false;
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
      disabled={structuralLocked || authoringReadOnly}
      disabledReason={
        structuralLocked
          ? 'Publishing is in progress. Editing will return when the live version is ready.'
          : authoringReadOnly
            ? 'Read-only preview'
            : undefined
      }
      onSave={onSave}
      onDiscard={onDiscard}
      unsavedLabel={format(plural(total, t.inspector.unsavedChanges), { count: total })}
      savedLabel={hostedDraftSave ? 'Saved to draft' : undefined}
      onUndo={history.undo}
      onRedo={history.redo}
      canUndo={history.canUndo}
      canRedo={history.canRedo}
    />
  );
}
