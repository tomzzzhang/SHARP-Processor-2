/**
 * `sharpplot render` — the browser half of the pipeline.
 *
 * Writes the harness, drives headless Chrome to a PDF, and rasterizes that PDF
 * to PNG. **PDF first, then rasterize** is deliberate and was arrived at the
 * hard way: `--screenshot` with `--force-device-scale-factor` clipped the
 * x-axis of every panel. Going through PDF also means dpi is a rasterization
 * parameter rather than a render parameter, so the PNG and the PDF are
 * guaranteed to be the same drawing at different resolutions.
 *
 * Chrome is driven through its own CLI flags rather than puppeteer, so there is
 * no npm dependency to install and the tool works offline.
 */
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { FigureBundle } from './figure';
import { buildHarness } from './harness';
import { CliError, writeOut } from './util';

const execFileAsync = promisify(execFile);

/** Where Chrome usually lives, per platform. Overridable by --chrome or
 *  SHARPPLOT_CHROME, which is the supported path for other machines. */
const CHROME_CANDIDATES: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/opt/google/chrome/chrome',
    // Playwright's browser cache, which is what a Claude sandbox usually has.
    // The versioned directory is expanded by `expandCandidate`.
    '/opt/pw-browsers/chromium-*/chrome-linux/chrome',
    '/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell',
    '/root/.cache/ms-playwright/chromium-*/chrome-linux/chrome',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    // Edge ships with Windows itself, so a locked-down corporate machine
    // with no Chrome install still has a Chromium browser available.
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
};

/**
 * Expand one `*` in a path segment, so a versioned browser directory can be
 * named without pinning its version. Returns matches sorted newest-last so the
 * highest version wins.
 */
