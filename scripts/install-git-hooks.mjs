#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'ignore' });
  console.log('Installed repository privacy hooks.');
} catch {
  // npm can install from a source archive with no .git directory. In that
  // case there is no repository to protect and no hook to configure.
}
