# sharpplot — user manual

**Last Updated:** 2026-08-05 15:52 EDT

Making publication figures from SHARP Processor data by talking to Claude.

This is the manual for **using** it. For how it is built and installed, see
[`SHARPPLOT.md`](SHARPPLOT.md); for the team install, see
[`../skills/team-install/`](../skills/team-install/).

---

## 1. The one idea worth understanding

**Your `.sharpx` is already most of the figure.**

When you set up a run in SHARP Processor 2 — group your wells, pick colours,
hide the ones that failed, set the baseline and threshold, choose a time axis —
all of that is saved *inside* the `.sharpx` file. It is not just data.

sharpplot reads that saved setup and starts from it. So a request as small as
"make me an amplification plot from this" already comes out grouped, coloured,
baseline-corrected and legended the way you left it in the app. You only have
to say what should be **different** for print.

That is why the workflow is short. You are not describing a figure from
nothing; you are describing the delta from what you already saw on screen.

---

## 2. The workflow

1. **Do your analysis in Processor 2 as usual.** Group wells, name samples, set
   colours, hide bad wells, set the baseline and threshold. Save as `.sharpx`.
2. **Open a chat on claude.ai** and drag the `.sharpx` in.
3. **Say what you want**, in normal words:
   > make an amplification plot from this, 3.4 inches wide
4. **Look at the picture** it shows you. Say what to change:
   > drop the gridlines, move the legend bottom right, and cap the x axis at 25 minutes
5. **Repeat** until it is right, then download the PDF.

You never see or edit a settings file. That file exists, but it is plumbing
between Claude and the tool.

Raw instrument files work too — `.pcrd`, `.tlpd`, `.eds`, `.amxd`, or a zipped
Bio-Rad CFX export folder. They just have no saved setup, so grouping and
colours start from defaults and you describe them in words instead.

---

## 3. Figures made this way remain reworkable

**A figure created in the standard SharpPlot folder format today can be
reopened and reworked months or years later — including in a new Claude chat,
on another computer, or for a different publication.** It is not a flattened,
one-way export.

Each completed figure is kept as a folder:

```text
Figure name/
  Figure name.spec.json   editable recipe and source of truth
  Figure name.pdf         accepted vector output
  Figure name.png         accepted preview
  source/                 source data and images, or safe source references
  archive/                superseded accepted versions
  NOTES.md                decisions, interpretation, and draft caption
```

To rework an old figure, give Claude the whole folder — zip it first when
uploading through claude.ai, or point Claude Code directly to the folder — and
describe the new purpose:

> Continue from this figure and make a half-column version for a paper.

> Reuse this as the top panel of a three-panel proposal figure.

> Keep the analysis and styling, but adapt the labels and dimensions for a poster.

Before changing anything, SharpPlot rerenders the unchanged recipe and requires
it to match the accepted PNG exactly. That catches changed source data, fonts,
browser behavior, or an accidental edit before any new work is mixed in. Once
the baseline passes, the old figure can be resized, relabelled, recoloured,
rearranged, combined with new panels, or adapted to a new output format without
starting from scratch. When a revision is accepted, the previous accepted
version remains in `archive/`.

Keep the full folder. The PDF and PNG alone are final outputs, not the editable
figure. The `.spec.json` and `source/` folder preserve the analysis and
design decisions that make later reworking possible.

A `fig.json` is different: it is a portable render bundle containing the
finished drawing instructions, embedded image panels, and SharpPlot build
information without full paths from the source computer. It is excellent for
reproducing an exact figure on another machine. For broad changes, the complete
figure folder is better because it also contains the editable recipe and source
material.

If confidential source data was intentionally not copied into the folder, the
folder contains an anonymous reference and checksum rather than its location.
A different computer can still rework the figure once its private source map is
connected; the shared folder itself never needs to expose the private path.

---

## 4. What is actually inside a `.sharpx`

A `.sharpx` is a zip. Unzip one and you get:

| File | What it holds |
|---|---|
| `amplification.csv` | the amplification traces — time/cycle and RFU per well, per channel |
| `melt_rfu.csv` | raw melt curves |
| `melt_derivative.csv` | the −dF/dT derivative |
| `wells.csv` | per-well sample name, content type (Unkn / NTC / Std), and the parse-time Cq and end-RFU |
| `metadata.json` | experiment ID, instrument, protocol, operator, run start, plate size, **format version** |
| `session.json` | **everything you did in the GUI** — see the next section |
| `SUMMARY.txt` | a human-readable summary |

