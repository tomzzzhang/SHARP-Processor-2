# skills/

Packaged skill bundles from this repo, ready to grab — not part of the app
build or release.

## sharpplot.skill

The `sharpplot` skill (see [`docs/SHARPPLOT.md`](../docs/SHARPPLOT.md) and
the CLI at [`src/cli/`](../src/cli/)), packaged as a `.skill` file for
upload to claude.ai / Cowork (Settings → Skills → Add).

For Claude Code instead, copy the source directly — no packaging needed:

```bash
cp -r .claude/skills/sharpplot ~/.claude/skills/
```

**Source of truth is [`.claude/skills/sharpplot/`](../.claude/skills/sharpplot/).**
This `.skill` file is a rebuildable artifact of that folder, kept here so it
can be downloaded without cloning and building the repo. Rebuild after
editing the skill:

```bash
npm run skill:pack
```

This writes `dist-skill/sharpplot.skill` (gitignored, ephemeral) and copies
it here to `skills/sharpplot.skill` (tracked, this is the one to grab).

## Not part of the release

Nothing under `skills/` is referenced by `build.sh`, `build.bat`, or any
Tauri bundling config. It ships with the repo, not with the app.
