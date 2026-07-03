/**
 * Standalone HTML kinetics report — the shareable fallback artifact (the
 * `cli/report.ts` shape, re-authored for the processor's `ReportRow`). Fully
 * self-contained (curve + fit + readout data embedded, vanilla-JS SVG plots, no
 * external requests) so it can be saved and opened anywhere. Sample toggles hide
 * a curve's raw + fit + landmark marks and its melt trace.
 */
import { curveAt, type FivePLParams } from '@/lib/curvefit';
import type { ReportRow } from './kinetics-report';

export interface ReportHtmlCurve {
  key: string;
  label: string;
  color: string;
  rfu: number[];
  fit: FivePLParams | null;
  row: ReportRow;
  /** Baseline level subtracted when `corrected` (raw − offset); fit is in raw
   *  units so the same offset applies to it. */
  baselineOffset: number;
  deriv: number[] | null;
}

export interface ReportHtmlInput {
  title: string;
  generated: string;
  /** Show the amplification panel baseline-corrected (raw − fitted baseline). */
  corrected: boolean;
  /** Which landmark markers to draw (defaults to all on). */
  poi?: { lod: boolean; onset: boolean; infl: boolean };
  condition: { label: string; value: string }[];
  timeS: number[];
  temperatureC: number[] | null;
  curves: ReportHtmlCurve[];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (v: number | null) => (v === null || !Number.isFinite(v) ? '—' : v.toFixed(1));
const r2 = (v: number | null) => (v === null || !Number.isFinite(v) ? '—' : v.toFixed(2));
const se = (v: number | null) => (v === null || !Number.isFinite(v) ? '' : `±${v < 100 ? v.toFixed(1) : Math.round(v)}`);

/** Linear interpolation of a raw series on its time grid at time `t` (to place
 *  the `t_lod` marker on the raw curve, independent of the fit). */
function interpAt(rfu: number[], timeS: number[], t: number): number {
  const n = Math.min(rfu.length, timeS.length);
  if (n === 0) return NaN;
  if (t <= timeS[0]) return rfu[0];
  if (t >= timeS[n - 1]) return rfu[n - 1];
  for (let i = 1; i < n; i++) {
    if (timeS[i] >= t) {
      const t0 = timeS[i - 1], t1 = timeS[i];
      const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      return rfu[i - 1] + f * (rfu[i] - rfu[i - 1]);
    }
  }
  return rfu[n - 1];
}

/** Linear scale factory: domain → pixel range. */
function scale(d0: number, d1: number, p0: number, p1: number) {
  const span = d1 - d0 || 1;
  return (v: number) => p0 + ((v - d0) / span) * (p1 - p0);
}

interface PlotLine { key: string; color: string; dash?: string; width: number; opacity: number; pts: [number, number][]; }
interface PlotDot { key: string; color: string; x: number; y: number; symbol: 'lod' | 'onset' | 'infl'; }

/** Build one SVG line/scatter plot. */
function svgPlot(
  W: number, H: number, xLabel: string, yLabel: string,
  xDom: [number, number], yDom: [number, number],
  lines: PlotLine[], dots: PlotDot[],
): string {
  const m = { l: 62, r: 14, t: 12, b: 40 };
  const sx = scale(xDom[0], xDom[1], m.l, W - m.r);
  const sy = scale(yDom[0], yDom[1], H - m.b, m.t);
  const ticks = (d0: number, d1: number, n: number) =>
    Array.from({ length: n + 1 }, (_, i) => d0 + ((d1 - d0) * i) / n);
  const xt = ticks(xDom[0], xDom[1], 6);
  const yt = ticks(yDom[0], yDom[1], 5);
  const grid = [
    ...xt.map((t) => `<line x1="${sx(t).toFixed(1)}" y1="${m.t}" x2="${sx(t).toFixed(1)}" y2="${H - m.b}" class="grid"/>`),
    ...yt.map((t) => `<line x1="${m.l}" y1="${sy(t).toFixed(1)}" x2="${W - m.r}" y2="${sy(t).toFixed(1)}" class="grid"/>`),
  ].join('');
  const xlabels = xt.map((t) => `<text x="${sx(t).toFixed(1)}" y="${H - m.b + 16}" class="tick" text-anchor="middle">${Math.round(t)}</text>`).join('');
  const ylabels = yt.map((t) => `<text x="${m.l - 6}" y="${(sy(t) + 3).toFixed(1)}" class="tick" text-anchor="end">${Math.round(t)}</text>`).join('');
  const path = (l: PlotLine) =>
    `<polyline data-key="${esc(l.key)}" fill="none" stroke="${l.color}" stroke-width="${l.width}" ${l.dash ? `stroke-dasharray="${l.dash}"` : ''} stroke-opacity="${l.opacity}" points="${l.pts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ')}"/>`;
  const dot = (d: PlotDot) => {
    const cx = sx(d.x).toFixed(1), cy = sy(d.y).toFixed(1);
    if (d.symbol === 'lod') return `<path data-key="${esc(d.key)}" class="mk" d="M${cx},${(+cy - 4).toFixed(1)} l4,7 h-8 z" fill="${d.color}"/>`;
    if (d.symbol === 'onset') return `<path data-key="${esc(d.key)}" class="mk" d="M${cx},${(+cy - 4).toFixed(1)} l4,4 l-4,4 l-4,-4 z" fill="${d.color}"/>`;
    return `<circle data-key="${esc(d.key)}" class="mk" cx="${cx}" cy="${cy}" r="3" fill="${d.color}"/>`;
  };
  return `<svg viewBox="0 0 ${W} ${H}" class="plot">
    ${grid}
    <line x1="${m.l}" y1="${H - m.b}" x2="${W - m.r}" y2="${H - m.b}" class="axis"/>
    <line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${H - m.b}" class="axis"/>
    ${xlabels}${ylabels}
    <text x="${(m.l + W - m.r) / 2}" y="${H - 4}" class="axtitle" text-anchor="middle">${esc(xLabel)}</text>
    <text x="14" y="${(m.t + H - m.b) / 2}" class="axtitle" text-anchor="middle" transform="rotate(-90 14 ${(m.t + H - m.b) / 2})">${esc(yLabel)}</text>
    ${lines.map(path).join('')}
    ${dots.map(dot).join('')}
  </svg>`;
}

export function buildReportHtml(input: ReportHtmlInput): string {
  const { curves, timeS } = input;
  const offOf = (c: ReportHtmlCurve) => (input.corrected ? c.baselineOffset : 0);
  const poi = input.poi ?? { lod: true, onset: true, infl: true };

  // ── Amplification plot: data (thin) + fit (solid) + landmark marks ──
  const xDomAmp: [number, number] = [timeS[0] ?? 0, timeS[timeS.length - 1] ?? 1];
  let yLo = Infinity, yHi = -Infinity;
  for (const c of curves) { const o = offOf(c); for (const v of c.rfu) { const y = v - o; if (y < yLo) yLo = y; if (y > yHi) yHi = y; } }
  if (!Number.isFinite(yLo)) { yLo = 0; yHi = 1; }
  const padY = (yHi - yLo) * 0.05 || 1;
  const yDomAmp: [number, number] = [yLo - padY, yHi + padY];

  const ampLines: PlotLine[] = [];
  const ampDots: PlotDot[] = [];
  for (const c of curves) {
    const o = offOf(c);
    ampLines.push({ key: c.key, color: c.color, width: 1, opacity: 0.4, pts: c.rfu.map((v, i) => [timeS[i], v - o]) });
    // t_lod on the data curve — a detection landmark, shown even when the fit is
    // censored/unusable.
    if (poi.lod && c.row.t_lod !== null && Number.isFinite(c.row.t_lod)) {
      ampDots.push({ key: c.key, color: c.color, x: c.row.t_lod, y: interpAt(c.rfu, timeS, c.row.t_lod) - o, symbol: 'lod' });
    }
    if (c.fit && c.fit.A !== null) {
      ampLines.push({ key: c.key, color: c.color, width: 1.8, opacity: 0.95, pts: timeS.map((t) => [t, curveAt(t, c.fit as FivePLParams) - o]) });
      // t_onset10 / inflection are fit-derived — on the fitted curve.
      const mark = (t: number | null, symbol: 'lod' | 'onset' | 'infl') => {
        if (t === null || !Number.isFinite(t)) return;
        ampDots.push({ key: c.key, color: c.color, x: t, y: curveAt(t, c.fit as FivePLParams) - o, symbol });
      };
      if (poi.onset) mark(c.row.t_onset10, 'onset');
      if (poi.infl) mark(c.row.fit_inflection_t, 'infl');
    }
  }
  const ampSvg = svgPlot(900, 380, 'Time (s)', input.corrected ? 'Baseline-corrected RFU' : 'Fluorescence (RFU)', xDomAmp, yDomAmp, ampLines, ampDots);

  // ── Melt plot: −dF/dT ──
  let meltSvg = '';
  const meltCurves = curves.filter((c) => c.deriv && c.deriv.length > 1);
  if (input.temperatureC && meltCurves.length) {
    const T = input.temperatureC;
    const xDomM: [number, number] = [T[0], T[T.length - 1]];
    let lo = Infinity, hi = -Infinity;
    for (const c of meltCurves) for (const v of c.deriv!) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const padM = (hi - lo) * 0.05 || 1;
    const meltLines: PlotLine[] = meltCurves.map((c) => ({
      key: c.key, color: c.color, width: 1.4, opacity: 0.9, pts: c.deriv!.map((v, i) => [T[i], v]),
    }));
    meltSvg = svgPlot(900, 300, 'Temperature (°C)', '−dF/dT', xDomM, [lo - padM, hi + padM], meltLines, []);
  }

  // ── Sample toggles ──
  const toggles = curves.map((c) =>
    `<label class="tog"><input type="checkbox" checked data-toggle="${esc(c.key)}"><span class="sw" style="background:${c.color}"></span>${esc(c.label)}</label>`,
  ).join('');

  // ── Kinetics table ──
  const chip = (v: boolean) => `<span class="flag ${v ? 'on' : 'off'}">${v ? '✓' : '—'}</span>`;
  const cell = (v: number | null, s: number | null, fmt: (x: number | null) => string) =>
    `<td class="num">${fmt(v)}</td><td class="num sesh">${esc(se(s))}</td>`;
  const tableRows = curves.map((c) => {
    const r = c.row;
    return `<tr data-key="${esc(c.key)}"><td>${esc(r.well)}</td><td><span class="sw" style="background:${c.color}"></span>${esc(c.label)}</td>
      ${cell(r.t_lod, r.t_lod_se, r1)}
      ${cell(r.t_onset10, r.t_onset10_se, r1)}
      ${cell(r.td_5, r.td_5_se, r1)}
      ${cell(r.td_20, r.td_20_se, r1)}
      ${cell(r.td_50, r.td_50_se, r1)}
      ${cell(r.yield_raw, r.yield_raw_se, (x) => (x === null ? '—' : Math.round(x).toString()))}
      ${cell(r.melt_tm, r.melt_tm_se, r2)}
      <td class="ctr">${chip(r.baseline_observed)}</td>
      <td class="ctr">${chip(r.plateau_observed)}</td>
      <td class="ctr call ${r.call ?? ''}">${r.call === 'positive' ? '+' : r.call === 'negative' ? '−' : '?'}</td></tr>`;
  }).join('');

  // ── Reconstruction table (6 params) ──
  const reconRows = curves.map((c) => {
    const r = c.row;
    return `<tr data-key="${esc(c.key)}"><td>${esc(r.well)}</td><td><span class="sw" style="background:${c.color}"></span>${esc(c.label)}</td>
      ${cell(r.fit_A, r.fit_A_se, r1)}${cell(r.fit_B, r.fit_B_se, (x) => (x === null ? '—' : x.toFixed(4)))}
      ${cell(r.fit_C, r.fit_C_se, r1)}${cell(r.fit_D, r.fit_D_se, r1)}
      ${cell(r.fit_foot, r.fit_foot_se, r2)}${cell(r.fit_shoulder, r.fit_shoulder_se, r2)}
      <td class="num">${r2(r.fit_r2)}</td><td class="num">${r1(r.fit_rmse)}</td></tr>`;
  }).join('');

  const chips = input.condition.map((c) => `<span class="cond"><b>${esc(c.label)}</b> ${esc(c.value)}</span>`).join('');

  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(input.title)} — Kinetics report</title>
<style>
  :root { --ink:#1a1a1a; --muted:#6b7280; --line:#e5e7eb; --brand:#aa2026; --sh:#f3f4f6; }
  * { box-sizing: border-box; }
  body { font: 13px/1.45 -apple-system, Segoe UI, Roboto, sans-serif; color: var(--ink); margin: 0; padding: 24px; background:#fff; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .sub { color: var(--muted); font-size: 12px; margin-bottom: 12px; }
  .conds { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:16px; }
  .cond { background: var(--sh); border:1px solid var(--line); border-radius:999px; padding:2px 10px; font-size:12px; }
  .cond b { color: var(--muted); font-weight:600; margin-right:4px; }
  section { margin: 20px 0; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); border-bottom:1px solid var(--line); padding-bottom:4px; margin:0 0 10px; }
  .togs { display:flex; flex-wrap:wrap; gap:4px 14px; margin-bottom:10px; }
  .tog { display:inline-flex; align-items:center; gap:5px; font-size:12px; cursor:pointer; }
  .sw { width:10px; height:10px; border-radius:2px; display:inline-block; }
  .plotwrap { overflow-x:auto; }
  .plot { width:100%; max-width:960px; height:auto; border:1px solid var(--line); border-radius:6px; background:#fff; }
  .grid { stroke:#f0f0f0; stroke-width:1; }
  .axis { stroke:#cfcfcf; stroke-width:1; }
  .tick { fill: var(--muted); font-size:10px; }
  .axtitle { fill: var(--ink); font-size:11px; }
  .legend { font-size:11px; color:var(--muted); margin-top:6px; display:flex; gap:16px; }
  .legend span { display:inline-flex; align-items:center; gap:5px; }
  table { border-collapse: collapse; font-size:12px; width:100%; }
  .tblwrap { overflow-x:auto; }
  th, td { padding:3px 8px; text-align:left; white-space:nowrap; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.03em; position:sticky; top:0; background:#fff; }
  td.num, th.num { text-align:right; font-variant-numeric: tabular-nums; }
  td.sesh { color: var(--muted); background: var(--sh); font-size:11px; padding-left:2px; }
  td.ctr, th.ctr { text-align:center; }
  .flag.on { color:#15803d; } .flag.off { color:#9ca3af; }
  .call.positive { color:#15803d; font-weight:700; } .call.negative { color:#b91c1c; font-weight:700; }
  .hidden { display:none; }
</style>
<h1>${esc(input.title)}</h1>
<div class="sub">Kinetics report · channel ${esc(input.condition.find((c) => c.label === 'Channel')?.value ?? '')} · generated ${esc(input.generated)}</div>
<div class="conds">${chips}</div>

<section>
  <h2>Samples</h2>
  <div class="togs">${toggles}</div>
</section>

<section>
  <h2>Amplification — ${input.corrected ? 'baseline-corrected' : 'raw'} + FreeShoulder fit</h2>
  <div class="plotwrap">${ampSvg}</div>
  <div class="legend"><span>▲ t_lod</span><span>◆ t_onset10</span><span>● inflection</span><span>thin = ${input.corrected ? 'corrected' : 'raw'} data · bold = fit</span></div>
</section>

${meltSvg ? `<section><h2>Melt — −dF/dT</h2><div class="plotwrap">${meltSvg}</div></section>` : ''}

<section>
  <h2>Kinetics</h2>
  <div class="tblwrap"><table>
    <thead><tr>
      <th>Well</th><th>Sample</th><th class="num">t_lod</th><th class="num">±</th><th class="num">t_onset10</th><th class="num">±</th>
      <th class="num">Td₅</th><th class="num">±</th><th class="num">Td₂₀</th><th class="num">±</th><th class="num">Td₅₀</th><th class="num">±</th>
      <th class="num">Yield</th><th class="num">±</th><th class="num">Tm</th><th class="num">±</th>
      <th class="ctr">base</th><th class="ctr">plat</th><th class="ctr">call</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table></div>
  <div class="sub" style="margin-top:6px">Shaded ± columns are standard errors. <b>base</b> = baseline observed, <b>plat</b> = plateau observed (unchecked = right-censored: D / foot / shoulder / yield extrapolated). All times in seconds.</div>
</section>

<section>
  <h2>Curve reconstruction (FreeShoulder parameters)</h2>
  <div class="tblwrap"><table>
    <thead><tr><th>Well</th><th>Sample</th><th class="num">A</th><th class="num">±</th><th class="num">B</th><th class="num">±</th><th class="num">C</th><th class="num">±</th><th class="num">D</th><th class="num">±</th><th class="num">foot</th><th class="num">±</th><th class="num">shoulder</th><th class="num">±</th><th class="num">r²</th><th class="num">rmse</th></tr></thead>
    <tbody>${reconRows}</tbody>
  </table></div>
</section>

<script>
  document.querySelectorAll('input[data-toggle]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      var key = cb.getAttribute('data-toggle');
      var on = cb.checked;
      document.querySelectorAll('[data-key="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]').forEach(function (el) {
        el.classList.toggle('hidden', !on);
      });
    });
  });
</script>`;
}
