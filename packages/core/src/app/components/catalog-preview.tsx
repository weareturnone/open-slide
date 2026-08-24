import { cn } from '@/lib/utils';
import { type CatalogPreviewDescriptor, isTrustedCoBrandPreview } from './catalog-preview-data';

export type { CatalogPreviewDescriptor } from './catalog-preview-data';

export type CatalogPreviewEntry = {
  id: string;
  name: string;
  description: string;
  category: string;
  accent: string;
  preview?: CatalogPreviewDescriptor;
};

export function CatalogPreview({
  entry,
  document = false,
  className,
}: {
  entry: CatalogPreviewEntry;
  document?: boolean;
  className?: string;
}) {
  if (!isTrustedCoBrandPreview(entry.preview)) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'grid place-items-center rounded-md border border-white/10 bg-[#0d0f64] text-center text-lg font-semibold text-white',
          document ? 'mx-auto max-h-52 w-full' : 'aspect-video',
          className,
        )}
        style={{
          boxShadow: `inset 0 -5px 0 ${entry.accent}`,
          ...(document ? { aspectRatio: '794 / 1123' } : {}),
        }}
      >
        {entry.name}
      </span>
    );
  }

  const { variant, background, text, muted, border, accent } = entry.preview;
  return (
    <span
      aria-hidden="true"
      className={cn('relative block aspect-video overflow-hidden rounded-md border', className)}
      style={{ background, borderColor: border }}
    >
      <span className="absolute left-[7%] top-[10%] flex h-[10%] items-center gap-[5px]">
        <span className="h-[5px] w-[28px]" style={{ background: text }} />
        <span className="h-full w-px bg-[#D9D5CF]" />
        <span
          className="grid h-[10px] w-[24px] place-items-center border border-dashed text-[3px] font-semibold"
          style={{ borderColor: muted, color: muted }}
        >
          CLIENT
        </span>
      </span>
      {variant === 'cover' ? (
        <>
          <span
            className="absolute bottom-[35%] left-[7%] h-[7px] w-[68%]"
            style={{ background: text }}
          />
          <span
            className="absolute bottom-[26%] left-[7%] h-[5px] w-[52%]"
            style={{ background: text }}
          />
          <span
            className="absolute bottom-[17%] left-[7%] h-[3px] w-[42%]"
            style={{ background: muted }}
          />
        </>
      ) : variant === 'content' ? (
        <>
          <span
            className="absolute left-[7%] top-[31%] h-[5px] w-[58%]"
            style={{ background: text }}
          />
          <span
            className="absolute left-[7%] top-[39%] h-[5px] w-[46%]"
            style={{ background: text }}
          />
          <span
            className="absolute bottom-[17%] left-[7%] h-[31%] w-[39%] border-t-2"
            style={{ borderColor: accent }}
          />
          <span
            className="absolute bottom-[17%] right-[7%] h-[31%] w-[39%] border-t-2"
            style={{ borderColor: text }}
          />
        </>
      ) : (
        <>
          <span
            className="absolute left-[7%] top-[34%] h-[6px] w-[62%]"
            style={{ background: text }}
          />
          <span
            className="absolute left-[7%] top-[44%] h-[6px] w-[48%]"
            style={{ background: text }}
          />
          <span
            className="absolute bottom-[18%] left-[7%] right-[7%] h-[23%] border bg-white"
            style={{ borderColor: border }}
          />
          <span
            className="absolute bottom-[18%] left-[7%] h-[23%] w-[2px]"
            style={{ background: accent }}
          />
        </>
      )}
    </span>
  );
}
