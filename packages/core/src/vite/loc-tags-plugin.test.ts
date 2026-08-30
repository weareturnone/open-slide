import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectLocTags, locTagsPlugin } from './loc-tags-plugin.ts';

const pluginTransformSource = 'export default [() => <div />];';

type LocTagsTransformResult = null | { code: string; map: null };

function transformWithLocTags(id: string) {
  // Force `path.resolve` to return a POSIX slidesRoot so this suite
  // exercises the same code path regardless of host OS.
  const resolveSpy = vi.spyOn(path, 'resolve').mockReturnValue('/repo/slides');
  try {
    const plugin = locTagsPlugin({ userCwd: '/repo' });
    const transform = plugin.transform;
    if (typeof transform !== 'function') throw new Error('expected transform function');
    return transform.call({} as never, pluginTransformSource, id) as LocTagsTransformResult;
  } finally {
    resolveSpy.mockRestore();
  }
}

function expectTaggedTransform(id: string) {
  const out = transformWithLocTags(id);
  if (out === null) throw new Error('expected tagged transform result');
  expect(out.code).toContain('data-slide-loc');
}

describe('injectLocTags', () => {
  it('adds data-slide-loc to host elements with the JSX start position', () => {
    const src = ['export default [() => (', '  <div>hello</div>', ')];', ''].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform');
    expect(out).toMatch(/<div data-slide-loc="2:2" data-slide-target="[0-9a-f]{16}">hello<\/div>/);
  });

  it('adds a content-relative source module when one is supplied', () => {
    const src = ['export default [() => (', '  <div>hello</div>', ')];', ''].join('\n');
    const out = injectLocTags(src, 'slides/cover/index.tsx');
    if (out === null) throw new Error('expected transform');
    expect(out).toMatch(
      /<div data-slide-loc="2:2" data-slide-target="[0-9a-f]{16}" data-slide-source="slides\/cover\/index.tsx">hello<\/div>/,
    );
  });

  it('tags separate component callsites without using render order', () => {
    const src = [
      'const Shared = () => <span>shared</span>;',
      'const Page = () => (',
      '  <div>',
      '    <Shared />',
      '    <Shared />',
      '  </div>',
      ');',
      'export default [Page];',
      '',
    ].join('\n');
    const out = injectLocTags(src, 'slides/repeated/index.tsx');
    if (out === null) throw new Error('expected transform');
    const callsites = Array.from(out.matchAll(/<Shared[^>]*data-slide-callsite="([^"]+)"/g)).map(
      (match) => match[1],
    );
    expect(callsites).toEqual(['slides/repeated/index.tsx#4:4', 'slides/repeated/index.tsx#5:4']);
  });

  it('records every level of a nested component call path', () => {
    const src = [
      'const Leaf = () => <span>leaf</span>;',
      'const Middle = () => <Leaf />;',
      'const Page = () => <Middle />;',
      'export default [Page];',
      '',
    ].join('\n');
    const out = injectLocTags(src, 'slides/nested/components.tsx');
    if (out === null) throw new Error('expected transform');
    expect(out).toContain('<Leaf data-slide-callsite="slides/nested/components.tsx#2:21" />');
    expect(out).toContain('<Middle data-slide-callsite="slides/nested/components.tsx#3:19" />');
  });

  it('preserves authored ids and explicit provenance attributes', () => {
    const src = [
      'const Card = () => <div />;',
      'export default [() => (',
      '  <main id="page-root" data-slide-source="authored/module.tsx">',
      '    <Card data-slide-callsite="authored-callsite" />',
      '  </main>',
      ')];',
      '',
    ].join('\n');
    const out = injectLocTags(src, 'slides/explicit/index.tsx');
    if (out === null) throw new Error('expected transform');
    expect(out).toContain('id="page-root" data-slide-source="authored/module.tsx"');
    expect(out).toContain('<Card data-slide-callsite="authored-callsite" />');
    expect(out.match(/data-slide-source="authored\/module.tsx"/g)).toHaveLength(1);
    expect(out.match(/data-slide-callsite="authored-callsite"/g)).toHaveLength(1);
  });

  it('skips capitalized component invocations', () => {
    const src = ['export default [() => (', '  <MyComp>hi</MyComp>', ')];', ''].join('\n');
    const out = injectLocTags(src);
    expect(out).toBeNull();
  });

  it('tags every host element including nested ones', () => {
    const src = [
      'export default [() => (',
      '  <div>',
      '    <h1>Hi</h1>',
      '    <p>World</p>',
      '  </div>',
      ')];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform');
    expect(out).toMatch(/<div data-slide-loc="2:2" data-slide-target="[0-9a-f]{16}">/);
    expect(out).toMatch(/<h1 data-slide-loc="3:4" data-slide-target="[0-9a-f]{16}">Hi<\/h1>/);
    expect(out).toMatch(/<p data-slide-loc="4:4" data-slide-target="[0-9a-f]{16}">World<\/p>/);
  });

  it('preserves an existing data-slide-loc while adding a target fingerprint', () => {
    const src = [
      'export default [() => (',
      '  <div data-slide-loc="2:2">already</div>',
      ')];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected fingerprint transform');
    expect(out).toMatch(
      /<div data-slide-target="[0-9a-f]{16}" data-slide-loc="2:2">already<\/div>/,
    );
  });

  it('inserts after the tag name, before any other attributes', () => {
    const src = ['export default [() => (', '  <div className="foo">x</div>', ')];', ''].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform');
    expect(out).toMatch(
      /<div data-slide-loc="2:2" data-slide-target="[0-9a-f]{16}" className="foo">x<\/div>/,
    );
  });

  it('handles self-closing host elements', () => {
    const src = ['export default [() => (', '  <img src="x" />', ')];', ''].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform');
    expect(out).toMatch(/<img data-slide-loc="2:2" data-slide-target="[0-9a-f]{16}" src="x" \/>/);
  });

  it('returns null when source has no host elements', () => {
    const src = 'const x = 1;';
    expect(injectLocTags(src)).toBeNull();
  });

  it('tags only host elements, leaving custom components untouched', () => {
    const src = [
      'export default [() => (',
      '  <Layout>',
      '    <h1>Title</h1>',
      '    <SubBox><span>nested</span></SubBox>',
      '  </Layout>',
      ')];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform');
    expect(out).toMatch(/<h1 data-slide-loc="3:4" data-slide-target="[0-9a-f]{16}">Title<\/h1>/);
    expect(out).toMatch(
      /<span data-slide-loc="4:12" data-slide-target="[0-9a-f]{16}">nested<\/span>/,
    );
    expect(out).not.toContain('<Layout data-slide-loc');
    expect(out).not.toContain('<SubBox data-slide-loc');
  });

  it('tags <ImagePlaceholder> as a forwarding component', () => {
    const src = ['export default [() => (', '  <ImagePlaceholder hint="hero" />', ')];', ''].join(
      '\n',
    );
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform');
    expect(out).toMatch(
      /<ImagePlaceholder data-slide-loc="2:2" data-slide-target="[0-9a-f]{16}" hint="hero" \/>/,
    );
  });

  it('does not tag other PascalCase components alongside ImagePlaceholder', () => {
    const src = [
      'export default [() => (',
      '  <Layout>',
      '    <ImagePlaceholder hint="hero" />',
      '    <CustomThing />',
      '  </Layout>',
      ')];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform');
    expect(out).toContain('<ImagePlaceholder data-slide-loc="3:4"');
    expect(out).not.toContain('<Layout data-slide-loc');
    expect(out).not.toContain('<CustomThing data-slide-loc');
  });

  it('tags a local component that forwards rest props to a host element', () => {
    const src = [
      "import type { CSSProperties } from 'react';",
      "type Props = { src: string; style?: CSSProperties; 'data-slide-loc'?: string };",
      'const SharedImage = ({ src, style, ...imageProps }: Props) => (',
      "  <img src={src} {...imageProps} style={{ objectFit: 'cover', ...style }} />",
      ');',
      'export default [() => <SharedImage src="hero.png" />];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform');
    expect(out).toMatch(
      /<SharedImage data-slide-loc="6:22" data-slide-target="[0-9a-f]{16}" src="hero.png" \/>/,
    );
  });

  it('tags a local component that forwards style directly', () => {
    const src = [
      "type Props = React.ImgHTMLAttributes<HTMLImageElement> & { 'data-slide-loc'?: string };",
      'const SharedImage = ({ style, ...imageProps }: Props) => (',
      '  <img style={style} {...imageProps} />',
      ');',
      'export default [() => <SharedImage />];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform');
    expect(out).toMatch(/<SharedImage data-slide-loc="5:22" data-slide-target="[0-9a-f]{16}" \/>/);
  });

  it('tags a local component with defaulted props and a defaulted style binding', () => {
    const src = [
      "type Props = React.ImgHTMLAttributes<HTMLImageElement> & { 'data-slide-loc'?: string };",
      'const SharedImage = ({ style = {}, ...imageProps }: Props = {}) => (',
      '  <img {...imageProps} style={{ objectFit: "cover", ...style }} />',
      ');',
      'export default [() => <SharedImage />];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform');
    expect(out).toMatch(/<SharedImage data-slide-loc="5:22" data-slide-target="[0-9a-f]{16}" \/>/);
  });

  it('does not tag a local component that does not forward its rest props', () => {
    const src = [
      'const SharedImage = ({ src, ...unused }: { src: string }) => <img src={src} />;',
      'export default [() => <SharedImage src="hero.png" />];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    expect(out ?? src).not.toContain('<SharedImage data-slide-loc');
  });

  it('does not tag a component that forwards location props but drops style', () => {
    const src = [
      "type Props = { style?: React.CSSProperties; 'data-slide-loc'?: string };",
      'const SharedImage = ({ style, ...imageProps }: Props) => <img {...imageProps} />;',
      'export default [() => <SharedImage />];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform for the host image');
    expect(out).not.toContain('<SharedImage data-slide-loc');
  });

  it('does not tag a component that forwards one location to multiple host elements', () => {
    const src = [
      'const ImagePair = (props: React.ImgHTMLAttributes<HTMLImageElement>) => (',
      '  <><img {...props} /><img {...props} /></>',
      ');',
      'export default [() => <ImagePair />];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform for the host images');
    expect(out).not.toContain('<ImagePair data-slide-loc');
  });

  it('does not tag a component when a later style overrides forwarded crop styles', () => {
    const src = [
      'const SharedImage = ({ ...imageProps }: React.ImgHTMLAttributes<HTMLImageElement>) => (',
      '  <img {...imageProps} style={{ width: 100 }} />',
      ');',
      'export default [() => <SharedImage />];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform for the host image');
    expect(out).not.toContain('<SharedImage data-slide-loc');
  });

  it('does not tag a component when forwarded props also fan out through a child', () => {
    const src = [
      'const Child = (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />;',
      'const Parent = ({ ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (',
      '  <><img {...props} /><Child {...props} /></>',
      ');',
      'export default [() => <Parent />];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform for the host images');
    expect(out).not.toContain('<Parent data-slide-loc');
  });

  it('does not tag a component when a later spread can override forwarded edit props', () => {
    const src = [
      'const SharedImage = ({ defaults, ...imageProps }: React.ImgHTMLAttributes<HTMLImageElement> & { defaults: React.ImgHTMLAttributes<HTMLImageElement> }) => (',
      '  <img {...imageProps} {...defaults} />',
      ');',
      'export default [() => <SharedImage defaults={{}} />];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform for the host image');
    expect(out).not.toContain('<SharedImage data-slide-loc');
  });

  it('does not tag a component when a fixed location overrides the forwarded location', () => {
    const src = [
      'const SharedImage = ({ ...imageProps }: React.ImgHTMLAttributes<HTMLImageElement>) => (',
      '  <img {...imageProps} data-slide-loc="fixed" />',
      ');',
      'export default [() => <SharedImage />];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    expect(out ?? src).not.toContain('<SharedImage data-slide-loc');
  });

  it('does not tag a component that removes the location prop from its rest props', () => {
    const src = [
      "type Props = React.ImgHTMLAttributes<HTMLImageElement> & { 'data-slide-loc'?: string };",
      "const SharedImage = ({ 'data-slide-loc': ignored, ...imageProps }: Props) => (",
      '  <img {...imageProps} />',
      ');',
      'export default [() => <SharedImage />];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform for the host image');
    expect(out).not.toContain('<SharedImage data-slide-loc');
  });

  it('does not tag a component that forwards edit props from a map callback', () => {
    const src = [
      'const Parent = ({ items, ...imageProps }: { items: string[] } & React.ImgHTMLAttributes<HTMLImageElement>) => (',
      '  items.map((item) => <img key={item} {...imageProps} />)',
      ');',
      'export default [() => <Parent items={["a", "b"]} />];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform for the host image');
    expect(out).not.toContain('<Parent data-slide-loc');
  });

  it('does not tag a component that forwards edit props through a nested component', () => {
    const src = [
      'const Parent = ({ ...imageProps }: React.ImgHTMLAttributes<HTMLImageElement>) => {',
      '  const Inner = () => <img {...imageProps} />;',
      '  return <><Inner /><Inner /></>;',
      '};',
      'export default [() => <Parent />];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform for the host image');
    expect(out).not.toContain('<Parent data-slide-loc');
  });

  it('does not merge forwarding safety across shadowed component names', () => {
    const src = [
      'const PageA = () => {',
      '  const Shared = ({ style, ...imageProps }: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...imageProps} style={{ ...style }} />;',
      '  return <Shared />;',
      '};',
      'const PageB = () => {',
      '  const Shared = ({ style, ...imageProps }: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...imageProps} />;',
      '  return <Shared />;',
      '};',
      'export default [PageA, PageB];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform for the host images');
    expect(out).not.toContain('<Shared data-slide-loc');
  });

  it('does not trust an unsafe local component that shadows ImagePlaceholder', () => {
    const src = [
      'const ImagePlaceholder = ({ ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => <><img {...props} /><img {...props} /></>;',
      'export default [() => <ImagePlaceholder />];',
      '',
    ].join('\n');
    const out = injectLocTags(src);
    if (out === null) throw new Error('expected transform for the host images');
    expect(out).not.toContain('<ImagePlaceholder data-slide-loc');
  });
});

describe('locTagsPlugin', () => {
  it('tags slide index files', () => {
    expectTaggedTransform('/repo/slides/cover/index.tsx');
  });

  it('tags shared slide source files', () => {
    expectTaggedTransform('/repo/slides/cover/shared.tsx');
  });

  it('tags numbered slide source files', () => {
    expectTaggedTransform('/repo/slides/cover/01-Cover.tsx');
  });

  it('tags slide source files in nested folders', () => {
    expectTaggedTransform('/repo/slides/cover/components/Card.tsx');
  });

  it('uses a checkout-independent module id for slide source', () => {
    const out = transformWithLocTags('/repo/slides/cover/components/Card.tsx');
    if (out === null) throw new Error('expected tagged transform result');
    expect(out.code).toContain('data-slide-source="slides/cover/components/Card.tsx"');
  });

  it('uses the documents namespace for document source', () => {
    const resolveSpy = vi.spyOn(path, 'resolve').mockImplementation((_cwd, dir) => {
      return dir === 'documents' ? '/repo/documents' : '/repo/slides';
    });
    try {
      const plugin = locTagsPlugin({ userCwd: '/repo' });
      const transform = plugin.transform;
      if (typeof transform !== 'function') throw new Error('expected transform function');
      const out = transform.call(
        {} as never,
        pluginTransformSource,
        '/repo/documents/report/index.tsx',
      ) as LocTagsTransformResult;
      if (out === null) throw new Error('expected tagged transform result');
      expect(out.code).toContain('data-slide-source="documents/report/index.tsx"');
    } finally {
      resolveSpy.mockRestore();
    }
  });

  it('skips tsx files directly under the slides directory', () => {
    expect(transformWithLocTags('/repo/slides/index.tsx')).toBeNull();
  });

  it('skips tsx files outside the slides directory', () => {
    expect(transformWithLocTags('/repo/apps/demo/foo.tsx')).toBeNull();
  });

  it('skips colocated test files', () => {
    expect(transformWithLocTags('/repo/slides/cover/index.test.tsx')).toBeNull();
  });
});

describe('locTagsPlugin on Windows-style paths', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function transformWithMockedResolve(resolvedSlidesRoot: string, id: string) {
    vi.spyOn(path, 'resolve').mockReturnValue(resolvedSlidesRoot);
    const plugin = locTagsPlugin({ userCwd: 'C:\\repo' });
    const transform = plugin.transform;
    if (typeof transform !== 'function') throw new Error('expected transform function');
    return transform.call({} as never, pluginTransformSource, id) as LocTagsTransformResult;
  }

  function expectTagged(resolvedSlidesRoot: string, id: string) {
    const out = transformWithMockedResolve(resolvedSlidesRoot, id);
    if (out === null) throw new Error(`expected tagged transform result for ${id}`);
    expect(out.code).toContain('data-slide-loc');
  }

  it('tags slide index files with forward-slash ids under a Windows slidesRoot', () => {
    expectTagged('C:\\repo\\slides', 'C:/repo/slides/cover/index.tsx');
  });

  it('strips HMR ?t= query before matching', () => {
    const out = transformWithMockedResolve(
      'C:\\repo\\slides',
      'C:/repo/slides/cover/index.tsx?t=1700000000000',
    );
    if (out === null) throw new Error('expected tagged transform result');
    expect(out.code).toContain('data-slide-source="slides/cover/index.tsx"');
  });

  it('tags nested slide source files under a Windows slidesRoot', () => {
    expectTagged('C:\\repo\\slides', 'C:/repo/slides/cover/components/Card.tsx');
  });

  it('skips tsx files directly under the Windows slides directory', () => {
    expect(transformWithMockedResolve('C:\\repo\\slides', 'C:/repo/slides/index.tsx')).toBeNull();
  });

  it('skips tsx files outside the Windows slides directory', () => {
    expect(transformWithMockedResolve('C:\\repo\\slides', 'C:/repo/apps/demo/foo.tsx')).toBeNull();
  });

  it('skips colocated test files under a Windows slidesRoot', () => {
    expect(
      transformWithMockedResolve('C:\\repo\\slides', 'C:/repo/slides/cover/index.test.tsx'),
    ).toBeNull();
  });

  it('still tags POSIX ids when path.resolve returns a POSIX slidesRoot (regression guard)', () => {
    expectTagged('/repo/slides', '/repo/slides/cover/index.tsx');
  });
});
