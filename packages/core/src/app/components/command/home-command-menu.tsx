import { FileText, Folder, Image as ImageIcon, Palette } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authoringEnabled } from '@/lib/authoring';
import { useLocale } from '@/lib/use-locale';
import { useSlideTitles } from '@/lib/use-slide-titles';
import type { Folder as FolderData } from '../../lib/sdk';
import { documentIds, loadDocument, slideIds, slideThemes } from '../../lib/slides';
import { themes } from '../../lib/themes';
import { FolderIconChip } from '../sidebar/folder-item';
import { ALL_SLIDES_ID, ASSETS_ID, DOCUMENTS_ID, DRAFT_ID, THEMES_ID } from '../sidebar/sidebar';
import { type CommandGroupSpec, CommandMenu, type CommandSpec } from './command-menu';

export function HomeCommandMenu({
  open,
  onOpenChange,
  folders,
  titleMap,
  onSelectView,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: FolderData[];
  titleMap: Record<string, string>;
  onSelectView: (id: string) => void;
}) {
  const t = useLocale();
  const navigate = useNavigate();
  const loadedTitles = useSlideTitles(open);
  const [documentTitles, setDocumentTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all(
      documentIds.map(async (id) => {
        try {
          const document = await loadDocument(id);
          return [id, document.meta?.title ?? id];
        } catch {
          return [id, id];
        }
      }),
    ).then((entries) => {
      if (!cancelled) setDocumentTitles(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const groups = useMemo<CommandGroupSpec[]>(() => {
    const slides: CommandSpec[] = slideIds.map((id, index) => ({
      id: `slide-${id}`,
      label: titleMap[id] ?? loadedTitles[id] ?? id,
      icon: (
        <span className="w-5 shrink-0 font-mono text-[10px] text-muted-foreground">
          {String(index + 1).padStart(2, '0')}
        </span>
      ),
      detail: themes.find((theme) => theme.id === slideThemes[id])?.name ?? slideThemes[id],
      keywords: [id],
      run: () => navigate(`/s/${id}`),
    }));

    const folderItems: CommandSpec[] = [
      {
        id: `view-${ALL_SLIDES_ID}`,
        label: t.home.slides,
        icon: <span className="w-5 font-mono text-[10px]">01</span>,
        keywords: ['all', 'slides'],
        run: () => onSelectView(ALL_SLIDES_ID),
      },
      {
        id: `view-${DRAFT_ID}`,
        label: t.home.draft,
        icon: <Folder />,
        keywords: ['draft', 'unsorted'],
        run: () => onSelectView(DRAFT_ID),
      },
      ...folders.map((folder) => ({
        id: `view-${folder.id}`,
        label: folder.name,
        icon: <FolderIconChip icon={folder.icon} />,
        keywords: ['folder', folder.id],
        run: () => onSelectView(folder.id),
      })),
    ];

    const documents: CommandSpec[] = documentIds.map((id) => ({
      id: `document-${id}`,
      label: documentTitles[id] ?? id,
      icon: <FileText />,
      detail: 'A4',
      keywords: [id, 'document'],
      run: () => navigate(`/d/${id}`),
    }));
    const navigation: CommandSpec[] = [
      {
        id: `view-${DOCUMENTS_ID}`,
        label: t.studio.documents,
        icon: <FileText />,
        keywords: ['documents', 'a4'],
        run: () => onSelectView(DOCUMENTS_ID),
      },
      {
        id: `view-${THEMES_ID}`,
        label: t.home.themes,
        icon: <Palette />,
        keywords: ['themes', 'design'],
        run: () => onSelectView(THEMES_ID),
      },
    ];
    if (authoringEnabled) {
      navigation.push({
        id: `view-${ASSETS_ID}`,
        label: t.home.assets,
        icon: <ImageIcon />,
        keywords: ['assets', 'images', 'files'],
        run: () => onSelectView(ASSETS_ID),
      });
    }

    return [
      { id: 'slides', heading: t.commandMenu.groupSlides, items: slides },
      { id: 'documents', heading: t.studio.documents, items: documents },
      { id: 'folders', heading: t.commandMenu.groupFolders, items: folderItems },
      { id: 'navigation', heading: t.commandMenu.groupNavigation, items: navigation },
    ];
  }, [t, folders, titleMap, loadedTitles, documentTitles, navigate, onSelectView]);

  return (
    <CommandMenu
      open={open}
      onOpenChange={onOpenChange}
      groups={groups}
      placeholder={t.commandMenu.placeholder}
    />
  );
}
