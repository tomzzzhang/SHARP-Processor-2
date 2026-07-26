/**
 * `sharpplot bundle` — stage a self-contained copy of the renderer.
 *
 * `render` needs two files and nothing else: `sharpplot.mjs` and
 * `plotly.min.js`. Copy them into a directory and figures can be rendered
 * there with no repo, no `node_modules`, and no network.
 *
 * That is what makes the split-machine flow practical. The machine holding
 * the data may have the repo but no browser; the machine with the browser may
 * have neither. Run `figure` where the data is, stage these two files where
 * the browser is, move `fig.json` across, and render.
 */
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePlotly } from './render';
import { CliError } from './util';

export interface BundleResult {
  directory: string;
  files: string[];
  /** Ready-to-run command for the staged copy. */
  usage: string;
}

export async function bundleCommand(outDir: string, plotlyOverride?: string | null): Promise<BundleResult> {
  const self = fileURLToPath(import.meta.url);
  const selfDir = path.dirname(self);
  const plotly = resolvePlotly(plotlyOverride);
  const dir = path.resolve(outDir);

  if (selfDir === dir) {
    throw new CliError(`${dir} is where sharpplot already lives — nothing to stage.`);
  }

  await mkdir(dir, { recursive: true });

  // Copy every emitted module, not just the entry point: rarely-used parsers
  // (the Agilent one pulls in OpenPGP) are lazily loaded side chunks, and a
  // staged copy missing them would fail only on the files that need them.
  const emitted = (await readdir(selfDir)).filter((f) => f.endsWith('.mjs'));
  const files: string[] = [];
  for (const name of emitted) {
    const dest = path.join(dir, name);
    await copyFile(path.join(selfDir, name), dest);
    files.push(dest);
  }

  const plotlyDest = path.join(dir, 'plotly.min.js');
  await copyFile(plotly, plotlyDest);
  files.push(plotlyDest);

  return {
    directory: dir,
    files,
    usage: `node ${path.join(dir, path.basename(self))} render fig.json --out figure`,
  };
}
