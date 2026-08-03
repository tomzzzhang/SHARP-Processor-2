/**
 * The HTML harness: one document that draws the whole composite.
 *
 * Chrome does the layout, which is why multi-panel composites are cheap rather
 * than a separate feature. Two rules make the output trustworthy:
 *
 *  1. **The page IS the figure.** `@page { size: <W>in <H>in; margin: 0 }` plus
 *     a body of exactly those dimensions, so `--print-to-pdf` emits a PDF whose
 *     media box is the figure and nothing is scaled or paginated.
 *  2. **Panels are positioned from the same geometry `figure` used.** Each
 *     panel is absolutely placed at the rectangle `computePlacements` returned,
 *     and its Plotly layout already carries that rectangle in pixels. A plot
 *     sized differently from its box is how axis labels get clipped.
 *
 * Everything is inlined or file-local, so the render works with no network.
 */
import type { FigureBundle, RenderPanel } from './figure';
import type { PanelLabelSpec } from './spec';
import { CSS_PPI } from './layout';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A file path usable in a `file://` document. */
function fileUrl(absPath: string): string {
  return `file://${absPath.split('/').map(encodeURIComponent).join('/')}`;
}

const LABEL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function labelText(panel: RenderPanel, index: number, cfg: PanelLabelSpec): string | null {
  if (cfg.mode === 'none') return null;
  if (cfg.mode === 'title') return panel.label;
  // `letter` mode: a single-character label is taken as the letter itself,
  // otherwise fall back to grid order so named panels still get A/B/C.
  return panel.label.length === 1 ? panel.label : (LABEL_LETTERS[index] ?? panel.label);
}

function labelStyle(cfg: PanelLabelSpec): string {
  const off = `${cfg.offset_in * CSS_PPI}px`;
  const vertical = cfg.position.startsWith('top') ? `top:${off}` : `bottom:${off}`;
  const horizontal = cfg.position.endsWith('left') ? `left:${off}` : `right:${off}`;
  return `${vertical};${horizontal}`;
}

const ALIGN_PCT = { left: '0%', center: '50%', right: '100%', top: '0%', bottom: '100%' } as const;

/** CSS `object-position`, which `object-fit: contain` honors wherever it
 *  leaves slack space. Unset on both axes reproduces the old always-centered
 *  behavior exactly — 50% 50% is `object-position`'s own default. */
function objectPositionOf(align: Extract<RenderPanel, { kind: 'image' }>['align']): string {
  const x = ALIGN_PCT[align?.x ?? 'center'];
  const y = ALIGN_PCT[align?.y ?? 'center'];
  return `${x} ${y}`;
}

function imagePanelHtml(panel: Extract<RenderPanel, { kind: 'image' }>, boxW: number, boxH: number): string {
  const url = fileUrl(panel.path);
  const bg = panel.background ? `background:${panel.background};` : '';
  if (!panel.crop) {
    return `<img class="pimg" src="${url}" style="object-fit:${panel.fit};object-position:${objectPositionOf(panel.align)};${bg}">`;
  }

  // Fractional crop. The window (x, y, w, h) must end up filling the viewport,
  // so the image is scaled to 1/w × 1/h of the viewport and shifted left/up by
  // the window's origin — expressed as a fraction of the WINDOW, since CSS
  // percentages on a positioned child resolve against the containing block.
  const { x, y, w, h } = panel.crop;
  const imgStyle =
    `width:${(100 / w).toFixed(4)}%;height:${(100 / h).toFixed(4)}%;` +
    `left:${(-100 * x / w).toFixed(4)}%;top:${(-100 * y / h).toFixed(4)}%;` +
    // The geometry above is exact, so the image must fill the box it is given.
    // Any object-fit other than `fill` would re-letterbox and break the crop.
    'object-fit:fill;';

  // With the source's real dimensions known, `contain` keeps the cropped
  // region's aspect ratio by letterboxing the viewport inside the panel —
  // a stretched gel would misrepresent the data.
  let viewport = `width:100%;height:100%;`;
  if (panel.fit === 'contain' && panel.intrinsic) {
    const cropAspect = (panel.intrinsic.width * w) / (panel.intrinsic.height * h);
    const boxAspect = boxW / boxH;
    if (cropAspect > boxAspect) {
      const pct = (boxAspect / cropAspect) * 100;
      viewport = `width:100%;height:${pct.toFixed(4)}%;top:${((100 - pct) / 2).toFixed(4)}%;`;
    } else {
      const pct = (cropAspect / boxAspect) * 100;
      viewport = `width:${pct.toFixed(4)}%;height:100%;left:${((100 - pct) / 2).toFixed(4)}%;`;
    }
  }

  return `<div class="crop" style="${viewport}${bg}"><img src="${url}" style="${imgStyle}"></div>`;
}

