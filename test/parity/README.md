# Parity check — `plot-figure.ts` must not change what it already draws

**Last Updated:** 2026-08-05 00:23 EDT

`sharpplot` adds capability to the Processor's shared figure modules. The rule
governing that work is that **existing plot types must render exactly as they
did before**: `amp`, `melt`, `melt_deriv` and `doubling` are what the shipped
app's Export Wizard produces, and a change to any of them is a regression
regardless of whether it looks better.

This directory holds the mechanical form of that check.

## What it compares

`plot-figure.ts`'s `buildFigure()` is the single source of every exported
figure — the Export Wizard calls it, and so does the CLI. So the check hashes
`buildFigure`'s actual output (traces + layout) for all four plot types over a
fixed input, rather than comparing rendered images, which would also fold in
font rasterization and antialiasing noise.

The CLI's `figure` verb is used as the harness because it drives the real code
path. With no decorations in the spec, a panel's `figure` object is exactly
what `buildFigure` returned plus the explicit pixel `width`/`height`.

## Running it

```bash
node scripts/parity-check.mjs --source "/path/to/file.sharpx"
```

First run with no baseline present records one. Later runs compare against it
and exit non-zero on any difference, printing the first differing JSON path.

Record the baseline **before** touching `plot-figure.ts`, and re-run it after
every change to that file or to anything it depends on (`analysis.ts`,
`curvefit/`, `constants.ts`, `curve-colors.ts`).

`baseline.json` is committed so the comparison survives a fresh checkout. It
holds hashes and small shape summaries, not the full figures.
