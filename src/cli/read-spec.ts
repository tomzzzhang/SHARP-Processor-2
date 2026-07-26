/**
 * Reading specs and figure bundles off disk.
 *
 * `render` accepts either a spec (which it builds first) or a previously built
 * `fig.json`, so the pure step and the browser step can happen on different
 * machines. The two are told apart by shape, not by filename.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveSpec, type FigureSpec, type ResolvedSpec } from './spec';
import type { FigureBundle } from './figure';
import { CliError } from './util';

export async function readJsonFile(filePath: string): Promise<unknown> {
  const abs = path.resolve(filePath);
  let text: string;
  try {
    text = await readFile(abs, 'utf-8');
  } catch (e) {
    throw new CliError(`Cannot read ${abs}: ${(e as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new CliError(`${abs} is not valid JSON: ${(e as Error).message}`);
  }
}

/** Load and resolve a spec file, with panel paths relative to the spec. */
export async function readSpec(filePath: string): Promise<ResolvedSpec> {
  const abs = path.resolve(filePath);
  const raw = await readJsonFile(abs);
  return resolveSpec(raw as FigureSpec, path.dirname(abs));
}

/** A built bundle carries `panels[].placement`; a spec never does. */
export function isBundle(value: unknown): value is FigureBundle {
  if (!value || typeof value !== 'object') return false;
  const panels = (value as { panels?: unknown }).panels;
  if (!Array.isArray(panels) || panels.length === 0) return false;
  return typeof (panels[0] as { placement?: unknown }).placement === 'object';
}