function expandCandidate(pattern: string): string[] {
  if (!pattern.includes('*')) return [pattern];
  const star = pattern.indexOf('*');
  const dirEnd = pattern.lastIndexOf('/', star);
  const parent = pattern.slice(0, dirEnd);
  const rest = pattern.slice(dirEnd + 1);
  const slash = rest.indexOf('/');
  const segment = slash === -1 ? rest : rest.slice(0, slash);
  const tail = slash === -1 ? '' : rest.slice(slash);

  let entries: string[];
  try {
    entries = readdirSync(parent);
  } catch {
    return [];
  }
  const re = new RegExp(`^${segment.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return entries.filter((e) => re.test(e)).sort().map((e) => `${parent}/${e}${tail}`);
}

export function resolveChrome(explicit?: string | null): string {
  const patterns = [
    explicit,
    process.env.SHARPPLOT_CHROME,
    ...(CHROME_CANDIDATES[process.platform] ?? []),
  ].filter((c): c is string => Boolean(c));

  const candidates = patterns.flatMap(expandCandidate);
  for (const c of candidates) if (existsSync(c)) return c;

  throw new CliError(
    'No Chrome/Chromium found. Pass --chrome <path> or set SHARPPLOT_CHROME.\n' +
    `Looked in:\n${patterns.map((c) => `  ${c}`).join('\n')}`,
  );
}

/**
 * Locate Plotly for the harness.
 *
 * A sibling `plotly.min.js` is checked first so the CLI stays portable: copy
 * `sharpplot.mjs` and `plotly.min.js` into any directory and `render` works
 * with no repo and no `node_modules` present. That is the shape of the
 * Cowork flow, where the machine holding the data has no browser and the
 * machine with the browser has no checkout.
 */
export function resolvePlotly(explicit?: string | null): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    explicit,
    process.env.SHARPPLOT_PLOTLY,
    path.resolve(here, 'plotly.min.js'),
    path.resolve(here, '../node_modules/plotly.js-dist-min/plotly.min.js'),
    path.resolve(here, '../../node_modules/plotly.js-dist-min/plotly.min.js'),
    path.resolve(process.cwd(), 'plotly.min.js'),
    path.resolve(process.cwd(), 'node_modules/plotly.js-dist-min/plotly.min.js'),
  ].filter((c): c is string => Boolean(c));

  for (const c of candidates) if (existsSync(c)) return c;
  throw new CliError(
    'Cannot find plotly.min.js.\n' +
    'Put it next to sharpplot.mjs, pass --plotly <path>, set SHARPPLOT_PLOTLY,\n' +
    'or run this from a checkout where node_modules/plotly.js-dist-min/ exists.\n' +
    `Looked in:\n${candidates.map((c) => `  ${c}`).join('\n')}`,
  );
}

/**
 * WebGL trace types rasterize silently, which would destroy vector output
 * without any visible error. Nothing in `plot-figure.ts` emits them today;
 * this is a tripwire in case that ever changes.
 */
function assertVectorSafe(bundle: FigureBundle): void {
  const offenders = new Set<string>();
  for (const panel of bundle.panels) {
    if (panel.kind !== 'plot') continue;
    for (const trace of panel.figure.data) {
      const type = (trace as { type?: string }).type;
      if (type && /gl$/i.test(type)) offenders.add(type);
    }
  }
  if (offenders.size > 0) {
    throw new CliError(
      `WebGL trace types would rasterize the PDF and lose vector output: ${[...offenders].join(', ')}.`,
    );
  }
}

export interface RenderOptions {
  /** Output path. Its extension is ignored; formats come from the spec. */
  out: string;
  chrome?: string | null;
  /** Explicit plotly.min.js, for a staged copy with no node_modules nearby. */
  plotly?: string | null;
  /** Keep the temporary harness directory and report where it is. */
  keepHtml?: boolean;
  /** Milliseconds Chrome will let the page's virtual clock run. */
  timeBudgetMs?: number;
}

export interface RenderResult {
  files: string[];
  harnessDir: string | null;
}

async function rasterize(pdfPath: string, outBase: string, dpi: number): Promise<string> {
  // pdftoppm writes `<root>-1.png` for a single-page document (or `<root>.png`
  // with -singlefile, which is what we want).
  try {
    await execFileAsync('pdftoppm', ['-png', '-r', String(dpi), '-singlefile', pdfPath, outBase]);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new CliError(
        'pdftoppm not found — it rasterizes the PDF into the PNG.\n' +
        'Install poppler (macOS: brew install poppler; Debian/Ubuntu: apt install poppler-utils),\n' +
        'or request only the pdf format in the spec.',
      );
    }
    throw new CliError(`pdftoppm failed: ${(e as Error).message}`);
  }
  return `${outBase}.png`;
}

export async function renderBundle(bundle: FigureBundle, opts: RenderOptions): Promise<RenderResult> {
  assertVectorSafe(bundle);

  const chrome = resolveChrome(opts.chrome);
  const plotlySrc = resolvePlotly(opts.plotly);

  const work = await mkdtemp(path.join(tmpdir(), 'sharpplot-'));
  let keep = Boolean(opts.keepHtml);
  try {
    // Copy Plotly next to the harness so the page loads it as a sibling file
    // and the render needs no network.
    await copyFile(plotlySrc, path.join(work, 'plotly.min.js'));
    const harnessPath = path.join(work, 'harness.html');
    await writeFile(harnessPath, buildHarness(bundle, { plotlySrc: 'plotly.min.js' }), 'utf-8');

    const pdfPath = path.join(work, 'figure.pdf');
    const budget = opts.timeBudgetMs ?? 15000;

    try {
      await execFileAsync(chrome, [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        '--allow-file-access-from-files',
        '--no-sandbox',
        `--virtual-time-budget=${budget}`,
        '--no-pdf-header-footer',
        `--print-to-pdf=${pdfPath}`,
        `file://${harnessPath}`,
      ], { maxBuffer: 32 * 1024 * 1024 });
    } catch (e) {
      throw new CliError(`Chrome failed to render: ${(e as Error).message}`);
    }

    if (!existsSync(pdfPath)) {
      throw new CliError('Chrome produced no PDF. Re-run with --keep-html and open the harness to see why.');
    }

    // A PDF that drew nothing still exists, so check that real text made it in.
    // Axis tick labels are text, and their absence means the plot did not draw.
    await assertPdfHasContent(pdfPath, bundle);

    const outDir = path.dirname(path.resolve(opts.out));
    const stem = path.basename(opts.out).replace(/\.(pdf|png)$/i, '');
    const base = path.join(outDir, stem);

    const files: string[] = [];
    if (bundle.output.formats.includes('pdf')) {
      const dest = `${base}.pdf`;
      await writeOut(dest, await readFile(pdfPath));
      files.push(dest);
    }
    if (bundle.output.formats.includes('png')) {
      // Rasterize inside the work dir, then move, so a failure cannot leave a
      // half-written file at the destination.
      const pngTmp = await rasterize(pdfPath, path.join(work, 'figure'), bundle.output.dpi);
      const dest = `${base}.png`;
      await writeOut(dest, await readFile(pngTmp));
      files.push(dest);
    }

    return { files, harnessDir: keep ? work : null };
  } catch (err) {
    // Keep the harness on failure — it is the only way to debug a bad render.
    keep = true;
    if (err instanceof CliError) {
      throw new CliError(`${err.message}\n\nHarness kept for inspection: ${work}`);
    }
    throw err;
  } finally {
    if (!keep) await rm(work, { recursive: true, force: true });
  }
}

/**
 * Confirm the PDF carries real vector text rather than being blank. Chrome
 * exits successfully even when the page threw, so without this a broken render
 * silently produces an empty figure.
 */
async function assertPdfHasContent(pdfPath: string, bundle: FigureBundle): Promise<void> {
  const bytes = await readFile(pdfPath);
  if (bytes.byteLength < 1000) {
    throw new CliError(`Chrome produced a ${bytes.byteLength}-byte PDF, which cannot contain a figure.`);
  }
  const hasPlot = bundle.panels.some((p) => p.kind === 'plot');
  if (!hasPlot) return;
  try {
    const { stdout } = await execFileAsync('pdftotext', [pdfPath, '-']);
    if (stdout.trim().length === 0) {
      throw new CliError(
        'The PDF contains no text, so the plots did not draw (axis labels and ticks are text).\n' +
        'Re-run with --keep-html and open the harness in a browser to see the error.',
      );
    }
  } catch (e) {
    // pdftotext is part of poppler and may be absent; its absence is not a
    // render failure, so fall back to the size check already done above.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    if (e instanceof CliError) throw e;
  }
}
