import config from 'virtual:open-slide/config';
import { useLocale } from '@/lib/use-locale';

export function AppBrand() {
  const t = useLocale();
  const logo = config.branding?.logo;
  const appName = config.branding?.appName?.trim() || t.home.appTitle;

  return (
    <h1 className="flex min-w-0 items-center gap-2 font-heading text-lg font-bold tracking-tight">
      {logo && (
        <img
          src={logo.src}
          alt={logo.alt ?? ''}
          width={24}
          height={24}
          className="size-6 shrink-0 rounded-[4px]"
        />
      )}
      <span className="truncate">{appName}</span>
    </h1>
  );
}
