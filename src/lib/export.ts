import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import Plotly from 'plotly.js-dist-min';
import type { ExperimentData } from '@/types/experiment';
import type { WellAnalysisResult } from '@/lib/analysis';
import { CONTENT_DISPLAY } from '@/lib/constants';
import { buildSharpZip } from './sharp-writer';
import type { LiveAnalysisBundle } from './sharp-writer';

// The .sharp/.sharpx writer (`buildSharpZip`) and its `LiveAnalysisBundle`
// type now live in `sharp-writer.ts` so they can run headless without pulling
// Plotly/Tauri. Re-export the type here so existing importers of `export.ts`
// keep working unchanged.
export type { LiveAnalysisBundle };

// ── Plot Export ──────────────────────────────────────────────────────

type ImageFormat = 'png' | 'svg' | 'jpeg';

/**
 * Resolve a caller-supplied element down to the actual Plotly graph div.
 * Plotly.toImage requires the element that Plotly.newPlot was called on
 * (the one with `.js-plotly-plot` and internal `_fullLayout` state).
 * Callers sometimes pass an outer wrapper div (e.g. a container with
 * our own `id="sharp-plot-amp"` stable tag) — walk down to the real
 * graph div if so. Returns the original if nothing better is found.
 */
function resolvePlotlyDiv(el: HTMLElement): HTMLElement {
  if (el.classList.contains('js-plotly-plot')) return el;
  const inner = el.querySelector('.js-plotly-plot') as HTMLElement | null;
  return inner ?? el;
}

/**
 * Decode a data URL's payload to text. Plotly returns PNG/JPEG as
 * base64 data URLs but SVG as a URL-encoded one (`data:image/svg+xml,…`),
 * so a blanket `atob` throws "string not correctly encoded" on SVG.
 */
function decodeDataUrlText(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  return meta.includes(';base64') ? atob(payload) : decodeURIComponent(payload);
}

/**
 * Export the current plot as an image file.
 * Uses Plotly's toImage to render, then Tauri's save dialog + writeFile.
 */