---

## 5. What carries over into the figure

This is the part worth knowing, because it tells you what to fix in the app
versus what to ask Claude for.

### Carries over — you set it once, in Processor 2

| What you did in the app | Effect on the figure |
|---|---|
| **Grouped wells** | becomes the legend entries; replicates collapse to one entry |
| **Legend order** | the order groups appear in the legend |
| **Per-well / per-curve colours** | used exactly; otherwise the palette you chose |
| **Palette choice**, reversed, group-colouring | the colours of every trace |
| **Hid a well** | that curve is not drawn *(verified: a 7-well file with 2 hidden renders 5 traces)* |
| **Deactivated a well** (empty well) | excluded from the figure and from pooled statistics |
| **Sample names** | the default legend labels |
| **Baseline settings** — on/off, auto, method, start/end, per-well overrides | **changes the numbers.** The y-axis title even reads "RFU (corrected)" |
| **Drift correction** | changes the numbers |
| **Normalisation** (amp and melt) | changes the numbers |
| **Threshold** on/off and RFU value | whether Tt exists — which decides whether a standard curve is even possible |
| **Smoothing** on/off and window | changes the drawn curve |
| **X-axis unit** — cycle, seconds, minutes | the x axis. A file saved in minutes gives "Time (min)" |
| **Log scale** | axis scaling |
| **Font family** | the figure's font |
| **Text sizes** — title, label, tick, legend | starting sizes for each |
| **Line width, grid on/off, grid alpha, background, text colour** | drawn as saved |
| **Legend on/off, position, and whether it shows sample or group** | the legend |

### Does *not* carry over

| Thing | Why, and what to do |
|---|---|
| **Figure DPI** | the app's screen DPI (often 100) is ignored; sharpplot defaults to **600** for print. Ask for a different one if you need it |
| **Figure width and height** | there is no meaningful physical size in the app. **You must say how wide**, in inches |
| **Panel titles** | off by default for publication — you write the caption |
| **Panel letters (A/B/C)** | added by the figure spec, not the app |
| **Which channel is "active"** | inherited, but in a multi-panel figure you usually name channels explicitly |

### The precedence rule

When two things disagree, later wins:

```
Processor's own defaults  →  what your .sharpx saved  →  figure-wide style  →  this one panel
```

So "half column, no grid" changes two settings and inherits everything else.
Small requests stay small.

---

## 6. What it can make

### Plot types

| Type | What it draws | Needs |
|---|---|---|
| `amp` | amplification curves | amplification data |
| `melt` | raw melt curves | melt data |
| `melt_deriv` | melt derivative, −dF/dT | melt data |
| `dilution` | **standard curve** — Tt against concentration, with a fit, error bars (SD / SEM / 95% CI) and a doubling time | a threshold set, so wells have a Tt |
| `doubling` | doubling time per well | threshold + fitting on |

If a plot type is impossible for your file, `inspect` says so **and why** — for
example "thresholdEnabled is off, so no well has a Tt".

### Panel types

- **`plot`** — any of the above.
- **`image`** — a gel photo, a diagram, a product shot. Croppable by fraction,
  and it keeps the source aspect ratio rather than stretching it.
- **`table`** — a small metrics table drawn in the same font as the figure.

### Layout

Multi-panel composites on a grid, with panels allowed to span cells — an
amplification plot over a gel image, say, or one wide amplification panel above
a standard curve and a melt derivative side by side.

You can describe layout in plain words — *"3 panel, top one full width, bottom
two side by side, ratios are the plotting areas"* — or **send a hand-drawn
sketch**, which is a perfectly good layout spec.

Exact physical sizing is the point: you say 3.4 inches, you get 3.4 inches, as
vector PDF that drops into Word or Illustrator without resampling. PNG comes
out of the same PDF, so the two can never disagree.

### The things that took real work, and that you can just ask for

- **Two source files in one panel** — combine wells from separate runs,
  recoloured as one series.
