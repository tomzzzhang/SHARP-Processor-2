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

function testEslintIgnoresClaudeWorktrees() {
  const config = fs.readFileSync(path.join(root, 'eslint.config.js'), 'utf8');
  assert.match(config, /\.claude\/worktrees\/\*\*/);
}

async function main() {
  const tests = [
    ['wells.csv empty content wins over metadata', testWellsCsvEmptyContentWins],
    ['results CSV includes Tm column', testResultsCsvIncludesTm],
    ['Save As can update active source path', testActiveSourcePathCanBeUpdatedAfterSaveAs],
    ['ESLint ignores stale Claude worktrees', testEslintIgnoresClaudeWorktrees],
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
