#!/usr/bin/env node
/**
 * Parity check for the shared figure modules.
 *
 * Renders `amp`, `melt`, `melt_deriv` and `doubling` through the real
 * `buildFigure()` path and hashes the result, so any change to what those
 * plot types draw is caught mechanically rather than by eye.
 *
 * The rule this enforces: sharpplot may ADD capability to `plot-figure.ts`,
 * but every new field must be optional with a default that preserves current
 * behaviour. If this script reports a difference and the change was not a
 * deliberate, signed-off fix, it is a regression in the shipped app's export.
 *
 *   node scripts/parity-check.mjs --source <file.sharpx>          compare
 *   node scripts/parity-check.mjs --source <file.sharpx> --record  (re)record
 *
 * Requires `npm run cli:build` first.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_TEMPLATE = path.join(ROOT, 'test/parity/parity-spec.json');
const BASELINE = path.join(ROOT, 'test/parity/baseline.json');
const CLI = path.join(ROOT, 'dist-cli/sharpplot.mjs');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}

const source = arg('source');
const record = process.argv.includes('--record');

if (!source) {
  console.error('usage: node scripts/parity-check.mjs --source <file.sharpx> [--record]');
  process.exit(2);
}
if (!existsSync(CLI)) {
  console.error(`Missing ${CLI}. Run: npm run cli:build`);
  process.exit(2);
}

/** Stable stringify: key order must not affect the hash. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  // Round floats so a last-bit difference in an irrelevant digit is not a
  // false alarm; anything visible is far coarser than this.
  if (typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value)) {
    return JSON.stringify(Number(value.toPrecision(12)));
  }
  return JSON.stringify(value === undefined ? null : value);
}

function hash(value) {
  return createHash('sha256').update(canonical(value)).digest('hex').slice(0, 16);
}

const work = mkdtempSync(path.join(tmpdir(), 'sharpplot-parity-'));
try {
  const spec = readFileSync(SPEC_TEMPLATE, 'utf-8').replaceAll('SOURCE', source.replaceAll('\\', '\\\\'));
  const specPath = path.join(work, 'spec.json');
  writeFileSync(specPath, spec);

  const outPath = path.join(work, 'fig.json');
  execFileSync('node', [CLI, 'figure', specPath, '--out', outPath], { stdio: ['ignore', 'ignore', 'inherit'] });
  const bundle = JSON.parse(readFileSync(outPath, 'utf-8'));

  const current = {};
  for (const panel of bundle.panels) {
    current[panel.label] = {
      hash: hash(panel.figure),
      traces: panel.figure.data.length,
      wells: panel.summary.wells.length,
      dataHash: hash(panel.figure.data),
      layoutHash: hash(panel.figure.layout),
    };
  }

  if (record || !existsSync(BASELINE)) {
    writeFileSync(BASELINE, `${JSON.stringify({ source: path.basename(source), panels: current }, null, 2)}\n`);
    console.log(`Recorded parity baseline for ${Object.keys(current).length} plot types:`);
    for (const [k, v] of Object.entries(current)) {
      console.log(`  ${k.padEnd(6)} ${v.hash}  ${v.traces} traces, ${v.wells} wells`);
    }
    process.exit(0);
  }

  const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8'));
  if (baseline.source !== path.basename(source)) {
    console.error(
      `Baseline was recorded from "${baseline.source}" but this run used "${path.basename(source)}". ` +
      'Compare like with like, or re-record with --record.',
    );
    process.exit(2);
  }

  let failed = 0;
  for (const [label, want] of Object.entries(baseline.panels)) {
    const got = current[label];
    if (!got) {
      console.error(`FAIL ${label}: missing from this run`);
      failed++;
      continue;
    }
    if (got.hash === want.hash) {
      console.log(`ok   ${label.padEnd(6)} ${got.hash}  ${got.traces} traces, ${got.wells} wells`);
      continue;
    }
    failed++;
    const which = got.dataHash !== want.dataHash
      ? (got.layoutHash !== want.layoutHash ? 'traces AND layout' : 'traces')
      : 'layout';
    console.error(`FAIL ${label}: ${which} changed (${want.hash} → ${got.hash})`);
    console.error(`     traces ${want.traces} → ${got.traces}, wells ${want.wells} → ${got.wells}`);
  }

  if (failed > 0) {
    console.error(`\n${failed} plot type(s) render differently than the recorded baseline.`);
    console.error('Existing plot types must be byte-identical. Fix the change, or if it is a');
    console.error('deliberate signed-off correction, re-record with --record and say so in the commit.');
    process.exit(1);
  }
  console.log(`\nAll ${Object.keys(baseline.panels).length} plot types identical to baseline.`);
  process.exit(0);
} finally {
  rmSync(work, { recursive: true, force: true });
}
