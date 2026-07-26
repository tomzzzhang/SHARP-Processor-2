/**
 * The dilution wizard, without the GUI.
 *
 * `DilutionWizard.tsx` exists to author one plain object — a `DilutionConfig`
 * of `{ unit, highestConcentration, dilutionFactor, numSteps, steps }` — which
 * `analyzeDilutionSeries` then turns into a standard curve. Clicking a plate is
 * one way to write that object down. A sentence is another, and the statistics
 * that follow are identical either way because the same pure function computes
 * them.
 *
 * Three ways to supply it, in the order they will actually be used:
 *
 *  1. **Derive from the groups already in the file.** The common case: the user
 *     grouped wells by dilution in the GUI before saving, so the only unknowns
 *     are the top concentration and the fold factor.
 *  2. **Explicit steps**, for irregular series or non-constant factors.
 *  3. **Whatever the file already carries**, if the GUI wizard was run.
 *
 * Two rules are not negotiable here, because a wrong x-axis produces a figure
 * that looks perfect and is wrong:
 *
 *  - **Dilution order comes from `legendOrder`, never from plate geometry.**
 *    Row and column order is not dilution order.
 *  - **Concentration is never inferred silently.** A group named `10^7` is
 *    parseable and offering that parse is useful, but it is a proposal for a
 *    human to confirm, not an assumption.
 */
import { analyzeDilutionSeries, type DilutionConfig, type DilutionSeriesResult } from '@/lib/analysis';
import { SpecError, type DilutionSpec } from './spec';
import type { LoadedExperiment } from './load';
import { fmt } from './util';

export interface ResolvedDilution {
  config: DilutionConfig;
  result: DilutionSeriesResult;
  /** How the config was arrived at, for the confirmation echo. */
  provenance: 'spec-steps' | 'derived-from-groups' | 'file';
  excludedGroups: string[];
}

/** Effective group per well, curve-level first. */
function groupsOf(loaded: LoadedExperiment): Map<string, string> {
  const out = new Map<string, string>();
  for (const [well, g] of loaded.view.wellGroups) out.set(well, g);
  return out;
}

/**
 * Walk the file's groups in legend order and assign descending concentrations
 * from `top`, dividing by `fold` at each step.
 */
function deriveFromGroups(loaded: LoadedExperiment, spec: DilutionSpec, ttByWell: Map<string, number>): DilutionConfig {
  if (spec.top == null || !(spec.top > 0)) {
    throw new SpecError(
      'Deriving a dilution series from groups needs the top concentration ' +
      '(dilution.top), e.g. 5e6. It is never guessed from a group name.',
    );
  }
  const fold = spec.fold ?? 10;
  if (!(fold > 1)) throw new SpecError(`dilution.fold must be greater than 1 (got ${fold}).`);

  const groups = groupsOf(loaded);
  const members = new Map<string, string[]>();
  for (const well of loaded.exp.wellsUsed) {
    const g = groups.get(well);
    if (!g) continue;
    members.set(g, [...(members.get(g) ?? []), well]);
  }
  if (members.size === 0) {
    throw new SpecError(
      'The file has no well groups, so a dilution series cannot be derived from them. ' +
      'Group the wells in the app, or give explicit dilution.steps.',
    );
  }

  // Order by legendOrder — the user's stated series order. Groups the legend
  // does not mention keep their first-seen order, after the ordered ones.
  const ordered: string[] = [];
  for (const entry of loaded.view.legendOrder) {
    const name = entry.startsWith('grp:') ? entry.slice(4) : entry;
    if (members.has(name) && !ordered.includes(name)) ordered.push(name);
  }
  for (const name of members.keys()) if (!ordered.includes(name)) ordered.push(name);

  const excluded = new Set(spec.exclude ?? []);
  const unknownExcludes = [...excluded].filter((e) => !members.has(e));
  if (unknownExcludes.length > 0) {
    throw new SpecError(
      `dilution.exclude names groups that do not exist: ${unknownExcludes.join(', ')}. ` +
      `Known groups: ${[...members.keys()].join(', ')}`,
    );
  }

  const stepGroups = ordered.filter((g) => !excluded.has(g));
  if (stepGroups.length < 2) {
    throw new SpecError(
      `Only ${stepGroups.length} dilution step(s) remain after exclusions — a standard curve needs at least 2.`,
    );
  }

  const steps = stepGroups.map((name, i) => {
    // Hidden and deactivated wells are not part of the measurement.
    const wells = (members.get(name) ?? []).filter(
      (w) => !loaded.view.hiddenWells.has(w) && !loaded.view.deactivatedWells.has(w),
    );
    return {
      concentration: spec.top! / Math.pow(fold, i),
      wells,
      enabled: wells.some((w) => ttByWell.has(w)),
    };
  });

  return {
    unit: spec.unit ?? '',
    highestConcentration: spec.top,
    dilutionFactor: fold,
    numSteps: steps.length,
    copiesExponent: spec.copiesExponent,
    steps,
  };
}

