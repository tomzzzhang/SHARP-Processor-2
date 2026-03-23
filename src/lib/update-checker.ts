import { APP_VERSION, GITHUB_REPO, RELEASES_URL } from './constants';

export interface UpdateResult {
  updateAvailable: boolean;
  latestVersion: string;
  currentVersion: string;
  releaseUrl: string;
  releaseNotes?: string;
}

/** Compare two semver strings: returns true if remote > local */
function isNewer(remote: string, local: string): boolean {
  const r = remote.replace(/^v/, '').split('.').map(Number);
  const l = local.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
    if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Check GitHub Releases API for a newer version.
 * Returns null if the check fails (no internet, API error, etc.).
 */
export async function checkForUpdates(): Promise<UpdateResult | null> {
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { Accept: 'application/vnd.github.v3+json' } },
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const tagName: string = data.tag_name ?? '';
    return {
      updateAvailable: isNewer(tagName, APP_VERSION),
      latestVersion: tagName.replace(/^v/, ''),
      currentVersion: APP_VERSION,
      releaseUrl: data.html_url ?? RELEASES_URL,
      releaseNotes: data.body ?? undefined,
    };
  } catch {
    return null; // Network error — silently fail
  }
}
