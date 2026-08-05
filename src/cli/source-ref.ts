/**
 * Resolve confidential/shared source references without putting machine paths
 * in a figure spec or emitted bundle.
 *
 * A shareable figure folder carries `source/source.json`, which names an
 * opaque reference and the expected content hash. The real path lives only in
 * a machine-local map selected by `SHARPPLOT_SOURCE_MAP` (or the default user
 * config location). This keeps the canonical spec reproducible without
 * leaking a username, customer folder, or synchronized-storage path.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { CliError } from './util';

interface PublicSourceEntry {
  id: string;
  role?: string;
  sha256?: string;
  sha256_tree?: string;
  recorded?: string;
  why_not_copied?: string;
}

interface PublicSourceManifest {
  version: number;
  files: PublicSourceEntry[];
}

export interface ResolvedInputPath {
  /** Absolute path used only inside this process. Never serialize it. */
  absolutePath: string;
  /** Privacy-safe provenance label suitable for an emitted bundle. */
  label: string;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new CliError(`${label} is not valid JSON: ${(e as Error).message}`);
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Specs archived one level below the figure root still share its manifest. */
async function findPublicManifest(baseDir: string): Promise<string | null> {
  let dir = path.resolve(baseDir);
  for (let depth = 0; depth < 5; depth++) {
    const candidate = path.join(dir, 'source', 'source.json');
    if (await exists(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function assertPublicManifest(value: unknown, label: string): PublicSourceManifest {
  if (!value || typeof value !== 'object') throw new CliError(`${label} must be a JSON object.`);
  const manifest = value as Partial<PublicSourceManifest>;
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) {
    throw new CliError(`${label} must contain { "version": 1, "files": [...] }.`);
  }
  for (const raw of manifest.files) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id.trim()) {
      throw new CliError(`${label} has a source entry without a non-empty "id".`);
    }
    const keys = Object.keys(raw as unknown as Record<string, unknown>);
    if (keys.some((key) => /^(?:path|absolute_path|source_path)$/i.test(key))) {
      throw new CliError(
        `${label} entry "${raw.id}" contains a private path. ` +
        'Public source manifests may contain only an opaque id, role, checksum, date, and reason.',
      );
    }
    if (!raw.sha256 && !raw.sha256_tree) {
      throw new CliError(`${label} entry "${raw.id}" needs "sha256" (file) or "sha256_tree" (folder).`);
    }
    for (const [name, digest] of [['sha256', raw.sha256], ['sha256_tree', raw.sha256_tree]] as const) {
      if (digest && !/^[0-9a-f]{64}$/i.test(digest)) {
        throw new CliError(`${label} entry "${raw.id}" has an invalid ${name} digest.`);
      }
    }
  }
  return manifest as PublicSourceManifest;
}

function defaultSourceMapPath(): string {
  const appData = process.env.APPDATA;
  return process.platform === 'win32' && appData
    ? path.join(appData, 'sharpplot', 'sources.json')
    : path.join(homedir(), '.config', 'sharpplot', 'sources.json');
}

async function readPrivateSourceMap(): Promise<{ mapPath: string; sources: Record<string, string> }> {
  const mapPath = path.resolve(process.env.SHARPPLOT_SOURCE_MAP ?? defaultSourceMapPath());
  let raw: unknown;
  try {
    raw = parseJson(await readFile(mapPath, 'utf-8'), 'The private sharpplot source map');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError(
        'This figure uses a confidential source reference, but no private source map is configured.\n' +
        'Set SHARPPLOT_SOURCE_MAP to a private JSON file containing ' +
        '{ "version": 1, "sources": { "source-id": "real local path" } }.',
      );
    }
    throw e;
  }
  if (!raw || typeof raw !== 'object') throw new CliError('The private sharpplot source map must be a JSON object.');
  const body = raw as { version?: unknown; sources?: unknown };
  if (body.version !== 1 || !body.sources || typeof body.sources !== 'object' || Array.isArray(body.sources)) {
    throw new CliError('The private sharpplot source map must contain { "version": 1, "sources": { ... } }.');
  }
  const sources: Record<string, string> = {};
  for (const [id, value] of Object.entries(body.sources as Record<string, unknown>)) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new CliError(`Private source map entry "${id}" must be a non-empty path string.`);
    }
    sources[id] = value;
  }
  return { mapPath, sources };
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function directoryFiles(root: string, current = root): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      throw new CliError('Confidential source folders may not contain symbolic links; archive the real files instead.');
    }
    if (info.isDirectory()) out.push(...await directoryFiles(root, absolute));
    else if (info.isFile()) out.push(absolute);
  }
  return out;
}

