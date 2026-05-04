import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import Plotly from 'plotly.js-dist-min';
import JSZip from 'jszip';
import type { ExperimentData } from '@/types/experiment';
import type { WellAnalysisResult } from '@/lib/analysis';
import { computeMeltDerivative } from '@/lib/parsers/utils';
import { CONTENT_DISPLAY } from '@/lib/constants';

/**
 * Optional bundle of current analysis output passed into the .sharp save path.
 * `results` carries the live `useAnalysisResults` map; `ttIsCycle` indicates
 * whether `tt` values are in cycle units (only then can `tt` be saved as `cq`,
 * since `cq` is by spec a cycle-quantification value).
 */
export interface LiveAnalysisBundle {
  results: Map<string, WellAnalysisResult>;
  ttIsCycle: boolean;
}

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

/** Escape a string for a CSV cell: wraps in double quotes if it contains
 *  a comma, quote, or newline; doubles internal quotes. Numeric values
 *  pass through unchanged. */
function csvCell(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Compact human format for optional numbers in wells.csv / SUMMARY.txt. */
function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v == null || !isFinite(v)) return '';
  return (Math.round(v * 10 ** decimals) / 10 ** decimals).toString();
}

/**
 * Build a .sharp ZIP archive from experiment data.
 * Shared by both saveSession (quick save) and exportAsSharp (save as).
 *
 * Format version 1.1 adds `wells.csv` (tabular well manifest) and
 * `SUMMARY.txt` (human-readable overview) alongside the authoritative
 * `metadata.json`. Both are written whenever there are wells; readers
 * that only know 1.0 continue to work because metadata.json still carries
 * the same well info.
 *
 * Pass `liveAnalysis` (the live `useAnalysisResults` map plus an
 * `ttIsCycle` flag) so saved cq/end_rfu reflect the user's current
 * threshold/baseline settings rather than the parse-time snapshot in
 * `exp.wells`. Without it, the save uses the snapshot — which is what
 * we did pre-v0.1.12 and what fixtures may want.
 */
async function buildSharpZip(
  exp: ExperimentData,
  liveAnalysis?: LiveAnalysisBundle,
): Promise<Uint8Array> {
  const zip = new JSZip();

  // Spread the parser-supplied sub-objects first so fields like
  // reaction_temp_c / amp_cycle_count / has_melt / raw_definition (protocol),
  // file_name / run_ended_utc (run_info), and cycle_count (data_summary)
  // survive the round trip. User-edited fields (operator/notes/runStarted/
  // protocolType/wells) are then unconditionally overlaid — empty string
  // is treated as a deliberate user clear, not a fallback to the parser.
  const origProtocol = (exp.metadata?.protocol ?? {}) as Record<string, unknown>;
  const origRunInfo = (exp.metadata?.run_info ?? {}) as Record<string, unknown>;
  const origDataSummary = (exp.metadata?.data_summary ?? {}) as Record<string, unknown>;

  const metadata: Record<string, unknown> = {
    ...(exp.metadata ?? {}),
    format_version: '1.1',
    experiment_id: exp.experimentId,
    protocol: {
      ...origProtocol,
      type: exp.protocolType || (origProtocol.type as string | undefined) || 'unknown',
    },
    run_info: {
      ...origRunInfo,
      operator: exp.operator,
      notes: exp.notes,
      run_started_utc: exp.runStarted,
    },
    data_summary: { ...origDataSummary, wells_used: exp.wellsUsed },
    plate_layout: { rows: exp.plateRows, cols: exp.plateCols },
    wells: {} as Record<string, unknown>,
  };

  // Pull cq / end_rfu from the live analysis bundle when present, falling
  // back to the parse-time snapshot in exp.wells. cq is only overlaid when
  // tt is in cycle units — for time-mode runs (SHARP isothermal etc.) the
  // live tt is in seconds and would corrupt the cq field's semantics.
  const liveCq = (well: string, fallback: number | null): number | null => {
    if (!liveAnalysis?.ttIsCycle) return fallback;
    const live = liveAnalysis.results.get(well);
    return live?.tt ?? fallback;
  };
  const liveEndRfu = (well: string, fallback: number | null): number | null => {
    const live = liveAnalysis?.results.get(well);
    return live?.endRfu ?? fallback;
  };

  const wellsMeta: Record<string, unknown> = {};
  for (const [wellName, info] of Object.entries(exp.wells)) {
    wellsMeta[wellName] = {
      sample: info.sample,
      content: info.content,
      cq: liveCq(wellName, info.cq),
      end_rfu: liveEndRfu(wellName, info.endRfu),
      melt_temp_c: info.meltTempC,
      melt_peak_height: info.meltPeakHeight,
    };
  }
  metadata.wells = wellsMeta;
  zip.file('metadata.json', JSON.stringify(metadata, null, 2));

  // wells.csv — flat well manifest, spreadsheet-friendly
  if (exp.wellsUsed.length > 0) {
    const headers = ['well', 'sample', 'content', 'cq', 'end_rfu', 'melt_temp_c', 'melt_peak_height'];
    const rows = exp.wellsUsed.map((w) => {
      const info = exp.wells[w];
      if (!info) return [csvCell(w), '', '', '', '', '', ''].join(',');
      return [
        csvCell(w),
        csvCell(info.sample),
        csvCell(info.content),
        csvCell(fmtNum(liveCq(w, info.cq), 3)),
        csvCell(fmtNum(liveEndRfu(w, info.endRfu), 1)),
        csvCell(fmtNum(info.meltTempC, 2)),
        csvCell(fmtNum(info.meltPeakHeight, 1)),
      ].join(',');
    });
    zip.file('wells.csv', [headers.join(','), ...rows].join('\n'));
  }

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

  // Always write melt_derivative.csv when melt RFU exists. If the in-memory
  // derivative map is empty (some parsers don't populate it), compute it
  // here via the shared BioRad-port algorithm so round-tripped files don't
  // exercise the loader fallback at all.
  if (exp.melt && Object.keys(exp.melt.rfu).length > 0) {
    const melt = exp.melt;
    const haveDeriv = Object.keys(melt.derivative).length > 0;
    const derivativeData = haveDeriv
      ? melt.derivative
      : computeMeltDerivative(melt.temperatureC, melt.rfu);
    const meltWells = exp.wellsUsed.filter((w) => w in derivativeData);
    if (meltWells.length > 0) {
      const derivHeaders = ['temperature_C', ...meltWells];
      const derivRows = melt.temperatureC.map((temp, i) => {
        const values = [String(temp)];
        for (const w of meltWells) values.push(String(derivativeData[w]?.[i] ?? ''));
        return values.join(',');
      });
      zip.file('melt_derivative.csv', [derivHeaders.join(','), ...derivRows].join('\n'));
    }
  }

  // SUMMARY.txt — human-readable overview. Not read back by the app;
  // exists so someone can `cat` the archive and understand it.
  zip.file('SUMMARY.txt', buildSharpSummary(exp, zip));

  return zip.generateAsync({ type: 'uint8array' });
}

