import { useEffect, useState } from 'react';
import { format, useLocale } from '@/lib/use-locale';
import { SlidePageProvider } from '../../lib/page-context';
import { loadThemeDemo, type Theme, type ThemeDemoModule, themes } from '../../lib/themes';
import { SlideCanvas } from '../slide-canvas';

export function ThemesGallery({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useLocale();

  if (themes.length === 0) {
    return <ThemesEmptyState />;
  }

  return (
    <ul className="divide-y divide-hairline">
      {themes.map((theme, index) => (
        <li key={theme.id}>
          <ThemeCard
            theme={theme}
            index={index}
            onOpen={() => onOpen(theme.id)}
            ariaLabel={format(t.themes.openThemeAria, { name: theme.name })}
          />
        </li>
      ))}
    </ul>
  );
}

function ThemeCard({
  theme,
  index,
  onOpen,
  ariaLabel,
}: {
  theme: Theme;
  index: number;
  onOpen: () => void;
  ariaLabel: string;
}) {
  const t = useLocale();
  const mode =
    theme.mode === 'light' ? t.common.light : theme.mode === 'dark' ? t.common.dark : theme.mode;
  const paletteSection = theme.body.match(/## Palette\s*\n([\s\S]*?)(?=\n## |$)/i)?.[1] ?? '';
  const palette = Array.from(
    paletteSection.matchAll(/^\|\s*([^|]+?)\s*\|\s*`?(#[\da-f]{6})`?\s*\|/gim),
  ).map((match) => ({ role: match[1].trim(), color: match[2] }));
  const primaryRoles = new Set(['bg', 'text', 'accent', 'cyan', 'navy', 'system', 'transition']);
  const swatches = palette.filter((entry) => primaryRoles.has(entry.role)).slice(0, 5);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={ariaLabel}
      className="group grid w-full items-start gap-5 py-7 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[minmax(180px,32%)_1fr] lg:gap-8 xl:grid-cols-[320px_1fr_auto]"
    >
      <div className="relative aspect-video w-full overflow-hidden border border-border bg-card transition-colors group-hover:border-foreground/50">
        <ThemePreview theme={theme} />
      </div>
      <div className="min-w-0 space-y-2.5 pt-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {String(index + 1).padStart(2, '0')}
          {mode && ` · ${mode}`}
        </p>
        <h3 className="font-heading text-[30px] font-medium leading-[1.1] tracking-[-0.035em]">
          {theme.name}
        </h3>
        {theme.description && (
          <p className="max-w-[440px] text-[14px] leading-5 text-muted-foreground">
            {theme.description}
          </p>
        )}
      </div>
      {swatches.length > 0 && (
        <div className="space-y-2 pt-1 md:col-start-2 xl:col-start-auto">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {t.studio.palette}
          </span>
          <div className="flex">
            {swatches.map(({ role, color }) => (
              <span
                key={role}
                role="img"
                title={`${role}: ${color}`}
                aria-label={`${role}: ${color}`}
                className="size-7 border border-foreground/10"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      )}
    </button>
  );
}

function ThemePreview({ theme }: { theme: Theme }) {
  const t = useLocale();
  const demo = useThemeDemo(theme);

  if (!theme.hasDemo) {
    return <NoDemoState />;
  }
  if (!demo) {
    return (
      <div className="grid h-full w-full place-items-center text-[10px] tracking-[0.08em] uppercase text-muted-foreground/60">
        {t.common.loading}
      </div>
    );
  }
  const FirstPage = demo.default[0];
  if (!FirstPage) return <NoDemoState />;

  return (
    <div className="h-full w-full">
      <SlideCanvas flat freezeMotion design={demo.design}>
        <SlidePageProvider index={0} total={demo.default.length}>
          <FirstPage />
        </SlidePageProvider>
      </SlideCanvas>
    </div>
  );
}

function NoDemoState() {
  const t = useLocale();
  return (
    <div className="grid h-full w-full place-items-center bg-muted/40 px-6 text-center">
      <div>
        <p className="font-heading text-[12px] font-semibold tracking-tight text-foreground/80">
          {t.themes.noDemoYet}
        </p>
        <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
          {t.themes.noDemoHintPrefix}
          <code className="rounded-[3px] bg-card px-1 py-0.5 font-mono text-[10px] text-foreground">
            /create-theme
          </code>
          {t.themes.noDemoHintSuffix}
        </p>
      </div>
    </div>
  );
}

function ThemesEmptyState() {
  const t = useLocale();
  return (
    <div className="rounded-[10px] border border-dashed border-border bg-card/60 px-8 py-20">
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <div className="text-2xl">🎨</div>
        <p className="mt-3 font-heading text-[15px] font-semibold tracking-tight">
          {t.themes.noThemesTitle}
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          {t.themes.noThemesHintPrefix}
          <code className="rounded-[4px] bg-muted px-1.5 py-0.5 font-mono text-[11.5px] text-foreground">
            /create-theme
          </code>
          {t.themes.noThemesHintSuffix}
        </p>
      </div>
    </div>
  );
}

function useThemeDemo(theme: Theme): ThemeDemoModule | null {
  const [demo, setDemo] = useState<ThemeDemoModule | null>(null);
  useEffect(() => {
    if (!theme.hasDemo) {
      setDemo(null);
      return;
    }
    let cancelled = false;
    loadThemeDemo(theme.id)
      .then((mod) => {
        if (!cancelled) setDemo(mod);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [theme.id, theme.hasDemo]);
  return demo;
}
