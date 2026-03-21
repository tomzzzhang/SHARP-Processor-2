export type AppTheme = 'classic' | 'sharp' | 'sharp-dark';

const STORAGE_KEY = 'sharp-processor-theme';

export function getTheme(): AppTheme {
  return (localStorage.getItem(STORAGE_KEY) as AppTheme) || 'sharp';
}

export function setTheme(theme: AppTheme) {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

export function applyTheme(theme: AppTheme) {
  const root = document.documentElement;
  root.classList.remove('dark', 'theme-classic', 'theme-sharp', 'theme-sharp-dark');

  if (theme === 'sharp-dark') {
    root.classList.add('dark', 'theme-sharp-dark');
  } else if (theme === 'classic') {
    root.classList.add('theme-classic');
  } else {
    root.classList.add('theme-sharp');
  }
}