export async function exportPlotImage(
  plotDiv: HTMLElement,
  format: ImageFormat,
  dpi: number,
  defaultName: string,
): Promise<string | null> {
  const filters: Record<ImageFormat, { name: string; extensions: string[] }> = {
    png: { name: 'PNG Image', extensions: ['png'] },
    svg: { name: 'SVG Image', extensions: ['svg'] },
    jpeg: { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
  };

  const filePath = await save({
    defaultPath: `${defaultName}.${format}`,
    filters: [filters[format]],
  });
  if (!filePath) return null;

  // Resolve the actual Plotly graph div (caller may have passed an
  // outer wrapper with our stable id) and read its on-screen size.
  // Pass those dimensions to Plotly.toImage and let `scale` upscale the
  // whole figure — canvas, fonts, line widths, and margins — in lockstep.
  // Pre-multiplying dimensions while passing scale: 1 (as we did before
  // v0.1.6) grew the canvas without scaling the fonts. Measuring an
  // inner child like `.plot-container` instead of the graph div itself
  // causes Plotly to re-flow the legend outside the figure on re-render.
  const graphDiv = resolvePlotlyDiv(plotDiv);
  const rect = graphDiv.getBoundingClientRect();
  const scale = dpi / 96; // screen-DPI baseline

  const result = await Plotly.toImage(graphDiv, {
    format,
    width: rect.width,
    height: rect.height,
    scale,
  });

  if (format === 'svg') {
    // SVG is returned as a URL-encoded data URL (not base64).
    const svgContent = decodeDataUrlText(result);
    await writeTextFile(filePath, svgContent);
  } else {
    // PNG/JPEG are returned as base64 data URLs
    const base64 = result.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    await writeFile(filePath, bytes);
  }

  return filePath;
}

/**
 * Export the currently-displayed plot for a given plot tab at its on-screen
 * size, upscaled by `dpi`. Resolves the active tab's stable container id rather
 * than a fragile `.js-plotly-plot` query (which grabs whichever Plotly plot is
 * first in the DOM — often the melt-derivative mini-plot), so it always
 * captures the right plot. On the amplification tab a PNG/JPEG export stitches
 * the melt-derivative mini-plot below the main plot, matching what's shown.
 */
export async function exportActivePlot(
  plotTab: 'amplification' | 'melt' | 'doubling',
  format: ImageFormat,
  dpi: number,
  defaultName: string,
): Promise<string | null> {
  const byId = (id: string) => document.getElementById(id);
  if (plotTab === 'amplification') {
    const amp = byId('sharp-plot-amp');
    if (!amp) return null;
    const deriv = byId('sharp-plot-amp-deriv');
    if (deriv && (format === 'png' || format === 'jpeg')) {
      return exportCompositePlotImage([amp, deriv], format, dpi, defaultName);
    }
    return exportPlotImage(amp, format, dpi, defaultName);
  }
  if (plotTab === 'melt') {
    const melt = byId('sharp-plot-melt');
    return melt ? exportPlotImage(melt, format, dpi, defaultName) : null;
  }
  const doubling = byId('sharp-plot-doubling');
  return doubling ? exportPlotImage(doubling, format, dpi, defaultName) : null;
}

/**
 * Export a stack of on-screen Plotly plots as a single composite image —
 * used on the Amplification tab to include the melt-derivative mini-plot
 * below the main amp plot, matching what's displayed. Plots are captured
 * at the user's current DPI and stitched top-to-bottom via an offscreen
 * HTMLCanvasElement, preserving each plot's width ratio.
 *
 * SVG is not supported for composites — SVG composition of two
 * independent Plotly figures is non-trivial. Callers should fall back
 * to single-plot SVG export for that case.
 */
export async function exportCompositePlotImage(
  plotDivs: HTMLElement[],
  format: 'png' | 'jpeg',
  dpi: number,
  defaultName: string,
): Promise<string | null> {
  if (plotDivs.length === 0) return null;

  const filters: Record<'png' | 'jpeg', { name: string; extensions: string[] }> = {
    png: { name: 'PNG Image', extensions: ['png'] },
    jpeg: { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
  };

  const filePath = await save({
    defaultPath: `${defaultName}.${format === 'png' ? 'png' : 'jpg'}`,
    filters: [filters[format]],
  });
  if (!filePath) return null;

  const scale = dpi / 96;

  // Capture each plot as a raster image at the scaled DPI. Resolve
  // each caller-provided div to the actual Plotly graph div (callers
  // typically pass outer wrappers tagged with stable ids) and measure
  // the graph div itself — measuring an inner child like
  // `.plot-container` causes Plotly to re-flow the legend outside the
  // figure when it re-renders at the requested size.
  const captures: { dataUrl: string; width: number; height: number }[] = [];
  for (const div of plotDivs) {
    const graphDiv = resolvePlotlyDiv(div);
    const rect = graphDiv.getBoundingClientRect();
    const dataUrl = await Plotly.toImage(graphDiv, {
      format: 'png', // always PNG for compositing, re-encode later
      width: rect.width,
      height: rect.height,
      scale,
    });
    captures.push({
      dataUrl,
      width: Math.round(rect.width * scale),
      height: Math.round(rect.height * scale),
    });
  }

  // Build an offscreen canvas sized to the max width × sum of heights,
  // matching the on-screen vertical stacking (each plot draws at its own
  // width centered horizontally). For the amp+deriv case both plots share
  // the container width, so this reduces to a simple stack.
  const maxWidth = Math.max(...captures.map((c) => c.width));
  const totalHeight = captures.reduce((sum, c) => sum + c.height, 0);

  const canvas = document.createElement('canvas');
  canvas.width = maxWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Paint a background for JPEG (which has no alpha channel).
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, maxWidth, totalHeight);
  }

  // Draw each captured image in order, top-to-bottom.
  let y = 0;
  for (const c of captures) {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(e);
      img.src = c.dataUrl;
    });
    const x = Math.round((maxWidth - c.width) / 2);
    ctx.drawImage(img, x, y, c.width, c.height);
    y += c.height;
  }

  // Encode the composite canvas as PNG or JPEG.
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const quality = format === 'jpeg' ? 0.95 : undefined;
  const compositeUrl = canvas.toDataURL(mime, quality);
  const base64 = compositeUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  await writeFile(filePath, bytes);

  return filePath;
}

/**
 * Render a freshly-built Plotly figure off-DOM at exact pixel dimensions
 * and export it as an image. Used by the Export Wizard so the preview
 * and the exported file are pixel-identical and independent of whatever
 * is currently on the main plot tab.
 */
