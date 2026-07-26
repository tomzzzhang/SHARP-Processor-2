/**
 * sharpplot — headless figure rendering from SHARP Data Processor 2 data.
 *
 * A second consumer of the Processor's own pure modules (parsers, analysis,
 * curve fitting, `plot-figure.ts`), not a reimplementation of them. Every
 * number and every trace comes from the same code the desktop app runs; this
 * entry point only handles files, arguments, and the browser.
 *
 * Verbs:
 *   inspect <file>                    what is in this file (+ a starting spec)
 *   figure  <spec.json> --out f.json  pure: spec → Plotly figures, no browser
 *   render  <spec|fig> --out out.pdf  browser: figures → PDF/PNG
 *   plot    <spec.json>               figure + render in one call
 */
import { parseArgs, type ParsedArgs } from './args';
import { inspectCommand } from './inspect';
import { buildBundle, type FigureBundle } from './figure';
import { isBundle, readJsonFile, readSpec } from './read-spec';
import { renderBundle } from './render';
import { CliError } from './util';

const USAGE = `sharpplot — publication figures from SHARP Processor data

Usage:
  sharpplot inspect <file> [--out report.json] [--pretty]
  sharpplot figure  <spec.json> [--panel LABEL] --out fig.json
  sharpplot render  <spec.json|fig.json> --out out.pdf [--chrome PATH] [--keep-html]
  sharpplot plot    <spec.json> [--out basename] [--chrome PATH]

Sources: .sharpx, .sharp, .pcrd, .tlpd, .eds, .amxd, or a Bio-Rad CFX folder.

Common options:
  --out PATH       where to write the result
  --pretty         indent JSON output
  --chrome PATH    Chrome/Chromium binary (or set SHARPPLOT_CHROME)
  -h, --help       this message
`;

async function run(args: ParsedArgs): Promise<number> {
  switch (args.verb) {
    case 'inspect': {
      const source = args.positional[0];
      if (!source) throw new CliError('inspect needs a file: sharpplot inspect <file>');
      const report = await inspectCommand(source);
      await args.emit(report);
      return 0;
    }
    case 'figure': {
      const specPath = args.positional[0];
      if (!specPath) throw new CliError('figure needs a spec: sharpplot figure <spec.json> --out fig.json');
      const spec = await readSpec(specPath);
      const only = typeof args.flags.panel === 'string' ? args.flags.panel : null;
      if (only) {
        const keep = spec.panels.filter((p) => p.label === only);
        if (keep.length === 0) {
          throw new CliError(
            `--panel ${only} matches no panel. Spec has: ${spec.panels.map((p) => p.label).join(', ')}`,
          );
        }
        spec.panels = keep;
      }
      const bundle = await buildBundle(spec);
      await args.emit(bundle);
      return 0;
    }
    case 'render':
    case 'plot': {
      const input = args.positional[0];
      if (!input) throw new CliError(`${args.verb} needs a spec or figure file.`);

      // `render` accepts either a spec (build it here) or a fig.json built
      // earlier, possibly on another machine with no browser.
      let bundle: FigureBundle;
      let defaultStem: string;
      const raw = await readJsonFile(input);
      if (isBundle(raw)) {
        bundle = raw;
        defaultStem = bundle.id;
      } else {
        const spec = await readSpec(input);
        bundle = await buildBundle(spec);
        defaultStem = spec.id;
      }

      const out = typeof args.flags.out === 'string' ? args.flags.out : defaultStem;
      const result = await renderBundle(bundle, {
        out,
        chrome: typeof args.flags.chrome === 'string' ? args.flags.chrome : null,
        keepHtml: args.flags['keep-html'] === true,
      });

      for (const f of result.files) process.stdout.write(`${f}\n`);
      if (result.harnessDir) process.stdout.write(`harness: ${result.harnessDir}\n`);
      return 0;
    }
    default:
      throw new CliError(`Unknown verb "${args.verb}".\n\n${USAGE}`);
  }
}

export async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }
  try {
    return await run(parseArgs(argv));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`sharpplot: ${message}\n`);
    if (!(err instanceof CliError) && err instanceof Error && err.stack && process.env.SHARPPLOT_DEBUG) {
      process.stderr.write(`${err.stack}\n`);
    }
    return 1;
  }
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
