/**
 * Node implementation of the `@tauri-apps/plugin-fs` surface the Processor's
 * loaders use.
 *
 * The CLI aliases `@tauri-apps/plugin-fs` to this module at bundle time (see
 * `vite.cli.config.ts`). That lets `instrument-loader.ts` and
 * `parsers/biorad-folder.ts` run unmodified in Node — no second ingest path,
 * no `#ifdef`-style branching inside shipped source, and no risk of the CLI
 * reading instrument files differently from the app.
 *
 * Only the functions those modules actually call are implemented.
 */
import { readFile as nodeReadFile, readdir, stat, writeFile as nodeWriteFile } from 'node:fs/promises';

export async function readFile(path: string): Promise<Uint8Array> {
  const buf = await nodeReadFile(path);
  // Copy into a standalone ArrayBuffer: Node pools small Buffers into a shared
  // one, and the parsers read `bytes.buffer` directly — an unsliced view would
  // hand them unrelated neighbouring data.
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

export async function readTextFile(path: string): Promise<string> {
  return nodeReadFile(path, 'utf-8');
}

export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

export async function readDir(path: string): Promise<DirEntry[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.map((e) => ({
    name: e.name,
    isFile: e.isFile(),
    isDirectory: e.isDirectory(),
    isSymlink: e.isSymbolicLink(),
  }));
}

export async function writeFile(path: string, data: Uint8Array): Promise<void> {
  await nodeWriteFile(path, data);
}

export async function writeTextFile(path: string, contents: string): Promise<void> {
  await nodeWriteFile(path, contents, 'utf-8');
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
