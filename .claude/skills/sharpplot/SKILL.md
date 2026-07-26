---
name: sharpplot
description: Build publication figures from SHARP Data Processor 2 data (.sharpx, .sharp, .pcrd, .tlpd, .eds, .amxd, Bio-Rad folders) by conversation — amplification curves, melt curves, melt derivatives, dilution standard curves, and multi-panel composites with gel images and metrics tables, at an exact physical size as vector PDF plus PNG. Use whenever someone wants a figure, plot, panel, or composite from qPCR / isothermal amplification data, or mentions a .sharpx file.
---

# sharpplot — figures from Processor data, by conversation

You drive a CLI that calls SHARP Data Processor 2's own analysis and plotting
modules headlessly. The user describes the figure; you write a spec and render
it. **The user should never see or write a spec** — it is plumbing between you
and the tool.

## Locate the CLI

It lives in the SHARP Processor 2 repo. Find and build it:

```bash
node dist-cli/sharpplot.mjs --help
```

If that fails, run `npm run cli:build` in the repo first. Do not hardcode a
path to anyone's home directory — discover the repo, or ask.

PNG output needs `pdftoppm` (`brew install poppler`); PDF needs only Chrome.
Chrome is auto-detected on macOS; elsewhere set `SHARPPLOT_CHROME` or pass
`--chrome`.

## Always inspect first

```bash
node dist-cli/sharpplot.mjs inspect "<file>" --pretty
```

This reports the real well names, sample names, groups, colours, channels,
melt content, and which plot types the file can support — plus a populated
starting spec. **Never write a spec without doing this**, and never invent a
well or group name. A spec naming something that does not exist is a hard
error, by design.

## The core idea: the file is already the spec

A `.sharpx` carries the user's saved session — groups, per-well colours, hidden
wells, legend order, threshold, baseline settings, fonts. A minimal panel
reproduces what they last saw in the app:

```json
{ "panels": [ { "kind": "plot", "source": "run.sharpx", "plotType": "amp" } ] }
```

So **apply only the deltas the user asked for**. If they say "make it 3.25
inches wide and drop the grid", change those two things and leave everything
else inherited. Do not restate the whole figure.

## Render

```bash
node dist-cli/sharpplot.mjs plot spec.json --out figures/fig2
```

Writes `fig2.pdf` and `fig2.png`. Show the user the PNG. Save the spec beside
the figure so it can be re-edited later.

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

- **Width**: 6.5 in = full Letter text width, 3.25 in = half column. Anything
  is settable.
- **`areas`** places panels by name; repeating a label spans it.
- **Panel labels**: `"letter"` (A/B/C), `"title"` (the panel's `label` text),
  or `"none"`.

Plot panels take every analysis field under its app name — `plotType`,
`select`, `xAxisMode`, `logScale`, `baselineEnabled`, `thresholdEnabled`,
`thresholdRfu`, `normalizeEnabled`, `smoothingEnabled`, `fittingEnabled`, … —
plus `legend`, `xaxis`/`yaxis` (`title`, `range`, `scale` incl. `log2`,
`dtick`, `tickFormat`, `frame`), `annotations`, `referenceLines` and
`styleOverride`. Full reference: `docs/SHARPPLOT.md` in the repo.

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
  "fitAnnotation": "slope {slope} min/log2<br>R² = {r2}<br>n = {n}" }
```

Needs `thresholdEnabled` (Tt is what it plots). `errorBars`: `sd` | `sem` |
`ci95` | `none`. Statistics available in annotations: `slope`, `slopeSE`,
`intercept`, `r2`, `adjR2`, `pValue`, `doublingTime`, `n`, `nSteps`.

**Never infer concentrations from group names.** A group called `10^7` is
suggestive, not authoritative — ask for the top concentration and the fold
factor. The tool prints the resolved step table; **show it to the user and let
them confirm before treating the figure as final.** A wrong x-axis produces a
figure that looks perfect and is wrong.

## Raw files and spoken plate maps

```bash
node dist-cli/sharpplot.mjs convert "run.pcrd" --out run.sharpx
node dist-cli/sharpplot.mjs group run.sharpx --assign "10^7=A1-A3; NTC=B4,B5,B6"
```

Ranges work along a row (`A1-A6`), down a column (`A1-H1`), over a block
(`A1-C3`), or by row letter (`A`). Group order becomes legend order. The tool
prints the grouping for confirmation and writes nothing without `--write`.
**Show the user that table before rendering.**

## Working with the user

- Show the rendered PNG, not the spec.
- Keep edits small — change what they asked about, inherit the rest.
- Relay warnings the tool prints. A clipped-legend warning means series are
  missing from the figure.
- If something cannot be drawn, the tool says why and what to set. Pass that
  on in plain language rather than guessing at a workaround.
- Never fabricate a number for a figure. Every value comes from the data.

## Two verbs for two machines

`figure` is pure (no browser) and `render` needs a browser, so when the data
and the browser are on different machines: run `figure … --out fig.json` where
the data is, move `fig.json`, and run `render fig.json` where the browser is.
On one machine just use `plot`.
