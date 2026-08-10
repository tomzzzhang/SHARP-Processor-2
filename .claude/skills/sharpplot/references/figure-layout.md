# Composite layout — margins, alignment, legends

**Last Updated:** 2026-08-10 14:15 EDT

Read this before building or revising a multi-panel composite, and before
matching a reference figure by eye. It is the recipe behind Tom's layout
language: "ratios are the plotting areas," "make sure things align at the
edges," "the legend looks different," "text doesn't align."

## 1. Ratios mean the frame, not the panel box

`layout.widths` / `layout.heights` size the **outer grid cell** — frame plus
axis titles, tick labels, panel title, and legend. Tom's ratio language
("3:1 vertical", "1:2 horizontal") describes the **inner framed rectangle**
the data actually draws in. These are not the same number, and the gap
between them is exactly the chrome around each panel — which differs per
panel (a y-axis with 4-digit tick labels needs more left margin than one
with 2-digit labels; a panel carrying a legend needs more top or side room
than one without).

**The procedure, every time:**

1. Decide each panel's chrome: does it have a title, a legend, how many axis
   digits, any panel label. Pick explicit `panel.margin` in px for each
   (`{l, r, t, b}`, 96 px/in).

   Margins are now **derived from panel content by default** — axis titles,
   tick-label visibility, and the real width of the widest y tick label — so
   an unstated margin is already far tighter than `plot-figure.ts`'s formula
   (which returns roughly `l:70 r:20 t:20 b:53`). That is a good starting
   point, and enough on its own for a single-panel figure.

   **It does not replace step 2 for a composite.** Cross-panel edge alignment
   requires panels to share a margin *number*, and content-derived margins
   differ per panel by design — a 4-digit y axis gets a wider left margin than
   a 2-digit one. When edges must line up, state the margins explicitly and
   equally; see §2. Read the derived values first (§3) and use them to choose
   what to pin.
2. Set `layout.widths` / `layout.heights` so that, once each panel's margin
   is subtracted, the **remaining inner rectangle** matches Tom's requested
   ratio. Work this out numerically (see §3), not by trial rendering alone.
3. Render, then verify from the emitted geometry (§3) — not the picture.
4. Only then look at the PNG, for things geometry can't tell you: does a
   legend cover data, does text collide, does it read as "empty" or
   "cramped."

## 2. Row edges must align

When one panel spans columns that a row below does not (e.g. a full-width
top panel over two bottom panels), **its left/right margins must equal the
corresponding bottom panels' margins**, so all three frames — and everything
drawn around them — share the same outer left and right edges. This is pure
arithmetic once panel widths are fixed:

```
top.margin.l  == bottomLeft.margin.l
top.margin.r  == bottomRight.margin.r
```

If a later edit changes one side's margin (tuning a legend, say) and not the
mirrored one, edges silently drift. Re-verify after every margin change, not
just once at the start.

## 3. Verify from geometry, not the picture

Build the figure JSON (no render needed) and read placement + margin
directly:

```bash
node <cli> figure spec.json --out fig.json
node -e "
const b = require('./fig.json'); const PPI = 96;
for (const p of b.panels) {
  const m = p.figure.layout.margin, pl = p.placement;
  const left  = pl.x_in*PPI + m.l;
  const right = (pl.x_in + pl.w_in)*PPI - m.r;
  console.log(p.label, 'left', left.toFixed(1), 'right', right.toFixed(1),
              'plotW', (right-left).toFixed(1), 'plotH',
              ((pl.y_in+pl.h_in)*PPI - m.b - (pl.y_in*PPI + m.t)).toFixed(1));
}
"
```

Compare the printed `left`/`right` across panels that should align (must
match to <1px) and the `plotW`/`plotH` ratios against what Tom asked for.
This is the same check used to catch a drifted edge before delivering
anything — do it after every layout-affecting change, silently, before
showing Tom a picture.

## 4. Legend sizing — the real constraint and the real options

Plotly's legend costs roughly **`fontSize + 12` px per vertical row** —
several times denser figure tools like matplotlib. A legend with N series
needs at minimum `N * (fontSize + 12) + ~20` (title) px of vertical room at
a given font size. This is arithmetic, not a limitation to route around by
shrinking text below ~7–8px — that makes the figure worse, not more compact.
If Tom's data has more categories than a reference figure he's matching
against (more dilution steps, more groups), the legend genuinely needs more
room than the reference's did. Say so plainly rather than silently
force-fitting with tiny text.

