---
name: sharpplot
description: Build publication figures from SHARP Data Processor 2 data — .sharpx, .sharp, .pcrd, .tlpd, .eds, .amxd, or Bio-Rad CFX folders. Amplification and melt plots, fitted curves, kinetic landmarks, Kinetics Report sections and fit-parameter tables, dilution standard curves, and multi-panel composites with images/tables, at an exact physical size as vector PDF plus PNG. Use whenever the user wants a figure, plot, report panel or composite from qPCR / isothermal amplification data, mentions a .sharpx or .pcrd file, or asks for a standard curve, amplification plot, melt plot, kinetics report, fitted curve, kinetic marker or fit parameters.
---

**Last Updated:** 2026-08-05 17:44 EDT

# sharpplot — figures from Processor data, by conversation

`sharpplot` is a command-line entry point into SHARP Data Processor 2's own
analysis and plotting modules. It is a second consumer of the Processor's core,
not a reimplementation, so a figure and the desktop app always agree.

The user describes a figure; you render it and show it; they react; you change
a field and re-render. **They never see a spec file** — it is plumbing between
you and the tool. Show figures and plain language, nothing else.

## Step 1 — find the CLI, and say so if it is missing

This needs a shell. **The CLI may ship inside this skill** — the Cowork build
puts `sharpplot.mjs`, its side chunks and `plotly.min.js` in a `bin/` folder
beside this file, so nothing has to be installed. Look there first, then at
the usual installed locations:

```bash
# 1. beside this SKILL.md (Cowork / uploaded .skill — no install needed)
find / -path "*/sharpplot/bin/sharpplot.mjs" 2>/dev/null | head -3
# 2. installed by `npm run cli:install`, or built in a checkout
node ~/.claude/tools/sharpplot/sharpplot.mjs --help
node "$HOME/Documents/SHARP Dx/SHARP Processor 2/dist-cli/sharpplot.mjs" --help
# 3. last resort — slow, but finds it wherever it is
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

Whatever you find, `--help` must print a usage block listing `inspect`,
`figure`, `render`, `plot`, `convert`, `group`, `bundle`, `verify`, `archive`
and `hash-source`. Use that same path for every later command — write it down
rather than re-deriving it.

**Then check which build it is:**

```bash
node <cli> --version
```

Prints the Processor version, the git commit, the build date and age, and the
newest `.sharpx` format it understands. Every copy of this tool is a snapshot —
staged, zipped into a `.skill`, uploaded — so it can fall behind the repo with
nothing to show for it. **State the build date when you first report what you
can do**, so a stale copy is visible before it makes a figure rather than after.

You do not need to check this against anything. The correctness case is handled
automatically: a `.sharpx` written by a newer Processor than this build
understands is a **hard error** at load time, not a warning. If you see it, do
not work around it with `--allow-newer-format` on your own initiative — relay
the message, which says how to get a current build.

**If there is no shell or no CLI, stop and say so.** You can still help decide
what the figure should contain, and write the spec to be rendered later on a
machine that has the tool — but do not pretend to have rendered anything, and
never invent numbers or describe a figure you have not produced.

## Step 2 — check what this machine can do

The pipeline has two halves, and they need not run on the same machine:

| Step | Needs | Does not need |
|---|---|---|
| `inspect`, `figure`, `convert`, `group` | Node 20+, the data file | any browser |
| `render` | Node 20+, Chrome/Chromium | the data, the repo |

```bash
node --version
ls /opt/pw-browsers/chromium-*/chrome-linux/chrome \
   /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell \
   /root/.cache/ms-playwright/chromium-*/chrome-linux/chrome \
   /usr/bin/chromium /usr/bin/google-chrome \
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" 2>/dev/null \
   || echo "no browser"