function fromExplicitSteps(loaded: LoadedExperiment, spec: DilutionSpec): DilutionConfig {
  const known = new Set(loaded.exp.wellsUsed);
  const steps = spec.steps!.map((s) => {
    const unknown = s.wells.filter((w) => !known.has(w));
    if (unknown.length > 0) {
      throw new SpecError(
        `dilution step at ${s.concentration} names wells that are not in the file: ${unknown.join(', ')}.`,
      );
    }
    if (!(s.concentration > 0)) {
      throw new SpecError(`A dilution step has a non-positive concentration (${s.concentration}).`);
    }
    return { concentration: s.concentration, wells: s.wells, enabled: s.enabled ?? true };
  });
  const concs = steps.map((s) => s.concentration);
  return {
    unit: spec.unit ?? '',
    highestConcentration: Math.max(...concs),
    dilutionFactor: spec.fold ?? 0,
    numSteps: steps.length,
    copiesExponent: spec.copiesExponent,
    steps,
  };
}

/**
 * Resolve a dilution config and run the regression.
 *
 * `ttByWell` must come from the same analysis the panel plots, so the standard
 * curve and the amplification panel beside it cannot disagree.
 */
export function resolveDilution(
  loaded: LoadedExperiment,
  spec: DilutionSpec | null | undefined,
  ttByWell: Map<string, number>,
): ResolvedDilution {
  let config: DilutionConfig;
  let provenance: ResolvedDilution['provenance'];

  if (spec?.steps && spec.steps.length > 0) {
    config = fromExplicitSteps(loaded, spec);
    provenance = 'spec-steps';
  } else if (spec?.fromGroups || spec?.top != null) {
    config = deriveFromGroups(loaded, spec, ttByWell);
    provenance = 'derived-from-groups';
  } else if (loaded.view.dilutionConfig) {
    config = loaded.view.dilutionConfig;
    provenance = 'file';
  } else {
    throw new SpecError(
      'A dilution panel needs a concentration for every step, and none is available.\n' +
      '  The file carries no dilutionConfig (the Standard Curve wizard was never run), ' +
      'and the panel gave no dilution block.\n' +
      '  Supply one of:\n' +
      '    "dilution": { "fromGroups": true, "top": 5e6, "fold": 10, "unit": "copies/uL", "exclude": ["NTC"] }\n' +
      '    "dilution": { "steps": [ { "concentration": 5e6, "wells": ["A1","A2","A3"] }, ... ] }\n' +
      '  Concentrations are never inferred from group names such as "10^7".',
    );
  }

  if (ttByWell.size === 0) {
    throw new SpecError(
      'No well has a time to threshold, so a standard curve cannot be built. ' +
      'Threshold detection must be on (thresholdEnabled) for the panel.',
    );
  }

  const result = analyzeDilutionSeries(config, ttByWell);
  if (!result) {
    const withTt = config.steps.filter((s) => s.enabled && s.wells.some((w) => ttByWell.has(w))).length;
    throw new SpecError(
      `The dilution regression could not be computed: ${withTt} of ${config.steps.length} steps ` +
      'have a usable Tt, and it needs at least 2 steps and 3 points.\n' +
      'Check that the steps name wells that actually amplified.',
    );
  }

  return {
    config,
    result,
    provenance,
    excludedGroups: spec?.exclude ?? [],
  };
}

