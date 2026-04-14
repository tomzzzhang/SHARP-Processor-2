import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import Plotly from 'plotly.js-dist-min';
import JSZip from 'jszip';
import type { ExperimentData } from '@/types/experiment';
import type { WellAnalysisResult } from '@/lib/analysis';
import { CONTENT_DISPLAY } from '@/lib/constants';

// ── Plot Export ──────────────────────────────────────────────────────

type ImageFormat = 'png' | 'svg' | 'jpeg';

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

  // Get the plot's current on-screen dimensions. Pass these unchanged to
  // Plotly.toImage and let `scale` upscale the whole figure — canvas,
  // fonts, line widths, and margins — proportionally. Previously we
  // pre-multiplied width/height and passed scale: 1, which grew the
  // canvas without scaling the fonts, producing tiny-text exports that
  // did not match the on-screen appearance.
  const rect = plotDiv.querySelector('.plot-container')?.getBoundingClientRect()
    ?? plotDiv.getBoundingClientRect();
  const scale = dpi / 96; // screen-DPI baseline

  const result = await Plotly.toImage(plotDiv, {
    format,
    width: rect.width,
    height: rect.height,
    scale,
  });

  if (format === 'svg') {
    // SVG is returned as a data URL
    const svgContent = atob(result.split(',')[1]);
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

  // Capture each plot as a raster image at the scaled DPI.
  const captures: { dataUrl: string; width: number; height: number }[] = [];
  for (const div of plotDivs) {
    const rect = div.querySelector('.plot-container')?.getBoundingClientRect()
      ?? div.getBoundingClientRect();
    const dataUrl = await Plotly.toImage(div, {
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
      const svgContent = atob(result.split(',')[1]);
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
  const headers = ['Well', 'Sample', 'Content', ttLabel, 'Doubling Time', 'Call', 'End RFU'];

  const rows = visibleWells.map((well) => {
    const info = exp.wells[well];
    const analysis = analysisResults.get(well);
    const displayType = CONTENT_DISPLAY[info?.content ?? ''] ?? info?.content ?? '';

    return [
      well,
      escapeCsv(info?.sample ?? ''),
      escapeCsv(displayType),
      analysis?.tt != null ? analysis.tt.toFixed(4) : '',
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
 * Build a .sharp ZIP archive from experiment data.
 * Shared by both saveSession (quick save) and exportAsSharp (save as).
 */
async function buildSharpZip(exp: ExperimentData): Promise<Uint8Array> {
  const zip = new JSZip();

  const metadata: Record<string, unknown> = {
    ...(exp.metadata ?? {}),
    format_version: exp.formatVersion || '1.0',
    experiment_id: exp.experimentId,
    protocol: { type: exp.protocolType || 'unknown' },
    run_info: {
      operator: exp.operator || '',
      notes: exp.notes || '',
      run_started_utc: exp.runStarted || '',
    },
    data_summary: {
      wells_used: exp.wellsUsed,
    },
    plate_layout: {
      rows: exp.plateRows,
      cols: exp.plateCols,
    },
    wells: {} as Record<string, unknown>,
  };

  const wellsMeta: Record<string, unknown> = {};
  for (const [wellName, info] of Object.entries(exp.wells)) {
    wellsMeta[wellName] = {
      sample: info.sample,
      content: info.content,
      cq: info.cq,
      end_rfu: info.endRfu,
      melt_temp_c: info.meltTempC,
      melt_peak_height: info.meltPeakHeight,
    };
  }
  metadata.wells = wellsMeta;
  zip.file('metadata.json', JSON.stringify(metadata, null, 2));

  if (exp.amplification) {
    const amp = exp.amplification;
    const ampHeaders = ['cycle', 'time_s', 'time_min', ...exp.wellsUsed];
    const ampRows = amp.cycle.map((_, i) => {
      const values = [
        String(amp.cycle[i] ?? ''),
        String(amp.timeS[i] ?? ''),
        String(amp.timeMin[i] ?? ''),
      ];
      for (const w of exp.wellsUsed) values.push(String(amp.wells[w]?.[i] ?? ''));
      return values.join(',');
    });
    zip.file('amplification.csv', [ampHeaders.join(','), ...ampRows].join('\n'));
  }

  if (exp.melt && Object.keys(exp.melt.rfu).length > 0) {
    const melt = exp.melt;
    const meltWells = exp.wellsUsed.filter((w) => w in melt.rfu);
    const rfuHeaders = ['temperature_C', ...meltWells];
    const rfuRows = melt.temperatureC.map((temp, i) => {
      const values = [String(temp)];
      for (const w of meltWells) values.push(String(melt.rfu[w]?.[i] ?? ''));
      return values.join(',');
    });
    zip.file('melt_rfu.csv', [rfuHeaders.join(','), ...rfuRows].join('\n'));
  }

  if (exp.melt && Object.keys(exp.melt.derivative).length > 0) {
    const melt = exp.melt;
    const meltWells = exp.wellsUsed.filter((w) => w in melt.derivative);
    const derivHeaders = ['temperature_C', ...meltWells];
    const derivRows = melt.temperatureC.map((temp, i) => {
      const values = [String(temp)];
      for (const w of meltWells) values.push(String(melt.derivative[w]?.[i] ?? ''));
      return values.join(',');
    });
    zip.file('melt_derivative.csv', [derivHeaders.join(','), ...derivRows].join('\n'));
  }

  return zip.generateAsync({ type: 'uint8array' });
}

/**
 * Quick save — writes to the given path without a dialog.
 * Used for Ctrl+S when the file was already saved/opened as .sharp.
 */
export async function saveSession(exp: ExperimentData, filePath: string): Promise<string> {
  const zipData = await buildSharpZip(exp);
  await writeFile(filePath, zipData);
  return filePath;
}

/**
 * Export the current experiment as a .sharp file (ZIP archive).
 * Preserves user edits to sample names, notes, descriptions, and content types.
 */
export async function exportAsSharp(exp: ExperimentData): Promise<string | null> {
  const filePath = await save({
    defaultPath: `${exp.experimentId}.sharp`,
    filters: [{ name: 'SHARP File', extensions: ['sharp'] }],
  });
  if (!filePath) return null;

  const zipData = await buildSharpZip(exp);
  await writeFile(filePath, zipData);
  return filePath;
}
