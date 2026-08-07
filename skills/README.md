# skills/

**Last Updated:** 2026-08-06 22:32 EDT

Packaged skill bundles from this repo, ready to grab — not part of the app
build or release.

**Source of truth for all of these is
[`.claude/skills/sharpplot/`](../.claude/skills/sharpplot/).** Everything below
is a rebuildable artifact of that folder.

## Which package do I want?

| Target | Build | Contains |
|---|---|---|
| claude.ai / Cowork | `npm run skill:pack:cowork` → `dist-skill/sharpplot-cowork.skill` | docs **+ the engine**. Upload and go — no install |
| Claude Code, this machine | `npm run cli:install` + copy the folder | source, staged CLI |
| Claude Code, a colleague | `npm run team:pack` → `dist-team/` | docs, skill folder, self-contained CLI |
| A machine where the CLI is already installed | `npm run skill:pack` → `skills/sharpplot.skill` | docs only, no engine |

See [`docs/SHARPPLOT.md`](../docs/SHARPPLOT.md) and the CLI at
[`src/cli/`](../src/cli/); hand-off docs for a colleague are in
[`team-install/`](team-install/).

## sharpplot-cowork.skill — the one for the team

```bash
npm run skill:pack:cowork
```

~1.9 MB: `SKILL.md`, `references/`, and a `bin/` folder holding the whole CLI
(`sharpplot.mjs`, its side chunks, `plotly.min.js`). `SKILL.md` looks in `bin/`
first, so an upload to claude.ai → Settings → Skills is the entire install.

**Not tracked, on purpose.** It changes with every CLI edit, and a stale copy
committed to git is precisely the drift this is meant to remove. Rebuild it
when you need it.

## sharpplot.skill — docs only

```bash
npm run skill:pack
```

Writes `dist-skill/sharpplot.skill` (gitignored) and copies it here to
`skills/sharpplot.skill` (tracked). Carries no engine, so it renders nothing on
its own — it is only useful where the CLI is installed separately. For Claude
Code, copying the source directly is simpler:

```bash
cp -r .claude/skills/sharpplot ~/.claude/skills/
```

## Not part of the release

Nothing under `skills/` is referenced by `build.sh`, `build.bat`, or any
Tauri bundling config. It ships with the repo, not with the app.
