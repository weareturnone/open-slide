import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { plural, useLocale } from '@/lib/use-locale';
import { ThemeDetail } from '../components/themes/theme-detail';
import { ThemesGallery } from '../components/themes/themes-gallery';
import { themes as themeRegistry } from '../lib/themes';

export function ThemesGalleryPage() {
  const navigate = useNavigate();
  const t = useLocale();
  useEffect(() => {
    document.title = `${t.themes.title} · Turn.One Studio`;
  }, [t.themes.title]);
  return (
    <>
      <header className="-mx-5 mb-1 border-b border-hairline px-5 pb-6 md:-mx-8 md:px-8 lg:-mx-14 lg:px-14 lg:pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-[52px] font-medium leading-[0.95] tracking-[-0.05em] lg:text-[76px]">
            {t.themes.title}
          </h1>
          <span className="font-mono text-[13px] uppercase tracking-[0.06em] text-muted-foreground self-end pb-2">
            {themeRegistry.length.toString().padStart(2, '0')}{' '}
            {plural(themeRegistry.length, t.studio.systemUnits)}
          </span>
        </div>
      </header>
      <ThemesGallery onOpen={(id) => navigate(`/themes/${encodeURIComponent(id)}`)} />
    </>
  );
}

export function ThemeDetailPage() {
  const { themeId } = useParams<{ themeId: string }>();
  const navigate = useNavigate();
  if (!themeId) return null;
  return <ThemeDetail themeId={themeId} onBack={() => navigate('/themes')} />;
}
