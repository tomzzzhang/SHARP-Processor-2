/**
 * Minimal browser globals the Processor's parsers expect.
 *
 * `.pcrd`, `.eds` and `.amxd` are XML under their encryption, and the parsers
 * read them with `DOMParser` — a browser API with no Node equivalent. Rather
 * than fork those parsers for headless use (two ingest paths that can drift is
 * exactly what this tool avoids), provide the global they expect from
 * `linkedom`, which the repo already carries for this purpose.
 *
 * Import this for its side effect before any parser runs.
 */
import { DOMParser } from 'linkedom';

const g = globalThis as unknown as { DOMParser?: unknown };
if (typeof g.DOMParser === 'undefined') {
  g.DOMParser = DOMParser;
}
