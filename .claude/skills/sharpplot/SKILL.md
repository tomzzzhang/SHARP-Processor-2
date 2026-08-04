---
name: sharpplot
description: Build publication figures from SHARP Data Processor 2 data — .sharpx, .sharp, .pcrd, .tlpd, .eds, .amxd, or Bio-Rad CFX folders. Amplification curves, melt curves, melt derivatives, dilution standard curves, and multi-panel composites with gel images and metrics tables, at an exact physical size as vector PDF plus PNG. Use whenever Tom wants a figure, plot, panel or composite from qPCR / isothermal amplification data, mentions a .sharpx or .pcrd file, or asks for a standard curve, amplification plot, melt plot or figure panel.
---

# sharpplot — figures from Processor data, by conversation

`sharpplot` is a command-line entry point into SHARP Data Processor 2's own
analysis and plotting modules. It is a second consumer of the Processor's core,
not a reimplementation, so a figure and the desktop app always agree.

Tom describes a figure; you render it and show it; he reacts; you change a
field and re-render. **He never sees a spec file** — it is plumbing between you
and the tool. Show figures and plain language, nothing else.

## Step 1 — find the CLI, and say so if it is missing

This needs a shell. On macOS/Linux, try in order:

```bash
node ~/.claude/tools/sharpplot/sharpplot.mjs --help
node "$HOME/Documents/SHARP Dx/SHARP Processor 2/dist-cli/sharpplot.mjs" --help
find / -name sharpplot.mjs -not -path "*/node_modules/*" 2>/dev/null | head -3
```

**On Windows** the paths and the shell differ — `~` and `$HOME` do not expand
in `cmd.exe`, and `find` is not the same program. Use PowerShell:

```powershell
node "$env:USERPROFILE\.claude\tools\sharpplot\sharpplot.mjs" --help
Get-ChildItem -Path $env:USERPROFILE -Filter sharpplot.mjs -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notlike '*node_modules*' } | Select-Object -First 3 FullName
```

If none answer, look for a SHARP Processor 2 checkout and build it:

```bash
cd <checkout> && npm install && npm run cli:build
```

**If there is no shell or no checkout, stop and say so.** You can still help
Tom decide what the figure should contain, and write the spec for him to render
later on his Mac — but do not pretend to have rendered anything, and never
invent numbers or describe a figure you have not produced.

## Step 2 — check what this machine can do

The pipeline has two halves, and they need not run on the same machine:

| Step | Needs | Does not need |
|---|---|---|
| `inspect`, `figure`, `convert`, `group` | Node, the data file | any browser |
| `render` | Node, Chrome/Chromium | the data, the repo |

```bash
node --version
ls /opt/pw-browsers/chromium-*/chrome-linux/chrome /usr/bin/chromium \
   /usr/bin/google-chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" 2>/dev/null \
   || echo "no browser"
which pdftoppm || echo "no poppler"
```

- **Browser present** → `plot` does figure + render in one call.
- **No browser** → run `figure … --out fig.json` here, then stage a renderer
  (`sharpplot bundle --out <dir>` writes a self-contained copy) and run
  `render fig.json` where a browser exists.
- **No `pdftoppm`** → ask for `"formats": ["pdf"]` only. PDF needs Chrome
  alone; the PNG is rasterized from the PDF, so they are always identical.

## Step 3 — always inspect before writing a spec

```bash
node <cli> inspect "<file>" --pretty
```

Reports the real well names, samples, groups, colours, channels, melt content
and supported plot types — plus a populated starting spec. **Never invent a
well or group name.** Unknown names are hard errors by design: a figure quietly
missing a well still looks correct.

## Step 4 — the core idea: the file is already the spec

A `.sharpx` carries Tom's saved session — groups, per-well colours, hidden
wells, legend order, threshold, baseline settings, fonts. So this alone
reproduces what he last saw in the app:

```json
{ "panels": [ { "kind": "plot", "source": "run.sharpx", "plotType": "amp" } ] }
```

Resolution runs *app default → what the file saved → composite style → panel*.
**Apply only the deltas he asks for.** "Half column, no grid" changes two
fields. Keep the spec small so the next edit stays small.

## Step 5 — render and show

```bash
node <cli> plot spec.json --out figures/fig2
```

Writes `fig2.pdf` (for Word or Illustrator) and `fig2.png` (show him this).
Save the spec beside the figure so it can be re-edited later.