which pdftoppm || echo "no poppler"
```

`render` finds those paths by itself — this check is so you can tell the user
up front what they will get, not something to pass in. If a browser exists in
an unlisted place, pass `--chrome <path>` or set `SHARPPLOT_CHROME`.

- **Browser present** → `plot` does figure + render in one call.
- **No browser** → run `figure … --out fig.json` here, then stage a renderer
  (`sharpplot bundle --out <dir>` writes a self-contained copy) and run
  `render fig.json` where a browser exists. Current bundles embed image panels
  as data and record the sharpplot version/commit/build date, so that one JSON
  file is genuinely portable and traceable. A legacy bundle may still contain
  an image path; rebuild it before moving it to another machine.
- **No `pdftoppm`** → ask for `"formats": ["pdf"]` only. PDF needs Chrome
  alone; the PNG is rasterized from the PDF, so they are always identical.

## Step 3 — establish the workspace, once per project

Ask **two questions on the first figure of a project, and none afterwards.**
Do not turn this into an interrogation: if an answer is obvious from context,
state the default you are using and move on.

1. **Where is the figures folder for this project?**
2. **New figure, or a revision of an existing one?**

For a **revision**, run the baseline gate before changing the spec:

```bash
node <cli> verify "Fig 3 AB/Fig 3 AB.spec.json"
```

It rerenders the unchanged spec and requires a byte-identical match to the
accepted PNG. If it fails, stop before editing and reconcile the source hash,
sharpplot build, fonts or browser. Do not fold unexplained drift into a small
requested revision.

Then look for `.sharpplot.json` at that figures root and read it if present:

```jsonc
{
  "defaults": {
    "width_in": 3.4,           // 3.4 = half column, 6.5–7 = full text width
    "dpi": 300,
    "formats": ["pdf", "png"],
    "fontFamily": "Arial, Helvetica, sans-serif"
  }
}
```

If it is absent, ask the two questions, then **write it** so the next session
inherits the answers instead of asking again. Everything in it is a default a
spec may override.

**A figure is a folder, not a file.** One folder per figure, named for the
figure, everything about it inside:

```
Fig 3 AB/
  Fig 3 AB.spec.json      canonical spec — the figure's source of truth
  Fig 3 AB.pdf            latest accepted render (vector; this goes in Word)
  Fig 3 AB.png            latest accepted render (raster; show this in chat)
  source/                 the data + images the spec reads
  archive/                superseded accepted versions
  NOTES.md                what it shows, decisions made, draft caption
```

Rules that go with it:

- **Renders are named after the folder**, never `figure.pdf`. These get dragged
  into Word, and five files called `figure.pdf` in Downloads is a mess.
- **Spec paths are relative to the figure folder** — `source/run.sharpx`, not
  an absolute path. The folder must survive being moved or copied. The emitted
  bundle never records a full machine path.
- **Source data: copy it in when it is ours; point at it when it is not.**
  Third-party or shared data does not get duplicated into a proposal folder.
  Give it an opaque id and write a **path-free** public manifest at
  `source/source.json`:
  ```jsonc
  { "version": 1, "files": [
    { "id": "external-run-1", "role": "amp panel A", "sha256": "…",
      "recorded": "2026-08-05",
      "why_not_copied": "third-party confidential data" }
  ] }
  ```
  The spec uses `"sourceRef": "external-run-1"` (or `pathRef` for an image).
  The real location lives **outside the figure folder and outside Git** in a
  private machine map selected by `SHARPPLOT_SOURCE_MAP`:
  ```jsonc
  { "version": 1, "sources": { "external-run-1": "<real local path>" } }
  ```
  `node <cli> hash-source "<real local path>"` prints the path-free field and
  digest to copy into the public manifest (`sha256` for a file,
  `sha256_tree` for a folder). The CLI verifies it on every build and stops if
  the data changed. Say *that* it is third-party confidential data, not whose.
  **Never put a path in `source/source.json`; it is public.**
- **Archive accepted versions only, not every render.** Iterate in a scratch
  directory; archive when the user says a version is good and then asks for a
  change. Flat inside `archive/`, timestamp first, triplet sharing a basename:
  `archive/2026-07-27 0110 full width gel.{pdf,png,spec.json}`. The figure name
  is not repeated — the folder already says it. Use the archive command; it
  copies the accepted files and rewrites relative source/image paths for the
  spec's new directory, so the old version remains rerunnable:
  ```bash
  node <cli> archive "Fig 3 AB" --label "full width gel"
  ```
- **NOTES.md** records what the figure shows, the decisions behind it (why this
  scale, why these wells excluded) and a draft caption. Start it from the spec
  — plot types, n, fit statistics — rather than from a blank page.

## Step 4 — always inspect before writing a spec

```bash
node <cli> inspect "<file>" --pretty
```

Reports the real well names, samples, groups, colours, channels, melt content
and supported plot types — plus a populated starting spec. **Never invent a
well or group name.** Unknown names are hard errors by design: a figure quietly
missing a well still looks correct.

## Step 5 — the core idea: the file is already the spec

A `.sharpx` carries a saved Processor session — groups, per-well colours,
hidden wells, legend order, threshold, baseline settings, fonts. So this alone
reproduces what the app last showed:

```json
{ "panels": [ { "kind": "plot", "source": "run.sharpx", "plotType": "amp" } ] }
```

Resolution runs *app default → what the file saved → composite style → panel*.
**Apply only the deltas they ask for.** "Half column, no grid" changes two
fields. Keep the spec small so the next edit stays small.

**Kinetics are an explicit figure delta.** If the user asks for fitted curves,
`t_lod` / `t_onset10` / inflection markers, residuals, Tm marks, kinetics
readouts, fit parameters, or all/part of the Kinetics Report, read
`references/kinetics-report.md` before writing the spec. SharpPlot deliberately
does not inherit the `.sharpx` landmark-toggle state: the requested report
content belongs in the figure recipe, so the same recipe stays deterministic.

## Step 6 — render and show

Iterate in a scratch directory — renders are cheap and most of them are wrong:

```bash
node <cli> plot "Fig 3 AB/Fig 3 AB.spec.json" --out /tmp/try
```

Writes `try.pdf` and `try.png` (show them the PNG). When a version is accepted,
promote it into the figure folder under the folder's own name — `Fig 3 AB.pdf`,
`Fig 3 AB.png`, `Fig 3 AB.spec.json`. Before replacing a previously accepted
version, run `archive` as shown above; do not move the spec by hand.

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
  "panels": [ /* plot | image | table | kinetics_table */ ]
}
```

