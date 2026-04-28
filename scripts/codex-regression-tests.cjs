const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const JSZip = require('jszip');

const root = path.resolve(__dirname, '..');
global.__APP_VERSION__ = 'codex-test';
const mockTauri = {
  savePath: null,
  textWrites: [],
  fileWrites: [],
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolveSharpAlias(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const mapped = path.join(root, 'src', request.slice(2));
    return originalResolve.call(this, mapped, parent, isMain, options);
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

const originalLoad = Module._load;
Module._load = function loadWithTauriStubs(request, parent, isMain) {
  if (request === '@tauri-apps/plugin-dialog') {
    return { save: async () => mockTauri.savePath };
  }
  if (request === '@tauri-apps/plugin-fs') {
    return {
      writeTextFile: async (filePath, text) => mockTauri.textWrites.push({ filePath, text }),
      writeFile: async (filePath, data) => mockTauri.fileWrites.push({ filePath, data }),
    };
  }
  if (request === 'plotly.js-dist-min') {
    return { toImage: async () => 'data:image/png;base64,' };
  }
  return originalLoad.call(this, request, parent, isMain);
};

require.extensions['.ts'] = function loadTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  module._compile(output, `${filename}.cjs`);
};

function makeExperiment() {
  return {
    experimentId: 'codex-fixture',
    sourcePath: 'codex-fixture.pcrd',
    metadata: {},
    amplification: {
      cycle: [1, 2],
      timeS: [0, 30],
      timeMin: [0, 0.5],
      wells: { A1: [10, 20] },
    },
    melt: {
      temperatureC: [84.5, 85.5, 86.5],
      rfu: { A1: [100, 50, 20] },
      derivative: { A1: [10, 42, 12] },
    },
    wells: {
      A1: {
        well: 'A1',
        sample: 'Sample 1',
        content: 'Unkn',
        cq: null,
        endRfu: null,
        meltTempC: null,
        meltPeakHeight: null,
        call: 'unset',
      },
    },
    wellsUsed: ['A1'],
    plateRows: 1,
    plateCols: 1,
    formatVersion: '1.1',
    protocolType: 'qpcr',
    operator: '',
    notes: '',
    runStarted: '',
  };
}

async function testWellsCsvEmptyContentWins() {
  const { loadSharpFile } = require(path.join(root, 'src/lib/sharp-loader.ts'));
  const zip = new JSZip();
  zip.file('metadata.json', JSON.stringify({
    format_version: '1.1',
    experiment_id: 'empty-content-fixture',
    data_summary: { wells_used: ['A1'] },
    plate_layout: { rows: 1, cols: 1 },
    protocol: { type: 'qpcr' },
    run_info: {},
    wells: { A1: { sample: 'Original', content: 'Unkn' } },
  }));
  zip.file('amplification.csv', 'cycle,time_s,time_min,A1\n1,0,0,10\n2,30,0.5,20\n');
  zip.file('wells.csv', 'well,sample,content,cq,end_rfu,melt_temp_c,melt_peak_height\nA1,Edited,,1.2,20,,\n');
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const exp = await loadSharpFile(buffer, 'empty-content-fixture.sharp');

  assert.equal(exp.wells.A1.sample, 'Edited');
  assert.equal(exp.wells.A1.content, '');
}

async function testResultsCsvIncludesTm() {
  const { exportResultsCsv } = require(path.join(root, 'src/lib/export.ts'));
  mockTauri.savePath = 'codex-results.csv';
  mockTauri.textWrites = [];

  await exportResultsCsv(
    makeExperiment(),
    new Map([['A1', { tt: 12.3456, dt: 1.2345, call: 'positive', endRfu: 1234, correctedRfu: [10, 20] }]]),
    ['A1'],
    'cycle',
  );

  const csv = mockTauri.textWrites[0]?.text ?? '';
  const [header, row] = csv.split('\n');
  assert.deepEqual(header.split(','), ['Well', 'Sample', 'Content', 'Ct', 'Tm', 'Doubling Time', 'Call', 'End RFU']);
  assert.equal(row.split(',')[4], '85.5');
}

async function testActiveSourcePathCanBeUpdatedAfterSaveAs() {
  const storeSource = fs.readFileSync(path.join(root, 'src/hooks/useAppState.ts'), 'utf8');
  assert.match(storeSource, /setActiveSourcePath:\s*\(path:\s*string\)\s*=>\s*void/);
  assert.match(storeSource, /setActiveSourcePath:\s*\(path\)\s*=>/);

  const menuSource = fs.readFileSync(path.join(root, 'src/components/MenuBar.tsx'), 'utf8');
  assert.match(menuSource, /const setActiveSourcePath = useAppState/);
  assert.match(menuSource, /setActiveSourcePath\(path\)/);
}

/**
 * All three direct Save-As entry points must adopt the chosen path as the
 * new active source so the next Ctrl+S quick-saves there. Codex caught a
 * gap on `claude/v0.1.12-findings-1-2-4` at 50cc901 where only the
 * handleSave fallback was wired; the File menu, Export menu, and DataTab
 * Save-buttons still discarded the path. Static source check — runtime
 * assertion would need React mounting infrastructure we don't have.
 */
function testAllSaveAsPathsAdoptActiveSource() {
  const menuSource = fs.readFileSync(path.join(root, 'src/components/MenuBar.tsx'), 'utf8');
  const dataTabSource = fs.readFileSync(path.join(root, 'src/components/sidebar/DataTab.tsx'), 'utf8');

  // MenuBar must have a single helper rather than scattered inline calls,
  // and the menu items must reference it (no orphan exportAsSharp calls
  // that discard the returned path).
  assert.match(menuSource, /const handleSaveAsSharp = useCallback/, 'MenuBar exports a Save-As helper');
  assert.match(menuSource, /handleSaveAsSharp\(\)/, 'handleSave fallback delegates to the helper');

  const saveAsActions = menuSource.match(/action: handleSaveAsSharp/g) ?? [];
  assert.equal(saveAsActions.length, 2, 'both File and Export menu Save-As items use the helper');

  // No remaining inline `exportAsSharp(exp, …)` calls in MenuBar that
  // would bypass setActiveSourcePath. (The helper itself is fine; that
  // call lives inside its body, but at the menu-action surface every
  // Save-As must go through handleSaveAsSharp.)
  const inlineMenuExports = menuSource.match(/action:\s*\(\s*\)\s*=>\s*exp\s*&&\s*exportAsSharp/g) ?? [];
  assert.equal(inlineMenuExports.length, 0, 'no menu actions invoke exportAsSharp directly');

  // DataTab Save .sharp button must adopt the path too. setActiveSourcePath
  // is imported from the store and called inside handleSaveSharp after
  // exportAsSharp returns.
  assert.match(dataTabSource, /const setActiveSourcePath = useAppState/, 'DataTab imports setActiveSourcePath');
  assert.match(
    dataTabSource,
    /handleSaveSharp[\s\S]*?setActiveSourcePath\(path\)/,
    'handleSaveSharp adopts the chosen path on success',
  );
}

function testEslintIgnoresClaudeWorktrees() {
  const config = fs.readFileSync(path.join(root, 'eslint.config.js'), 'utf8');
  assert.match(config, /\.claude\/worktrees\/\*\*/);
}

/**
 * Capture the bytes of the most recent .sharp file written by an exportAsSharp
 * call (Codex's mockTauri stub buffers them in fileWrites). Returns a JSZip
 * loaded from those bytes for inspection.
 */
async function captureSharpZip(savePath, run) {
  mockTauri.savePath = savePath;
  mockTauri.fileWrites = [];
  await run();
  const lastWrite = mockTauri.fileWrites.at(-1);
  assert.ok(lastWrite, 'expected exportAsSharp to write a file');
  return JSZip.loadAsync(lastWrite.data);
}

/**
 * Finding 1 — buildSharpZip should preserve parser-supplied nested fields
 * inside protocol / run_info / data_summary instead of overwriting them
 * with the smaller user-edit subset.
 */
async function testBuildSharpZipPreservesParserMetadata() {
  const { exportAsSharp } = require(path.join(root, 'src/lib/export.ts'));
  const exp = makeExperiment();
  exp.metadata = {
    protocol: {
      type: 'qpcr',
      reaction_temp_c: 65,
      amp_cycle_count: 40,
      has_melt: true,
      raw_definition: 'STAGE1: 95C 30s',
    },
    run_info: {
      operator: 'tom',
      run_started_utc: '2026-04-28T10:00:00Z',
      run_ended_utc: '2026-04-28T10:42:17Z',
      file_name: 'fixture.pcrd',
    },
    data_summary: { wells_used: ['A1'], cycle_count: 40 },
    instrument: { manufacturer: 'BioRad', model: 'CFX96' },
  };
  const zip = await captureSharpZip('codex-fixture.sharp', () => exportAsSharp(exp));
  const meta = JSON.parse(await zip.file('metadata.json').async('string'));

  assert.equal(meta.protocol.reaction_temp_c, 65, 'protocol.reaction_temp_c preserved');
  assert.equal(meta.protocol.amp_cycle_count, 40, 'protocol.amp_cycle_count preserved');
  assert.equal(meta.protocol.has_melt, true, 'protocol.has_melt preserved');
  assert.equal(meta.protocol.raw_definition, 'STAGE1: 95C 30s', 'protocol.raw_definition preserved');
  assert.equal(meta.run_info.run_ended_utc, '2026-04-28T10:42:17Z', 'run_info.run_ended_utc preserved');
  assert.equal(meta.run_info.file_name, 'fixture.pcrd', 'run_info.file_name preserved');
  assert.equal(meta.data_summary.cycle_count, 40, 'data_summary.cycle_count preserved');
  assert.equal(meta.instrument.model, 'CFX96', 'instrument block survives');
}

/**
 * Finding 1 corollary — user-cleared fields stay cleared.
 * If a user blanks operator/notes in the UI, save shouldn't silently restore
 * the parser's value via fallback.
 */
async function testUserClearedFieldsStayCleared() {
  const { exportAsSharp } = require(path.join(root, 'src/lib/export.ts'));
  const exp = makeExperiment();
  exp.metadata = {
    run_info: { operator: 'parser-tom', notes: 'parser notes', run_started_utc: '2026-01-01T00:00:00Z' },
  };
  exp.operator = '';                                    // user cleared
  exp.notes = '';                                       // user cleared
  exp.runStarted = '2026-04-28T10:00:00Z';              // user kept

  const zip = await captureSharpZip('cleared-fields.sharp', () => exportAsSharp(exp));
  const meta = JSON.parse(await zip.file('metadata.json').async('string'));

  assert.equal(meta.run_info.operator, '', 'cleared operator stays cleared');
  assert.equal(meta.run_info.notes, '', 'cleared notes stays cleared');
  assert.equal(meta.run_info.run_started_utc, '2026-04-28T10:00:00Z', 'kept run_started_utc');
}

/**
 * Finding 2 — when a live analysis bundle is passed in cycle mode, saved
 * cq and end_rfu come from the live results map rather than the parse-time
 * snapshot in exp.wells. Also verified in wells.csv (which mirrors metadata
 * but is what spreadsheet users see).
 */
async function testLiveAnalysisOverridesSavedCqAndEndRfu() {
  const { exportAsSharp } = require(path.join(root, 'src/lib/export.ts'));
  const exp = makeExperiment();
  exp.wells.A1.cq = 99;       // stale parse-time value
  exp.wells.A1.endRfu = 1;
  const liveAnalysis = {
    results: new Map([
      ['A1', { tt: 18.5, dt: null, call: 'positive', endRfu: 9999, correctedRfu: [10, 20] }],
    ]),
    ttIsCycle: true,
  };

  const zip = await captureSharpZip('live-overlay.sharp', () => exportAsSharp(exp, liveAnalysis));
  const meta = JSON.parse(await zip.file('metadata.json').async('string'));
  assert.equal(meta.wells.A1.cq, 18.5, 'metadata.wells.A1.cq comes from live tt');
  assert.equal(meta.wells.A1.end_rfu, 9999, 'metadata.wells.A1.end_rfu comes from live result');

  const wellsCsv = await zip.file('wells.csv').async('string');
  const a1Row = wellsCsv.split('\n').find((l) => l.startsWith('A1,'));
  assert.ok(a1Row, 'wells.csv has A1 row');
  const cells = a1Row.split(',');
  assert.equal(cells[3], '18.5', 'wells.csv cq column reflects live tt');
  assert.equal(cells[4], '9999', 'wells.csv end_rfu column reflects live result');
}

/**
 * Finding 2 — when ttIsCycle is false (time-mode run, e.g. SHARP isothermal),
 * tt is in seconds and would corrupt cq's cycle-quantification semantics.
 * Save should keep the parse-time cq value untouched. end_rfu is unit-agnostic
 * and still gets the live overlay.
 */
async function testTimeModeKeepsParserCq() {
  const { exportAsSharp } = require(path.join(root, 'src/lib/export.ts'));
  const exp = makeExperiment();
  exp.wells.A1.cq = 31.7;
  exp.wells.A1.endRfu = 1;
  const liveAnalysis = {
    results: new Map([
      ['A1', { tt: 1234.5, dt: null, call: 'positive', endRfu: 8888, correctedRfu: [10, 20] }],
    ]),
    ttIsCycle: false,
  };

  const zip = await captureSharpZip('time-mode.sharp', () => exportAsSharp(exp, liveAnalysis));
  const meta = JSON.parse(await zip.file('metadata.json').async('string'));
  assert.equal(meta.wells.A1.cq, 31.7, 'parse-time cq preserved when tt is not in cycle units');
  assert.equal(meta.wells.A1.end_rfu, 8888, 'end_rfu still overlays from live result');
}

/**
 * Finding 4 — loader missing-derivative fallback now uses the BioRad
 * computeMeltDerivative algorithm, not a naive central-difference.
 * Assert the loaded derivative matches what computeMeltDerivative produces.
 */
async function testLoaderMissingDerivativeUsesBioRadAlgorithm() {
  const { loadSharpFile } = require(path.join(root, 'src/lib/sharp-loader.ts'));
  const { computeMeltDerivative } = require(path.join(root, 'src/lib/parsers/utils.ts'));

  // 6 temperature points, simple RFU profile with a peak
  const temps = [80, 81, 82, 83, 84, 85];
  const rfu = [1000, 990, 940, 800, 700, 660];
  const expected = computeMeltDerivative(temps, { A1: rfu }).A1;

  const zip = new JSZip();
  zip.file('metadata.json', JSON.stringify({
    format_version: '1.1',
    experiment_id: 'no-deriv-fixture',
    data_summary: { wells_used: ['A1'] },
    plate_layout: { rows: 1, cols: 1 },
    protocol: { type: 'qpcr' },
    run_info: {},
    wells: { A1: { sample: 'A', content: 'Unkn' } },
  }));
  zip.file('amplification.csv', 'cycle,time_s,time_min,A1\n1,0,0,10\n2,30,0.5,20\n');
  // Note: NO melt_derivative.csv — loader fallback should fire.
  let meltRfuCsv = 'temperature_C,A1\n';
  for (let i = 0; i < temps.length; i++) meltRfuCsv += `${temps[i]},${rfu[i]}\n`;
  zip.file('melt_rfu.csv', meltRfuCsv);

  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const exp = await loadSharpFile(buffer, 'no-deriv-fixture.sharp');

  const got = exp.melt.derivative.A1;
  assert.ok(got, 'derivative was computed by fallback');
  assert.equal(got.length, expected.length, 'derivative length matches BioRad output');
  for (let i = 0; i < expected.length; i++) {
    assert.ok(
      Math.abs(got[i] - expected[i]) < 1e-9,
      `derivative[${i}]: loader=${got[i]} vs BioRad=${expected[i]}`,
    );
  }
}

/**
 * Finding 4 stretch — buildSharpZip writes melt_derivative.csv even when the
 * in-memory derivative map is empty (some parsers don't populate it). Avoids
 * round-tripped files exercising the loader fallback at all.
 */
async function testSaveComputesDerivativeWhenMissing() {
  const { exportAsSharp } = require(path.join(root, 'src/lib/export.ts'));
  const exp = makeExperiment();
  // Wipe the derivative map but keep RFU.
  exp.melt = {
    temperatureC: [80, 81, 82, 83, 84, 85],
    rfu: { A1: [1000, 990, 940, 800, 700, 660] },
    derivative: {},
  };

  const zip = await captureSharpZip('compute-on-save.sharp', () => exportAsSharp(exp));
  assert.ok(zip.file('melt_derivative.csv'), 'melt_derivative.csv written even with empty derivative map');
  const csv = await zip.file('melt_derivative.csv').async('string');
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'temperature_C,A1', 'derivative CSV header');
  assert.equal(lines.length, 7, 'derivative CSV has 6 data rows + header');
}

