# sharpplot — headless figures from Processor data

**Last Updated:** 2026-08-06 13:56 EDT

`sharpplot` is a command-line entry point into SHARP Data Processor 2's own
modules, so publication figures can be produced without the desktop GUI. It is
a **second consumer of the Processor's core, not a fork of it**: parsers,
`analysis.ts`, `curvefit/` and `plot-figure.ts` are called directly, so every
number and every trace comes from the code the shipped app runs.

It is a developer tool, merged to `main` (PR #13). It is deliberately **not
part of the shipped application** — `src/cli/` is excluded from the Tauri
bundle and `dist-cli/` is gitignored, so installing the app does not provide
the CLI. Teammates install it separately; see "Installing the skill" below.

## Build and run

```bash
npm run cli:build
node dist-cli/sharpplot.mjs --help
```

Rendering additionally needs Chrome (found automatically on macOS, or set
`SHARPPLOT_CHROME` / pass `--chrome`) and `pdftoppm` from poppler
(`brew install poppler`) for PNG output. PDF output needs only Chrome.

## The idea

A `.sharpx` already contains `session.json` — the groups, per-well colours,
hidden wells, legend order, threshold, baseline settings and every font size
the user last had on screen. **So the file is already most of the figure
spec.** A spec states only what should differ:

```json
{
  "panels": [
    { "kind": "plot", "source": "run.sharpx", "plotType": "amp" }
  ]
}
```

That renders the amplification plot as the app last showed it. Everything not
mentioned is inherited, which keeps specs short and keeps edits to the one or
two fields actually being changed.

Resolution order for every field:

```
app default  →  what the source file saved  →  composite style  →  panel
```

## Verbs

| Verb | Purpose |
|---|---|
| `inspect <file>` | What is in the file — wells, samples, groups, colours, channels, melt content, which plot types it supports — plus a populated starting spec. |
| `figure <spec> --out fig.json` | Pure. Spec to Plotly figures. No browser; runs anywhere Node runs. |
| `render <spec\|fig> --out out.pdf` | Browser. Figures to PDF and PNG. |
| `plot <spec>` | `figure` + `render`. The normal path. |
| `convert <raw> --out f.sharpx` | Raw instrument file to `.sharpx` via the app's own parsers. |
| `group <file> --assign "..."` | Assign wells to groups from a described plate map. |
| `bundle --out <dir>` | Stage a self-contained renderer for a machine with no checkout. |
| `verify <spec> [--against accepted.png]` | Re-render an unchanged accepted figure and stop on any byte-level PNG drift. |
| `archive <figure-folder\|spec> [--label text]` | Archive an accepted triplet while preserving its relative source paths. |
| `hash-source <file\|folder>` | Produce the path-free checksum used by confidential-source manifests. |

`figure` and `render` are separate because the data step and the browser step
do not always run on the same machine: the pure step runs where the data is,
and the resulting `fig.json` can be rendered anywhere a browser exists.

Sources: `.sharpx`, `.sharp`, `.pcrd`, `.tlpd`, `.eds`, `.amxd`, or a Bio-Rad
CFX export folder.

## Installing the skill

**For using it rather than building it, see
[`SHARPPLOT_MANUAL.md`](SHARPPLOT_MANUAL.md)** — the `.sharpx` workflow, which
saved GUI state reaches the figure and which does not, the full capability
list, and the two inputs the tool refuses to guess.

The same manual exists as plain text at
[`../skills/team-install/sharpplot user manual.txt`](../skills/team-install/sharpplot%20user%20manual.txt)
— that is the copy sent to the team, because it opens with a double-click on
any machine and needs no Markdown renderer. **The two are parallel documents:
edit both, or neither.** The Markdown one is for GitHub; the text one is the
one people actually read.

The skill source lives at `.claude/skills/sharpplot/` and is packaged three
ways, from one set of files:

**Claude Code (this machine, every project):**

```bash
npm run cli:install                          # build + stage CLI to ~/.claude/tools/sharpplot/
cp -r .claude/skills/sharpplot ~/.claude/skills/
```

`cli:install` is also the refresh command after changing the CLI — the staged
files are a snapshot, not a link.

**claude.ai / Cowork — the path for anyone who does not already work in a
terminal.** Build a self-contained skill and upload that:

```bash
npm run skill:pack:cowork                    # dist-skill/sharpplot-cowork.skill (~1.9 MB)
```

The current self-contained package is attached to the **v0.2.5 release** as
`sharpplot.skill`, so anyone can download it without a checkout. That release
asset is a **snapshot**: re-upload it (`gh release upload v0.2.5
dist-skill/sharpplot-cowork.skill --clobber`, renamed to `sharpplot.skill`)
whenever the CLI or the skill changes, or it silently goes stale. `--version`
is what tells you which build a copy actually is.

It carries the engine in a `bin/` folder beside `SKILL.md` — `sharpplot.mjs`,
its side chunks and `plotly.min.js` — and `SKILL.md` looks there first. So the
recipient uploads one file and is done: no Node install, no Chrome install, no
PATH. The sandbox supplies Node and a Playwright chromium, both of which
`render` already knows how to find.

Deliberately **not** tracked: it is 1.9 MB of build output that changes on
every CLI edit, and a stale copy in git is exactly the drift this replaces.
Rebuild and re-upload after changing the skill or the CLI.

[`skills/sharpplot.skill`](../skills/sharpplot.skill) (`npm run skill:pack`)
remains the docs-only package — SKILL.md plus references, no engine. It is
useful only where the CLI is already installed separately; it will not render
anything on its own.

**A colleague on Claude Code:** they clone the repo and do the same as above,
or run the bundle produced by `npm run team:pack`. The skill discovers the CLI
(beside SKILL.md, then the staged copy, then a checkout) rather than
hardcoding a path, so it works wherever it lands. See
[`skills/team-install/`](../skills/team-install/) for the hand-off docs.

## Porting it to another machine

Two routes.

**With a checkout** — clone the repo, then:

```bash
npm install
npm run cli:build
```

**Without a checkout** — stage a self-contained copy:

```bash
node dist-cli/sharpplot.mjs bundle --out /somewhere
```

That writes `sharpplot.mjs`, its lazily-loaded side chunks, and
`plotly.min.js`. Every dependency is bundled, so those files run on any machine
with Node 20+ — no `node_modules`, no network, no repo. Copy the directory and:

```bash
node sharpplot.mjs render fig.json --out figure
```

Per-machine requirements: **Node 20+** for everything; **Chrome/Chromium** only
for `render` (auto-detected on macOS, Linux, Windows, including Playwright's
browser cache; override with `--chrome` or `SHARPPLOT_CHROME`); **poppler**
(`pdftoppm`) only for PNG output — PDF needs Chrome alone.

This is what makes the split-machine flow work: run `figure` where the data
lives, move `fig.json` to where a browser lives, and `render` there. Bundle
format 2 embeds image-panel bytes and records the sharpplot version, commit,
build date and supported `.sharpx` format. It emits no source machine paths.

## Reusable figure folders

Before revising an accepted figure, prove that the unchanged canonical spec
still reproduces its accepted PNG:

```bash
node dist-cli/sharpplot.mjs verify "Fig 3 AB/Fig 3 AB.spec.json"
```

This catches changed data, a different sharpplot build, browser/font drift, or
an accidental spec edit before those changes are mixed into a small requested
revision. A mismatch keeps the candidate PNG for inspection and exits nonzero.

Archive an accepted revision with the CLI rather than moving its spec by hand:

```bash
node dist-cli/sharpplot.mjs archive "Fig 3 AB" --label "full width gel"
```

The archived PDF/PNG/spec share a timestamped basename. Relative `source`,
`mergeSources[].source`, and image `path` fields are rewritten for the spec's
new location; `sourceRef`/`pathRef` remain unchanged.

For confidential/shared input that must not be copied into a figure folder,
use `sourceRef` (or `pathRef` for an image). The shareable
`source/source.json` contains only an opaque id, role, checksum, date and
generic reason. The real path belongs in a private machine-local map selected
by `SHARPPLOT_SOURCE_MAP`, never in the figure folder or Git:

```json
{ "version": 1, "sources": { "external-run-1": "<real local path>" } }
```

`hash-source` prints the standard `sha256` field for a file or the stable
`sha256_tree` field for a folder. Every resolution verifies that digest and
stops if the source changed.

## Spec reference

Full types, with per-field documentation, are in
[`src/cli/spec.ts`](../src/cli/spec.ts). The shape:

```jsonc
{
  "id": "figure_2",
  "output": { "width_in": 6.5, "height_in": 2.6, "dpi": 600, "formats": ["pdf", "png"] },
  "style": {            // composite-wide; every PlotFigureStyle field, same names
    "fontFamily": "Arial, Helvetica, sans-serif",
    "titleSize": 9, "labelSize": 8, "tickSize": 7, "legendSize": 7,
    "lineWidth": 1.2, "showGrid": false, "showTitle": false, "plotBgColor": "#ffffff"
  },
  "panelLabels": { "mode": "letter", "bold": true, "size": 10, "position": "top-left" },
  "layout": {
    "rows": 1, "cols": 3,
    "widths": [1.35, 1, 1], "gap_in": 0.16, "margin_in": 0.14,
    "areas": ["A A B", "C C B"]        // optional; repeat a label to span
  },
  "panels": [ /* plot | image | table | kinetics_table */ ]
}
```

`width_in` 6.5 is full Letter text width; 3.25 is a half column.

### Plot panels

Every analysis and view field keeps the name it has in `BuildFigureInput` /
the app's own state, and omitting it inherits from the source:

`plotType` (`amp`, `melt`, `melt_deriv`, `doubling`, `dilution`,
`kinetics_residuals`), `channel`,
`select`, `groups`, `groupColors`, `wellStyleOverrides`, `xAxisMode`,
`logScale`, `baselineEnabled`, `baselineAuto`, `baselineMethod`,
`baselineStart`, `baselineEnd`, `driftCorrectionEnabled`, `normalizeEnabled`,
`thresholdEnabled`, `thresholdRfu`, `meltThresholdEnabled`,
`meltThresholdValue`, `meltNormalizeEnabled`, `smoothingEnabled`,
`smoothingWindow`, `fittingEnabled`, `fitStartFraction`, `fitEndFraction`.

Plus figure-authoring controls with no GUI equivalent: `legend`
(`show`/`position`/`content`/`title`/`order`), `xaxis`/`yaxis`/`yaxis2`
(`title`, `range`, `scale` including `log2`, `dtick`, `tickFormat`,
`tickDirection`, `minorTicks`, `frame`), `title`, `annotations`,
`referenceLines`, and `styleOverride`.

Use `sourceRef` instead of `source` for a path-free confidential/shared input.
The same alternative is available on every `mergeSources` entry.

Well selection is explicit and validated:

```json
"select": { "groups": ["10^7", "10^6"], "exclude": ["A3"] }
```

`wells`, `groups` and `samples` all work. **A name that does not exist is a
hard error listing what does** — never a silent skip, because a figure quietly
missing a well looks correct.

### Dilution panels

```json
{
  "kind": "plot", "label": "B", "source": "run.sharpx", "plotType": "dilution",
  "dilution": { "fromGroups": true, "top": 1e7, "fold": 10,
                "unit": "copies/uL", "exclude": ["NTC"] },
  "errorBars": "sd",
  "showFit": true,
  "fitAnnotation": "slope {slope} min/log2<br>R² = {r2}<br>n = {n}"
}
```

`errorBars` is `sd`, `sem`, `ci95` or `none`. `ci95` uses the t-value for each
step's own replicate count, not 1.96 — at n = 3 that difference is more than
2×. Substitutable statistics: `slope`, `slopeSE`, `intercept`, `interceptSE`,
`r2`, `adjR2`, `pValue`, `doublingTime`, `doublingTimeSE`, `n`, `nSteps`.

Alternatives to `fromGroups`: explicit `steps`, or nothing at all if the file
already carries a `dilutionConfig` from the app's Standard Curve wizard.

The resolved step table is always printed before rendering. Check it. A wrong
x-axis produces a figure that looks perfect and is wrong.

### Kinetics Report sections

SharpPlot can rebuild all or selected parts of Processor 2's Kinetics Report
as native vector plots and figure tables. The full report computation
(FreeShoulder fit, covariance/SEs, landmarks, run σ, melt peaks) is cached once
per source/channel and shared across panels.

```jsonc
{
  "kind": "plot", "label": "A", "source": "run.sharpx", "plotType": "amp",
  "thresholdEnabled": false,
  "kinetics": {
    "signal": "corrected",
    "showData": true,
    "showFit": true,
    "markers": ["t_lod", "t_onset10", "inflection"]
  }
}
```

The data are bold; fits are fainter and thinner. `t_lod` is drawn on the
measured curve, while `t_onset10` and inflection are drawn on the fitted model.
`signal` is `corrected` (the report's fit-first baseline) or `raw`. Fits are
never extrapolated past the report's censoring gate: a panel requesting fits
with no usable selected fit stops with a specific error.

Other independently placeable sections:

```jsonc
{ "kind": "plot", "label": "B", "source": "run.sharpx",
  "plotType": "kinetics_residuals" }

{ "kind": "plot", "label": "C", "source": "run.sharpx",
  "plotType": "melt_deriv", "kinetics": { "showMeltTm": true } }

{ "kind": "kinetics_table", "label": "D", "source": "run.sharpx",
  "section": "readouts",
  "columns": ["well", "sample", "t_lod", "t_onset10", "td_20", "yield_raw", "melt_tm", "call"],
  "timeUnit": "min", "uncertainty": "plusminus" }

{ "kind": "kinetics_table", "label": "E", "source": "run.sharpx",
  "section": "fit_parameters",
  "columns": ["well", "sample", "fit_A", "fit_B", "fit_C", "fit_D", "fit_foot", "fit_shoulder", "fit_r2", "fit_rmse"],
  "uncertainty": "separate" }
```

Residuals are observed − fit with the ±1 pooled run-σ band. Kinetics tables
support `readouts`, `fit_parameters`, or `all`; `columns` selects and orders
any subset; `uncertainty` is `plusminus`, `separate`, or `none`; `timeUnit`
converts both time/rate values and their SEs.

The `.sharpx` 1.3 landmark visibility triple is intentionally not inherited
by the CLI. Kinetics content is an explicit figure recipe, so a spec produces
the same figure regardless of which marker happened to be toggled in the app.
Omitting `kinetics` preserves the existing plot path byte-for-byte.

### Image and table panels

```json
{ "kind": "image", "label": "B", "path": "gel.png", "fit": "contain",
  "crop": { "x": 0.05, "y": 0.1, "w": 0.9, "h": 0.75 } }

{ "kind": "table", "label": "C", "fontSize": 7,
  "columns": ["Metric", "SHARP", "PCR"],
  "rows": [["On-target %", "99.1", "98.7"]] }
```

Crop values are fractions of the source image. Under `fit: contain` the crop
keeps the source's aspect ratio, read from the image header — a stretched gel
misrepresents data. Use `pathRef` instead of `path` for a confidential/shared
image. New `fig.json` bundles embed the image itself, so they remain renderable
after moving to another computer or removing the original source.

## Grouping from a described plate

```bash
node dist-cli/sharpplot.mjs group run.sharpx \
  --assign "10^7=A1-A3; 10^6=B1-B3; NTC=B4,B5,B6"
```

Wells may be listed (`A1,A2,A3`), given as a range along a row (`A1-A6`), down
a column (`A1-H1`), over a block (`A1-C3`), or named by row letter (`A`).
Group order becomes the legend order. The resulting table is printed for
confirmation and **nothing is written without `--write`**.

## Render pipeline

One HTML harness draws the whole composite, so multi-panel figures are not a
separate feature — Chrome does the layout. The page *is* the figure (`@page`
sized to it, no margins), each panel is absolutely placed at its computed
rectangle, and each Plotly layout carries that same rectangle in pixels
(sizes are never left to CSS, which clips axis labels).

**PDF first, then rasterize.** `--print-to-pdf` produces the vector PDF;
`pdftoppm -r <dpi>` produces the PNG from it. This makes dpi a rasterization
parameter rather than a render parameter and guarantees the PNG and PDF are the
same drawing. The `--screenshot --force-device-scale-factor` route was tried
first and clipped the x-axis of every panel.

Checks that run automatically, because each of these failures produces a
plausible-looking wrong figure:

- WebGL trace types are rejected — they silently rasterize the PDF.
- The PDF is verified to contain extractable text; Chrome exits successfully
  even when the page threw.
- A legend with more entries than fit warns with the count that will be
  clipped, since Plotly truncates silently.
- On any failure the harness directory is kept and its path reported.

## Constraints this tool works under

`sharpplot` adds capability to the Processor without changing what it already
does:

- Every field added to a shared module is optional with a default that
  preserves current behaviour.
- `npm run test:parity` hashes `buildFigure`'s output for `amp`, `melt`,
  `melt_deriv` and `doubling` against a recorded baseline. **Existing plot
  types must stay byte-identical.** See [`test/parity/README.md`](../test/parity/README.md).
- No `.sharpx` schema change in this feature. Current `.sharpx` 1.3 files open
  in shipped v0.2.5.
- No GUI wiring. Bringing any of this into the app is a separate decision.
- Kinetics report panels reuse `computeExperimentReport`; they do not fork the
  fit or landmark mathematics into the CLI.

### Known upstream issue, not fixed here

`computeMargins` in `plot-figure.ts` returns a fixed 20px right margin, so a
legend positioned outside the axes is clipped — in the Export Wizard as well as
here. The CLI widens the margin itself; fixing it upstream would change every
existing exported figure and needs its own review.
