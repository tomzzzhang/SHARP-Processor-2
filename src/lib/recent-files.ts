/**
 * Recent files tracking via localStorage.
 * Stores the last N opened file paths with metadata.
 */

const STORAGE_KEY = 'sharp-processor-recent-files';
const MAX_RECENT = 10;

export interface RecentFile {
  path: string;
  name: string;
  format: string;
  wellCount?: number;
  openedAt: string; // ISO date
}

function getFormatLabel(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'sharp': return 'SHARP';
    case 'pcrd': return 'BioRad';
    case 'tlpd': return 'TianLong';
    case 'eds': return 'QuantStudio';
    case 'amxd': case 'adxd': return 'AriaMx';
    default: return ext.toUpperCase();
  }
}

export function getRecentFiles(): RecentFile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentFile[];
  } catch {
    return [];
  }
}

export function addRecentFile(filePath: string, wellCount?: number): void {
  const name = filePath.split(/[/\\]/).pop() ?? filePath;
  const entry: RecentFile = {
    path: filePath,
    name,
    format: getFormatLabel(filePath),
    wellCount,
    openedAt: new Date().toISOString(),
  };

  const existing = getRecentFiles().filter((f) => f.path !== filePath);
  const updated = [entry, ...existing].slice(0, MAX_RECENT);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

export function clearRecentFiles(): void {
  localStorage.removeItem(STORAGE_KEY);
}
