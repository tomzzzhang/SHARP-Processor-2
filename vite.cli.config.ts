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

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig({
  resolve: {
    alias: {
      '@tauri-apps/plugin-fs': path.resolve(__dirname, './src/cli/shims/tauri-fs.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    // Matches the app build so `constants.ts` reports the same version.
    __APP_VERSION__: JSON.stringify(pkg.version),
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
