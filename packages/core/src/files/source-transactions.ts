import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type SourceTransactionUpdate<T> = {
  source: string;
  value: T;
};

export type SourceTransactionResult<T> = {
  changed: boolean;
  value: T;
};

const fileQueues = new Map<string, Promise<void>>();

async function inFileQueue<T>(file: string, run: () => Promise<T>): Promise<T> {
  const previous = fileQueues.get(file) ?? Promise.resolve();
  let release = () => {};
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => {}).then(() => turn);
  fileQueues.set(file, tail);
  await previous.catch(() => {});
  try {
    return await run();
  } finally {
    release();
    if (fileQueues.get(file) === tail) fileQueues.delete(file);
  }
}

async function openExclusiveTemporary(file: string, mode: number) {
  const directory = path.dirname(file);
  const basename = path.basename(file);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const temporary = path.join(
      directory,
      `.${basename}.open-slide-tmp-${process.pid}-${randomUUID()}`,
    );
    try {
      const handle = await fs.open(temporary, 'wx', mode);
      return { handle, temporary };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`Could not reserve an atomic replacement for ${file}`);
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch {
    // Some platforms do not permit fsync on directories. The file itself was
    // already synced before rename, so this is a durability enhancement only.
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function atomicReplace(file: string, source: string, mode: number): Promise<void> {
  const { handle, temporary } = await openExclusiveTemporary(file, mode);
  let ownsTemporary = true;
  let open = true;
  try {
    await handle.writeFile(source, 'utf8');
    await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    open = false;
    await fs.rename(temporary, file);
    ownsTemporary = false;
    await syncDirectory(path.dirname(file));
  } finally {
    if (open) await handle.close().catch(() => {});
    if (ownsTemporary) await fs.unlink(temporary).catch(() => {});
  }
}

export async function transactSourceFile<T>(
  filePath: string,
  transform: (source: string) => SourceTransactionUpdate<T> | Promise<SourceTransactionUpdate<T>>,
): Promise<SourceTransactionResult<T>> {
  const canonicalPath = await fs.realpath(filePath);
  return inFileQueue(canonicalPath, async () => {
    const [source, stat] = await Promise.all([
      fs.readFile(canonicalPath, 'utf8'),
      fs.stat(canonicalPath),
    ]);
    const update = await transform(source);
    const changed = update.source !== source;
    if (changed) await atomicReplace(canonicalPath, update.source, stat.mode & 0o7777);
    return { changed, value: update.value };
  });
}
