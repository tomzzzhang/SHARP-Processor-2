/**
 * `sharpplot group` — assign wells to groups from a spoken plate map.
 *
 * When the user hands over a raw file rather than a prepared `.sharpx`, they
 * describe the plate out loud: "row A is 10^7 in triplicate, B4 to B6 are
 * NTC." This turns that description into the same `wellGroups` /
 * `legendOrder` the GUI writes.
 *
 * A silently mis-grouped figure is the worst thing this tool can produce — it
 * renders beautifully and every conclusion drawn from it is wrong — so the
 * guard rails here are not optional:
 *
 *  - Every well named must exist. Unknown names are a hard error listing what
 *    does exist, never a silent skip.
 *  - The resulting well-to-group table is always echoed for confirmation
 *    before anything is rendered.
 *  - Nothing is written to the user's file unless `--write` is passed. The
 *    `.sharpx` is their source of truth and silently mutating it is not
 *    acceptable.
 *  - Group order is the order given, which becomes `legendOrder`. It is never
 *    inferred from plate geometry, because row/column order is not dilution
 *    order.
 */
import { buildSharpZip } from '@/lib/sharp-writer';
import { CliError, writeOut } from './util';
import { analyzeChannel, loadSource, type LoadedExperiment } from './load';

export interface GroupAssignment {
  name: string;
  wells: string[];
}

const ROW_RE = /^([A-Z])(\d+)$/i;

/** Expand `A1-A3` / `A1:A3` into the wells between them, inclusive. */
function expandRange(token: string): string[] | null {
  const parts = token.split(/[-:]/);
  if (parts.length !== 2) return null;
  const a = ROW_RE.exec(parts[0].trim());
  const b = ROW_RE.exec(parts[1].trim());
  if (!a || !b) return null;

  const [rowA, colA] = [a[1].toUpperCase(), Number(a[2])];
  const [rowB, colB] = [b[1].toUpperCase(), Number(b[2])];
  const out: string[] = [];

  if (rowA === rowB) {
    // Along a row: A1-A6
    const [lo, hi] = colA <= colB ? [colA, colB] : [colB, colA];
    for (let c = lo; c <= hi; c++) out.push(`${rowA}${c}`);
    return out;
  }
  if (colA === colB) {
    // Down a column: A1-H1
    const [lo, hi] = rowA <= rowB ? [rowA, rowB] : [rowB, rowA];
    for (let r = lo.charCodeAt(0); r <= hi.charCodeAt(0); r++) {
      out.push(`${String.fromCharCode(r)}${colA}`);
    }
    return out;
  }
  // A rectangular block: A1-C3
  const [rLo, rHi] = rowA <= rowB ? [rowA, rowB] : [rowB, rowA];
  const [cLo, cHi] = colA <= colB ? [colA, colB] : [colB, colA];
  for (let r = rLo.charCodeAt(0); r <= rHi.charCodeAt(0); r++) {
    for (let c = cLo; c <= cHi; c++) out.push(`${String.fromCharCode(r)}${c}`);
  }
  return out;
}

/** Every populated well of a row letter, e.g. `A` → A1..A12 that exist. */
function expandRow(token: string, known: Set<string>): string[] | null {
  if (!/^[A-Z]$/i.test(token)) return null;
  const row = token.toUpperCase();
  const out = [...known].filter((w) => w.startsWith(row) && /^\d+$/.test(w.slice(1)));
  return out.length > 0 ? out : null;
}

/**
 * Parse a well list: comma-separated wells, ranges (`A1-A3`, `A1-H1`,
 * `A1-C3`), or a bare row letter (`A`).
 */
export function parseWellList(text: string, known: Set<string>, context: string): string[] {
  const out: string[] = [];
  for (const rawToken of text.split(',')) {
    const token = rawToken.trim();
    if (!token) continue;
    const expanded = expandRange(token) ?? expandRow(token, known) ?? [token.toUpperCase()];
    out.push(...expanded);
  }

  const unknown = out.filter((w) => !known.has(w));
  if (unknown.length > 0) {
    throw new CliError(
      `${context}: these wells are not in the file: ${[...new Set(unknown)].join(', ')}.\n` +
      `Known wells: ${[...known].join(', ')}`,
    );
  }
  const seen = new Set<string>();
  return out.filter((w) => (seen.has(w) ? false : (seen.add(w), true)));
}

/**
 * Parse an assignment string: `"10^7=A1-A3; 10^6=B1-B3; NTC=B4,B5,B6"`.
 * Order is significant — it becomes the legend order.
 */