/**
 * The confirmation echo. A silently mis-assigned concentration is the worst
 * failure this tool can produce — the figure looks perfect and the axis is
 * wrong — so the resolved series is always printable, step by step, with the
 * exact wells behind every point.
 */
export function describeDilution(resolved: ResolvedDilution, ttByWell: Map<string, number>): string {
  const { config, result, provenance } = resolved;
  const source = {
    'spec-steps': 'explicit steps given in the spec',
    'derived-from-groups': 'derived from the groups saved in the file, in legend order',
    'file': "the file's own saved dilution config (from the app's Standard Curve wizard)",
  }[provenance];

  const lines: string[] = [];
  lines.push(`Dilution series — ${source}`);
  if (resolved.excludedGroups.length > 0) {
    lines.push(`Excluded groups: ${resolved.excludedGroups.join(', ')}`);
  }
  lines.push('');
  lines.push('  concentration        n  wells                     mean Tt');
  lines.push('  ' + '-'.repeat(64));

  for (const step of config.steps) {
    const used = step.wells.filter((w) => ttByWell.has(w));
    const stat = result.groupStats.find((g) => g.concentration === step.concentration);
    const conc = step.concentration.toExponential(2).padEnd(12);
    const flag = step.enabled ? ' ' : '·';
    lines.push(
      `${flag} ${conc}${String(used.length).padStart(9)}  ` +
      `${(used.join(',') || '(none)').padEnd(24).slice(0, 24)}  ` +
      `${stat ? fmt(stat.meanTt) : '—'}`,
    );
  }

  lines.push('');
  lines.push(
    `  fit: slope ${fmt(result.slope, 3)} ± ${fmt(result.slopeSE, 3)} per log2, ` +
    `R² ${fmt(result.rSquared, 4)}, p ${result.pValue < 1e-4 ? '< 1e-4' : fmt(result.pValue, 4)}, ` +
    `n = ${result.nTotal} over ${result.nSteps} steps`,
  );
  if (config.unit) lines.push(`  unit: ${config.unit}`);
  return lines.join('\n');
}

/** Statistics available for substitution into an annotation. */
export function statisticValues(result: DilutionSeriesResult): Record<string, string> {
  return {
    slope: fmt(result.slope, 3),
    slopeSE: fmt(result.slopeSE, 3),
    intercept: fmt(result.intercept, 3),
    interceptSE: fmt(result.interceptSE, 3),
    r2: fmt(result.rSquared, 4),
    adjR2: fmt(result.adjRSquared, 4),
    pValue: result.pValue < 1e-4 ? '< 1e-4' : fmt(result.pValue, 4),
    doublingTime: fmt(result.doublingTime, 3),
    doublingTimeSE: fmt(result.doublingTimeSE, 3),
    n: String(result.nTotal),
    nSteps: String(result.nSteps),
  };
}

/**
 * Substitute `{slope}`, `{r2}`, `{pValue}` … into annotation text, so a label
 * can state a computed statistic rather than one typed in by hand and left to
 * go stale. An unknown placeholder is an error rather than being left in the
 * figure looking like a typo.
 */
export function substituteStatistics(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_match, key: string) => {
    if (!(key in values)) {
      throw new SpecError(
        `Unknown statistic "{${key}}" in annotation text. Available: ${Object.keys(values).join(', ')}`,
      );
    }
    return values[key];
  });
}
