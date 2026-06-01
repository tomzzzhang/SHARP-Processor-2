# .sharp File Format

**Last Updated:** 2026-06-01 PST — Claude (v0.2.0 release prep; on-disk format unchanged (the README now notes format 1.2 for users) — batch 4 performance sweep — **file format unchanged** (the perf work is rendering/state-sharing only: see CLAUDE.md table #46). On-disk layout as of batch 3: no `metadata.json`/CSV change; the session-only `.sharpx` `session.json` carries curve-level fields — `selectedCurves` (Set), `curveStyleOverrides` / `curveGroups` (Maps) — beside the per-well selection/style/group, with a pre-curve session backfilling `selectedCurves` from `wells × channels` on open. See CLAUDE.md table #45/#46 / docs/RELEASE_v0.2.0.md §16)
**Current version:** 1.2 (multichannel) / 1.1 (single-channel)

A `.sharp` file is a ZIP archive (rename to `.zip` to open). It bundles one
experiment: raw data, reconstructed timestamps, plate setup, sample
annotations, and per-well analysis outputs.

`.sharp` and `.sharpx` use the **identical ZIP layout**. A `.sharpx`
additionally carries a `session.json` entry that captures the working
view-state (selections, hidden wells, analysis settings, style, etc.).
Plain `.sharp` is meant for data sharing — clean, no workspace state.
`.sharpx` is meant for resuming work — same data plus the session you
were in. Either extension opens through the same loader.

## Contents

| File | Required | Description |
|------|----------|-------------|
| `metadata.json` | Yes | Authoritative machine-readable metadata. Format version, instrument, protocol, run info, per-well sample + analysis outputs, data summary, plate layout, time reconstruction. |
| `amplification.csv` | Yes | Wide format: `cycle, time_s, time_min, A1, B1, …` (RFU). |
| `melt_rfu.csv` | No | Wide format: `temperature_C, A1, B1, …`. |
| `melt_derivative.csv` | No | Wide format: `temperature_C, A1, B1, …` (`-dF/dT`). |
| `wells.csv` | 1.1+ | Flat well manifest — one row per populated well. Spreadsheet-friendly view of the per-well info that otherwise lives nested inside `metadata.json`. Columns: `well, sample, content, cq, end_rfu, melt_temp_c, melt_peak_height`. String cells (sample, content) follow standard CSV quoting — commas and embedded quotes are escaped with double-quoted fields. Empty numeric cells mean "not measured / not applicable". |
| `amplification_ch{i}.csv` | 1.2 | **Multichannel only.** Per-channel amplification, one file per channel, index-keyed (`i`) to `metadata.channels`. Same wide layout as `amplification.csv`. |
| `melt_rfu_ch{i}.csv` / `melt_derivative_ch{i}.csv` | 1.2 | **Multichannel only.** Per-channel melt RFU / `-dF/dT`, index-keyed to `metadata.channels`. |
| `SUMMARY.txt` | 1.1+ | Plain-text human overview of the experiment. Lists which files are in the archive and their purpose. Not read back by the app — purely for someone browsing the ZIP by hand. Re-generated on every write from `metadata.json`. |
| `session.json` | `.sharpx` only | Working-session state — selections (per-well **and** per-`(well,channel)` curve via `selectedCurves`), hidden / deactivated wells, baseline / normalization / drift settings, threshold, style, x-axis mode, active plot tab, groups (well + curve), per-well **and** per-curve style overrides, per-well baseline / normalize overrides, dilution wizard config. Sets serialised as arrays, Maps as `[key, value]` arrays. Written **only** by Save Session; never by plain Save as .sharp. Restored on open (a pre-curve session backfills curve selection from its wells × channels). |
| `parsing_log.json` | No | Append-only parse history. |

### Multichannel (format 1.2)

A multi-fluorophore experiment (BioRad multiplex, QuantStudio 4-plex, etc.) bumps
`format_version` to `1.2` and adds:
- `metadata.channels: string[]` — canonical channel IDs in display order (dye
  names like `["FAM","VIC","ABY","JUN"]`, or `["default"]` / a single dye for
  single-channel runs).
- `metadata.channel_fluorophore: Record<channel, dye>` — parser-detected dye per
  channel.
- One trio of per-channel CSVs per channel, **index-keyed** to `channels` to
  avoid filename ambiguity for dye names with spaces/dots:
  `amplification_ch{i}.csv`, `melt_rfu_ch{i}.csv`, `melt_derivative_ch{i}.csv`.

The legacy `amplification.csv` / `melt_*.csv` still carry the **first** channel,
so 1.0/1.1 readers load that channel and ignore the rest. Single-channel files
stay at `format_version` `1.1` with no per-channel files and no behavior change.
On read, when `metadata.channels` has >1 entry and the per-channel files exist,
the loader rebuilds `amplificationByChannel` / `meltByChannel`; otherwise it
falls back to a single channel.

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
- `session.json` (in `.sharpx`) is overwritten on every Save Session —
  hand edits are lost. It also tolerates missing fields, so older / newer
  app versions can still open the file; they just ignore keys they don't
  recognise and fall back to defaults for the rest.
