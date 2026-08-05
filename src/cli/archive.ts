/**
 * Archive one accepted figure revision without breaking its relative paths.
 *
 * The canonical spec resolves paths from the figure folder. A plain move into
 * `archive/` changes that base and silently makes `source/...` invalid. This
 * command copies the accepted triplet and rewrites only those relative path
 * fields so the archived spec remains independently rerunnable.
 */
import { constants as fsConstants } from 'node:fs';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveSpec, type FigureSpec } from './spec';
import { CliError } from './util';

export interface ArchiveResult {
  archiveStem: string;
  files: string[];
}

function localTimestamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function validateTimestamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2} \d{4}$/.test(value)) {
    throw new CliError('--timestamp must use YYYY-MM-DD HHmm.');
  }
  return value;
}

function validateLabel(value: string | null | undefined): string {
  const label = value?.trim() ?? '';
  const hasControlCharacter = [...label].some((character) => character.charCodeAt(0) < 32);
  if (/[<>:"/\\|?*]/.test(label) || hasControlCharacter || label === '.' || label === '..') {
    throw new CliError('Archive labels may not contain path separators or filesystem-reserved characters.');
  }
  return label;
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

function portableRelative(from: string, to: string): string {
  const relative = path.relative(from, to).split(path.sep).join('/');
  return relative || '.';
}

function rewritePath(value: string, originalBase: string, archiveDir: string, field: string): string {
  if (path.isAbsolute(value)) {
    throw new CliError(
      `${field} is an absolute path. Replace it with a relative path or sourceRef before archiving ` +
      'so the archive cannot expose a private machine path.',
    );
  }
  return portableRelative(archiveDir, path.resolve(originalBase, value));
}

function rewriteArchivedSpec(raw: FigureSpec, originalBase: string, archiveDir: string): FigureSpec {
  // JSON is the public contract; a JSON round-trip is the safest deep clone
  // and deliberately rejects values a spec file could not have represented.
  const copy = JSON.parse(JSON.stringify(raw)) as FigureSpec;
  for (const panel of copy.panels) {
    if (panel.kind === 'plot') {
      if (panel.source) panel.source = rewritePath(panel.source, originalBase, archiveDir, `Panel "${panel.label}" source`);
      for (const [i, merge] of (panel.mergeSources ?? []).entries()) {
        if (merge.source) {
          merge.source = rewritePath(
            merge.source,
            originalBase,
            archiveDir,
            `Panel "${panel.label}" mergeSources[${i}] source`,
          );
        }
      }
    } else if (panel.kind === 'image' && panel.path) {
      panel.path = rewritePath(panel.path, originalBase, archiveDir, `Panel "${panel.label}" image path`);
    }
  }
  return copy;
}

async function specPathFromInput(input: string): Promise<string> {
  const absolute = path.resolve(input);
  if (!(await isDirectory(absolute))) return absolute;
  const name = path.basename(absolute);
  return path.join(absolute, `${name}.spec.json`);
}

export async function archiveCommand(
  input: string,
  labelValue?: string | null,
  timestampValue?: string | null,
): Promise<ArchiveResult> {
  const specPath = await specPathFromInput(input);
  if (!(await exists(specPath))) throw new CliError(`Cannot find the canonical spec: ${specPath}`);
  const figureDir = path.dirname(specPath);
  if (path.basename(figureDir).toLowerCase() === 'archive') {
    throw new CliError('Archive the canonical spec from the figure folder, not a spec already inside archive/.');
  }

  let raw: FigureSpec;
  try {
    raw = JSON.parse(await readFile(specPath, 'utf-8')) as FigureSpec;
  } catch (e) {
    throw new CliError(`Cannot read the canonical spec: ${(e as Error).message}`);
  }
  resolveSpec(raw, figureDir); // validate before writing anything

  const archiveDir = path.join(figureDir, 'archive');
  const timestamp = timestampValue ? validateTimestamp(timestampValue) : localTimestamp();
  const label = validateLabel(labelValue);
  const archiveStem = `${timestamp}${label ? ` ${label}` : ''}`;
  const canonicalStem = path.basename(specPath).replace(/\.spec\.json$/i, '');
  const rewritten = rewriteArchivedSpec(raw, figureDir, archiveDir);

  const sources = ['pdf', 'png']
    .map((extension) => ({
      source: path.join(figureDir, `${canonicalStem}.${extension}`),
      destination: path.join(archiveDir, `${archiveStem}.${extension}`),
    }));
  const present: typeof sources = [];
  for (const candidate of sources) if (await exists(candidate.source)) present.push(candidate);
  if (present.length === 0) {
    throw new CliError(`No accepted PDF or PNG exists beside ${path.basename(specPath)}.`);
  }

  const specDestination = path.join(archiveDir, `${archiveStem}.spec.json`);
  const destinations = [specDestination, ...present.map((item) => item.destination)];
  for (const destination of destinations) {
    if (await exists(destination)) throw new CliError(`Archive destination already exists: ${destination}`);
  }

  await mkdir(archiveDir, { recursive: true });
  const created: string[] = [];
  try {
    for (const item of present) {
      await copyFile(item.source, item.destination, fsConstants.COPYFILE_EXCL);
      created.push(item.destination);
    }
    await writeFile(specDestination, `${JSON.stringify(rewritten, null, 2)}\n`, { flag: 'wx' });
    created.push(specDestination);
  } catch (e) {
    for (const file of created) await rm(file, { force: true });
    throw new CliError(`Could not create the archive atomically: ${(e as Error).message}`);
  }

  return { archiveStem: path.join(archiveDir, archiveStem), files: created };
}
