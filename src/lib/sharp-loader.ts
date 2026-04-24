import JSZip from 'jszip';
import type {
  ExperimentData, AmplificationData, MeltData, WellInfo, ContentType,
} from '../types/experiment';
import { inferPlateDimensions, getInstrumentPlateLayout, DEFAULT_PLATE_ROW_COUNT, DEFAULT_PLATE_COL_COUNT } from './constants';

/** Parse a wide-format CSV string into { headers, rows } */
function parseCSV(text: string): { headers: string[]; rows: number[][] } {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows: number[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    rows.push(line.split(',').map(Number));
  }
  return { headers, rows };
}

/** Parse a CSV row respecting double-quoted fields (for string columns
 *  in wells.csv that may contain commas in sample names). Handles doubled
 *  quotes inside a quoted field. */
function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"' && cur === '') inQuotes = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** Parse wells.csv (format 1.1) into a partial WellInfo map. Only the
 *  fields present in the CSV are populated; missing cells → null/''. */
function parseWellsCsv(text: string): Record<string, Partial<WellInfo>> {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return {};
  const headers = parseCsvRow(lines[0]).map((h) => h.trim());
  const col = (name: string) => headers.indexOf(name);
  const iWell = col('well');
  if (iWell < 0) return {};
  const iSample = col('sample');
  const iContent = col('content');
  const iCq = col('cq');
  const iEndRfu = col('end_rfu');
  const iTm = col('melt_temp_c');
  const iPeak = col('melt_peak_height');

  const result: Record<string, Partial<WellInfo>> = {};
  const num = (s: string | undefined) => {
    if (s == null || s === '') return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  };
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvRow(lines[i]);
    const well = (cells[iWell] ?? '').trim();
    if (!well) continue;
    result[well] = {
      well,
      sample: iSample >= 0 ? (cells[iSample] ?? '') : '',
      content: (iContent >= 0 ? (cells[iContent] ?? '') : '') as ContentType,
      cq: iCq >= 0 ? num(cells[iCq]) : null,
      endRfu: iEndRfu >= 0 ? num(cells[iEndRfu]) : null,
      meltTempC: iTm >= 0 ? num(cells[iTm]) : null,
      meltPeakHeight: iPeak >= 0 ? num(cells[iPeak]) : null,
    };
  }
  return result;
}

/** Parse amplification.csv into AmplificationData */
function parseAmplification(text: string): AmplificationData {
  const { headers, rows } = parseCSV(text);

  const cycleIdx = headers.indexOf('cycle');
  const timeSIdx = headers.indexOf('time_s');
  const timeMinIdx = headers.indexOf('time_min');

  const cycle: number[] = [];
  const timeS: number[] = [];
  const timeMin: number[] = [];
  const wells: Record<string, number[]> = {};

  // Well columns are everything except cycle, time_s, time_min
  const wellHeaders: { name: string; idx: number }[] = [];
  for (let i = 0; i < headers.length; i++) {
    if (i !== cycleIdx && i !== timeSIdx && i !== timeMinIdx) {
      wellHeaders.push({ name: headers[i], idx: i });
      wells[headers[i]] = [];
    }
  }

  for (const row of rows) {
    if (cycleIdx >= 0) cycle.push(row[cycleIdx]);
    if (timeSIdx >= 0) timeS.push(row[timeSIdx]);
    if (timeMinIdx >= 0) timeMin.push(row[timeMinIdx]);
    for (const { name, idx } of wellHeaders) {
      wells[name].push(row[idx]);
    }
  }

  return { cycle, timeS, timeMin, wells };
}

/** Parse melt CSVs into MeltData */
function parseMelt(rfuText: string | null, derivText: string | null): MeltData | null {
  if (!rfuText && !derivText) return null;

  const rfu: Record<string, number[]> = {};
  const derivative: Record<string, number[]> = {};
  let temperatureC: number[] = [];

  if (rfuText) {
    const { headers, rows } = parseCSV(rfuText);
    const tempIdx = headers.indexOf('temperature_C');
    const wellHeaders = headers.filter((_, i) => i !== tempIdx);

    for (const name of wellHeaders) rfu[name] = [];
    for (const row of rows) {
      if (tempIdx >= 0) temperatureC.push(row[tempIdx]);
      for (const name of wellHeaders) {
        rfu[name].push(row[headers.indexOf(name)]);
      }
    }
  }

  if (derivText) {
    const { headers, rows } = parseCSV(derivText);
    const tempIdx = headers.indexOf('temperature_C');
    const wellHeaders = headers.filter((_, i) => i !== tempIdx);

    if (temperatureC.length === 0) {
      for (const row of rows) {
        if (tempIdx >= 0) temperatureC.push(row[tempIdx]);
      }
    }
    for (const name of wellHeaders) derivative[name] = [];
    for (const row of rows) {
      for (const name of wellHeaders) {
        derivative[name].push(row[headers.indexOf(name)]);
      }
    }
  }

  // Compute derivative on-the-fly if melt RFU exists but derivative is missing
  // Uses numerical gradient: -dF/dT ≈ -(rfu[i+1] - rfu[i-1]) / (temp[i+1] - temp[i-1])
  if (Object.keys(rfu).length > 0 && Object.keys(derivative).length === 0 && temperatureC.length > 2) {
    for (const [well, rfuData] of Object.entries(rfu)) {
      const deriv: number[] = new Array(rfuData.length);
      // Forward difference for first point
      deriv[0] = -(rfuData[1] - rfuData[0]) / (temperatureC[1] - temperatureC[0]);
      // Central difference for interior points
      for (let i = 1; i < rfuData.length - 1; i++) {
        deriv[i] = -(rfuData[i + 1] - rfuData[i - 1]) / (temperatureC[i + 1] - temperatureC[i - 1]);
      }
      // Backward difference for last point
      const n = rfuData.length - 1;
      deriv[n] = -(rfuData[n] - rfuData[n - 1]) / (temperatureC[n] - temperatureC[n - 1]);
      derivative[well] = deriv;
    }
  }

  return { temperatureC, rfu, derivative };
}

