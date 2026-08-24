import { cn } from '@/lib/utils';

export type CatalogPreviewDescriptor = {
  kind?: string;
  variant?: 'cover' | 'content' | 'decision';
  background?: string;
  accent?: string;
};

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
  if (entry.preview?.kind !== 'dual-logo') {
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

  const variant = entry.preview.variant ?? 'cover';
  const background = entry.preview.background ?? '#F9FAF8';
  const accent = entry.preview.accent ?? '#F54E00';
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative block aspect-video overflow-hidden rounded-md border border-[#E6E5E0]',
        className,
      )}
      style={{ background }}
    >
      <span className="absolute left-[7%] top-[10%] flex h-[10%] items-center gap-[5px]">
        <span className="h-[5px] w-[28px] bg-[#26251E]" />
        <span className="h-full w-px bg-[#D9D5CF]" />
        <span className="grid h-[10px] w-[24px] place-items-center border border-dashed border-[#9A9891] text-[3px] font-semibold text-[#6E6D68]">
          CLIENT
        </span>
      </span>
      {variant === 'cover' ? (
        <>
          <span className="absolute bottom-[35%] left-[7%] h-[7px] w-[68%] bg-[#26251E]" />
          <span className="absolute bottom-[26%] left-[7%] h-[5px] w-[52%] bg-[#26251E]" />
          <span className="absolute bottom-[17%] left-[7%] h-[3px] w-[42%] bg-[#6E6D68]" />
        </>
      ) : variant === 'content' ? (
        <>
          <span className="absolute left-[7%] top-[31%] h-[5px] w-[58%] bg-[#26251E]" />
          <span className="absolute left-[7%] top-[39%] h-[5px] w-[46%] bg-[#26251E]" />
          <span
            className="absolute bottom-[17%] left-[7%] h-[31%] w-[39%] border-t-2"
            style={{ borderColor: accent }}
          />
          <span className="absolute bottom-[17%] right-[7%] h-[31%] w-[39%] border-t-2 border-[#26251E]" />
        </>
      ) : (
        <>
          <span className="absolute left-[7%] top-[34%] h-[6px] w-[62%] bg-[#26251E]" />
          <span className="absolute left-[7%] top-[44%] h-[6px] w-[48%] bg-[#26251E]" />
          <span className="absolute bottom-[18%] left-[7%] right-[7%] h-[23%] border border-[#D9D5CF] bg-white" />
          <span
            className="absolute bottom-[18%] left-[7%] h-[23%] w-[2px]"
            style={{ background: accent }}
          />
        </>
      )}
    </span>
  );
}
