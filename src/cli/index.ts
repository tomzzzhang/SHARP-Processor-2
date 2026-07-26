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
// Side-effect import: installs the browser globals the instrument parsers
// expect. Must come before anything that can reach a parser.
import './shims/dom';
import { parseArgs, type ParsedArgs } from './args';
import { inspectCommand } from './inspect';
import { buildBundle, type FigureBundle } from './figure';
import { isBundle, readJsonFile, readSpec } from './read-spec';
import { renderBundle } from './render';
import { convertCommand } from './convert';
import { groupCommand, writeGroups } from './group';
import { bundleCommand } from './bundle';
import { CliError, toJson } from './util';

const USAGE = `sharpplot — publication figures from SHARP Processor data

Usage:
  sharpplot inspect <file> [--out report.json] [--pretty]
      What is in this file: wells, samples, groups, colours, channels, melt
      content, which plot types it supports — plus a populated starting spec.

  sharpplot figure  <spec.json> [--panel LABEL] --out fig.json
      Pure. Spec to Plotly figures, no browser needed.

  sharpplot render  <spec.json|fig.json> --out out.pdf [--chrome PATH] [--keep-html]
      Browser. Figures to PDF and PNG.

  sharpplot plot    <spec.json> [--out basename] [--chrome PATH]
      figure + render in one call. The normal path.

  sharpplot convert <raw-file> --out <file.sharpx>
      Raw instrument file to .sharpx, through the app's own parsers.

  sharpplot group   <file.sharpx> --assign "10^7=A1-A3; NTC=B4,B5,B6" [--write [--out f]]
      Assign wells to groups from a described plate map. Prints the resulting
      well-to-group table for confirmation. Writes nothing unless --write.

  sharpplot bundle  --out <dir>
      Stage a self-contained renderer (sharpplot.mjs + plotly.min.js) so
      the render verb works there with no repo and no node_modules.

Sources: .sharpx, .sharp, .pcrd, .tlpd, .eds, .amxd, or a Bio-Rad CFX folder.

Common options:
  --out PATH       where to write the result
  --pretty         indent JSON output
  --chrome PATH    Chrome/Chromium binary (or set SHARPPLOT_CHROME)
  -h, --help       this message

Anything a spec does not mention is inherited from the source file, so a
one-panel spec reproduces what the app last showed for it.
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
      // A dilution panel's resolved step table goes to stderr so it is seen
      // even when the figure JSON is piped somewhere. It is the confirmation
      // that the x-axis means what the user thinks it means.
      for (const p of bundle.panels) {
        if (p.kind === 'plot' && p.summary.dilution) {
          process.stderr.write(`\n[panel ${p.label}] ${p.summary.dilution}\n\n`);
        }
      }
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
        plotly: typeof args.flags.plotly === 'string' ? args.flags.plotly : null,
        keepHtml: args.flags['keep-html'] === true,
      });

      for (const p of bundle.panels) {
        if (p.kind === 'plot' && p.summary.dilution) {
          process.stderr.write(`\n[panel ${p.label}] ${p.summary.dilution}\n\n`);
        }
      }

      for (const f of result.files) process.stdout.write(`${f}\n`);
      if (result.harnessDir) process.stdout.write(`harness: ${result.harnessDir}\n`);
      return 0;
    }
    case 'convert': {
      const source = args.positional[0];
      if (!source) throw new CliError('convert needs a file: sharpplot convert <raw> --out <file.sharpx>');
      const out = typeof args.flags.out === 'string' ? args.flags.out : null;
      if (!out) throw new CliError('convert needs --out <file.sharpx>');
      const result = await convertCommand(source, out);
      // Report to stdout directly rather than through `emit`: here --out names
      // the archive being written, so emitting there would overwrite it.
      process.stdout.write(`${toJson(result, true)}\n`);
      return 0;
    }

    case 'group': {
      const source = args.positional[0];
      if (!source) throw new CliError('group needs a file: sharpplot group <file.sharpx> --assign "..."');
      const assign = args.flags.assign;
      if (typeof assign !== 'string') {
        throw new CliError(
          'group needs --assign "NAME=WELLS; NAME=WELLS".\n' +
          'Wells may be listed (A1,A2,A3), given as a range (A1-A3, A1-H1, A1-C3),\n' +
          'or named by row letter (A). Group order becomes the legend order.',
        );
      }
      const { loaded, result, echo } = await groupCommand(source, assign);

      // The echo goes to stdout because it IS the deliverable of this verb:
      // grouping is confirmed by a human before any figure is trusted.
      process.stdout.write(`${echo}\n`);

      if (args.flags.write === true) {
        const out = typeof args.flags.out === 'string' ? args.flags.out : loaded.sourcePath;
        await writeGroups(loaded, result, out);
        process.stdout.write(`\nWritten to ${out}\n`);
      } else {
        process.stdout.write('\nNothing written. Re-run with --write to save this into the file.\n');
      }
      return 0;
    }

    case 'bundle': {
      const out = typeof args.flags.out === 'string' ? args.flags.out : null;
      if (!out) throw new CliError('bundle needs --out <dir>');
      const result = await bundleCommand(out, typeof args.flags.plotly === 'string' ? args.flags.plotly : null);
      process.stdout.write(`${toJson(result, true)}\n`);
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
