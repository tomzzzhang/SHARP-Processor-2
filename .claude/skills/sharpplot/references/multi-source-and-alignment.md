# Multi-source panels, custom ticks, dual legends, image alignment

Five capabilities added to the CLI while building a set of NSF proposal
figures (2026-07). Four are new fields; the fifth (`smoothingEnabled`) already
existed but was never documented here. All are additive — no existing spec
renders differently because of them.

**Status: uncommitted.** These live in the working tree of `SHARP Processor 2`
(`src/cli/spec.ts`, `src/cli/figure.ts`, `src/cli/decorate.ts`,
`src/cli/harness.ts`, `src/lib/plot-figure.ts`). Before relying on them from a
folder that doesn't already have a staged CLI reflecting these changes, check
`git status` in the repo and re-run `npm run cli:install` after committing.
Each addition passed the full gate suite (`tsc -b`, `vite build`,
`test:codex`, `test:parity`, `eslint`) with zero regressions when it was
built — re-run them again before committing, since more may have landed
since.

## `panel.mergeSources` — combine wells from two different files

The normal case is one panel, one `source`. When the figure needs curves
that live in two separate experiment files — a titration run and a
low-titer follow-up run, say — `mergeSources` draws additional wells from
other files into the same panel, through the exact same well-resolution and
analysis pipeline the primary source uses (baseline, drift correction,
smoothing — nothing is reimplemented by hand for the second file).

```jsonc
{
  "kind": "plot",
  "source": "run1.sharpx",
  "plotType": "amp",
  "select": { "wells": ["A2", "B2"] },
  "groups": { "A2": "10^4", "B2": "10^3" },
  "mergeSources": [
    {
      "source": "run2.sharpx",           // relative paths resolve against the spec file
      "select": { "wells": ["A2", "A4"] },
      "groups": { "A2": "10^2", "A4": "NTC" }
    }
  ],
  "legend": { "order": ["10^4", "10^3", "10^2", "NTC"] }
}
```

Two things to know:

- **Every source must agree on `xAxisMode`.** The primary source's resolved
  x-axis mode is forced onto every merged source too, so traces land on one
  shared axis. This is silent and automatic — you don't set it per entry.
