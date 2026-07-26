---
name: sharpplot
description: Build publication figures from SHARP Data Processor 2 data — .sharpx, .sharp, .pcrd, .tlpd, .eds, .amxd, or Bio-Rad CFX folders. Amplification curves, melt curves, melt derivatives, dilution standard curves, and multi-panel composites with gel images and metrics tables, at an exact physical size as vector PDF plus PNG. Use whenever someone wants a figure, plot, panel or composite from qPCR / isothermal amplification data, mentions a .sharpx or .pcrd file, or asks for a standard curve, amplification plot or melt plot.
---

# sharpplot — figures from Processor data, by conversation

`sharpplot` calls SHARP Data Processor 2's own analysis and plotting modules
headlessly, so every number in a figure comes from the same code the desktop
app runs. The user describes a figure; you render it and show it; they react;
you change a field and re-render.

**The user never sees a spec file.** It is plumbing between you and the tool.
Show them figures and plain language, nothing else.

## 1. Find the CLI

Try these in order and use the first that answers:

```bash
node ~/.claude/tools/sharpplot/sharpplot.mjs --help    # staged global copy
node dist-cli/sharpplot.mjs --help                      # inside the repo
```

If neither works, look for a SHARP Processor 2 checkout and build it:

```bash
npm install && npm run cli:build
```

Then refresh the global copy so it is there next time:

```bash
npm run cli:install
```

Do not hardcode a path to anyone's home directory beyond `~`. If you cannot
find a checkout or a staged copy, say so and ask.

## 2. Check what this machine can do

The pipeline has two halves with different needs, and they need not run on the
same machine:

| Step | Needs | Does not need |
|---|---|---|
| `inspect`, `figure`, `convert`, `group` | Node, the data file | any browser |
| `render` | Node, Chrome/Chromium | the data, the repo |

```bash
node --version
ls /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
   /opt/pw-browsers/chromium-*/chrome-linux/chrome \
   /usr/bin/chromium /usr/bin/google-chrome 2>/dev/null || echo "no browser"
which pdftoppm || echo "no poppler"
```

- **Browser present** → use `plot` (figure + render in one call).
- **No browser** → run `figure … --out fig.json`, then move `fig.json` plus a
  staged renderer (`sharpplot bundle --out <dir>`, which is self-contained) to
  a machine that has one and run `render` there.
- **No `pdftoppm`** → request only `"formats": ["pdf"]`. PDF needs Chrome
  alone; PNG is rasterized from the PDF, so they are always the same drawing.

## 3. Always inspect before writing a spec

```bash
node <cli> inspect "<file>" --pretty
```

Reports the real well names, sample names, groups, colours, channels, melt
content, and which plot types the file supports — plus a populated starting
spec. **Never invent a well or group name.** Unknown names are hard errors by
design, because a figure quietly missing a well still looks correct.

## 4. The core idea: the file is already the spec

A `.sharpx` carries the user's saved session — groups, per-well colours, hidden
wells, legend order, threshold, baseline settings, fonts. So this alone
reproduces what they last saw in the app:

```json
{ "panels": [ { "kind": "plot", "source": "run.sharpx", "plotType": "amp" } ] }
```

Resolution runs *app default → what the file saved → composite style → panel*.
**Apply only the deltas they ask for.** "Half-column and no grid" changes two
fields; everything else stays inherited. Keep the spec small so the next edit
stays small.

## 5. Render

```bash
node <cli> plot spec.json --out figures/fig2
```

Writes `fig2.pdf` (place this in Word or Illustrator) and `fig2.png` (show this
to the user). Save the spec next to the figure so it can be re-edited later.

## Spec reference

```jsonc
{
  "id": "figure_2",
  "output": { "width_in": 6.5, "height_in": 2.6, "dpi": 600, "formats": ["pdf", "png"] },
  "style": { "fontFamily": "Arial, Helvetica, sans-serif",
             "titleSize": 9, "labelSize": 8, "tickSize": 7, "legendSize": 7,
             "lineWidth": 1.2, "showGrid": false, "showTitle": false,
             "plotBgColor": "#ffffff", "textColor": "black" },
  "panelLabels": { "mode": "letter", "bold": true, "size": 10, "offset_in": 0.0 },
  "layout": { "rows": 1, "cols": 3, "widths": [1.35, 1, 1], "gap_in": 0.16,
              "margin_in": 0.14, "areas": ["A A B", "C C B"] },
  "panels": [ /* plot | image | table */ ]
}
```