/** Stable tree hash: relative POSIX path + NUL + file bytes + NUL, sorted. */
async function hashDirectory(directory: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update('sharpplot-tree-v1\0');
  for (const file of await directoryFiles(directory)) {
    hash.update(path.relative(directory, file).split(path.sep).join('/'));
    hash.update('\0');
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Digest form to copy into public source/source.json, without echoing a path. */
export async function sourceHash(inputPath: string): Promise<{
  kind: 'file' | 'folder';
  field: 'sha256' | 'sha256_tree';
  digest: string;
}> {
  const absolute = path.resolve(inputPath);
  const info = await stat(absolute).catch(() => null);
  if (!info) throw new CliError('Cannot hash the requested source because it does not exist.');
  if (info.isDirectory()) {
    return { kind: 'folder', field: 'sha256_tree', digest: await hashDirectory(absolute) };
  }
  if (!info.isFile()) throw new CliError('The requested source is neither a regular file nor a folder.');
  return { kind: 'file', field: 'sha256', digest: await hashFile(absolute) };
}

async function verifyHash(entry: PublicSourceEntry, absolutePath: string): Promise<void> {
  const info = await stat(absolutePath).catch(() => null);
  if (!info) throw new CliError(`The private source map entry for "${entry.id}" does not exist on this machine.`);
  const expected = info.isDirectory() ? entry.sha256_tree : entry.sha256;
  if (!expected) {
    throw new CliError(
      `Public source entry "${entry.id}" needs ${info.isDirectory() ? 'sha256_tree' : 'sha256'} ` +
      `for the mapped ${info.isDirectory() ? 'folder' : 'file'}.`,
    );
  }
  const actual = info.isDirectory() ? await hashDirectory(absolutePath) : await hashFile(absolutePath);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new CliError(
      `Confidential source "${entry.id}" has changed since this figure recorded it.\n` +
      `Expected ${expected.toLowerCase()} but found ${actual.toLowerCase()}. ` +
      'Do not render until the source is reconciled.',
    );
  }
}

const referenceCache = new Map<string, Promise<ResolvedInputPath>>();

async function resolveReference(baseDir: string, reference: string): Promise<ResolvedInputPath> {
  const manifestPath = await findPublicManifest(baseDir);
  if (!manifestPath) {
    throw new CliError(
      `Source reference "${reference}" needs source/source.json in the figure folder. ` +
      'The public manifest must name the reference and its checksum without a machine path.',
    );
  }
  const manifest = assertPublicManifest(
    parseJson(await readFile(manifestPath, 'utf-8'), 'source/source.json'),
    'source/source.json',
  );
  const entry = manifest.files.find((item) => item.id === reference);
  if (!entry) {
    throw new CliError(
      `source/source.json has no entry "${reference}". Known references: ` +
      `${manifest.files.map((item) => item.id).join(', ') || '(none)'}.`,
    );
  }
  const { mapPath, sources } = await readPrivateSourceMap();
  const mapped = sources[reference];
  if (!mapped) throw new CliError(`The private sharpplot source map has no entry "${reference}".`);
  const absolutePath = path.isAbsolute(mapped) ? mapped : path.resolve(path.dirname(mapPath), mapped);
  await verifyHash(entry, absolutePath);
  return { absolutePath, label: `sourceRef:${reference}` };
}

/** Resolve either a normal path or an opaque confidential-source reference. */
export async function resolveInputPath(
  baseDir: string,
  directPath: string | null | undefined,
  reference: string | null | undefined,
  description: string,
): Promise<ResolvedInputPath> {
  if (directPath && reference) {
    throw new CliError(`${description} declares both a path and a source reference; use exactly one.`);
  }
  if (directPath) {
    const absolutePath = path.isAbsolute(directPath) ? directPath : path.resolve(baseDir, directPath);
    // Absolute inputs remain supported for old/private specs, but the emitted
    // bundle records only the basename so it cannot leak the machine path.
    return { absolutePath, label: path.isAbsolute(directPath) ? path.basename(directPath) : directPath };
  }
  if (!reference) throw new CliError(`${description} needs a path or source reference.`);
  const key = `${path.resolve(baseDir)}\0${reference}`;
  let resolved = referenceCache.get(key);
  if (!resolved) {
    resolved = resolveReference(baseDir, reference);
    referenceCache.set(key, resolved);
  }
  return resolved;
}
