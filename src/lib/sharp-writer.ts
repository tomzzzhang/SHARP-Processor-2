/**
 * .sharp / .sharpx archive writer.
 *
 * Extracted from `export.ts` so the writer can run in a plain Node/headless
 * context (e.g. the Primer-runs `pcrd-to-sharp` CLI). `export.ts` top-imports
 * Plotly and Tauri plugins, which a bare `import` evaluates even when only the
 * writer is needed — Plotly reaches for `document` and breaks. This module has
 * no GUI/Tauri imports, only pure deps (`jszip`, `computeMeltDerivative`).
 *
 * `export.ts` re-exports `buildSharpZip` and `LiveAnalysisBundle` from here, so
 * existing callers (`saveSession` / `exportAsSharp` / `exportAsSharpx`) are
 * unchanged. No behavior change versus the original in-file implementation.
 */
import JSZip from 'jszip';
import type { ExperimentData } from '@/types/experiment';
import type { WellAnalysisResult } from '@/lib/analysis';
import { computeMeltDerivative } from '@/lib/parsers/utils';

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
export async function buildSharpZip(
  exp: ExperimentData,
  liveAnalysis?: LiveAnalysisBundle,
  session?: Record<string, unknown> | null,
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

  const expChannels = exp.channels ?? [];
  const multichannel = expChannels.length > 1;
  const metadata: Record<string, unknown> = {
    ...(exp.metadata ?? {}),
    format_version: multichannel ? '1.2' : '1.1',
    experiment_id: exp.experimentId,
    channels: expChannels,
    channel_fluorophore: exp.channelFluorophore ?? {},
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

  // Legacy single-channel CSVs (amplification.csv / melt_*.csv) carry the
  // FIRST channel (channel 0), not the active one, so 1.0/1.1 readers and
  // spreadsheet inspection always see channel 0 regardless of which channel is
  // active in the UI. For a single-channel experiment channel 0 *is* the
  // active channel, so legacyAmp/legacyMelt equal exp.amplification/exp.melt
  // and this is a no-op. (Channel-aware 1.2 readers prefer the _ch{i} files.)
  const firstCh = expChannels[0];
  const legacyAmp = firstCh != null ? (exp.amplificationByChannel?.[firstCh] ?? exp.amplification) : exp.amplification;
  const legacyMelt = firstCh != null ? (exp.meltByChannel?.[firstCh] ?? exp.melt) : exp.melt;

  if (legacyAmp) {
    const amp = legacyAmp;
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

  if (legacyMelt && Object.keys(legacyMelt.rfu).length > 0) {
    const melt = legacyMelt;
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
  if (legacyMelt && Object.keys(legacyMelt.rfu).length > 0) {
    const melt = legacyMelt;
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

  // Per-channel data CSVs (format 1.2, multichannel only). The legacy
  // amplification.csv / melt_*.csv above carry the first channel so 1.0/1.1
  // readers still load something; channel-aware readers prefer these. Files
  // are index-keyed (`_ch{i}`) to metadata.channels to avoid name-sanitization
  // ambiguity for dye names with spaces/dots.
  if (multichannel) {
    expChannels.forEach((ch, i) => {
      const amp = exp.amplificationByChannel?.[ch];
      if (amp) {
        const headers = ['cycle', 'time_s', 'time_min', ...exp.wellsUsed];
        const rows = amp.cycle.map((_, r) => {
          const v = [String(amp.cycle[r] ?? ''), String(amp.timeS[r] ?? ''), String(amp.timeMin[r] ?? '')];
          for (const w of exp.wellsUsed) v.push(String(amp.wells[w]?.[r] ?? ''));
          return v.join(',');
        });
        zip.file(`amplification_ch${i}.csv`, [headers.join(','), ...rows].join('\n'));
      }
      const m = exp.meltByChannel?.[ch];
      if (m && Object.keys(m.rfu).length > 0) {
        const meltWells = exp.wellsUsed.filter((w) => w in m.rfu);
        const rfuHeaders = ['temperature_C', ...meltWells];
        const rfuRows = m.temperatureC.map((temp, r) => {
          const v = [String(temp)];
          for (const w of meltWells) v.push(String(m.rfu[w]?.[r] ?? ''));
          return v.join(',');
        });
        zip.file(`melt_rfu_ch${i}.csv`, [rfuHeaders.join(','), ...rfuRows].join('\n'));
        const deriv = Object.keys(m.derivative).length > 0 ? m.derivative : computeMeltDerivative(m.temperatureC, m.rfu);
        const derivWells = exp.wellsUsed.filter((w) => w in deriv);
        if (derivWells.length > 0) {
          const dHeaders = ['temperature_C', ...derivWells];
          const dRows = m.temperatureC.map((temp, r) => {
            const v = [String(temp)];
            for (const w of derivWells) v.push(String(deriv[w]?.[r] ?? ''));
            return v.join(',');
          });
          zip.file(`melt_derivative_ch${i}.csv`, [dHeaders.join(','), ...dRows].join('\n'));
        }
      }
    });
  }

  // SUMMARY.txt — human-readable overview. Not read back by the app;
  // exists so someone can `cat` the archive and understand it.
  zip.file('SUMMARY.txt', buildSharpSummary(exp, zip));

  // session.json — working-session view state. Present only in `.sharpx`
  // files; plain `.sharp` exports omit it so shared data carries no
  // selection / analysis / style state.
  if (session) zip.file('session.json', JSON.stringify(session, null, 2));

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
