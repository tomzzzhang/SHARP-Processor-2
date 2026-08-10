# Kinetics report figures

**Last Updated:** 2026-08-10 14:15 EDT

Read this whenever the user asks for fitted amplification curves, kinetic
landmarks, residuals, melt-temperature marks, kinetics readouts, fit
parameters, or all/part of the Processor Kinetics Report.

## One report, independently placeable sections

SharpPlot computes the same source-backed report as Processor 2 once per
`(source, channel)` and reuses it across every panel in the composite. Build a
full report from these independent sections, or use any subset:

| Requested section | Figure spec |
|---|---|
| amplification data + fitted curves + landmarks | `plotType: "amp"` plus `kinetics` |
| observed − fit residuals and the ±1 run-σ band | `plotType: "kinetics_residuals"` |
| melt derivative with fitted Tm marks | `plotType: "melt_deriv"` plus `kinetics.showMeltTm` |
| kinetics readout table | `kind: "kinetics_table", section: "readouts"` |
| FreeShoulder parameter table | `kind: "kinetics_table", section: "fit_parameters"` |
| every supported report field | `kind: "kinetics_table", section: "all"` |

This is native figure content, not a screenshot of the app report. Each plot
is vector in PDF, each table uses the figure font, and every section can be
resized, relabelled, or combined with unrelated panels.

## Fitted curves and kinetic markers

```jsonc
{
  "kind": "plot",
  "label": "A",
  "source": "source/run.sharpx",
  "plotType": "amp",
  "xAxisMode": "time_min",
  "thresholdEnabled": false,
  "kinetics": {
    "signal": "corrected",             // corrected (default) | raw
    "showData": true,                  // default true
    "showFit": true,                   // default false
    "markers": ["t_lod", "t_onset10", "inflection"]
  }
}
```

`corrected` subtracts the report's fit-first baseline from both the measured
curve and fitted model. `raw` draws both in measured RFU. The data remain bold;
the fit is a thinner, fainter overlay. `t_lod` is placed on the measured curve;
`t_onset10` and inflection are placed on the fitted curve.

The `kinetics` block is deliberately opt-in. SharpPlot does **not** read the
landmark toggle state saved in `.sharpx` 1.3: the same figure spec must render
the same content regardless of a transient app-view toggle. An omitted
`kinetics` block preserves the ordinary plot path byte-for-byte.

Only a usable, uncensored FreeShoulder fit is drawn. If every selected curve is
censored or failed, a requested fit/residual section stops with a specific
error instead of drawing an extrapolated model. `t_lod` is detection-based and
may still exist when a fit is censored.

## Residual and melt sections

```jsonc
{ "kind": "plot", "label": "B", "source": "source/run.sharpx",
  "plotType": "kinetics_residuals", "xAxisMode": "time_min",
  "select": { "groups": ["Sample", "Control"] } }

{ "kind": "plot", "label": "C", "source": "source/run.sharpx",
  "plotType": "melt_deriv",
  "kinetics": { "showMeltTm": true } }
```

Residuals are raw observed RFU minus the raw fitted curve, so baseline display
mode cancels out. The shaded band is ±1 pooled run σ, the same noise floor used
for `t_lod`. Tm markers are omitted for curves with no fitted melt peak.

## Readout and fit-parameter tables

```jsonc
{
  "kind": "kinetics_table",
  "label": "D",
  "source": "source/run.sharpx",
  "section": "readouts",
  "columns": ["well", "sample", "t_lod", "t_onset10", "td_20", "yield_raw", "melt_tm", "call"],
  "timeUnit": "min",
  "uncertainty": "plusminus",
  "amplifyingOnly": false,
  "sort": { "by": "t_lod", "direction": "asc" },
  "fontSize": 7
}

{
  "kind": "kinetics_table",
  "label": "E",
  "source": "source/run.sharpx",
  "section": "fit_parameters",
  "columns": ["well", "sample", "fit_A", "fit_B", "fit_C", "fit_D", "fit_foot", "fit_shoulder", "fit_r2", "fit_rmse"],
  "uncertainty": "separate"
}
```

`columns` is optional and controls both subset and order. `uncertainty` is
`plusminus` (compact value ± SE), `separate` (a value and SE column), or `none`.
`timeUnit` is `s` or `min`; rate parameters and slopes are converted with the
time unit, not merely relabelled.

Supported column groups:

- identity: `well`, `sample`, `channel`, `curve_key`
- baseline/noise: `baseline_offset`, `baseline_from_fit`,
  `baseline_observed`, `plateau_observed`, `well_sigma`, `run_sigma`, `quality`
- detection/model-free: `t_lod`, `fired`, `t_mid`, `slope_mid`
- kinetics/yield: `t_onset10`, `td_5`, `td_20`, `td_50`, `td_slowdown`,
  `yield_raw`, `plateau_start_s`
- fit: `fit_A`, `fit_B`, `fit_C`, `fit_D`, `fit_foot`, `fit_shoulder`,
  `fit_inflection_t`, `fit_max_slope`, `fit_rmse`, `fit_r2`,
  `fit_converged`, `shape_at_bound`
- call/melt: `call`, `melt_has_peak`, `melt_peak_count`, `melt_tm`,
  `melt_peak_height`

## Full report composite

Use the five section types together. This example makes amplification and
residual plots on top, melt plus two tables below; change the grid as needed.

```jsonc
{
  "id": "kinetics_report",
  "output": { "width_in": 7, "height_in": 8.5, "dpi": 600, "formats": ["pdf", "png"] },
  "layout": {
    "rows": 3, "cols": 2, "heights": [1.2, 0.8, 1], "gap_in": 0.16,
    "areas": ["A A", "B C", "D E"]
  },
  "panels": [
    { "kind": "plot", "label": "A", "source": "source/run.sharpx", "plotType": "amp",
      "thresholdEnabled": false,
      "kinetics": { "showFit": true, "markers": ["t_lod", "t_onset10", "inflection"] } },
    { "kind": "plot", "label": "B", "source": "source/run.sharpx", "plotType": "kinetics_residuals" },
    { "kind": "plot", "label": "C", "source": "source/run.sharpx", "plotType": "melt_deriv",
      "kinetics": { "showMeltTm": true } },
    { "kind": "kinetics_table", "label": "D", "source": "source/run.sharpx",
      "section": "readouts", "uncertainty": "plusminus" },
    { "kind": "kinetics_table", "label": "E", "source": "source/run.sharpx",
      "section": "fit_parameters", "uncertainty": "plusminus" }
  ]
}
```

As with ordinary panels, `channel`, `select`, and `sourceRef` work. Explicitly
naming a hidden well includes its row/curve, while hidden wells remain excluded
from the pooled run-σ calculation so displaying one cannot change another
well's `t_lod`.
