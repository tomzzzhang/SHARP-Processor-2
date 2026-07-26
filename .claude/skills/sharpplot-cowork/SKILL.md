---
name: sharpplot-cowork
description: Build publication figures from SHARP Data Processor 2 data (.sharpx, .sharp, .pcrd, .tlpd, .eds, .amxd, Bio-Rad folders) in Claude Cowork or chat, where the machine holding the data and the machine with a browser may be different. Amplification curves, melt curves, melt derivatives, dilution standard curves, multi-panel composites with gel images and metrics tables, as vector PDF plus PNG at an exact physical size. Use whenever someone wants a figure, plot, panel or composite from qPCR / isothermal amplification data, or mentions a .sharpx file.
---

# sharpplot in Cowork — figures by conversation

You drive a CLI that calls SHARP Data Processor 2's own analysis and plotting
modules. The user describes a figure; you render it and show it inline; they
react; you change a field and re-render. **They never see a spec file** — it is
plumbing between you and the tool.

The tool is `sharpplot`, source in the SHARP Processor 2 repo under `src/cli/`
on branch `feature/sharpplot-cli`.

## First: work out where you are

Cowork spreads work across machines, and the two halves of this pipeline have
different needs:

| Step | Needs | Does not need |
|---|---|---|
| `inspect`, `figure`, `convert`, `group` | Node, the data file | any browser |
| `render` | Node, Chrome/Chromium | the data, the repo |

So run **one probe** before anything else:

```bash
node --version
ls dist-cli/sharpplot.mjs 2>/dev/null || echo "no build"
ls /opt/pw-browsers/chromium-*/chrome-linux/chrome /usr/bin/chromium /usr/bin/google-chrome 2>/dev/null || echo "no browser"
which pdftoppm || echo "no poppler"
```

Then pick a path:

- **Everything present** → use `plot` and you are done.
- **Repo but no browser** (typical `device_bash` Linux VM) → run `figure` there,
  move `fig.json` plus a staged renderer to a machine that has a browser, run
  `render` there.
- **Browser but no repo** (typical cloud sandbox) → you need `fig.json` and a
  staged copy of the renderer; you cannot read the raw data here.
- **No build** → in a checkout, `npm install && npm run cli:build`.

## Staging the renderer where there is no repo

```bash
node dist-cli/sharpplot.mjs bundle --out /path/to/stage
```

Copies `sharpplot.mjs`, its side chunks, and `plotly.min.js`. Those files are
self-contained — no `node_modules`, no network. Move that directory plus
`fig.json` to the browser machine and:

```bash
node sharpplot.mjs render fig.json --out figure
```

Chromium is auto-detected including Playwright's cache
(`/opt/pw-browsers/chromium-*/…`). Otherwise pass `--chrome <path>` or set
`SHARPPLOT_CHROME`.

Without `pdftoppm`, request only `"formats": ["pdf"]` — PDF needs Chrome alone.
PNG is derived from the PDF by `pdftoppm`, so they are always the same drawing.

## Always inspect before writing a spec

```bash
node dist-cli/sharpplot.mjs inspect "<file>" --pretty
```

Reports the real well names, sample names, groups, colours, channels, melt
content and which plot types the file supports — plus a populated starting
spec. **Never invent a well or group name.** Unknown names are hard errors by
design, because a figure silently missing a well looks correct.

## The core idea: the file is already the spec

A `.sharpx` carries the user's saved session — groups, per-well colours, hidden
wells, legend order, threshold, baseline settings, fonts. This reproduces what
they last saw in the app:

```json
{ "panels": [ { "kind": "plot", "source": "run.sharpx", "plotType": "amp" } ] }
```

So **apply only the deltas they ask for**. "Make it half-column and drop the
grid" changes two fields; everything else stays inherited.

## Spec essentials