- **Colors are reassigned as one palette after merging**, not inherited from
  each file's own session. Each source's `buildFigure` call independently
  starts its palette at index 0, so without this a merged panel's second
  file would reuse the first file's colors instead of continuing the ramp.
  The reassignment walks `legend.order` (or the primary file's own saved
  order, then appends anything `order` didn't mention) and recolors every
  trace, every source, from one `getPaletteColors` call. **Give an explicit
  `legend.order` covering every group from every source** — otherwise
  groups the order list doesn't name get appended in encounter order, which
  works but isn't necessarily the order you'd have chosen.
- Well names collide across files often (`A1`, `A2`...). `groups`,
  `groupColors`, and `wellStyleOverrides` on the panel apply only to the
  *primary* source — a `mergeSources` entry needs its own `groups` (as
  above) rather than trying to reuse the panel's.

## `legend2` — a second legend, for pulling specific entries into their own column

Plotly's own legend has no "put these two entries in a second column"
option — `orientation: "h"` wraps row-major and always claims the panel's
full width (tried, rejected: reads as a full-width bar, not a compact
second column). A genuinely separate column needs a second Plotly legend
object, which is what this exposes.

```jsonc
"legend": {
  "order": ["10^7", "10^6", "10^5", "10^4", "10^3", "10^2", "10^1", "10^0"]
},
"legend2": {
  "position": "upper left",
  "groups": ["NTC", "Threshold"],   // group names, or a reference line's `legend` text
  "frame": true, "bgcolor": "#ffffff", "fontSize": 7,
  "x": 0.126                          // paper-fraction override — see below
}
```

Any name in `legend2.groups` is pulled out of the primary legend and drawn
in this one instead, correctly styled (a reference line's dashed swatch
stays dashed — it isn't approximated).

**Positioning a second legend next to the first is manual, and needs
render-and-measure.** `legend2.x`/`legend2.y` are paper-fraction overrides
on top of whatever `position` resolves to. There's no formula for "just
right of column 1" because that depends on column 1's actual rendered
width, which depends on its entry text and font size. Render once, read
the primary legend's right edge from the PNG (or measure with the Pillow
snippet in `figure-layout.md` §5), set `legend2.x` to land just past it,
re-render, done in one or two passes — same convergence pattern as
`titleStandoff`.

## `xaxis`/`yaxis.tickVals` + `tickText` — literal tick labels

Overrides whatever Plotly would auto-generate for that axis, including its
own log-exponent formatting. Both arrays must be the same length; `tickVals`
are in data units (for a log axis, the actual value, not its log).

```jsonc
"yaxis": {
  "tickVals": [0, 1000, 2000, 3000, 4000],
  "tickText": ["0", "1K", "2K", "3K", "4K"]
}
```

Two things this was built for, both real cases:

- **"K" formatting** a linear RFU axis (Plotly has no built-in SI-suffix
  tick formatter that reads clean at small sizes — d3 format strings via
  `tickFormat` give `"100k"`/`"1M"`-style output, not `"1K"`).
- **Matching a legend's caret notation** (`10^7`) on a log-scale axis. A
  log axis's native `exponentformat: "power"` gives proper superscript
  (`10⁷`) and reads *better* in isolation, but it's a different visual
  convention than caret text — if the rest of the figure uses `10^7` in a
  legend, the axis should say `10^7` too, not mix conventions. Superscript
  is only worth it if nothing else in the figure uses caret notation.

## `image.align` — position an uncropped image within a box larger than it needs

Image panels have no `margin` field (unlike plot panels) — they fill their
entire outer cell via `fit: "contain"`, which centers by default. That's
fine when the image panel's cell is sized to exactly match the image, but
breaks down the moment you want the image's cell to match a *different*
panel's cell for layout reasons (e.g., so a panel-label letter lines up)
while the image itself sits somewhere other than centered in that now-too-big
box.

```jsonc
{
  "kind": "image",
  "path": "gel.png",
  "fit": "contain",
  "align": { "x": "right", "y": "top" },   // default is centered on both axes
  "background": "#ffffff"
}
```

`align.x`/`align.y` map straight to CSS `object-position` (`left`/`center`/
`right`, `top`/`center`/`bottom`). Concretely: a plot panel above an image
panel, both full-width, gel image narrower than the column — give the gel
panel the *same* width as the plot panel (so their panel-label letters
share an x-position) and `align: { x: "right" }` to pin the image to one
side, rather than shrinking the image panel's own cell (which moves its
label out of alignment with the plot's).

**The gotcha that cost real time getting this right:** a panel-label letter
in `top-left`/etc. position on an image or table panel is *inset* into that
panel's own content box, not overlaid on top of it — the box the image
renders into is `cell_height - labelInset`, where `labelInset ≈
panelLabels.size * 1.5 + offset_in_px`. If you're hand-computing a target
render size (so an uncropped image lands at an exact width/height), account
for this subtraction *once* — don't also add a separate "safety buffer" on
top, since unlike a margin, that buffer isn't excluded from the image's own
box; it just makes the image render bigger than intended and throws off
any precise alignment math built on the target size. Compute the panel's
`height_in` as `target_image_height + labelInset`, full stop.

## `panel.smoothingEnabled` / `smoothingWindow` (pre-existing, undocumented until now)

Not new — `BuildFigureInput` has carried these since the CLI's first cut —
but nothing in this skill ever mentioned them. Engages the same
Savitzky-Golay smoothing (`savitzkyGolaySmooth`) the app's own Processor
UI uses, at the app's own default window (11) unless overridden:

```jsonc
{ "smoothingEnabled": true, "smoothingWindow": 11 }
```

Set on the panel, it applies uniformly to the primary source *and* every
`mergeSources` entry, since they all share the same panel object.

## Technique: one panel visually inside another's blank corner (no code needed)

Plotly gives each panel one independent figure, absolutely positioned by
the grid. There's no native "draw this panel as an inset inside that one,"
but the grid's own bounding-box math gets you there anyway, with zero CLI
changes:

`layout.areas` computes each label's placement as the **bounding box of
every cell that label appears in** — not the literal shape of those cells.
So a label that surrounds a "hole" still gets the full rectangle spanning
that hole, because Plotly has no notion of holes; it just renders its
complete computed box. A *different* label placed only in that hole cell
gets a small box sitting entirely within the first one's rendered area.
Since panels are separate absolutely-positioned elements, the later one in
`panels[]` paints on top — giving a real, pixel-precise inset, using two
completely independent Plotly figures.

```jsonc
"layout": {
  "rows": 3, "cols": 3,
  "areas": [
    "A A A",
    "A inset A",
    "A A A"
  ],
  "widths": [mainW, insetW, gutterW],
  "heights": [mainH, insetH, gutterH]
}
```

**The containment rule, learned the hard way:** the inset's *outer cell*
must fit inside the host's *frame* — not just the host's outer cell edge.
An image or plot's own margin/title space extends past its frame, and a
panel-label letter on the inset needs room too. If the inset's outer box
reaches all the way to the host panel's own outer edge, the inset's axis
title (or panel-label inset) will physically overlap the host's own tick
labels or title, even though the two *frames* never touch. The fix is a
dedicated gutter cell (`gutterW`/`gutterH` above) sized to **at least the
host's own margin on that side** — not a token few pixels, the host's
actual `margin.r`/`margin.b` in inches. Verify both frame *and* outer-box
containment from the emitted geometry before trusting a render — see the
containment-check snippet in `figure-layout.md` §3, extended to compare
outer bounds, not just frame bounds.

## Technique: converting a figure to half-page width

Shrinking `output.width_in` (e.g. 7.0 → 3.4) does not, by itself, make text
read bigger relative to the figure — the opposite complaint that started
this: a full-width figure with a single sparse panel just reads as mostly
white space, and naively halving the canvas without touching fonts halves
their apparent size too, right when the ask is usually the reverse ("make
this smaller AND make the text readable").

**The fix is to *not* scale font sizes down with the canvas.** Keep
`labelSize`/`tickSize`/`legendSize`/`panelLabels.size` at roughly their
full-width values (nudge up rather than down) while `width_in` shrinks —
since point size is an absolute physical unit, the same tick label now
occupies a much larger fraction of the smaller panel automatically. What
*does* need re-deriving for the new width: every pixel margin that was
sized to fit those fonts (`panel.margin.l` for a 4-digit y-axis at the
larger relative font size needs more room, not less), and any annotation
that assumed the wider canvas — a one-line title that fit at 7in will very
likely need to become two or three shorter lines at 3.4in, no matter the
font size, because the text's total character count didn't shrink even
though the canvas did.
