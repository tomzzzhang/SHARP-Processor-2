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

/** Detect current platform from navigator */
function getCurrentPlatform(): 'windows' | 'macos' | 'unknown' {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'macos';
  return 'unknown';
}

/** Asset filename patterns that indicate a platform-specific release */
const PLATFORM_ASSET_PATTERNS: Record<string, RegExp> = {
  windows: /\.(exe|msi)$/i,
  macos: /\.(dmg|app)$/i,
};

/** Check if a release has assets for the given platform */
function hasPlatformAsset(assets: Array<{ name: string }>, platform: string): boolean {
  const pattern = PLATFORM_ASSET_PATTERNS[platform];
  if (!pattern) return true; // unknown platform — don't filter
  return assets.some((a) => pattern.test(a.name));
}

/**
 * Check GitHub Releases API for a newer version.
 * Only reports an update if the release includes assets for the current platform,
 * so users won't be notified about a release they can't download yet.
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
    const assets: Array<{ name: string }> = data.assets ?? [];
    const platform = getCurrentPlatform();
    const newer = isNewer(tagName, APP_VERSION);
    const hasAsset = hasPlatformAsset(assets, platform);
    return {
      updateAvailable: newer && hasAsset,
      latestVersion: tagName.replace(/^v/, ''),
      currentVersion: APP_VERSION,
      releaseUrl: data.html_url ?? RELEASES_URL,
      releaseNotes: data.body ?? undefined,
    };
  } catch {
    return null; // Network error — silently fail
  }
}
