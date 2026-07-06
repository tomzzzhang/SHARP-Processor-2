/**
 * Standalone HTML kinetics report — the shareable fallback artifact (the
 * `cli/report.ts` shape, re-authored for the processor's `ReportRow`). Fully
 * self-contained (curve + fit + readout data embedded, vanilla-JS SVG plots, no
 * external requests) so it can be saved and opened anywhere. Sample toggles hide
 * a curve's raw + fit + landmark marks and its melt trace.
 */
import { curveAt, type FivePLParams } from '@/lib/curvefit';
import { fitCensorReason, type ReportRow } from './kinetics-report';

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
  /** Pooled run σ (the measurement noise floor) — the ±band on the residual strip. */
  runSigma: number;
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

interface PlotLine { key: string; color: string; dash?: string; width: number; opacity: number; role?: 'data' | 'fit' | 'melt'; pts: [number, number][]; }
interface PlotDot { key: string; color: string; x: number; y: number; symbol: 'lod' | 'onset' | 'infl'; }

/** Build one SVG line/scatter plot. */
function svgPlot(
  W: number, H: number, xLabel: string, yLabel: string,
  xDom: [number, number], yDom: [number, number],
  lines: PlotLine[], dots: PlotDot[],
): string {
  const m = { l: 64, r: 16, t: 14, b: 42 };
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
  const xlabels = xt.map((t) => `<text x="${sx(t).toFixed(1)}" y="${H - m.b + 17}" class="tick" text-anchor="middle">${Math.round(t)}</text>`).join('');
  const ylabels = yt.map((t) => `<text x="${m.l - 8}" y="${(sy(t) + 3).toFixed(1)}" class="tick" text-anchor="end">${Math.round(t)}</text>`).join('');
  const path = (l: PlotLine) =>
    `<polyline class="ln${l.role ? ` ln-${l.role}` : ''}" data-key="${esc(l.key)}" fill="none" stroke="${l.color}" stroke-width="${l.width}" ${l.dash ? `stroke-dasharray="${l.dash}"` : ''} stroke-opacity="${l.opacity}" stroke-linejoin="round" points="${l.pts.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ')}"/>`;
  const dot = (d: PlotDot) => {
    const cx = sx(d.x).toFixed(1), cy = sy(d.y).toFixed(1);
    if (d.symbol === 'lod') return `<path data-key="${esc(d.key)}" class="mk mk-lod" d="M${cx},${(+cy - 4).toFixed(1)} l4,7 h-8 z" fill="${d.color}"/>`;
    if (d.symbol === 'onset') return `<path data-key="${esc(d.key)}" class="mk mk-onset" d="M${cx},${(+cy - 4).toFixed(1)} l4,4 l-4,4 l-4,-4 z" fill="${d.color}"/>`;
    return `<circle data-key="${esc(d.key)}" class="mk mk-infl" cx="${cx}" cy="${cy}" r="3" fill="${d.color}"/>`;
  };
  return `<svg viewBox="0 0 ${W} ${H}" class="plot">
    ${grid}
    <line x1="${m.l}" y1="${H - m.b}" x2="${W - m.r}" y2="${H - m.b}" class="axis"/>
    <line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${H - m.b}" class="axis"/>
    ${xlabels}${ylabels}
    <text x="${(m.l + W - m.r) / 2}" y="${H - 5}" class="axtitle" text-anchor="middle">${esc(xLabel)}</text>
    <text x="15" y="${(m.t + H - m.b) / 2}" class="axtitle" text-anchor="middle" transform="rotate(-90 15 ${(m.t + H - m.b) / 2})">${esc(yLabel)}</text>
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
    // Data is the ground truth → bold and solid; the fit is a fainter, thinner overlay.
    ampLines.push({ key: c.key, color: c.color, width: 1.8, opacity: 0.9, role: 'data', pts: c.rfu.map((v, i) => [timeS[i], v - o]) });
    // All landmark types are always drawn; `poi` only sets their initial
    // visibility so they can be toggled on/off live in the standalone report.
    // t_lod sits on the data curve — a detection landmark, shown even when the
    // fit is censored/unusable.
    if (c.row.t_lod !== null && Number.isFinite(c.row.t_lod)) {
      ampDots.push({ key: c.key, color: c.color, x: c.row.t_lod, y: interpAt(c.rfu, timeS, c.row.t_lod) - o, symbol: 'lod' });
    }
    if (c.fit && c.fit.A !== null) {
      ampLines.push({ key: c.key, color: c.color, width: 1, opacity: 0.5, role: 'fit', pts: timeS.map((t) => [t, curveAt(t, c.fit as FivePLParams) - o]) });
      // t_onset10 / inflection are fit-derived — on the fitted curve.
      const mark = (t: number | null, symbol: 'lod' | 'onset' | 'infl') => {
        if (t === null || !Number.isFinite(t)) return;
        ampDots.push({ key: c.key, color: c.color, x: t, y: curveAt(t, c.fit as FivePLParams) - o, symbol });
      };
      mark(c.row.t_onset10, 'onset');
      mark(c.row.fit_inflection_t, 'infl');
    }
  }
  const ampSvg = svgPlot(900, 380, 'Time (s)', input.corrected ? 'Baseline-corrected RFU' : 'Fluorescence (RFU)', xDomAmp, yDomAmp, ampLines, ampDots);

  // ── Residuals (observed − fit) per fitted curve, pre-computed here and rendered
  //    on demand in the browser (renderResid) below the amp plot when a row is
  //    clicked. The residual is display-invariant (the baseline offset cancels),
  //    so it's just raw − curveAt. Only curves with a usable fit have a strip. ──
  const residData: Record<string, { label: string; color: string; pts?: [number, number][]; note?: string }> = {};
  for (const c of curves) {
    if (c.fit && c.fit.A !== null) {
      const pts: [number, number][] = [];
      for (let i = 0; i < timeS.length; i++) {
        const rv = c.rfu[i] - curveAt(timeS[i], c.fit as FivePLParams);
        if (Number.isFinite(rv)) pts.push([timeS[i], rv]);
      }
      if (pts.length) { residData[c.key] = { label: c.label, color: c.color, pts }; continue; }
    }
    // No usable fit → carry the reason (no plateau, etc.) so the strip flags it.
    residData[c.key] = { label: c.label, color: c.color, note: fitCensorReason(c.row) };
  }
  // Escape `<` so a sample name containing "</script>" can't break out of the tag.
  const residJson = JSON.stringify(residData).replace(/</g, '\\u003c');

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
      key: c.key, color: c.color, width: 1.4, opacity: 0.9, role: 'melt', pts: c.deriv!.map((v, i) => [T[i], v]),
    }));
    // Melt panel is 3/5 the amplification-plot height — the derivative reads fine
    // in a shorter band and it keeps the report compact.
    meltSvg = svgPlot(900, 180, 'Temperature (°C)', '−dF/dT', xDomM, [lo - padM, hi + padM], meltLines, []);
  }

  // ── Sample toggles ──
  const toggles = curves.map((c) =>
    `<label class="tog"><input type="checkbox" checked data-toggle="${esc(c.key)}"><span class="sw" style="background:${c.color}"></span>${esc(c.label)}</label>`,
  ).join('');

  // ── Summary counts ──
  const nPos = curves.filter((c) => c.row.call === 'positive').length;
  const nNeg = curves.filter((c) => c.row.call === 'negative').length;

  // ── Kinetics table ──
  const flag = (v: boolean) => `<span class="flag ${v ? 'on' : 'off'}">${v ? '✓' : '—'}</span>`;
  const callCell = (call: ReportRow['call']) => {
    const c = call === 'positive' ? 'pos' : call === 'negative' ? 'neg' : 'unk';
    const ch = call === 'positive' ? '+' : call === 'negative' ? '−' : '?';
    return `<td class="ctr callcell"><span class="call ${c}">${ch}</span></td>`;
  };
  const cell = (v: number | null, s: number | null, fmt: (x: number | null) => string) => {
    const st = se(s);
    return `<td class="num">${fmt(v)}${st ? `<span class="se">${esc(st)}</span>` : ''}</td>`;
  };
  const swatch = (c: ReportHtmlCurve) => `<span class="sw" style="background:${c.color}"></span>`;
  const tableRows = curves.map((c) => {
    const r = c.row;
    return `<tr data-key="${esc(c.key)}"><td>${esc(r.well)}</td><td>${swatch(c)}${esc(c.label)}</td>
      ${cell(r.t_lod, r.t_lod_se, r1)}
      ${cell(r.t_onset10, r.t_onset10_se, r1)}
      ${cell(r.td_5, r.td_5_se, r1)}
      ${cell(r.td_20, r.td_20_se, r1)}
      ${cell(r.td_50, r.td_50_se, r1)}
      ${cell(r.yield_raw, r.yield_raw_se, (x) => (x === null ? '—' : Math.round(x).toString()))}
      ${cell(r.melt_tm, r.melt_tm_se, r2)}
      <td class="ctr">${flag(r.baseline_observed)}</td>
      <td class="ctr">${flag(r.plateau_observed)}</td>
      ${callCell(r.call)}</tr>`;
  }).join('');

  // ── Reconstruction table (6 params) ──
  const reconRows = curves.map((c) => {
    const r = c.row;
    return `<tr data-key="${esc(c.key)}"><td>${esc(r.well)}</td><td>${swatch(c)}${esc(c.label)}</td>
      ${cell(r.fit_A, r.fit_A_se, r1)}${cell(r.fit_B, r.fit_B_se, (x) => (x === null ? '—' : x.toFixed(4)))}
      ${cell(r.fit_C, r.fit_C_se, r1)}${cell(r.fit_D, r.fit_D_se, r1)}
      ${cell(r.fit_foot, r.fit_foot_se, r2)}${cell(r.fit_shoulder, r.fit_shoulder_se, r2)}
      <td class="num">${r2(r.fit_r2)}</td><td class="num">${r1(r.fit_rmse)}</td></tr>`;
  }).join('');

  const chips = input.condition
    .map((c) => `<span class="chip"><span class="k">${esc(c.label)}</span><span class="v">${esc(c.value)}</span></span>`)
    .join('');

  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(input.title)} — Kinetics report</title>
<style>
  :root{
    --ink:#14161c; --ink-2:#3d424d; --muted:#6c727c; --faint:#9aa1ab;
    --line:#e8eaef; --line-2:#d9dce3; --bg:#eef0f4; --card:#ffffff;
    --brand:#a5121a; --brand-2:#c4212a; --brand-tint:#fbecec;
    --pos:#0f7a43; --pos-tint:#e6f4ec; --neg:#c1272d; --neg-tint:#fceded;
    --shade:#f5f7f9; --zebra:#fafbfc;
    --shadow:0 1px 2px rgba(20,22,28,.04), 0 3px 10px rgba(20,22,28,.05);
    --radius:12px;
  }
  *{ box-sizing:border-box; }
  html{ -webkit-text-size-adjust:100%; }
  body{ margin:0; padding:32px 24px 48px; color:var(--ink); background:var(--bg);
    font:14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing:antialiased; }
  .wrap{ max-width:1140px; margin:0 auto; }

  .masthead{ position:relative; display:flex; justify-content:space-between; align-items:flex-start; gap:24px;
    background:var(--card); border:1px solid var(--line); border-radius:var(--radius);
    box-shadow:var(--shadow); padding:22px 26px; margin-bottom:16px; overflow:hidden; }
  .masthead::before{ content:""; position:absolute; left:0; top:0; bottom:0; width:4px;
    background:linear-gradient(160deg,var(--brand),var(--brand-2)); }
  .eyebrow{ font-size:11px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--brand); margin:0 0 7px; }
  .masthead h1{ font-size:22px; line-height:1.18; font-weight:650; margin:0; letter-spacing:-.01em; }
  .masthead .gen{ color:var(--muted); font-size:12px; text-align:right; white-space:nowrap; padding-top:2px; }
  .masthead .gen b{ display:inline-block; margin-top:2px; color:var(--ink-2); font-weight:600; font-size:13px; font-variant-numeric:tabular-nums; }
  .metarow{ display:flex; flex-wrap:wrap; gap:8px; margin-top:15px; }
  .chip{ display:inline-flex; align-items:baseline; gap:7px; background:var(--shade); border:1px solid var(--line);
    border-radius:8px; padding:5px 11px; font-size:12.5px; }
  .chip .k{ color:var(--faint); font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; }
  .chip .v{ color:var(--ink-2); font-weight:550; }

  .stats{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:16px; }
  .stat{ background:var(--card); border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); padding:15px 18px; }
  .stat .n{ font-size:26px; line-height:1; font-weight:650; letter-spacing:-.02em; font-variant-numeric:tabular-nums; color:var(--ink); }
  .stat .l{ font-size:12px; color:var(--muted); margin-top:6px; }
  .stat.pos .n{ color:var(--pos); }
  .stat.neg .n{ color:var(--neg); }

  .card{ background:var(--card); border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); margin-bottom:16px; }
  .card-head{ display:flex; align-items:baseline; gap:11px; padding:14px 18px; border-bottom:1px solid var(--line); }
  .card-head h2{ font-size:14px; font-weight:650; margin:0; letter-spacing:.005em; }
  .card-head .sub{ font-size:12px; color:var(--muted); }
  .card-body{ padding:16px 18px; }

  .togtools{ display:flex; gap:8px; margin-bottom:13px; }
  .btn{ font:inherit; font-size:12px; font-weight:550; color:var(--ink-2); background:var(--card);
    border:1px solid var(--line-2); border-radius:8px; padding:5px 12px; cursor:pointer; transition:.12s; }
  .btn:hover{ background:var(--shade); border-color:var(--faint); }
  .btn:active{ transform:translateY(.5px); }
  .togs{ display:flex; flex-wrap:wrap; gap:7px; }
  .tog{ position:relative; display:inline-flex; align-items:center; gap:7px; padding:5px 12px 5px 10px;
    border:1px solid var(--line-2); border-radius:999px; font-size:12.5px; cursor:pointer; user-select:none;
    transition:opacity .12s, background .12s, border-color .12s; }
  .tog input{ position:absolute; opacity:0; width:0; height:0; }
  .tog:hover{ background:var(--shade); }
  .tog .sw{ width:11px; height:11px; border-radius:50%; flex:none; box-shadow:0 0 0 1.5px rgba(0,0,0,.05) inset; }
  .tog:has(input:not(:checked)){ opacity:.4; background:transparent; text-decoration:line-through; text-decoration-color:var(--faint); }

  .plotwrap{ overflow-x:auto; }
  .plot{ width:100%; max-width:940px; height:auto; display:block; }
  .grid{ stroke:#eef0f3; stroke-width:1; }
  .axis{ stroke:#c9ccd3; stroke-width:1; }
  .tick{ fill:var(--muted); font-size:10.5px; font-variant-numeric:tabular-nums; }
  .axtitle{ fill:var(--ink-2); font-size:11.5px; font-weight:600; }
  .legend{ display:flex; flex-wrap:wrap; align-items:center; gap:8px 14px; margin-top:14px; font-size:12px; color:var(--ink-2); }
  .leg-group{ display:inline-flex; flex-wrap:wrap; align-items:center; gap:8px 14px; }
  .leg-sep{ width:1px; height:16px; background:var(--line-2); }
  .glyph{ width:12px; height:12px; overflow:visible; flex:none; }
  .poi.rule .glyph{ width:22px; }
  .glyph path, .glyph circle{ fill:var(--faint); }
  .glyph line{ stroke:var(--ink-2); }
  .poi{ display:inline-flex; align-items:center; gap:6px; cursor:pointer; user-select:none; transition:opacity .12s; }
  .poi input{ width:13px; height:13px; margin:0; accent-color:var(--brand-2); cursor:pointer; flex:none; }
  .poi:has(input:not(:checked)){ opacity:.5; }
  .ctl{ margin-left:auto; display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--ink-2); cursor:pointer; user-select:none; }
  .ctl input{ width:13px; height:13px; margin:0; accent-color:var(--brand-2); cursor:pointer; }
  .wrap.hide-lod .mk-lod, .wrap.hide-onset .mk-onset, .wrap.hide-infl .mk-infl{ display:none; }
  .wrap.hide-data .ln-data, .wrap.hide-fit .ln-fit{ display:none; }
  .wrap.hide-se .se{ display:none; }

  .tablewrap{ overflow-x:auto; }
  table{ border-collapse:separate; border-spacing:0; width:100%; font-size:12.5px; }
  thead th{ background:var(--card); color:var(--muted); font-weight:600; text-align:left; white-space:nowrap;
    padding:7px 10px; vertical-align:bottom; }
  thead th.grp{ text-align:center; color:var(--faint); font-size:10px; font-weight:700; text-transform:uppercase;
    letter-spacing:.07em; padding:8px 10px 5px; border-bottom:1px solid var(--line); }
  thead tr:first-child th:not(.grp){ font-size:10.5px; text-transform:uppercase; letter-spacing:.04em;
    color:var(--faint); font-weight:600; border-bottom:1.5px solid var(--line-2); padding-bottom:7px; }
  thead th.sub2{ font-size:10.5px; letter-spacing:.02em; color:var(--faint); font-weight:600;
    border-bottom:1.5px solid var(--line-2); padding-bottom:7px; }
  th.srt{ cursor:pointer; }
  th.srt:hover{ color:var(--ink-2); }
  th.srt::after{ content:"⇅"; margin-left:4px; font-size:9px; color:var(--line-2); }
  th.srt:hover::after{ color:var(--faint); }
  th.srt.asc::after{ content:"▲"; font-size:8px; color:var(--brand); }
  th.srt.desc::after{ content:"▼"; font-size:8px; color:var(--brand); }
  tbody td{ padding:7px 10px; border-bottom:1px solid var(--line); white-space:nowrap; color:var(--ink-2); }
  tbody tr{ cursor:pointer; }
  tbody tr:last-child td{ border-bottom:none; }
  tbody tr:nth-child(even) td{ background:var(--zebra); }
  tbody tr:hover td{ background:var(--brand-tint); }
  .wrap tbody tr.active > td{ background:var(--brand-tint); }
  tbody td:first-child{ font-variant-numeric:tabular-nums; font-weight:600; color:var(--ink); }
  td.num, th.num{ text-align:right; font-variant-numeric:tabular-nums; }
  td .se{ display:block; color:var(--faint); font-size:10px; line-height:1.2; margin-top:1px; font-variant-numeric:tabular-nums; }
  td .se:empty{ display:none; }
  td.ctr, th.ctr{ text-align:center; }
  .sw{ width:10px; height:10px; border-radius:50%; display:inline-block; margin-right:7px; vertical-align:middle;
    box-shadow:0 0 0 1.5px rgba(0,0,0,.05) inset; }
  .flag{ display:inline-flex; align-items:center; justify-content:center; width:19px; height:19px; border-radius:50%; font-size:11px; line-height:1; }
  .flag.on{ color:var(--pos); background:var(--pos-tint); }
  .flag.off{ color:var(--faint); background:var(--shade); }
  .callcell{ text-align:center; }
  .call{ display:inline-flex; align-items:center; justify-content:center; min-width:21px; height:21px; padding:0 7px;
    border-radius:999px; font-weight:700; font-size:12px; }
  .call.pos{ color:var(--pos); background:var(--pos-tint); }
  .call.neg{ color:var(--neg); background:var(--neg-tint); }
  .call.unk{ color:var(--faint); background:var(--shade); }
  .note{ font-size:12px; line-height:1.55; color:var(--muted); margin:12px 2px 0; }
  .note b{ color:var(--ink-2); font-weight:600; }
  .residmsg{ display:flex; align-items:flex-start; gap:9px; font-size:12.5px; line-height:1.5; color:var(--ink-2);
    background:var(--brand-tint); border:1px solid var(--line-2); border-radius:8px; padding:11px 13px; }
  .residmsg .warn{ color:var(--brand); font-weight:700; flex:none; }
  .residmsg b{ color:var(--ink); font-weight:650; }
  .foot{ text-align:center; color:var(--faint); font-size:11.5px; margin-top:6px; }
  .hidden{ display:none; }

  @media (max-width:720px){
    body{ padding:18px 12px 36px; }
    .masthead{ flex-direction:column; gap:10px; }
    .masthead .gen{ text-align:left; }
    .stats{ grid-template-columns:1fr 1fr; }
  }
  @media print{
    body{ background:#fff; padding:0; font-size:11px; }
    .masthead,.stat,.card{ box-shadow:none; }
    .card{ break-inside:avoid; }
    .card-head .sub,.togtools{ display:none; }
  }
</style>
<div class="wrap${poi.lod ? '' : ' hide-lod'}${poi.onset ? '' : ' hide-onset'}${poi.infl ? '' : ' hide-infl'}">
  <header class="masthead">
    <div class="mast-main">
      <div class="eyebrow">SHARP · Kinetics report</div>
      <h1>${esc(input.title)}</h1>
      <div class="metarow">${chips}</div>
    </div>
    <div class="gen">Generated<br><b>${esc(input.generated)}</b></div>
  </header>

  <div class="stats">
    <div class="stat"><div class="n">${curves.length}</div><div class="l">Curves analysed</div></div>
    <div class="stat pos"><div class="n">${nPos}</div><div class="l">Positive calls</div></div>
    <div class="stat neg"><div class="n">${nNeg}</div><div class="l">Negative calls</div></div>
  </div>

  <section class="card">
    <div class="card-head"><h2>Samples</h2><span class="sub">toggle any curve on or off across all panels</span></div>
    <div class="card-body">
      <div class="togtools"><button class="btn" id="allOn">All</button><button class="btn" id="allOff">None</button></div>
      <div class="togs">${toggles}</div>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Amplification</h2><span class="sub">${input.corrected ? 'baseline-corrected' : 'raw'} signal + FreeShoulder fit</span></div>
    <div class="card-body">
      <div class="plotwrap">${ampSvg}</div>
      <div class="legend">
        <span class="leg-group">
          <label class="poi rule"><input type="checkbox" data-line="data" checked><svg class="glyph" viewBox="0 0 22 12"><line x1="1" y1="6" x2="21" y2="6" stroke-width="2.4"/></svg>${input.corrected ? 'corrected' : 'raw'} data</label>
          <label class="poi rule"><input type="checkbox" data-line="fit" checked><svg class="glyph" viewBox="0 0 22 12"><line x1="1" y1="6" x2="21" y2="6" stroke-width="1"/></svg>fit</label>
        </span>
        <span class="leg-sep"></span>
        <span class="leg-group">
          <label class="poi"><input type="checkbox" data-poi="lod"${poi.lod ? ' checked' : ''}><svg class="glyph" viewBox="0 0 12 12"><path d="M6 1 L11 11 L1 11 Z"/></svg>LoD time</label>
          <label class="poi"><input type="checkbox" data-poi="onset"${poi.onset ? ' checked' : ''}><svg class="glyph" viewBox="0 0 12 12"><path d="M6 1 L11 6 L6 11 L1 6 Z"/></svg>10% onset</label>
          <label class="poi"><input type="checkbox" data-poi="infl"${poi.infl ? ' checked' : ''}><svg class="glyph" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5"/></svg>inflection</label>
        </span>
      </div>
    </div>
  </section>

  <section class="card hidden" id="residCard">
    <div class="card-head"><h2>Residuals</h2><span class="sub" id="residSub">click a row below to show observed − fit</span></div>
    <div class="card-body">
      <div class="residmsg hidden" id="residMsg"></div>
      <div class="plotwrap" id="residPlotWrap"><svg id="residPlot" viewBox="0 0 900 170" class="plot"></svg></div>
      <p class="note" id="residHelp">Vertical distance from each measured point to the fitted curve for the selected sample. The shaded band is <b>±1 run σ</b> (the measurement-noise floor): residuals staying inside it mean the fit is within noise, while systematic structure poking outside signals lack of fit.</p>
    </div>
  </section>

  ${meltSvg ? `<section class="card">
    <div class="card-head"><h2>Melt</h2><span class="sub">−dF/dT</span></div>
    <div class="card-body"><div class="plotwrap">${meltSvg}</div></div>
  </section>` : ''}

  <section class="card">
    <div class="card-head"><h2>Kinetics</h2><span class="sub">click a header to sort · click a row to highlight its curve</span><label class="ctl"><input type="checkbox" data-ui="se" checked>± uncertainties</label></div>
    <div class="card-body">
      <div class="tablewrap"><table>
        <thead>
          <tr>
            <th class="srt" rowspan="2" data-c="0" data-t="well">Well</th><th class="srt" rowspan="2" data-c="1" data-t="str">Sample</th>
            <th class="grp" colspan="2">Detection</th>
            <th class="grp" colspan="3">Doubling time</th>
            <th class="num srt" rowspan="2" data-c="7" data-t="num">Yield</th>
            <th class="num srt" rowspan="2" data-c="8" data-t="num">Tm</th>
            <th class="grp" colspan="3">Quality</th>
          </tr>
          <tr>
            <th class="num sub2 srt" data-c="2" data-t="num">t_lod</th><th class="num sub2 srt" data-c="3" data-t="num">t_onset10</th>
            <th class="num sub2 srt" data-c="4" data-t="num">Td₅</th><th class="num sub2 srt" data-c="5" data-t="num">Td₂₀</th><th class="num sub2 srt" data-c="6" data-t="num">Td₅₀</th>
            <th class="ctr sub2 srt" data-c="9" data-t="flag">base</th><th class="ctr sub2 srt" data-c="10" data-t="flag">plat</th><th class="ctr sub2 srt" data-c="11" data-t="call">call</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table></div>
      <p class="note"><b>±</b> values are standard errors. <b>base</b> / <b>plat</b> = baseline / plateau observed; an unchecked <b>plat</b> means the curve is right-censored (D / foot / shoulder / yield extrapolated). Times in seconds, Tm in °C.</p>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Curve reconstruction</h2><span class="sub">FreeShoulder six-parameter fit · click a header to sort</span></div>
    <div class="card-body">
      <div class="tablewrap"><table>
        <thead>
          <tr>
            <th class="srt" rowspan="2" data-c="0" data-t="well">Well</th><th class="srt" rowspan="2" data-c="1" data-t="str">Sample</th>
            <th class="grp" colspan="6">FreeShoulder parameters</th>
            <th class="grp" colspan="2">Fit quality</th>
          </tr>
          <tr>
            <th class="num sub2 srt" data-c="2" data-t="num">A</th><th class="num sub2 srt" data-c="3" data-t="num">B</th><th class="num sub2 srt" data-c="4" data-t="num">C</th>
            <th class="num sub2 srt" data-c="5" data-t="num">D</th><th class="num sub2 srt" data-c="6" data-t="num">foot</th><th class="num sub2 srt" data-c="7" data-t="num">shoulder</th>
            <th class="num sub2 srt" data-c="8" data-t="num">r²</th><th class="num sub2 srt" data-c="9" data-t="num">rmse</th>
          </tr>
        </thead>
        <tbody>${reconRows}</tbody>
      </table></div>
    </div>
  </section>

  <footer class="foot">SHARP Data Processor · FreeShoulder kinetics · ${esc(input.generated)}</footer>
</div>

<script>
  function apply(cb){
    var key = cb.getAttribute('data-toggle'); var on = cb.checked;
    var sel = '[data-key="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]';
    document.querySelectorAll(sel).forEach(function(el){ el.classList.toggle('hidden', !on); });
  }
  document.querySelectorAll('input[data-toggle]').forEach(function(cb){
    cb.addEventListener('change', function(){ apply(cb); });
  });
  function setAll(on){
    document.querySelectorAll('input[data-toggle]').forEach(function(cb){ cb.checked = on; apply(cb); });
  }
  var a = document.getElementById('allOn'), b = document.getElementById('allOff');
  if (a) a.addEventListener('click', function(){ setAll(true); });
  if (b) b.addEventListener('click', function(){ setAll(false); });
  var root = document.querySelector('.wrap');
  // landmark (▲◆●) + line (data/fit) toggles add a hide-<name> class on .wrap
  document.querySelectorAll('input[data-poi]').forEach(function(cb){
    cb.addEventListener('change', function(){ root.classList.toggle('hide-' + cb.getAttribute('data-poi'), !cb.checked); });
  });
  document.querySelectorAll('input[data-line]').forEach(function(cb){
    cb.addEventListener('change', function(){ root.classList.toggle('hide-' + cb.getAttribute('data-line'), !cb.checked); });
  });
  var seCb = document.querySelector('input[data-ui="se"]');
  if (seCb) seCb.addEventListener('change', function(){ root.classList.toggle('hide-se', !seCb.checked); });

  // ── column sorting ──
  function cellText(cell){ var f = cell.firstChild; return ((f && f.nodeType === 3) ? f.nodeValue : cell.textContent) || ''; }
  function sortKey(cell, t){
    if (t === 'num'){ var s = cellText(cell).trim().replace(/,/g, ''); if (s === '' || s === '—') return null; var v = parseFloat(s); return isNaN(v) ? null : v; }
    if (t === 'flag'){ return cell.textContent.indexOf('✓') >= 0 ? 1 : 0; }
    if (t === 'call'){ var c = cell.textContent; return c.indexOf('+') >= 0 ? 2 : (c.indexOf('?') >= 0 ? 1 : 0); }
    if (t === 'well'){ var m = /^([A-Za-z]+)(\\d+)/.exec(cellText(cell).trim()); return m ? [m[1].toUpperCase(), parseInt(m[2], 10)] : [cellText(cell), 0]; }
    return cell.textContent.trim().toLowerCase();
  }
  document.querySelectorAll('th.srt').forEach(function(th){
    th.addEventListener('click', function(){
      var table = th.closest('table'), tb = table.tBodies[0];
      var c = +th.getAttribute('data-c'), t = th.getAttribute('data-t') || 'str';
      var dir = th.classList.contains('asc') ? 'desc' : 'asc';
      table.querySelectorAll('th.srt').forEach(function(o){ o.classList.remove('asc', 'desc'); });
      th.classList.add(dir);
      var rows = Array.prototype.slice.call(tb.rows);
      rows.sort(function(ra, rb){
        var a = sortKey(ra.cells[c], t), b = sortKey(rb.cells[c], t);
        if (a === null && b === null) return 0;
        if (a === null) return 1; if (b === null) return -1; // blanks always last
        var d;
        if (Array.isArray(a)) d = a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1];
        else if (typeof a === 'number') d = a - b;
        else d = a < b ? -1 : a > b ? 1 : 0;
        return dir === 'desc' ? -d : d;
      });
      rows.forEach(function(r){ tb.appendChild(r); });
    });
  });

  // ── residual strip: rendered on row-click for the selected curve ──
  var RESID = ${residJson};
  var RUNSIGMA = ${Number.isFinite(input.runSigma) ? input.runSigma : 0};
  var TDOM = [${xDomAmp[0]}, ${xDomAmp[1]}];
  function renderResid(key){
    var card = document.getElementById('residCard');
    var d = key ? RESID[key] : null;
    if (!d){ card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    var msg = document.getElementById('residMsg'), wrap = document.getElementById('residPlotWrap'), help = document.getElementById('residHelp');
    if (!d.pts){
      // No usable fit — flag WHY (no plateau, etc.) instead of an empty strip.
      document.getElementById('residSub').textContent = d.label + ' — no fit reported';
      msg.innerHTML = '';
      var w = document.createElement('span'); w.className = 'warn'; w.textContent = '⚠';
      var b = document.createElement('b'); b.textContent = d.label;
      msg.appendChild(w); msg.appendChild(b); msg.appendChild(document.createTextNode(' — ' + (d.note || 'No fit reported.')));
      msg.classList.remove('hidden'); wrap.classList.add('hidden'); help.classList.add('hidden');
      return;
    }
    msg.classList.add('hidden'); wrap.classList.remove('hidden'); help.classList.remove('hidden');
    document.getElementById('residSub').textContent =
      d.label + ' — observed − fit · band = ±1 run σ (' + Math.round(RUNSIGMA) + ' RFU)';
    var W = 900, H = 170, ml = 64, mr = 16, mt = 14, mb = 42;
    var x0 = TDOM[0], x1 = TDOM[1], xs = (x1 - x0) || 1;
    var maxAbs = 0;
    for (var i = 0; i < d.pts.length; i++){ var a = Math.abs(d.pts[i][1]); if (a > maxAbs) maxAbs = a; }
    var R = Math.max(4 * RUNSIGMA, 1.1 * maxAbs); if (!(R > 0)) R = 1;
    function sx(v){ return ml + ((v - x0) / xs) * (W - mr - ml); }
    function sy(v){ return (H - mb) + ((v + R) / (2 * R)) * (mt - (H - mb)); }
    var g = [];
    // ±run σ noise band
    g.push('<rect x="' + ml + '" y="' + sy(RUNSIGMA).toFixed(1) + '" width="' + (W - mr - ml) + '" height="' + Math.abs(sy(-RUNSIGMA) - sy(RUNSIGMA)).toFixed(1) + '" fill="' + d.color + '" fill-opacity="0.10"/>');
    // grid + x ticks
    for (var k = 0; k <= 6; k++){
      var tx = x0 + (x1 - x0) * k / 6, px = sx(tx);
      g.push('<line x1="' + px.toFixed(1) + '" y1="' + mt + '" x2="' + px.toFixed(1) + '" y2="' + (H - mb) + '" class="grid"/>');
      g.push('<text x="' + px.toFixed(1) + '" y="' + (H - mb + 17) + '" class="tick" text-anchor="middle">' + Math.round(tx) + '</text>');
    }
    // zero line + axes
    g.push('<line x1="' + ml + '" y1="' + sy(0).toFixed(1) + '" x2="' + (W - mr) + '" y2="' + sy(0).toFixed(1) + '" stroke="#c9ccd3" stroke-width="1"/>');
    g.push('<line x1="' + ml + '" y1="' + (H - mb) + '" x2="' + (W - mr) + '" y2="' + (H - mb) + '" class="axis"/>');
    g.push('<line x1="' + ml + '" y1="' + mt + '" x2="' + ml + '" y2="' + (H - mb) + '" class="axis"/>');
    // y labels (−R, 0, +R)
    [-R, 0, R].forEach(function(ty){ g.push('<text x="' + (ml - 8) + '" y="' + (sy(ty) + 3).toFixed(1) + '" class="tick" text-anchor="end">' + Math.round(ty) + '</text>'); });
    g.push('<text x="' + ((ml + W - mr) / 2) + '" y="' + (H - 5) + '" class="axtitle" text-anchor="middle">Time (s)</text>');
    g.push('<text x="15" y="' + ((mt + H - mb) / 2) + '" class="axtitle" text-anchor="middle" transform="rotate(-90 15 ' + ((mt + H - mb) / 2) + ')">Residual (RFU)</text>');
    var pts = '';
    for (var j = 0; j < d.pts.length; j++){ pts += sx(d.pts[j][0]).toFixed(1) + ',' + sy(d.pts[j][1]).toFixed(1) + ' '; }
    g.push('<polyline fill="none" stroke="' + d.color + '" stroke-width="1.4" stroke-linejoin="round" points="' + pts.trim() + '"/>');
    document.getElementById('residPlot').innerHTML = g.join('');
  }

  // ── click a row to isolate its curve on the plots (both tables stay in sync) ──
  var isoKey = null;
  function setIso(key){
    isoKey = (isoKey === key) ? null : key;
    document.querySelectorAll('.plot [data-key]').forEach(function(el){
      el.style.opacity = (isoKey === null || el.getAttribute('data-key') === isoKey) ? '' : '0.07';
    });
    document.querySelectorAll('tr[data-key]').forEach(function(r){
      r.classList.toggle('active', isoKey !== null && r.getAttribute('data-key') === isoKey);
    });
    renderResid(isoKey);
  }
  document.querySelectorAll('tbody tr[data-key]').forEach(function(r){
    r.addEventListener('click', function(){ setIso(r.getAttribute('data-key')); });
  });
</script>`;
}
