# sharpplot spec — complete field reference

Read this before writing anything beyond a single basic panel.

**The inheritance rule governs everything here:** omitting a field, or setting
it to `null`, inherits it — from the source file's saved session, then the
composite `style` block, then the app default. A value is never guessed. That
is why a one-line panel reproduces what the Processor GUI last showed, and why
edits should change only the fields actually being discussed.

## Verbs

| Verb | Purpose |
|---|---|
| `inspect <file>` | Wells, samples, groups, colours, channels, melt content, supported plot types, plus a populated starting spec. |
| `figure <spec> --out fig.json` | Pure: spec to Plotly figures. No browser. |
| `render <spec\|fig> --out out.pdf` | Browser: figures to PDF and PNG. |
| `plot <spec> --out <base>` | figure + render. The normal path. |
| `convert <raw> --out f.sharpx` | Raw instrument file to `.sharpx`. |
| `group <file> --assign "..."` | Wells to groups from a described plate map. |
| `bundle --out <dir>` | Stage a self-contained renderer (no repo needed there). |

Flags: `--pretty`, `--panel <label>`, `--chrome <path>`, `--plotly <path>`,
`--keep-html`, `--write` (group only). Environment: `SHARPPLOT_CHROME`,
`SHARPPLOT_PLOTLY`.

Sources: `.sharpx`, `.sharp`, `.pcrd`, `.tlpd`, `.eds`, `.amxd`, or a Bio-Rad
CFX export folder.

## Composite level

```jsonc
{
  "id": "figure_2",                    // used as the default output filename
  "output": {
    "width_in": 6.5,                   // 6.5 = full Letter text width, 3.25 = half column
    "height_in": 2.6,
    "dpi": 600,                        // PNG raster density; PDF is vector regardless
    "formats": ["pdf", "png"]
  },
  "style": { /* any PlotFigureStyle field, same names — see below */ },
  "panelLabels": {
    "mode": "letter",                  // "letter" (A/B/C) | "title" (the panel's label text) | "none"
    "bold": true, "size": 10,
    "position": "top-left",            // top-left | top-right | bottom-left | bottom-right
    "offset_in": 0.02,
    "fontFamily": "...",               // defaults to the composite font
    "color": "#000000"
  },
  "layout": {
    "rows": 1, "cols": 3,
    "widths": [1.35, 1, 1],            // relative; length must equal cols
    "heights": [1],                    // relative; length must equal rows
    "gap_in": 0.16,
    "margin_in": 0.14,
    "areas": ["A A B", "C C B"]        // optional; repeat a label to span cells
  },
  "panels": [ /* … */ ]
}
```

### style (composite-wide, overridable per panel via `styleOverride`)

`palette`, `paletteReversed`, `paletteGroupColors`, `lineWidth`, `fontFamily`,
`titleSize`, `labelSize`, `tickSize`, `legendSize`, `showLegend`,
`legendPosition`, `legendContent` (`well` | `sample` | `group`), `showTitle`,
`showLabels`, `showTicks`, `showGrid`, `gridAlpha`, `plotBgColor`, `textColor`
(`auto` | `black` | `white`), `isDark`.

For print, set `plotBgColor: "#ffffff"` and `textColor: "black"`.

## Plot panels

```jsonc
{
  "kind": "plot",
  "label": "A",
  "source": "run.sharpx",              // relative paths resolve against the spec file
  "plotType": "amp",                   // amp | melt | melt_deriv | doubling | dilution
  "channel": null,                     // defaults to the file's active channel
  "select": { "groups": ["10^7"], "exclude": ["A3"] }
}
```

### Selection

`select` takes `wells`, `groups`, `samples` (any combination, unioned) and
`exclude` (applied last). With no `select`, the file's own visible set is used
— populated, not hidden, not deactivated.

Naming a well explicitly overrides the file's hidden flag: asking for it is
asking to see it. **Any name that does not exist is a hard error listing what
does.** Never a silent skip.

### Analysis fields — same names as the app, omit to inherit

`xAxisMode` (`cycle` | `time_s` | `time_min`), `logScale`, `baselineEnabled`,
`baselineAuto`, `baselineMethod` (`horizontal` | `linear`), `baselineStart`,
`baselineEnd` (1-indexed cycles), `driftCorrectionEnabled`, `normalizeEnabled`,
`thresholdEnabled`, `thresholdRfu`, `meltThresholdEnabled`,
`meltThresholdValue`, `meltNormalizeEnabled`, `smoothingEnabled`,
`smoothingWindow`, `fittingEnabled`, `fitStartFraction`, `fitEndFraction`.

