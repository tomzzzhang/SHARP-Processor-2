#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOW_MISSING = process.argv.includes('--allow-missing-denylist');
const WORKTREE = process.argv.includes('--worktree');
const SELF = 'scripts/privacy-check.mjs';

function flagValues(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) values.push(process.argv[i + 1]);
  }
  return values;
}

const ARTIFACTS = flagValues('artifact');

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
}

function privateDenylistPath() {
  if (process.env.SHARP_PRIVACY_DENYLIST) return process.env.SHARP_PRIVACY_DENYLIST;
  const gitDir = git(['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim();
  return path.resolve(ROOT, gitDir, 'info', 'privacy-denylist');
}

function loadPrivateTerms() {
  const denylist = privateDenylistPath();
  if (!existsSync(denylist)) {
    if (ALLOW_MISSING) return [];
    console.error('Privacy check blocked: the private denylist is not installed.');
    console.error('Place one confidential identifier per line in .git/info/privacy-denylist.');
    process.exit(2);
  }
  return readFileSync(denylist, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((term) => ({
      label: 'private denylist term',
      pattern: new RegExp(
        `(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
        'iu',
      ),
    }));
}

const STRUCTURAL_PATTERNS = [
  {
    label: 'absolute user-home path',
    pattern: /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^\s"'`]+/i,
  },
  {
    label: 'private synchronized-storage path',
    pattern: /(?:Library[\\/]CloudStorage|[\\/]SHARED Files[\\/]|[\\/]3_Customers[\\/]|Claude Cowork[\\/]SHARP Diagnostics General Project)/i,
  },
  {
    label: 'dated private fixture filename',
    pattern: /[^\n"'`]*\b\d{6}\.(?:sharpx|sharp|pcrd|tlpd|eds)\b/i,
  },
];

const privateTerms = loadPrivateTerms();
const findings = [];

function scanText(text, location, patterns) {
  for (const { label, pattern } of patterns) {
    if (pattern.test(text)) findings.push(`${location}: ${label}`);
  }
}

function scanBlob(data, location, patterns) {
  if (data.includes(0)) return;
  scanText(data.toString('utf8'), location, patterns);
}

function scanFileData(data, location) {
  scanBlob(data, location, [...STRUCTURAL_PATTERNS, ...privateTerms]);

  if (location.endsWith('.skill')) {
    try {
      const entries = unzipSync(new Uint8Array(data));
      for (const [entry, content] of Object.entries(entries)) {
        scanBlob(Buffer.from(content), `${location}!${entry}`, [...STRUCTURAL_PATTERNS, ...privateTerms]);
      }
    } catch {
      findings.push(`${location}: unreadable packaged skill`);
    }
  }
}

const tracked = git(WORKTREE
  ? ['ls-files', '-co', '--exclude-standard', '-z']
  : ['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean);
for (const file of tracked) {
  if (file === SELF) continue;
  const absolute = path.join(ROOT, file);
  if (WORKTREE && !existsSync(absolute)) continue;
  const data = WORKTREE ? readFileSync(absolute) : git(['show', `:${file}`]);
  scanFileData(data, file);
}

function scanArtifact(artifactPath) {
  const absolute = path.resolve(ROOT, artifactPath);
  if (!existsSync(absolute)) {
    findings.push(`${artifactPath}: requested artifact does not exist`);
    return;
  }
  const info = statSync(absolute);
  if (info.isDirectory()) {
    for (const entry of readdirSync(absolute).sort()) scanArtifact(path.join(artifactPath, entry));
    return;
  }
  if (!info.isFile()) return;
  scanFileData(readFileSync(absolute), path.relative(ROOT, absolute));
}

for (const artifact of ARTIFACTS) scanArtifact(artifact);

// A clean tip is not enough: an old branch, tag, blob, or commit message must
// not re-publish a confidential identifier. The private terms are deliberately
// kept outside Git, then checked against the complete reachable export.
if (privateTerms.length > 0) {
  const history = git(['fast-export', '--all', '--signed-tags=strip']);
  scanText(history.toString('utf8'), 'reachable Git history', privateTerms);
}

if (findings.length > 0) {
  console.error('Privacy check failed:');
  for (const finding of [...new Set(findings)].sort()) console.error(`  ${finding}`);
  console.error('No content was printed. Remove or neutralize the identifier before continuing.');
  process.exit(1);
}

console.log(`Privacy check passed (${tracked.length} ${WORKTREE ? 'working-tree' : 'tracked'} files${
  privateTerms.length ? ', private denylist + full reachable history' : ', structural checks only'
}${ARTIFACTS.length ? `, ${ARTIFACTS.length} explicit artifact(s)` : ''}).`);
