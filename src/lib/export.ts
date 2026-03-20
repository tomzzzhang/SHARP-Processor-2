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

  // Get the plot's current dimensions
  const rect = plotDiv.querySelector('.plot-container')?.getBoundingClientRect()
    ?? plotDiv.getBoundingClientRect();
  const scale = dpi / 96; // scale relative to screen DPI

  const result = await Plotly.toImage(plotDiv, {
    format,
    width: rect.width * scale,
    height: rect.height * scale,
    scale: 1,
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
 * Export the current experiment as a .sharp file (ZIP archive).
 * Preserves user edits to sample names, notes, descriptions, and content types.
 */
export async function exportAsSharp(exp: ExperimentData): Promise<string | null> {
  const filePath = await save({
    defaultPath: `${exp.experimentId}.sharp`,
    filters: [{ name: 'SHARP File', extensions: ['sharp'] }],
  });
  if (!filePath) return null;

  const zip = new JSZip();

  // Build metadata.json from current experiment state
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

  // Write per-well metadata (sample, content, cq, etc.)
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

  // Build amplification.csv
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

  // Build melt_rfu.csv
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

  // Build melt_derivative.csv
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

  // Generate ZIP and write
  const zipBlob = await zip.generateAsync({ type: 'uint8array' });
  await writeFile(filePath, zipBlob);
  return filePath;
}