`doubling` panels need both `thresholdEnabled` (for Tt) and `fittingEnabled`
(for doubling time), or nothing is plotted.

### Appearance

```jsonc
{
  "groups": { "A1": "10^7" },              // override the file's grouping
  "groupColors": { "10^7": "#67000d" },    // colour a whole group
  "wellStyleOverrides": {
    "H12": { "color": "#7f8c8d", "lineStyle": "dash", "lineWidth": 1.0 }
  },
  "legend": {
    "show": true,
    "position": "upper left",              // upper/lower + left/right/center, "center",
                                           // "right" (outside), or "best"
    "content": "group",
    "title": "Input",
    "order": ["10^7", "10^6", "NTC"]
  },
  "title": "Amplification",
  "styleOverride": { "legendSize": 6 },
  "margin": { "l": 60, "r": 12, "t": 24, "b": 36 }
}
```

Line styles: `solid`, `dash`, `dot`, `dashdot`.

`panel.margin` overrides the plot's computed pixel margins (96 px/in),
per edge — omitted edges keep the computed value. This is the primary lever
for hitting an exact inner-plot-area ratio and for aligning panel edges
across a composite; see `references/figure-layout.md` for the full recipe.

### Legend, beyond position/content

```jsonc
"legend": {
  "show": true, "position": "upper left", "content": "group",
  "title": "Input", "order": ["10^7", "10^6", "NTC"],
  "frame": true,            // box around the legend (false = unboxed, common in print)
  "bgcolor": "#ffffff",     // or "transparent"
  "fontSize": 8,
  "orientation": "h",       // "v" (default, one row per entry) | "h" (wraps, spends width not height)
  "itemGap": 2,             // px between entries
  "entryWidthPx": 90        // forces per-entry width in "h" mode — changes column count,
                             // NOT the legend box's overall footprint. See figure-layout.md.
}
```

`position` also accepts `"above"`: places a horizontal legend in reserved
space over the axes (never over data) and pins the panel title above it.
Only meaningful with `orientation: "h"`.

Plotly costs ~`(fontSize + 12)` px per vertical row — a many-series legend
needs real room; see `references/figure-layout.md` §4 before assuming a
legend "should" fit and shrinking text to force it.

### Axes

`xaxis`, `yaxis`, and `yaxis2` (the derivative subplot of a full `melt` panel):

```jsonc
"xaxis": {
  "title": "Time (min)",
  "range": [0, 30],
  "scale": "linear",        // linear | log (base 10) | log2
  "dtick": 5,
  "tickFormat": ".1f",
  "tickDirection": "outside", // "outside" | "inside" | "" (no ticks — pairs with gridlines)
  "minorTicks": true,
  "frame": true,             // full box instead of open L-shaped axes
  "lineWidth": 1.1,          // frame/axis line weight, px (Plotly's default reads thin)
  "lineColor": "#000000",
  "gridDash": "dot",         // "solid" | "dot" | "dash" | "dashdot" — Plotly defaults to solid
  "gridColor": "rgba(0,0,0,0.15)",
  "zeroline": false,         // Plotly's separate y=0 line reads as a stray heavy gridline
  "titleStandoff": 20        // px from tick labels to the title — see below
}
```

Pass `range` in data units even for a log axis — the conversion is handled.

**`titleStandoff` — needed whenever two panels' y-axis titles should align.**
Plotly positions a y-axis title relative to that axis's own tick-label
width, not a fixed distance from the plot edge, so two panels with equal
margins but different tick-label digit counts (`"7000"` vs `"20"`) get
visibly offset titles. Tune per panel and verify by measuring rendered
pixels — full recipe in `references/figure-layout.md` §5.

### Annotations and reference lines

```jsonc
"annotations": [
  { "text": "LoD", "x": 0.02, "y": 0.96, "size": 7, "bold": true,
    "xref": "paper", "yref": "paper", "xanchor": "left", "yanchor": "top",
    "color": "#000000", "arrow": false, "ax": 0, "ay": -20 }
],
"referenceLines": [
  { "axis": "y", "value": 1000, "color": "#c42a30", "dash": "dash",
    "width": 1.5, "legend": "threshold" }
]
```

`axis: "y"` draws a horizontal line at that y value; `"x"` draws a vertical
one. Setting `legend` gives the line its own legend entry.

## Dilution / standard-curve panels