## Minimum spec

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
              "margin_in": 0.14 },
  "panels": [ /* plot | image | table */ ]
}
```

6.5 in = full Letter text width, 3.25 in = half column.

**Read `references/spec-reference.md` for the complete field list** — panel
types, selection, axes, annotations, reference lines, dilution config, image
crop and table panels. Load it before writing anything beyond a basic panel.

**Read `references/multi-source-and-alignment.md` before combining wells
from two files, adding a second legend, forcing literal tick labels, or
positioning an image inside a differently-sized panel box** — `mergeSources`,
`legend2`, `tickVals`/`tickText`, and `image.align`, plus the inset-panel
technique and the half-page conversion rule. Marked uncommitted where that
matters — check `git status` in the repo before relying on it elsewhere.

## Step 6 — matching a reference, and Tom's layout language

Tom specifies composites by describing the **framed plotting rectangles**,
not the outer panel boxes. "3 panel, 3:1 vertical, top 1 fig, bottom 2 at
1:2 horizontal, ratios are the plotting areas" means: the inner axes frames
land at that ratio; labels, ticks, titles and legend are added on top
without disturbing it. `layout.widths`/`heights` in the spec size the
*outer* cell (frame + labels + ticks + legend + title). Solve backward —
pick margins for each panel's chrome, then set the outer cell sizes so what
is left over is the frame ratio he asked for. **Read
`references/figure-layout.md` before building or revising any multi-panel
composite** — it has the margin-solving recipe and copy-paste verification
snippets. Do not skip it and eyeball the result; every alignment claim in
this workflow should be checked from the emitted geometry or measured pixels,
because "looks right" has been wrong before.

**Row edges must align.** When a panel spans two columns and the row below
it doesn't, its left margin must equal the left panel's, and its right
margin the right panel's, so the two rows' frames — and everything around
them — share the same outer edges. Verify this by reading `figure`'s emitted
`placement` + `margin`, never by eye.

**Hand-drawn sketches are valid layout specs.** Tom may send one instead of
describing panel arrangement in words — translate it the same way: panel
count and position, relative sizes, which one spans.

**Style defaults for this kind of figure**, unless told otherwise: framed
(boxed) axes on all four sides, gridlines on and subtle, ticks **off** when
gridlines are already shown (redundant otherwise), a moderate frame weight
(not the Plotly default, which reads thin, and not so thick it looks heavy),
tight margins and panel gaps, one shared legend when panels repeat the same
colour key rather than one per panel.

**Legend size is arithmetic, not negotiable below a floor.** Plotly costs
about `(fontSize + 12)` px per vertical legend row — several times
matplotlib's density. A figure with more categories than a reference
figure (more dilution steps, more groups) needs a genuinely bigger legend;
that is not a setting being withheld. The floor is real: don't shrink text
past readability (≈7–8px) to force a fit. Instead trade panel height, legend
shape (vertical column vs. horizontal wrapped), or position — see the
reference doc for the decision process.

**After any CLI code edit, re-stage before testing.** `npm run cli:install`
rebuilds and re-copies to `~/.claude/tools/sharpplot/` — that global copy is
a snapshot, not a link. Testing against the stale one has produced false
bug reports before.

**Once Tom accepts a figure, save one named file next to the source data**
(`<name>.pdf`, `<name>.png`, `<name>.spec.json`) and overwrite those same
three files on later revisions of the same figure, rather than accumulating
versioned filenames. Use throwaway names for iteration in scratch.

## The two things that must never be guessed

A figure that renders beautifully and is wrong is the worst output this tool
can produce. Two inputs cause that, and both have a confirmation step:

1. **Dilution concentrations.** Never infer them from a group name — `10^7` is
   suggestive, not authoritative. Ask for the top concentration and the fold
   factor. The tool prints the resolved step table; **show it to Tom and get
   confirmation before treating the figure as final.**
2. **Verbal grouping.** `group … --assign "10^7=A1-A3; NTC=B4,B5,B6"` prints
   the resulting well-to-group table and writes nothing without `--write`.
   Show that table before rendering.

## Working with Tom

- Show the PNG. Never show the spec.
- Keep edits small — change what he asked about, inherit the rest.
- Relay the tool's warnings. "Legend has 9 entries but only 4 fit" means series
  are missing from the figure.
- When something cannot be drawn, the tool says why and what to set. Pass that
  on in plain language rather than guessing a workaround.
- Never fabricate a number. Every value comes from the data.
- On Linux, Arial is substituted by metric-compatible Liberation Sans —
  previews are faithful but not identical. Final publication renders belong on
  his Mac, where real Arial is installed. Say so when it matters.

## Where this comes from

Source is in the SHARP Processor 2 repo under `src/cli/`, branch
`feature/sharpplot-cli`; full documentation in `docs/SHARPPLOT.md` there.
