#!/usr/bin/env node
/** Public, synthetic sharpplot tests: no private fixture and no browser. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist-cli', 'sharpplot.mjs');

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function run(args, env = {}, expected = 0) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf-8',
  });
  assert.equal(
    result.status,
    expected,
    `sharpplot ${args.join(' ')} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

if (!readFileSync(CLI, 'utf-8').includes('sharpplot')) {
  throw new Error('Missing built CLI. Run npm run cli:build first.');
}

const work = mkdtempSync(path.join(tmpdir(), 'sharpplot-public-test-'));
try {
  // A real 1x1 transparent PNG. Its content is public and deterministic.
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2NDWQAAAABJRU5ErkJggg==',
    'base64',
  );
  const privateImage = path.join(work, 'private-fixture.png');
  writeFileSync(privateImage, tinyPng);
  const sha256 = createHash('sha256').update(tinyPng).digest('hex');

  const figureDir = path.join(work, 'Portable Figure');
  writeJson(path.join(figureDir, 'source', 'source.json'), {
    version: 1,
    files: [{
      id: 'reference-image',
      role: 'image panel A',
      sha256,
      recorded: '2026-08-05',
      why_not_copied: 'third-party confidential data',
    }],
  });
  const mapPath = path.join(work, 'private-sources.json');
  writeJson(mapPath, { version: 1, sources: { 'reference-image': privateImage } });
  const specPath = path.join(figureDir, 'Portable Figure.spec.json');
  writeJson(specPath, {
    id: 'portable_figure',
    output: { width_in: 1, height_in: 1, dpi: 72, formats: ['pdf'] },
    panels: [{ kind: 'image', label: 'A', pathRef: 'reference-image' }],
  });

  const bundlePath = path.join(work, 'portable.fig.json');
  run(['figure', specPath, '--out', bundlePath], { SHARPPLOT_SOURCE_MAP: mapPath });
  const bundleText = readFileSync(bundlePath, 'utf-8');
  const bundle = JSON.parse(bundleText);
  assert.equal(bundle.bundleFormat, 2);
  assert.equal(typeof bundle.sharpplot?.commit, 'string');
  assert.equal(typeof bundle.sharpplot?.builtAt, 'string');
  assert.match(bundle.panels[0].dataUrl, /^data:image\/png;base64,/);
  assert.equal('path' in bundle.panels[0], false);
  assert.equal(bundleText.includes(work), false, 'emitted bundle leaked its build/test path');
  console.log('ok  portable image bundle is self-contained, path-free, and build-stamped');

  const hashResult = JSON.parse(run(['hash-source', privateImage]).stdout);
  assert.deepEqual(hashResult, { kind: 'file', field: 'sha256', digest: sha256 });
  console.log('ok  hash-source emits a path-free public-manifest digest');

  writeFileSync(privateImage, Buffer.concat([tinyPng, Buffer.from([0])]));
  const mismatch = run(
    ['figure', specPath, '--out', path.join(work, 'must-not-exist.json')],
    { SHARPPLOT_SOURCE_MAP: mapPath },
    1,
  );
  assert.match(mismatch.stderr, /has changed since this figure recorded it/);
  writeFileSync(privateImage, tinyPng);
  console.log('ok  source references stop on checksum drift');

  const unsafeManifest = JSON.parse(readFileSync(path.join(figureDir, 'source', 'source.json'), 'utf-8'));
  unsafeManifest.files[0].path = path.join(path.parse(work).root, 'private', 'source');
  writeJson(path.join(figureDir, 'source', 'source.json'), unsafeManifest);
  const unsafe = run(
    ['figure', specPath, '--out', path.join(work, 'must-not-exist-unsafe.json')],
    { SHARPPLOT_SOURCE_MAP: mapPath },
    1,
  );
  assert.match(unsafe.stderr, /contains a private path/);
  console.log('ok  public source manifests reject machine paths');

  const archiveDir = path.join(work, 'Archive Figure');
  mkdirSync(path.join(archiveDir, 'source'), { recursive: true });
  writeFileSync(path.join(archiveDir, 'source', 'tiny.png'), tinyPng);
  writeJson(path.join(archiveDir, 'Archive Figure.spec.json'), {
    id: 'archive_figure',
    panels: [{ kind: 'image', label: 'A', path: 'source/tiny.png' }],
  });
  writeFileSync(path.join(archiveDir, 'Archive Figure.pdf'), 'accepted pdf');
  writeFileSync(path.join(archiveDir, 'Archive Figure.png'), tinyPng);

  const archived = JSON.parse(run([
    'archive',
    archiveDir,
    '--label', 'first accepted',
    '--timestamp', '2026-08-05 1200',
  ]).stdout);
  const archivedSpec = path.join(archiveDir, 'archive', '2026-08-05 1200 first accepted.spec.json');
  assert.equal(JSON.parse(readFileSync(archivedSpec, 'utf-8')).panels[0].path, '../source/tiny.png');
  assert.deepEqual(readFileSync(path.join(archiveDir, 'archive', '2026-08-05 1200 first accepted.png')), tinyPng);
  assert.equal(archived.files.length, 3);
  assert.equal(readFileSync(path.join(archiveDir, 'Archive Figure.spec.json'), 'utf-8').includes('source/tiny.png'), true);
  console.log('ok  archive copies the accepted triplet and preserves rerunnable paths');

  // Source-backed kinetics: exact synthetic FreeShoulder curves give the real
  // report engine a stable, public fixture (no private run data or browser).
  const sigmoid = (t, p) => {
    const s = 1 / (1 + Math.exp(-p.B * (t - p.C)));
    const warp = 1 - Math.pow(1 - Math.pow(s, p.foot), p.shoulder);
    return p.A + (p.D - p.A) * warp;
  };
  const wells = {
    A1: { sample: 'Fast', p: { A: 120, B: 0.014, C: 470, D: 6200, foot: 0.9, shoulder: 1.2 } },
    A2: { sample: 'Slow', p: { A: 180, B: 0.011, C: 650, D: 5700, foot: 1.1, shoulder: 0.85 } },
  };
  const times = Array.from({ length: 61 }, (_, i) => i * 20);
  const ampRows = times.map((t, i) => [
    i + 1, t, t / 60,
    ...Object.values(wells).map(({ p }, wi) => sigmoid(t, p) + Math.sin(i * 0.73 + wi) * 3),
  ]);
  const temps = Array.from({ length: 41 }, (_, i) => 70 + i * 0.5);
  const derivRows = temps.map((temp) => [
    temp,
    900 * Math.exp(-0.5 * Math.pow((temp - 82.5) / 0.8, 2)),
    760 * Math.exp(-0.5 * Math.pow((temp - 84.0) / 1.0, 2)),
  ]);
  const meltRows = temps.map((temp, i) => [temp, 7000 - i * 100, 6800 - i * 90]);

  const kineticsZip = new JSZip();
  kineticsZip.file('metadata.json', JSON.stringify({
    format_version: '1.1',
    experiment_id: 'public-kinetics-fixture',
    data_summary: { wells_used: Object.keys(wells) },
    plate_layout: { rows: 1, cols: 2 },
    protocol: { type: 'isothermal' },
    run_info: {},
    wells: Object.fromEntries(Object.entries(wells).map(([well, v]) => [well, { sample: v.sample, content: 'Unkn' }])),
  }));
  kineticsZip.file(
    'amplification.csv',
    ['cycle,time_s,time_min,A1,A2', ...ampRows.map((row) => row.join(','))].join('\n'),
  );
  kineticsZip.file(
    'melt_rfu.csv',
    ['temperature_C,A1,A2', ...meltRows.map((row) => row.join(','))].join('\n'),
  );
  kineticsZip.file(
    'melt_derivative.csv',
    ['temperature_C,A1,A2', ...derivRows.map((row) => row.join(','))].join('\n'),
  );
  const kineticsSource = path.join(work, 'public-kinetics.sharp');
  writeFileSync(kineticsSource, await kineticsZip.generateAsync({ type: 'nodebuffer' }));

  const kineticsSpec = path.join(work, 'kinetics.spec.json');
  writeJson(kineticsSpec, {
    id: 'kinetics_sections',
    output: { width_in: 10, height_in: 8, dpi: 96, formats: ['pdf'] },
    layout: { rows: 3, cols: 2, gap_in: 0.1 },
    panels: [
      {
        kind: 'plot', label: 'A', source: kineticsSource, plotType: 'amp', xAxisMode: 'time_min',
        thresholdEnabled: false,
        kinetics: {
          signal: 'corrected', showData: true, showFit: true,
          markers: ['t_lod', 't_onset10', 'inflection'],
        },
      },
      { kind: 'plot', label: 'B', source: kineticsSource, plotType: 'kinetics_residuals', xAxisMode: 'time_min' },
      {
        kind: 'plot', label: 'C', source: kineticsSource, plotType: 'melt_deriv',
        kinetics: { showMeltTm: true },
      },
      {
        kind: 'kinetics_table', label: 'D', source: kineticsSource, section: 'readouts',
        columns: ['well', 'sample', 't_lod', 't_onset10', 'yield_raw', 'call'],
        timeUnit: 'min', uncertainty: 'separate',
      },
      {
        kind: 'kinetics_table', label: 'E', source: kineticsSource, section: 'fit_parameters',
        columns: ['well', 'fit_A', 'fit_B', 'fit_C', 'fit_D', 'fit_r2'],
        uncertainty: 'plusminus',
      },
    ],
  });
  const kineticsBundlePath = path.join(work, 'kinetics.fig.json');
  run(['figure', kineticsSpec, '--out', kineticsBundlePath]);
  const kb = JSON.parse(readFileSync(kineticsBundlePath, 'utf-8'));
  const panel = (label) => kb.panels.find((p) => p.label === label);
  const a = panel('A');
  assert.equal(a.figure.data.filter((t) => t.meta?.sharpplotRole === 'kinetics-fit').length, 2);
  assert.deepEqual(
    a.figure.data.filter((t) => ['t_lod', 't_onset10', 'inflection'].includes(t.name)).map((t) => t.name),
    ['t_lod', 't_onset10', 'inflection'],
  );
  assert.equal(panel('B').figure.data.length, 2);
  assert.equal(panel('B').figure.layout.shapes.some((s) => s.type === 'rect'), true);
  assert.equal(panel('C').figure.data.some((t) => t.name === 'Tm'), true);
  assert.equal(panel('D').columns.includes('SE'), true);
  assert.equal(panel('D').rows.every((row) => row[0] !== '—' && row[2] !== '—'), true);
  assert.equal(panel('E').columns.includes('A (RFU)'), true);
  assert.equal(panel('E').rows.some((row) => String(row[1]).includes('±')), true);
  console.log('ok  kinetics fits, landmarks, residuals, Tm marks, readouts, and fit tables share one report');

  console.log('\nAll 6 synthetic sharpplot regression checks passed.');
} finally {
  rmSync(work, { recursive: true, force: true });
}