```jsonc
{
  "kind": "plot", "label": "B", "source": "run.sharpx", "plotType": "dilution",
  "thresholdEnabled": true, "thresholdRfu": 1000,
  "dilution": {
    "fromGroups": true,          // walk the file's groups in legend order
    "top": 1e7,                  // concentration of the most concentrated step
    "fold": 10,                  // dilution factor between steps
    "unit": "copies/uL",
    "exclude": ["NTC", "Plasmid"]
  },
  "errorBars": "sd",             // sd | sem | ci95 | none
  "showFit": true,
  "fitAnnotation": "slope {slope} min/log₂<br>R² = {r2}<br>n = {n}",
  "fitAnnotationPosition": "bottom-left",
  "pointColor": "#c42a30", "fitColor": "#555555", "markerSize": 7,
  "markerSymbol": "square",
  "dilution": { "xScale": "log2" },  // "concentration" (default, log10 axis) | "log2" (linear axis)
  "yaxis": { "title": "Time to threshold (min)" }
}
```

`dilution.xScale: "log2"` plots log₂(concentration) on a linear axis — the
space the regression is actually solved in, so the slope reads directly as
minutes per doubling. Default plots concentration on a log10 axis instead.

Requires `thresholdEnabled` — time-to-threshold is what it plots.

`ci95` uses the t-value for each step's own replicate count, not 1.96. At n = 3
that is a factor of more than two, so it matters.

Three ways to supply the config, in expected order of use:

1. **`fromGroups`** — the common case. Tom already grouped by dilution in the
   GUI, so only the top concentration and fold factor are unknown.
2. **Explicit steps**, for irregular series:
   `"steps": [ { "concentration": 5e6, "wells": ["A1","A2","A3"] }, … ]`
3. **Nothing** — if the file already carries a `dilutionConfig` from the app's
   Standard Curve wizard, it is used as-is.

Order comes from `legendOrder`, never from plate geometry. Row and column order
is not dilution order.

**Substitutable statistics** in `fitAnnotation`: `{slope}`, `{slopeSE}`,
`{intercept}`, `{interceptSE}`, `{r2}`, `{adjR2}`, `{pValue}`,
`{doublingTime}`, `{doublingTimeSE}`, `{n}`, `{nSteps}`. An unknown placeholder
is an error rather than being left in the figure.

## Image panels

```jsonc
{ "kind": "image", "label": "B", "path": "gel.png",
  "fit": "contain",                                    // contain | cover | fill
  "crop": { "x": 0.05, "y": 0.1, "w": 0.9, "h": 0.75 },  // fractions of the source
  "background": "#ffffff" }
```

Under `fit: contain` a cropped image keeps the source's aspect ratio, read from
the file header — a stretched gel misrepresents data.

## Table panels

```jsonc
{ "kind": "table", "label": "C", "fontSize": 7, "header": true,
  "align": ["left", "right", "right"],
  "columns": ["Metric", "SHARP", "PCR"],
  "rows": [["On-target %", "99.1", "98.7"], ["Median Q", "18.4", "18.1"]] }
```

## Verbal grouping

```bash
node <cli> group run.sharpx --assign "10^7=A1-A3; 10^6=B1-B3; NTC=B4,B5,B6"
```

Wells may be listed (`A1,A2,A3`), a range along a row (`A1-A6`), down a column
(`A1-H1`), a rectangular block (`A1-C3`), or a bare row letter (`A`). Group
order becomes legend order.

Unknown wells and wells claimed by two groups are hard errors. The resolved
table is printed for confirmation. Nothing is written without `--write`; with
it, only `wellGroups` and `legendOrder` are touched, in the app's own format,
so the file still opens in the shipped Processor.

## Failure modes the tool guards against

Each of these otherwise produces a plausible-looking wrong figure, so the tool
checks and reports rather than continuing:

- Unknown well, group, sample or channel names → hard error listing what exists.
- WebGL trace types → rejected; they silently rasterize the PDF.
- A PDF with no extractable text → rejected; Chrome exits successfully even
  when the page threw.
- A legend with more entries than fit → warning with the count that will be
  clipped, since Plotly truncates silently.
- Missing image, out-of-range crop, grid too small for its panels → hard error.
- On any render failure the HTML harness is kept and its path reported.

## Known limitation

`plot-figure.ts`'s margin calculation returns a fixed 20px right margin, so a
legend placed outside the axes would be clipped. The CLI widens it itself. The
same issue affects the desktop app's Export Wizard and is unfixed there.