6.5 in = full Letter text width, 3.25 in = half column.

**Read `references/spec-reference.md` for the complete field list** — panel
types, selection, axes, annotations, reference lines, dilution config, image
crop and table panels. Load it before writing anything beyond a basic panel.

**Read `references/kinetics-report.md` for any kinetics request** — fitted
curves, landmark markers, residuals, Tm markers, selectable report tables,
fit-parameter tables, and the full-report composite recipe.

**Read `references/multi-source-and-alignment.md` before combining wells
from two files, adding a second legend, forcing literal tick labels, or
positioning an image inside a differently-sized panel box** — `mergeSources`,
`legend2`, `tickVals`/`tickText`, and `image.align`, plus the inset-panel
technique and the half-page conversion rule. All of it is on `main`; an older
staged copy of the CLI may predate it, so if a field is silently ignored,
re-stage before assuming it does not exist.

## Step 7 — matching a reference, and the house layout language

Composites here are specified by describing the **framed plotting rectangles**,
not the outer panel boxes. "3 panel, 3:1 vertical, top 1 fig, bottom 2 at
1:2 horizontal, ratios are the plotting areas" means: the inner axes frames
land at that ratio; labels, ticks, titles and legend are added on top
without disturbing it. `layout.widths`/`heights` in the spec size the
*outer* cell (frame + labels + ticks + legend + title). Solve backward —
pick margins for each panel's chrome, then set the outer cell sizes so what
is left over is the frame ratio they asked for. **Read
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

**Hand-drawn sketches are valid layout specs.** A sketch may arrive instead of
a verbal description of the panel arrangement — translate it the same way:
panel count and position, relative sizes, which one spans.

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

## Two inputs that must never be guessed

Many things can make a figure wrong, and most of them are visible on the
render. These two are not — get either wrong and the figure still looks
perfect — so both have a confirmation step:

1. **Dilution concentrations.** Never infer them from a group name — `10^7` is
   suggestive, not authoritative. Ask for the top concentration and the fold
   factor. The tool prints the resolved step table; **show it and get explicit
   confirmation before treating the figure as final.**
2. **Verbal grouping.** `group … --assign "10^7=A1-A3; NTC=B4,B5,B6"` prints
   the resulting well-to-group table and writes nothing without `--write`.
   Show that table before rendering.

## Working with the user

- Show the PNG. Never show the spec.
- Keep edits small — change what they asked about, inherit the rest.
- Relay the tool's warnings. "Legend has 9 entries but only 4 fit" means series
  are missing from the figure.
- When something cannot be drawn, the tool says why and what to set. Pass that
  on in plain language rather than guessing a workaround.
- Never fabricate a number. Every value comes from the data.
- **Arial is substituted off macOS** — Linux resolves it to metric-compatible
  Liberation Sans, so a preview is faithful in every dimension but not
  pixel-identical in letterforms. Say so when it matters; a final publication
  render belongs on a Mac, where real Arial is installed.

## Where this comes from

Source is in the SHARP Processor 2 repo under `src/cli/`, on `main`; full
documentation in `docs/SHARPPLOT.md` there. The CLI is a second consumer of
the Processor's own modules, so `npm run test:parity` proves a change to the
CLI did not change what the desktop app draws.
