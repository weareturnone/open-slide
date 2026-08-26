// A compact deterministic identity for one authored JSX element. This is not
// a security token; it prevents a stale browser location from mutating the
// next element that moved into the same line/column after an earlier edit.
export function targetFingerprint(source: string, start: number, end: number): string {
  const value = source.slice(start, end);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}
