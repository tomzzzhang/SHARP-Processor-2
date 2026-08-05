/// <reference types="vite/client" />

/** Injected by Vite from package.json — see vite.config.ts `define`. */
declare const __APP_VERSION__: string;

/**
 * Injected by the CLI build only — see vite.cli.config.ts `define`. The app
 * build does not set these, so nothing under `src/lib` or `src/components`
 * may reference them; they exist so a copied `sharpplot.mjs` can say which
 * build it is. `'unknown'` when git is unavailable at build time.
 */
declare const __SHARPPLOT_COMMIT__: string;
declare const __SHARPPLOT_BUILT_AT__: string;
