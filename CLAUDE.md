# CLAUDE.md — SHARP Processor 2

**Last Updated:** 2026-03-19 PST

## Project Overview

SHARP Processor 2 — a modern desktop app for qPCR/isothermal amplification data analysis. This is a ground-up rewrite of the v1 PyQt6+matplotlib app using **Tauri 2 + React + TypeScript + Plotly.js**.

See `HANDOFF.md` for the full context, feature list, and architecture plan from v1.

## Tech Stack

- **Frontend:** React 18+, TypeScript, Vite, Tailwind CSS, shadcn/ui, Plotly.js
- **Backend:** Tauri 2.x (Rust)
- **Python sidecar:** For instrument file parsing (.pcrd, .tlpd, .eds, .amxd)
- **Build:** Tauri CLI → `.exe` (Windows), `.app` (macOS)

## Python Environment

If working with the Python sidecar (parser), use the `sharp` conda environment:

| Platform | Python path |
|----------|-------------|
| Windows  | `C:\Users\Tom\anaconda3\envs\sharp\python.exe` |
| macOS    | `~/anaconda3/envs/sharp/bin/python` |

## Repository

- GitHub: https://github.com/tomzzzhang/SHARP-Processor-2
- v1 repo: https://github.com/tomzzzhang/SHARP-data-processor

## Key References

- `HANDOFF.md` — complete feature spec, architecture, and implementation priority
- v1 source: `C:\Users\Tom\OneDrive - SHARP Diagnostics\SHARP data processor\Unwinding data processing\`
- v1 design doc: `PROCESSOR_DESIGN.md` (in v1 repo)
- .sharp format spec: `SHARP_FORMAT.md` (in v1 repo)

## Documentation Timestamps (MANDATORY)

All project MD files have a `**Last Updated:**` field. Update ALL of them whenever any project file is modified. Format: `**Last Updated:** YYYY-MM-DD PST`