export async function exportWizardFigure(
  figure: { data: unknown[]; layout: Partial<Plotly.Layout> },
  widthPx: number,
  heightPx: number,
  format: ImageFormat,
  defaultName: string,
): Promise<string | null> {
  const filters: Record<ImageFormat, { name: string; extensions: string[] }> = {
    png: { name: 'PNG Image', extensions: ['png'] },
    svg: { name: 'SVG Image', extensions: ['svg'] },
    jpeg: { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
  };

  const filePath = await save({
    defaultPath: `${defaultName}.${format}`,
    filters: [filters[format]],
  });
  if (!filePath) return null;

  // Render off-DOM at the exact target pixel size. The layout has width
  // and height baked in so fonts, margins, and line widths land at their
  // intended absolute sizes.
  const hidden = document.createElement('div');
  hidden.style.position = 'fixed';
  hidden.style.left = '-10000px';
  hidden.style.top = '-10000px';
  hidden.style.width = `${widthPx}px`;
  hidden.style.height = `${heightPx}px`;
  hidden.style.pointerEvents = 'none';
  document.body.appendChild(hidden);

  try {
    const layoutWithSize: Partial<Plotly.Layout> = {
      ...figure.layout,
      width: widthPx,
      height: heightPx,
    };
    await Plotly.newPlot(hidden, figure.data as Plotly.Data[], layoutWithSize, {
      staticPlot: true,
      displayModeBar: false,
    });
    const result = await Plotly.toImage(hidden, {
      format,
      width: widthPx,
      height: heightPx,
      scale: 1,
    });

    if (format === 'svg') {
      // SVG is returned as a URL-encoded data URL (not base64).
      const svgContent = decodeDataUrlText(result);
      await writeTextFile(filePath, svgContent);
    } else {
      const base64 = result.split(',')[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      await writeFile(filePath, bytes);
    }
  } finally {
    Plotly.purge(hidden);
    hidden.remove();
  }

  return filePath;
}

// ── CSV Export ───────────────────────────────────────────────────────

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Export amplification data as CSV.
 */
export async function exportDataCsv(
  exp: ExperimentData,
  xAxisMode: 'cycle' | 'time_s' | 'time_min',
  visibleWells: string[],
): Promise<string | null> {
  if (!exp.amplification) return null;

  const filePath = await save({
    defaultPath: `${exp.experimentId}_data.csv`,
    filters: [{ name: 'CSV File', extensions: ['csv'] }],
  });
  if (!filePath) return null;

  const amp = exp.amplification;
  const xData =
    xAxisMode === 'cycle' ? amp.cycle :
    xAxisMode === 'time_s' ? amp.timeS :
    amp.timeMin;

  const xLabel = xAxisMode === 'cycle' ? 'Cycle' : xAxisMode === 'time_s' ? 'Time_s' : 'Time_min';

  const headers = [xLabel, ...visibleWells];
  const rows = xData.map((x, i) => {
    const values = [String(x)];
    for (const well of visibleWells) {
      values.push(String(amp.wells[well]?.[i] ?? ''));
    }
    return values.join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  await writeTextFile(filePath, csv);
  return filePath;
}

/**
 * Export results table as CSV.
 */
export async function exportResultsCsv(
  exp: ExperimentData,
  analysisResults: Map<string, WellAnalysisResult>,
  visibleWells: string[],
  xAxisMode: 'cycle' | 'time_s' | 'time_min',
): Promise<string | null> {
  const filePath = await save({
    defaultPath: `${exp.experimentId}_results.csv`,
    filters: [{ name: 'CSV File', extensions: ['csv'] }],
  });
  if (!filePath) return null;

  const ttLabel = xAxisMode === 'cycle' ? 'Ct' : 'Tt';
  const headers = ['Well', 'Sample', 'Content', ttLabel, 'Tm', 'Doubling Time', 'Call', 'End RFU'];
  const tmByWell = new Map<string, number>();
  if (exp.melt && Object.keys(exp.melt.derivative).length > 0) {
    for (const well of visibleWells) {
      const derData = exp.melt.derivative[well];
      if (!derData || derData.length === 0) continue;
      let maxIdx = 0;
      let maxVal = -Infinity;
      for (let i = 0; i < derData.length; i++) {
        if (derData[i] > maxVal) {
          maxVal = derData[i];
          maxIdx = i;
        }
      }
      if (maxVal > 0 && maxIdx < exp.melt.temperatureC.length) {
        tmByWell.set(well, exp.melt.temperatureC[maxIdx]);
      }
    }
  }

  const rows = visibleWells.map((well) => {
    const info = exp.wells[well];
    const analysis = analysisResults.get(well);
    const displayType = CONTENT_DISPLAY[info?.content ?? ''] ?? info?.content ?? '';
    const tm = tmByWell.get(well);

    return [
      well,
      escapeCsv(info?.sample ?? ''),
      escapeCsv(displayType),
      analysis?.tt != null ? analysis.tt.toFixed(4) : '',
      tm != null ? tm.toFixed(1) : '',
      analysis?.dt != null ? analysis.dt.toFixed(4) : '',
      analysis?.call ?? '',
      analysis?.endRfu != null ? Math.round(analysis.endRfu).toString() : '',
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  await writeTextFile(filePath, csv);
  return filePath;
}

/**
 * Export melt data as CSV (temperature + RFU + derivative columns).
 */
export async function exportMeltCsv(
  exp: ExperimentData,
  visibleWells: string[],
): Promise<string | null> {
  if (!exp.melt) return null;

  const filePath = await save({
    defaultPath: `${exp.experimentId}_melt.csv`,
    filters: [{ name: 'CSV File', extensions: ['csv'] }],
  });
  if (!filePath) return null;

  const melt = exp.melt;
  const hasRfu = Object.keys(melt.rfu).length > 0;
  const hasDeriv = Object.keys(melt.derivative).length > 0;

  const headers = ['Temperature_C'];
  if (hasRfu) for (const w of visibleWells) headers.push(`${w}_RFU`);
  if (hasDeriv) for (const w of visibleWells) headers.push(`${w}_dFdT`);

  const rows = melt.temperatureC.map((temp, i) => {
    const values = [String(temp)];
    if (hasRfu) for (const w of visibleWells) values.push(String(melt.rfu[w]?.[i] ?? ''));
    if (hasDeriv) for (const w of visibleWells) values.push(String(melt.derivative[w]?.[i] ?? ''));
    return values.join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  await writeTextFile(filePath, csv);
  return filePath;
}

// ── .sharp Export ────────────────────────────────────────────────────

/**
 * Quick save — writes to the given path without a dialog.
 * Used for Ctrl+S when the file was already saved/opened as .sharp.
 *
 * `liveAnalysis` is forwarded into the zip builder so saved cq/end_rfu
 * reflect the user's current threshold/baseline rather than parser values.
 */
export async function saveSession(
  exp: ExperimentData,
  filePath: string,
  liveAnalysis?: LiveAnalysisBundle,
  session?: Record<string, unknown> | null,
): Promise<string> {
  const zipData = await buildSharpZip(exp, liveAnalysis, session);
  await writeFile(filePath, zipData);
  return filePath;
}

/**
 * Export the current experiment as a .sharp file (ZIP archive).
 * Preserves user edits to sample names, notes, descriptions, and content types.
 *
 * `liveAnalysis` is forwarded into the zip builder so saved cq/end_rfu
 * reflect the user's current threshold/baseline rather than parser values.
 */
export async function exportAsSharp(
  exp: ExperimentData,
  liveAnalysis?: LiveAnalysisBundle,
): Promise<string | null> {
  const filePath = await save({
    defaultPath: `${exp.experimentId}.sharp`,
    filters: [{ name: 'SHARP File', extensions: ['sharp'] }],
  });
  if (!filePath) return null;

  const zipData = await buildSharpZip(exp, liveAnalysis);
  await writeFile(filePath, zipData);
  return filePath;
}

/**
 * Save a working session as a `.sharpx` file — a `.sharp` archive plus a
 * `session.json` carrying the current view state (selections, baseline /
 * normalization / drift settings, style, x-axis, plot tab). Reopening the
 * `.sharpx` restores all of it. Plain `.sharp` exports never include it.
 */
export async function exportAsSharpx(
  exp: ExperimentData,
  session: Record<string, unknown>,
  liveAnalysis?: LiveAnalysisBundle,
): Promise<string | null> {
  const filePath = await save({
    defaultPath: `${exp.experimentId}.sharpx`,
    filters: [{ name: 'SHARP Session', extensions: ['sharpx'] }],
  });
  if (!filePath) return null;

  const zipData = await buildSharpZip(exp, liveAnalysis, session);
  await writeFile(filePath, zipData);
  return filePath;
}