/**
 * Full round-trip: build a parser-rich exp, save with live analysis, load
 * the resulting bytes back, assert both halves of the v0.1.12 fixes survive.
 * This is the closest a node script can get to "edit threshold in UI, save,
 * reopen file" without a real browser.
 */
async function testRoundTripPreservesMetadataAndLiveAnalysis() {
  const { exportAsSharp } = require(path.join(root, 'src/lib/export.ts'));
  const { loadSharpFile } = require(path.join(root, 'src/lib/sharp-loader.ts'));

  const exp = makeExperiment();
  exp.metadata = {
    protocol: { type: 'qpcr', reaction_temp_c: 65, amp_cycle_count: 40, has_melt: true },
    run_info: { operator: 'tom', run_started_utc: '2026-04-28T10:00:00Z', run_ended_utc: '2026-04-28T10:42:17Z', file_name: 'fixture.pcrd' },
    data_summary: { wells_used: ['A1'], cycle_count: 40 },
    instrument: { manufacturer: 'BioRad', model: 'CFX96' },
  };
  exp.wells.A1.cq = 99;       // stale parse-time
  exp.wells.A1.endRfu = 1;
  // Wipe in-memory derivative so we exercise the on-save compute path too.
  exp.melt = {
    temperatureC: [80, 81, 82, 83, 84, 85],
    rfu: { A1: [1000, 990, 940, 800, 700, 660] },
    derivative: {},
  };

  const liveAnalysis = {
    results: new Map([
      ['A1', { tt: 18.5, dt: null, call: 'positive', endRfu: 9999, correctedRfu: [10, 20] }],
    ]),
    ttIsCycle: true,
  };

  mockTauri.savePath = 'roundtrip.sharp';
  mockTauri.fileWrites = [];
  await exportAsSharp(exp, liveAnalysis);
  const written = mockTauri.fileWrites.at(-1).data;

  // Load it back via the production loader (no fixture shortcuts).
  const buffer = written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength);
  const reloaded = await loadSharpFile(buffer, 'roundtrip.sharp');

  // Finding 1: parser metadata survived.
  assert.equal(reloaded.metadata.protocol.reaction_temp_c, 65);
  assert.equal(reloaded.metadata.protocol.amp_cycle_count, 40);
  assert.equal(reloaded.metadata.run_info.run_ended_utc, '2026-04-28T10:42:17Z');
  assert.equal(reloaded.metadata.run_info.file_name, 'fixture.pcrd');
  assert.equal(reloaded.metadata.data_summary.cycle_count, 40);
  assert.equal(reloaded.metadata.instrument.model, 'CFX96');

  // Finding 2: cq + end_rfu reflect live analysis, not stale parse-time values.
  assert.equal(reloaded.wells.A1.cq, 18.5, 'reloaded cq matches live tt at save time');
  assert.equal(reloaded.wells.A1.endRfu, 9999, 'reloaded endRfu matches live result');

  // Finding 4 stretch: derivative was computed at save and is now present
  // on the reloaded experiment without the loader fallback firing.
  assert.ok(reloaded.melt.derivative.A1, 'reloaded derivative is populated');
  assert.equal(reloaded.melt.derivative.A1.length, 6);

  // Sanity: loaded format version is 1.1 (the format we wrote).
  assert.equal(reloaded.formatVersion, '1.1');
}