- **Literal tick labels** — `10^0 / 10^2 / 10^4`, or `1K / 2K / 3K`.
- **A second legend column**, for pulling specific entries out of the main one.
- **Reference lines** with their own legend entry (a threshold line, say).
- **Annotations** that substitute computed statistics.
- **Cross-panel alignment** — matching frame edges and axis titles between
  panels, verified from geometry rather than by eye.

---

## 7. Two inputs it always asks about

Plenty of things can make a figure wrong, and most of them are visible — you
look at it and see it. These two are not: get them wrong and the figure still
looks perfect. So they are gated:

1. **Dilution concentrations.** It will **never** read `10^7` off a group name
   and treat it as a real concentration. It asks for the top concentration and
   the fold factor, then prints the resolved table — concentration, n, wells,
   mean Tt — and waits for you to confirm before the figure counts as final.
   **Read that table.** It is the only place a silent mislabel would show up.
2. **Verbal grouping.** If you describe a plate map in words, it prints the
   resulting well-to-group table and writes nothing to your file unless
   explicitly told to.

Related: naming a well or group that does not exist is a **hard error**, not a
silent omission — because a figure quietly missing a well still looks correct.

---

## 8. Limits worth knowing

- **Fonts off macOS.** On claude.ai the engine runs on Linux, where Arial
  resolves to Liberation Sans. Metrically identical — every dimension, margin
  and alignment is right — but the letter shapes are not pixel-identical. Fine
  for working and reviewing. Send the final version to be re-rendered on a Mac.
- **Legend size is arithmetic, not a preference.** Plotly costs about
  (font size + 12) pixels per legend row. Ten dilution steps need a genuinely
  bigger legend than five. Shrinking text below ~7 pt to force a fit is not
  offered, because it stops being readable. The trade is panel height, legend
  shape, or legend position.
- **PNG needs `pdftoppm`.** PDF only needs a browser. If PNG is unavailable,
  ask for PDF — it is the better format for Word and Illustrator anyway.
- **It reports what it cannot do.** If a legend will clip, or a plot type is
  unavailable, it says so and says what to change. Those messages get passed on
  to you rather than worked around silently.

---

## 9. Version check

Every copy of sharpplot is a snapshot — staged, zipped into a `.skill`,
uploaded. It can fall behind the repo. Two mechanisms:

**Ask what build you are on.** Claude reports the build date when it first says
what it can do, or run:

```bash
sharpplot --version
```

```
  Processor version   0.2.4
  built from commit   8cb799040
  built at            2026-08-05T03:31:29Z  (0 days ago)
  .sharpx format      understands up to 1.3
```

**The gate that matters is automatic.** A `.sharpx` records the format version
it was written as. If you open a file written by a **newer** Processor than
your copy of sharpplot understands, it **stops with an error** instead of
reading it with the old rules and quietly ignoring whatever is new. The error
tells you how to get a current build.

Every `.sharpx` saved by the current Processor is format **1.3** — it now saves
the kinetic-landmark toggles (`t_lod` / `t_onset10` / inflection) with the view.
An older sharpplot build will stop on those files; re-pack the skill to clear
it. `--allow-newer-format` is genuinely safe for this particular bump, because a
figure spec declares its own landmarks and never reads the saved toggles.

That is the one real coupling between the app and this tool — and it is
checked, not assumed. You do **not** need Processor 2 installed to use
sharpplot on claude.ai; the engine is inside the skill.

---

## 10. Does this work outside Claude?

`sharpplot.skill` is packaged in the open **Agent Skills** format — a zip with
one top-level folder holding `SKILL.md` plus its files. ChatGPT supports that
format too, and at 1.9 MB the file is well inside its 50 MB upload limit, so it
should upload there (rename it to `.zip` if the picker insists).

**Uploading is not the same as working, and only Claude is tested.** The
engine is `bin/sharpplot.mjs`, which needs **Node 20+**, and rendering needs a
**Chromium** in the sandbox. ChatGPT's Code Interpreter has historically been
Python-only; Node shows up in its Codex cloud environments and shell tool, but
whether the skills sandbox provides Node and a browser is unconfirmed. If Node
is absent, nothing runs.

If you try it, the useful check is the same one used for any host — ask it to
run `node --version` and look for a chromium binary. Section 9's `--version`
output tells you the rest.

The CLI itself is a plain Node program, so anything with a shell and Node 20+
can drive it: Claude Code, an editor agent, a CI job. The `.skill` wrapper is
only the packaging.
