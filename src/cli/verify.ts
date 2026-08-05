/** Revision baseline gate: prove the accepted figure still renders unchanged. */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FigureBundle } from './figure';
import { renderBundle } from './render';
import { CliError } from './util';

export interface VerifyOptions {
  chrome?: string | null;
  plotly?: string | null;
}

export interface VerifyResult {
  matches: true;
  accepted: string;
  sha256: string;
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function exists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export async function verifyAcceptedFigure(
  bundle: FigureBundle,
  acceptedPng: string,
  opts: VerifyOptions,
): Promise<VerifyResult> {
  const accepted = path.resolve(acceptedPng);
  if (!(await exists(accepted))) {
    throw new CliError(`Accepted PNG not found: ${accepted}`);
  }

  const work = await mkdtemp(path.join(tmpdir(), 'sharpplot-verify-'));
  let keep = false;
  try {
    // Verification always needs a PNG even if the publication deliverable is
    // PDF-only. The PNG is the stable byte-level view of the whole rendered
    // page; PDFs may carry changing document metadata.
    const candidateBundle: FigureBundle = {
      ...bundle,
      output: { ...bundle.output, formats: ['pdf', 'png'] },
    };
    const result = await renderBundle(candidateBundle, {
      out: path.join(work, 'candidate'),
      chrome: opts.chrome,
      plotly: opts.plotly,
    });
    const candidate = result.files.find((file) => file.endsWith('.png'));
    if (!candidate) throw new CliError('Baseline verification produced no PNG.');

    const acceptedHash = digest(await readFile(accepted));
    const candidateHash = digest(await readFile(candidate));
    if (acceptedHash !== candidateHash) {
      keep = true;
      throw new CliError(
        'Revision baseline FAILED: the unchanged spec no longer reproduces the accepted PNG.\n' +
        `Accepted SHA-256: ${acceptedHash}\n` +
        `Current SHA-256:  ${candidateHash}\n` +
        `Candidate kept for inspection: ${candidate}\n` +
        'Stop before editing the figure and reconcile the source, sharpplot build, fonts, or browser.',
      );
    }
    return { matches: true, accepted, sha256: acceptedHash };
  } finally {
    if (!keep) await rm(work, { recursive: true, force: true });
  }
}
