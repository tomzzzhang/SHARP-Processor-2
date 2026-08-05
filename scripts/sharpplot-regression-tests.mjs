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

  console.log('\nAll 5 synthetic sharpplot regression checks passed.');
} finally {
  rmSync(work, { recursive: true, force: true });
}