async function main() {
  const tests = [
    ['wells.csv empty content wins over metadata', testWellsCsvEmptyContentWins],
    ['results CSV includes Tm column', testResultsCsvIncludesTm],
    ['Save As can update active source path', testActiveSourcePathCanBeUpdatedAfterSaveAs],
    ['all Save-As entry points adopt active source path', testAllSaveAsPathsAdoptActiveSource],
    ['ESLint ignores stale Claude worktrees', testEslintIgnoresClaudeWorktrees],
    ['buildSharpZip preserves parser metadata fields', testBuildSharpZipPreservesParserMetadata],
    ['user-cleared fields stay cleared on save', testUserClearedFieldsStayCleared],
    ['live analysis overrides saved cq and end_rfu in cycle mode', testLiveAnalysisOverridesSavedCqAndEndRfu],
    ['time-mode keeps parse-time cq (only end_rfu overlays)', testTimeModeKeepsParserCq],
    ['loader missing derivative uses BioRad algorithm', testLoaderMissingDerivativeUsesBioRadAlgorithm],
    ['save computes derivative CSV when in-memory map empty', testSaveComputesDerivativeWhenMissing],
    ['round-trip preserves metadata and live analysis', testRoundTripPreservesMetadataAndLiveAnalysis],
  ];
  const failures = [];
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      failures.push([name, error]);
      console.error(`not ok - ${name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main();