```jsonc
{
  "id": "figure_2",
  "output": { "width_in": 6.5, "height_in": 2.6, "dpi": 600, "formats": ["pdf", "png"] },
  "style": { "fontFamily": "Arial, Helvetica, sans-serif",
             "labelSize": 8, "tickSize": 7, "legendSize": 7,
             "lineWidth": 1.2, "showGrid": false, "showTitle": false,
             "plotBgColor": "#ffffff" },
  "panelLabels": { "mode": "letter", "bold": true, "size": 10 },
  "layout": { "rows": 1, "cols": 3, "widths": [1.35, 1, 1], "gap_in": 0.16,
              "margin_in": 0.14, "areas": ["A A B", "C C B"] },
  "panels": [ /* … */ ]
}
```

6.5 in = full Letter text width, 3.25 in = half column. `areas` places panels by
name; repeating a label spans it. `panelLabels.mode` is `letter`, `title` or
`none`.

Plot panels take every analysis field under its app name — `plotType`,
`select`, `xAxisMode`, `logScale`, `baselineEnabled`, `thresholdEnabled`,
`thresholdRfu`, `normalizeEnabled`, `smoothingEnabled`, `fittingEnabled` — plus
`legend`, `xaxis`/`yaxis` (`title`, `range`, `scale` incl. `log2`, `dtick`,
`tickFormat`, `frame`), `annotations`, `referenceLines`, `styleOverride`.

Selection: `"select": { "groups": ["10^7"], "exclude": ["A3"] }` — `wells`,
`groups`, `samples` all work.

Non-plot panels:

```json
{ "kind": "image", "label": "B", "path": "gel.png", "fit": "contain",
  "crop": { "x": 0.05, "y": 0.1, "w": 0.9, "h": 0.75 } }
{ "kind": "table", "label": "C", "columns": ["Metric", "SHARP"], "rows": [["Q", "18.4"]] }
```

## Standard curves

```json
{ "kind": "plot", "plotType": "dilution",
  "dilution": { "fromGroups": true, "top": 1e7, "fold": 10,
                "unit": "copies/uL", "exclude": ["NTC"] },
  "errorBars": "sd", "showFit": true,
  "fitAnnotation": "slope {slope} min/log₂<br>R² = {r2}<br>n = {n}",
  "fitAnnotationPosition": "bottom-left" }
```

Needs `thresholdEnabled` — Tt is what it plots. `errorBars`: `sd` | `sem` |
`ci95` | `none`. Substitutable: `slope`, `slopeSE`, `intercept`, `r2`, `adjR2`,
`pValue`, `doublingTime`, `n`, `nSteps`.

**Never infer a concentration from a group name.** `10^7` is suggestive, not
authoritative — ask for the top concentration and the fold factor. The tool
prints the resolved step table to stderr; **show it and let the user confirm
before the figure is treated as final.**

## Raw files and spoken plate maps

```bash
node dist-cli/sharpplot.mjs convert "run.pcrd" --out run.sharpx
node dist-cli/sharpplot.mjs group run.sharpx --assign "10^7=A1-A3; NTC=B4,B5,B6"
```

Ranges work along a row (`A1-A6`), down a column (`A1-H1`), over a block
(`A1-C3`), or by row letter (`A`). Group order becomes legend order. Prints the
grouping for confirmation; writes nothing without `--write`. **Show that table
before rendering.**

## Working with the user

- Show the rendered PNG inline. Never show them the spec.
- Keep edits small — change what they asked about, inherit the rest.
- Save the spec beside the figure so it can be re-edited later.
- Relay the tool's warnings. "Legend has 9 entries but only 4 fit" means series
  are missing from the figure.
- If something cannot be drawn, the tool says why and what to set. Pass that on
  in plain language rather than guessing a workaround.
- Never fabricate a number. Every value comes from the data.

## Font fidelity

A Linux sandbox substitutes Liberation Sans for Arial. It is metric-compatible,
so previews are faithful but not pixel-identical. **Final renders for
publication should run on the Mac**, where real Arial is installed. Say so if
the user is producing something for submission.
