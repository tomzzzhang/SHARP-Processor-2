/**
 * Build config for the sharpplot CLI.
 *
 * Bundles `src/cli/index.ts` to `dist-cli/sharpplot.mjs` in SSR/lib mode, using
 * the SAME `@/` alias as the app so every import resolves to the identical
 * module the desktop build uses. Nothing here is wired into the Tauri bundle —
 * `dist-cli/` is a developer artifact, and stays out of the shipped app until
 * that is a deliberate decision.
 *
 * The one substitution is `@tauri-apps/plugin-fs`, aliased to a Node
 * implementation so the app's own instrument loaders run headlessly rather
 * than needing a parallel ingest path.
 */
import { defineConfig } from 'vite';
import path from 'path';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

/**
 * Rolldown's readable bundles include `//#region` comments containing absolute
 * source paths. Those paths identify the build machine and must not enter a
 * shared or public artifact. Removing comments is behavior-neutral.
 */
function stripAbsoluteModulePathComments() {
  return {
    name: 'strip-absolute-module-path-comments',
    generateBundle(_options: unknown, bundle: Record<string, { type: string; code?: string }>) {
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk' && output.code) {
          output.code = output.code.replace(/^\/\/#(?:end)?region.*(?:\r?\n|$)/gm, '');
        }
      }
    },
  };
}

/**
 * Which commit this bundle was built from.
 *
 * `sharpplot.mjs` gets copied around — staged to `~/.claude/tools/`, zipped
 * into a `.skill` and uploaded to claude.ai — and every one of those copies is
 * a snapshot with no link back. Stamping the commit is what makes "are you on
 * the current build?" answerable at all. Tolerant of a missing git: a tarball
 * of the source still builds, it just cannot name itself.
 */
function gitCommit(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short=9', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    // `-c core.fileMode=false` so a permission bit is not mistaken for a
    // change. build.sh / dev.sh carry long-standing, deliberately-unstaged
    // chmod +x deltas; without this every build would be stamped `-dirty`
    // and the flag would stop meaning anything.
    const dirty = execFileSync('git', ['-c', 'core.fileMode=false', 'status', '--porcelain'], {
      cwd: __dirname,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().length > 0;
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [stripAbsoluteModulePathComments()],
  resolve: {
    alias: {
      '@tauri-apps/plugin-fs': path.resolve(__dirname, './src/cli/shims/tauri-fs.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    // Matches the app build so `constants.ts` reports the same version.
    __APP_VERSION__: JSON.stringify(pkg.version),
    // CLI-only build identity. See gitCommit() above and src/cli/version.ts.
    __SHARPPLOT_COMMIT__: JSON.stringify(gitCommit()),
    __SHARPPLOT_BUILT_AT__: JSON.stringify(new Date().toISOString().slice(0, 19) + 'Z'),
  },
  ssr: {
    // Bundle every dependency rather than leaving them as bare imports
    // resolved from node_modules at run time. That makes dist-cli/sharpplot.mjs
    // genuinely self-contained, so it can be copied to a machine with no
    // checkout — which is the whole point of the `bundle` verb and of the
    // split between the pure `figure` step and the browser `render` step.
    noExternal: true,
  },
  build: {
    ssr: true,
    outDir: 'dist-cli',
    emptyOutDir: true,
    // The app's public/ assets (icons, favicon) are irrelevant to a CLI.
    copyPublicDir: false,
    target: 'node20',
    minify: false,
    sourcemap: false,
    lib: {
      entry: path.resolve(__dirname, 'src/cli/index.ts'),
      formats: ['es'],
    },
    rollupOptions: {
      // Node built-ins stay external; everything else is bundled so the CLI is
      // a single self-contained file.
      external: [/^node:/],
      output: {
        entryFileNames: 'sharpplot.mjs',
        chunkFileNames: '[name].mjs',
      },
    },
  },
});
