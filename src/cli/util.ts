/**
 * Shared CLI helpers: the error type that produces a clean message rather than
 * a stack trace, and small filesystem conveniences.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** An error caused by bad input rather than a bug. Reported without a stack. */
export class CliError extends Error {}

/** Write a file, creating its parent directory first. */
export async function writeOut(filePath: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  await writeFile(filePath, data);
}

/**
 * JSON with Maps and Sets rendered as the app serializes them (entry arrays
 * and plain arrays), so reports of restored session state are readable rather
 * than a wall of `{}`.
 */
export function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries(value);
  if (value instanceof Set) return [...value];
  return value;
}

export function toJson(value: unknown, pretty: boolean): string {
  return JSON.stringify(value, jsonReplacer, pretty ? 2 : undefined);
}

/** Format a number for display, dropping trailing zeros. */
export function fmt(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return Number(value.toFixed(digits)).toString();
}