6.5 in = full Letter text width, 3.25 in = half column. `areas` places panels by
label; repeating a label spans it. `panelLabels.mode` is `letter`, `title` or
`none`.

**Plot panels** take every analysis field under its app name, and omitting one
inherits it: `plotType` (`amp` | `melt` | `melt_deriv` | `doubling` |
`dilution`), `channel`, `select`, `groups`, `groupColors`,
`wellStyleOverrides`, `xAxisMode`, `logScale`, `baselineEnabled`,
`baselineAuto`, `baselineMethod`, `baselineStart`, `baselineEnd`,
`driftCorrectionEnabled`, `normalizeEnabled`, `thresholdEnabled`,
`thresholdRfu`, `meltThresholdEnabled`, `meltThresholdValue`,
`meltNormalizeEnabled`, `smoothingEnabled`, `smoothingWindow`,
`fittingEnabled`, `fitStartFraction`, `fitEndFraction`.

Plus figure-authoring controls: `legend`
(`show`/`position`/`content`/`title`/`order`), `xaxis`/`yaxis`/`yaxis2`
(`title`, `range`, `scale` incl. `log2`, `dtick`, `tickFormat`,
`tickDirection`, `minorTicks`, `frame`), `title`, `annotations`,
`referenceLines`, `styleOverride`.

Selection: `"select": { "groups": ["10^7"], "exclude": ["A3"] }` — `wells`,
`groups` and `samples` all work.

**Image and table panels:**

```json
{ "kind": "image", "label": "B", "path": "gel.png", "fit": "contain",
  "crop": { "x": 0.05, "y": 0.1, "w": 0.9, "h": 0.75 } }
{ "kind": "table", "label": "C", "fontSize": 7,
  "columns": ["Metric", "SHARP"], "rows": [["Median Q", "18.4"]] }
```

Crop values are fractions of the source. Under `fit: contain` the crop keeps
the source's aspect ratio.

## Standard curves

```json
{ "kind": "plot", "plotType": "dilution",
  "thresholdEnabled": true, "thresholdRfu": 1000,
  "dilution": { "fromGroups": true, "top": 1e7, "fold": 10,
                "unit": "copies/uL", "exclude": ["NTC"] },
  "errorBars": "sd", "showFit": true,
  "fitAnnotation": "slope {slope} min/log₂<br>R² = {r2}<br>n = {n}",
  "fitAnnotationPosition": "bottom-left" }
```

Requires `thresholdEnabled` — time-to-threshold is what it plots. `errorBars`:
`sd` | `sem` | `ci95` | `none`. Substitutable statistics: `slope`, `slopeSE`,
`intercept`, `interceptSE`, `r2`, `adjR2`, `pValue`, `doublingTime`,
`doublingTimeSE`, `n`, `nSteps`.

**Never infer a concentration from a group name.** A group called `10^7` is
suggestive, not authoritative — ask for the top concentration and the fold
factor. The tool prints the resolved step table to stderr; **show it and get
confirmation before the figure is treated as final.**

## Raw files and spoken plate maps

```bash
node <cli> convert "run.pcrd" --out run.sharpx
node <cli> group run.sharpx --assign "10^7=A1-A3; 10^6=B1-B3; NTC=B4,B5,B6"
```

Wells may be listed (`A1,A2,A3`), a range along a row (`A1-A6`), down a column
(`A1-H1`), a block (`A1-C3`), or a bare row letter (`A`). Group order becomes
legend order — it is never inferred from plate geometry. The grouping is
printed for confirmation and **nothing is written without `--write`**. Show
that table before rendering.

## Working with the user

- Show the PNG. Never show the spec.
- Keep edits small — change what they asked about, inherit the rest.
- Relay the tool's warnings. "Legend has 9 entries but only 4 fit" means series
  are missing from the figure.
- If something cannot be drawn, the tool says why and what to set. Pass that on
  in plain language rather than guessing a workaround.
- Never fabricate a number. Every value comes from the data.
- On Linux, Arial is substituted by metric-compatible Liberation Sans —
  previews are faithful but not identical. Final publication renders belong on
  a machine with real Arial.

## Where this comes from

Source lives in the SHARP Processor 2 repo under `src/cli/` on branch
`feature/sharpplot-cli`; full reference in `docs/SHARPPLOT.md` there. It is a
second consumer of the Processor's core, not a fork — so a figure and the
desktop app always agree.
