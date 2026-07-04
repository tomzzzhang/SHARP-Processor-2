/**
 * Machine-readable companion to the human `report-html.ts`. Flattens every curve
 * (S-C pair) into one CSV row carrying all kinetics readouts + fit parameters,
 * each with its standard error. Full numeric precision (no rounding), CSV-quoted
 * strings, CRLF line endings (spreadsheet-friendly). Times in seconds, Tm in °C.
 */
import type { ReportRow } from './kinetics-report';

const q = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const n = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '' : String(v));
const b = (v: boolean | null | undefined) => (v === null || v === undefined ? '' : v ? 'true' : 'false');

type Col = [header: string, get: (r: ReportRow) => string];

const COLS: Col[] = [
  ['well', (r) => q(r.well)],
  ['sample', (r) => q(r.sample)],
  ['channel', (r) => q(r.channel)],
  ['call', (r) => r.call ?? ''],
  ['quality', (r) => q(String(r.quality))],
  ['baseline_observed', (r) => b(r.baseline_observed)],
  ['plateau_observed', (r) => b(r.plateau_observed)],
  ['well_sigma', (r) => n(r.well_sigma)],
  ['run_sigma', (r) => n(r.run_sigma)],
  ['t_lod', (r) => n(r.t_lod)], ['t_lod_se', (r) => n(r.t_lod_se)],
  ['t_onset10', (r) => n(r.t_onset10)], ['t_onset10_se', (r) => n(r.t_onset10_se)],
  ['td_5', (r) => n(r.td_5)], ['td_5_se', (r) => n(r.td_5_se)],
  ['td_20', (r) => n(r.td_20)], ['td_20_se', (r) => n(r.td_20_se)],
  ['td_50', (r) => n(r.td_50)], ['td_50_se', (r) => n(r.td_50_se)],
  ['yield_raw', (r) => n(r.yield_raw)], ['yield_raw_se', (r) => n(r.yield_raw_se)],
  ['melt_tm', (r) => n(r.melt_tm)], ['melt_tm_se', (r) => n(r.melt_tm_se)],
  ['melt_peak_height', (r) => n(r.melt_peak_height)], ['melt_peak_height_se', (r) => n(r.melt_peak_height_se)],
  ['fit_A', (r) => n(r.fit_A)], ['fit_A_se', (r) => n(r.fit_A_se)],
  ['fit_B', (r) => n(r.fit_B)], ['fit_B_se', (r) => n(r.fit_B_se)],
  ['fit_C', (r) => n(r.fit_C)], ['fit_C_se', (r) => n(r.fit_C_se)],
  ['fit_D', (r) => n(r.fit_D)], ['fit_D_se', (r) => n(r.fit_D_se)],
  ['fit_foot', (r) => n(r.fit_foot)], ['fit_foot_se', (r) => n(r.fit_foot_se)],
  ['fit_shoulder', (r) => n(r.fit_shoulder)], ['fit_shoulder_se', (r) => n(r.fit_shoulder_se)],
  ['fit_inflection_t', (r) => n(r.fit_inflection_t)], ['fit_inflection_t_se', (r) => n(r.fit_inflection_t_se)],
  ['fit_max_slope', (r) => n(r.fit_max_slope)], ['fit_max_slope_se', (r) => n(r.fit_max_slope_se)],
  ['fit_r2', (r) => n(r.fit_r2)], ['fit_rmse', (r) => n(r.fit_rmse)],
  ['fit_converged', (r) => b(r.fit_converged)],
  ['baseline_offset', (r) => n(r.baseline_offset)],
];

export function buildReportCsv(rows: ReportRow[], opts?: { experiment?: string }): string {
  const withExp = opts?.experiment !== undefined;
  const header = (withExp ? ['experiment'] : []).concat(COLS.map((c) => c[0]));
  const lines = [header.join(',')];
  for (const r of rows) {
    const cells = (withExp ? [q(opts!.experiment!)] : []).concat(COLS.map((c) => c[1](r)));
    lines.push(cells.join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