/** Load a .sharp ZIP file (ArrayBuffer) into ExperimentData */
export async function loadSharpFile(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<ExperimentData> {
  const zip = await JSZip.loadAsync(buffer);

  // Read metadata.json (required)
  const metadataFile = zip.file('metadata.json');
  if (!metadataFile) {
    throw new Error('Invalid .sharp file: missing metadata.json');
  }
  const metadata = JSON.parse(await metadataFile.async('string'));

  // Read amplification.csv (required)
  const ampFile = zip.file('amplification.csv');
  if (!ampFile) {
    throw new Error('Invalid .sharp file: missing amplification.csv');
  }
  const amplification = parseAmplification(await ampFile.async('string'));

  // Read melt CSVs (optional)
  const meltRfuFile = zip.file('melt_rfu.csv');
  const meltDerivFile = zip.file('melt_derivative.csv');
  const meltRfuText = meltRfuFile ? await meltRfuFile.async('string') : null;
  const meltDerivText = meltDerivFile ? await meltDerivFile.async('string') : null;
  const melt = parseMelt(meltRfuText, meltDerivText);

  // Build per-well info. Format 1.1 adds wells.csv — if present, it's
  // preferred for the user-editable fields (sample, content). Numeric
  // analysis outputs (cq, endRfu, meltTempC, meltPeakHeight) prefer the
  // CSV when non-null but fall back to metadata.json.
  const wells: Record<string, WellInfo> = {};
  const metaWells = (metadata.wells ?? {}) as Record<string, Record<string, unknown>>;
  const wellsCsvFile = zip.file('wells.csv');
  const wellsCsv = wellsCsvFile ? parseWellsCsv(await wellsCsvFile.async('string')) : {};

  const allWellNames = new Set<string>([
    ...Object.keys(metaWells),
    ...Object.keys(wellsCsv),
  ]);
  for (const wellName of allWellNames) {
    const m = metaWells[wellName] ?? {};
    const c = wellsCsv[wellName] ?? {};
    wells[wellName] = {
      well: wellName,
      sample: c.sample ?? ((m.sample as string) ?? ''),
      content: (c.content || (m.content as ContentType) || '') as ContentType,
      cq: c.cq ?? ((m.cq as number) ?? null),
      endRfu: c.endRfu ?? ((m.end_rfu as number) ?? null),
      meltTempC: c.meltTempC ?? ((m.melt_temp_c as number) ?? null),
      meltPeakHeight: c.meltPeakHeight ?? ((m.melt_peak_height as number) ?? null),
      call: 'unset',
    };
  }

  // Wells used list
  const wellsUsed: string[] =
    metadata.data_summary?.wells_used ??
    Object.keys(amplification.wells);

  // Extract experiment-level info
  const experimentId =
    metadata.experiment_id ??
    fileName.replace(/\.sharp$/i, '');

  // Determine plate dimensions: explicit metadata > instrument lookup > infer from wells
  const explicitRows = (metadata.plate_layout?.rows ?? metadata.instrument?.plate_rows) as number | undefined;
  const explicitCols = (metadata.plate_layout?.cols ?? metadata.instrument?.plate_cols) as number | undefined;
  let plateRows: number;
  let plateCols: number;
  if (explicitRows && explicitCols) {
    plateRows = explicitRows;
    plateCols = explicitCols;
  } else {
    const instrumentModel = (metadata.instrument?.model ?? '') as string;
    const knownLayout = instrumentModel ? getInstrumentPlateLayout(instrumentModel) : null;
    if (knownLayout) {
      plateRows = knownLayout.rows;
      plateCols = knownLayout.cols;
    } else {
      const inferred = inferPlateDimensions(wellsUsed);
      plateRows = inferred.rows > 0 ? inferred.rows : DEFAULT_PLATE_ROW_COUNT;
      plateCols = inferred.cols > 0 ? inferred.cols : DEFAULT_PLATE_COL_COUNT;
    }
  }

  return {
    experimentId,
    sourcePath: fileName,
    metadata,
    amplification,
    melt,
    wells,
    wellsUsed,
    plateRows,
    plateCols,
    formatVersion: metadata.format_version ?? '1.0',
    protocolType: metadata.protocol?.type ?? 'unknown',
    operator: metadata.run_info?.operator ?? '',
    notes: metadata.run_info?.notes ?? '',
    runStarted: metadata.run_info?.run_started_utc ?? '',
  };
}