function tablePanelHtml(panel: Extract<RenderPanel, { kind: 'table' }>): string {
  const head = panel.header
    ? `<thead><tr>${panel.columns
        .map((c, i) => `<th style="text-align:${panel.align[i] ?? 'left'}">${escapeHtml(c)}</th>`)
        .join('')}</tr></thead>`
    : '';
  const body = panel.rows
    .map((row) => `<tr>${row
      .map((cell, i) => `<td style="text-align:${panel.align[i] ?? 'left'}">${escapeHtml(String(cell))}</td>`)
      .join('')}</tr>`)
    .join('');
  return `<table class="ptable" style="font-family:${escapeHtml(panel.fontFamily)};` +
    `font-size:${panel.fontSize}px;color:${panel.color}">${head}<tbody>${body}</tbody></table>`;
}

export interface HarnessOptions {
  /** Path the harness will load Plotly from, relative to the harness file. */
  plotlySrc: string;
}

export function buildHarness(bundle: FigureBundle, opts: HarnessOptions): string {
  const { output } = bundle;
  const wPx = output.width_in * CSS_PPI;
  const hPx = output.height_in * CSS_PPI;

  const panelHtml = bundle.panels.map((panel, i) => {
    const p = panel.placement;
    const box =
      `left:${p.x_in * CSS_PPI}px;top:${p.y_in * CSS_PPI}px;` +
      `width:${p.w_in * CSS_PPI}px;height:${p.h_in * CSS_PPI}px`;

    const cfg = { ...bundle.panelLabels, ...(panel.labelOverride ?? {}) };
    const text = labelText(panel, i, cfg);

    // A plot reserves its own top margin, so a label sits in whitespace there.
    // Image and table panels draw from their top edge, so a top-anchored label
    // would land on the content — inset them by the label's height instead.
    const labelInset = text && cfg.position.startsWith('top') && panel.kind !== 'plot'
      ? cfg.size * 1.5 + cfg.offset_in * CSS_PPI
      : 0;
    const contentBox = labelInset > 0
      ? `position:absolute;left:0;right:0;top:${labelInset.toFixed(2)}px;bottom:0;`
      : 'position:absolute;inset:0;';
    const innerH = Math.max(1, p.h_in * CSS_PPI - labelInset);

    let inner: string;
    if (panel.kind === 'plot') inner = `<div class="plot" id="plot-${i}"></div>`;
    else if (panel.kind === 'image') inner = imagePanelHtml(panel, p.w_in * CSS_PPI, innerH);
    else inner = tablePanelHtml(panel);
    if (panel.kind !== 'plot') inner = `<div style="${contentBox}">${inner}</div>`;
    const label = text
      ? `<div class="plabel" style="${labelStyle(cfg)};font-size:${cfg.size}px;` +
        `font-weight:${cfg.bold ? 700 : 400};` +
        (cfg.fontFamily ? `font-family:${escapeHtml(cfg.fontFamily)};` : '') +
        (cfg.color ? `color:${cfg.color};` : '') +
        `">${escapeHtml(text)}</div>`
      : '';

    return `<div class="panel" style="${box}">${inner}${label}</div>`;
  }).join('\n');

  const figures = bundle.panels
    .map((panel, i) => (panel.kind === 'plot'
      ? { id: `plot-${i}`, data: panel.figure.data, layout: panel.figure.layout }
      : null))
    .filter(Boolean);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  /* The page is the figure: no paper margins, no pagination. */
  @page { size: ${output.width_in}in ${output.height_in}in; margin: 0; }
  html, body {
    margin: 0; padding: 0;
    width: ${wPx}px; height: ${hPx}px;
    background: #ffffff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .panel { position: absolute; overflow: visible; }
  .plot { position: absolute; left: 0; top: 0; }
  .plabel { position: absolute; line-height: 1; z-index: 10; }
  .pimg { width: 100%; height: 100%; display: block; }
  .crop { position: relative; width: 100%; height: 100%; overflow: hidden; }
  .crop img { position: absolute; display: block; }
  .ptable { width: 100%; border-collapse: collapse; }
  .ptable th { border-bottom: 1px solid currentColor; padding: 2px 4px; font-weight: 600; }
  .ptable td { padding: 2px 4px; }
</style>
<script src="${opts.plotlySrc}"></script>
</head>
<body>
${panelHtml}
<script>
  const FIGURES = ${JSON.stringify(figures)};
  const CONFIG = { staticPlot: true, displayModeBar: false, responsive: false };
  Promise.all(FIGURES.map(function (f) {
    return Plotly.newPlot(document.getElementById(f.id), f.data, f.layout, CONFIG);
  })).then(function () {
    // Read by the renderer to confirm every panel finished drawing.
    window.__SHARPPLOT_READY = true;
    document.title = 'sharpplot-ready';
  }).catch(function (err) {
    window.__SHARPPLOT_ERROR = String(err && err.message || err);
    document.title = 'sharpplot-error';
  });
</script>
</body>
</html>
`;
}