export function parseAssignments(spec: string, known: Set<string>): GroupAssignment[] {
  const groups: GroupAssignment[] = [];
  for (const clause of spec.split(';')) {
    const text = clause.trim();
    if (!text) continue;
    const eq = text.indexOf('=');
    if (eq === -1) {
      throw new CliError(
        `Cannot parse group assignment "${text}". Expected NAME=WELLS, ` +
        'e.g. "10^7=A1-A3; NTC=B4,B5,B6".',
      );
    }
    const name = text.slice(0, eq).trim();
    if (!name) throw new CliError(`A group in "${text}" has an empty name.`);
    const wells = parseWellList(text.slice(eq + 1), known, `group "${name}"`);
    if (wells.length === 0) throw new CliError(`Group "${name}" names no wells.`);
    groups.push({ name, wells });
  }
  if (groups.length === 0) throw new CliError('No groups were given.');
  return groups;
}

export interface GroupResult {
  assignments: GroupAssignment[];
  /** Wells assigned to more than one group — always an error. */
  conflicts: { well: string; groups: string[] }[];
  /** Populated wells left ungrouped. Allowed, but reported. */
  ungrouped: string[];
  wellGroups: Map<string, string>;
  legendOrder: string[];
}

export function resolveGroups(loaded: LoadedExperiment, assignments: GroupAssignment[]): GroupResult {
  const owners = new Map<string, string[]>();
  for (const g of assignments) {
    for (const w of g.wells) owners.set(w, [...(owners.get(w) ?? []), g.name]);
  }

  const conflicts = [...owners.entries()]
    .filter(([, gs]) => gs.length > 1)
    .map(([well, groups]) => ({ well, groups }));

  const wellGroups = new Map<string, string>();
  for (const g of assignments) for (const w of g.wells) wellGroups.set(w, g.name);

  const ungrouped = loaded.exp.wellsUsed.filter(
    (w) => !wellGroups.has(w) && !loaded.view.deactivatedWells.has(w),
  );

  return {
    assignments,
    conflicts,
    ungrouped,
    wellGroups,
    legendOrder: assignments.map((g) => `grp:${g.name}`),
  };
}

/** The confirmation echo — shown before anything is rendered or written. */
export function describeGroups(loaded: LoadedExperiment, result: GroupResult): string {
  const lines: string[] = [];
  lines.push('Proposed grouping (order shown is the legend order):');
  lines.push('');
  for (const g of result.assignments) {
    const samples = [...new Set(g.wells.map((w) => loaded.exp.wells[w]?.sample).filter(Boolean))];
    lines.push(
      `  ${g.name.padEnd(16)} n=${String(g.wells.length).padStart(2)}  ${g.wells.join(', ')}` +
      (samples.length > 0 ? `   [${samples.join(', ')}]` : ''),
    );
  }
  if (result.ungrouped.length > 0) {
    lines.push('');
    lines.push(`  ungrouped: ${result.ungrouped.join(', ')}`);
  }
  if (result.conflicts.length > 0) {
    lines.push('');
    for (const c of result.conflicts) {
      lines.push(`  CONFLICT: ${c.well} is claimed by ${c.groups.join(' and ')}`);
    }
  }
  return lines.join('\n');
}

/**
 * Group wells from an assignment string. Returns the resolved grouping and
 * its confirmation table; writing it into the file is a separate, explicit
 * step.
 */
export async function groupCommand(
  source: string,
  assignSpec: string,
): Promise<{ loaded: LoadedExperiment; result: GroupResult; echo: string }> {
  const loaded = await loadSource(source);
  const known = new Set(loaded.exp.wellsUsed);
  const assignments = parseAssignments(assignSpec, known);
  const result = resolveGroups(loaded, assignments);
  const echo = describeGroups(loaded, result);

  if (result.conflicts.length > 0) {
    throw new CliError(
      `${echo}\n\nEvery well must belong to exactly one group. Fix the overlapping assignments above.`,
    );
  }
  return { loaded, result, echo };
}

/**
 * Persist a grouping into a `.sharpx`.
 *
 * Explicit and opt-in: the source of truth belongs to the user. Only the two
 * keys the app already reads and writes are touched (`wellGroups`,
 * `legendOrder`), in the app's own serialized form — Maps as entry arrays — so
 * the result opens cleanly in the shipped version. No schema change, no new
 * keys, no `format_version` bump.
 *
 * Writes to `outPath`; passing the source path overwrites it in place, which
 * the caller must decide to do rather than have happen by default.
 */
export async function writeGroups(
  loaded: LoadedExperiment,
  result: GroupResult,
  outPath: string,
): Promise<void> {
  const existing = (loaded.exp.session as Record<string, unknown> | null | undefined) ?? {};
  const session: Record<string, unknown> = {
    ...existing,
    wellGroups: [...result.wellGroups.entries()],
    legendOrder: result.legendOrder,
  };

  const results = analyzeChannel(loaded, loaded.view.activeChannel);
  const bytes = await buildSharpZip(
    loaded.exp,
    { results, ttIsCycle: loaded.view.xAxisMode === 'cycle' },
    session,
  );
  await writeOut(outPath, bytes);
}