/** Build the human-readable SUMMARY.txt body. Lists only the files
 *  actually present in the archive. */
function buildSharpSummary(exp: ExperimentData, zip: JSZip): string {
  const md = (exp.metadata ?? {}) as Record<string, unknown>;
  const instrument = (md.instrument ?? {}) as Record<string, string>;
  const protocol = (md.protocol ?? {}) as Record<string, unknown>;
  const runInfo = (md.run_info ?? {}) as Record<string, string>;

  const instrumentLine = [
    instrument.manufacturer,
    instrument.model,
  ].filter(Boolean).join(' ') || 'Unknown';
  const instrumentExtras: string[] = [];
  if (instrument.serial_number) instrumentExtras.push(`SN ${instrument.serial_number}`);
  if (instrument.software_version) instrumentExtras.push(`sw ${instrument.software_version}`);

  const protocolBits: string[] = [];
  if (protocol.type) protocolBits.push(String(protocol.type));
  if (protocol.amp_cycle_count) protocolBits.push(`${protocol.amp_cycle_count} cycles`);
  if (protocol.reaction_temp_c != null) protocolBits.push(`${protocol.reaction_temp_c}°C reaction`);
  if (protocol.has_melt) protocolBits.push('with melt curve');

  const wellCount = exp.wellsUsed.length;
  const plate = `${exp.plateRows}×${exp.plateCols}`;

  // Only list files that actually ended up in the archive
  const descriptions: Record<string, string> = {
    'metadata.json':       'full machine-readable metadata (authoritative)',
    'amplification.csv':   'per-cycle RFU per well, wide format',
    'melt_rfu.csv':        'per-temperature RFU per well, wide format',
    'melt_derivative.csv': 'per-temperature -dF/dT per well, wide format',
    'wells.csv':           'well → sample / content / Cq / Tm manifest',
    'SUMMARY.txt':         'this file',
  };
  const presentFiles = Object.keys(descriptions).filter((f) => zip.file(f) != null);
  // SUMMARY.txt is being added right after this call so it won't appear in
  // zip.file() yet — include it explicitly.
  if (!presentFiles.includes('SUMMARY.txt')) presentFiles.push('SUMMARY.txt');
  const fileListing = presentFiles
    .map((f) => `  ${f.padEnd(22)}— ${descriptions[f]}`)
    .join('\n');

  const notes = runInfo.notes ? `\nNotes:        ${runInfo.notes}` : '';

  return [
    'SHARP Processor — Experiment Summary',
    '====================================',
    '',
    `Experiment:   ${exp.experimentId}`,
    `Operator:     ${exp.operator || '(not recorded)'}`,
    ...(notes ? [notes.trim()] : []),
    `Run started:  ${exp.runStarted || '(not recorded)'}`,
    `Instrument:   ${instrumentLine}${instrumentExtras.length ? ` (${instrumentExtras.join(', ')})` : ''}`,
    `Protocol:     ${protocolBits.join(', ') || exp.protocolType || 'unknown'}`,
    `Plate:        ${plate}, ${wellCount} well${wellCount === 1 ? '' : 's'} populated`,
    '',
    'Files in this archive:',
    fileListing,
    '',
    'For full per-well details, open wells.csv in Excel or any text editor.',
    'metadata.json is the authoritative source — edit there, not here.',
    '',
  ].join('\n');
}

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
): Promise<string> {
  const zipData = await buildSharpZip(exp, liveAnalysis);
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
