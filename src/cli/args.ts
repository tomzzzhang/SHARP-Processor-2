/**
 * Argument parsing. Deliberately tiny and dependency-free: the CLI's real
 * interface is the spec file, and flags exist only to say where things go.
 */
import { CliError, toJson, writeOut } from './util';

export interface ParsedArgs {
  verb: string;
  positional: string[];
  flags: Record<string, string | boolean>;
  /** Write a JSON result to `--out` if given, else stdout. */
  emit: (value: unknown) => Promise<void>;
}

/** Flags that take a value; everything else is a boolean switch. */
const VALUE_FLAGS = new Set(['out', 'panel', 'chrome', 'format', 'dpi', 'width', 'height', 'assign', 'source']);

export function parseArgs(argv: string[]): ParsedArgs {
  const [verb, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    if (VALUE_FLAGS.has(body)) {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new CliError(`--${body} needs a value.`);
      }
      flags[body] = value;
      i++;
    } else {
      flags[body] = true;
    }
  }

  const pretty = flags.pretty === true;
  const out = typeof flags.out === 'string' ? flags.out : null;

  return {
    verb,
    positional,
    flags,
    emit: async (value: unknown) => {
      // Reports default to indented JSON on a terminal, where a human is
      // reading, and compact when piped.
      const text = toJson(value, pretty || (!out && Boolean(process.stdout.isTTY)));
      if (out) await writeOut(out, text);
      else process.stdout.write(`${text}\n`);
    },
  };
}

export function requireFlag(args: ParsedArgs, name: string): string {
  const v = args.flags[name];
  if (typeof v !== 'string') throw new CliError(`--${name} is required.`);
  return v;
}
