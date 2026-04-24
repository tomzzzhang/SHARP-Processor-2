# .sharp File Format

**Last Updated:** 2026-04-24 PST
**Current version:** 1.1

A `.sharp` file is a ZIP archive (rename to `.zip` to open). It bundles one
experiment: raw data, reconstructed timestamps, plate setup, sample
annotations, and per-well analysis outputs.

## Contents

| File | Required | Description |
|------|----------|-------------|
| `metadata.json` | Yes | Authoritative machine-readable metadata. Format version, instrument, protocol, run info, per-well sample + analysis outputs, data summary, plate layout, time reconstruction. |
| `amplification.csv` | Yes | Wide format: `cycle, time_s, time_min, A1, B1, …` (RFU). |
| `melt_rfu.csv` | No | Wide format: `temperature_C, A1, B1, …`. |
| `melt_derivative.csv` | No | Wide format: `temperature_C, A1, B1, …` (`-dF/dT`). |
| `wells.csv` | 1.1+ | Flat well manifest — one row per populated well. Spreadsheet-friendly view of the per-well info that otherwise lives nested inside `metadata.json`. Columns: `well, sample, content, cq, end_rfu, melt_temp_c, melt_peak_height`. String cells (sample, content) follow standard CSV quoting — commas and embedded quotes are escaped with double-quoted fields. Empty numeric cells mean "not measured / not applicable". |
| `SUMMARY.txt` | 1.1+ | Plain-text human overview of the experiment. Lists which files are in the archive and their purpose. Not read back by the app — purely for someone browsing the ZIP by hand. Re-generated on every write from `metadata.json`. |
| `parsing_log.json` | No | Append-only parse history. |

## `metadata.json` shape

```jsonc
{
  "format_version": "1.1",
  "experiment_id": "…",
  "instrument": { "manufacturer": "…", "model": "…", "serial_number": "…", "software_version": "…" },
  "run_info":    { "operator": "…", "notes": "…", "run_started_utc": "…", "run_ended_utc": "…", "file_name": "…" },
  "protocol":    { "type": "sharp", "reaction_temp_c": 65, "amp_cycle_count": 81, "has_melt": true, "raw_definition": "…" },
  "wells": {
    "A1": { "sample": "…", "content": "Unkn", "cq": null, "end_rfu": null, "melt_temp_c": null, "melt_peak_height": null },
    …
  },
  "data_summary":        { "wells_used": ["A1", "A2", "B1", …], "cycle_count": 81 },
  "plate_layout":        { "rows": 8, "cols": 12 },
  "time_reconstruction": { "source": "pcrd", "cycle_times_s": […], "mean_cycle_duration_s": 23.05, … }
}
```

## Well name convention

`{row_letter}{column_number}`, no zero-padding. E.g. `A1`, `B3`, `H12`.
Sort order is row-first, then column numerically.

## Experiment types (`protocol.type`)

`sharp` (isothermal ~65 °C) · `unwinding` (~37 °C) · `standard_pcr`
(thermal cycling) · `fast_pcr` · `isothermal` · `unknown`.

## Versioning & backward compatibility

Readers should key on `format_version`. 1.1 is additive: `wells.csv` and
`SUMMARY.txt` are new optional entries; `metadata.json` is unchanged in
shape and still authoritative. A 1.0-only reader will ignore the extra
files and continue to work.

On read, when both are present, `wells.csv` is preferred for the fields
it carries (user-editable sample / content names survive round-trips
more legibly through plain-text diffs). Numeric fields fall back to
`metadata.json` when the CSV cell is empty.

On write, the processor always emits `format_version: "1.1"` with both
new files populated. `metadata.json`'s `wells` section stays in lockstep
so nothing is lost if the CSV is deleted manually.

## Editing by hand

- **Safe:** edit `wells.csv` in Excel to rename samples, change content
  types. Save back into the ZIP. The processor will pick up the CSV on
  reload.
- **Unsafe:** editing `metadata.json` by hand without matching the CSV
  works but creates a divergence the processor resolves with CSV-wins on
  the user-editable fields. Prefer the CSV for text edits; use the JSON
  for structural changes.
- `SUMMARY.txt` is regenerated on every save — hand edits are lost.