**Decision order, cheapest first:**

1. **Vertical, boxed, in an empty corner of the plot.** The best match to a
   typical published look. Check whether a corner is actually visually
   empty for this data (e.g. amplification curves are flat near y=0 at low
   x, so top-left is free until curves rise) — if so, place the legend
   there (`legend.position` a corner, `legend.frame: true`,
   `legend.bgcolor: "#ffffff"`) and size **that panel's plot height** to fit
   the entry count at a readable font (see the formula above). This costs
   panel height, not width.
2. **Horizontal, wrapped, above the axes.** `legend.orientation: "h"` with
   `legend.position: "above"` reserves top margin so the legend sits over
   nothing (never over data) and wraps into as many rows as needed. Spends
   width instead of height — the right call when the panel can't grow
   taller (e.g. it's already the short row in a 3:1 layout). **Also pins the
   panel title above the legend** — without that, Plotly centers the title
   in the enlarged top margin and draws it straight through the legend text.
3. **`legend.entryWidthPx` does not make a horizontal legend more compact.**
   Tested directly: Plotly sizes a horizontal legend's bounding box to the
   full width of its container regardless of per-entry width — the setting
   only changes how many columns appear per row, not the box's footprint.
   Don't reach for it expecting a narrower legend.
4. **The clip-warning heuristic assumes vertical stacking.** It does not
   fire for `orientation: "h"` legends (their row count isn't driven by
   entry count the same way) — don't read "no warning" as "definitely
   fits" for a horizontal legend; look at the render.

## 5. Y-axis titles don't align across panels by default — and why

Plotly positions a y-axis title relative to **that axis's own tick-label
width**, not a fixed distance from the plot's outer edge. Two panels with
identical `panel.margin.l` but different tick-label digit counts (one axis
ticks `0…7000`, the other `0…20`) will show visibly offset titles — the one
with wider labels sits further left, at equal margins.

Fix with `yaxis.titleStandoff` (px), tuned per panel so `tickLabelWidth +
titleStandoff` is equal across the panels that should align. There's no
formula that avoids one render-and-measure pass — tick label width depends
on the actual rendered digits. Measure with:

```python
from PIL import Image
im = Image.open('fig.png').convert('L'); px = im.load()
def leftmost_ink(x0, x1, y0, y1, thresh=140):
    for x in range(x0, x1):
        for y in range(y0, y1):
            if px[x, y] < thresh: return x
    return None
# y0/y1: a vertical pixel band spanning each title's rotated text
a = leftmost_ink(0, 90, Y0_PANEL_A, Y1_PANEL_A)
b = leftmost_ink(0, 90, Y0_PANEL_B, Y1_PANEL_B)
print(a, b, b - a)   # positive => B's title sits right of A's; give B more standoff
```

Adjust the lagging panel's `titleStandoff` by the measured delta (divide by
`dpi/96` if the PNG was rasterized above 96 dpi), re-render, re-measure.
Converges in one or two passes.

## 6. Frame and grid styling

For a boxed, publication-style axes look:

```jsonc
"xaxis": { "frame": true, "lineWidth": 1.1, "lineColor": "#000000",
           "gridDash": "dot", "gridColor": "rgba(0,0,0,0.15)",
           "zeroline": false, "tickDirection": "" }
```

- `frame: true` draws the closed box; `lineWidth` controls its weight —
  Plotly's default reads thin for print, but don't over-correct (1.4px read
  "too thick" against a reference; 1.1px matched).
- `tickDirection: ""` removes tick marks entirely — redundant once
  gridlines are on, and Tom prefers them off in that case.
- `gridDash: "dot"` + a low-alpha `gridColor` gives the subtle dotted grid
  common in matplotlib-derived figures, versus Plotly's solid default.
- `zeroline: false` removes Plotly's separate heavy line at y=0, which
  otherwise reads as a stray extra gridline.

Apply consistently across every panel in a composite unless Tom asks for one
panel to differ.
