export type ThemeMode = 'dark' | 'light' | 'system';
const KEY = 'ui:theme';

export function getTheme(): ThemeMode {
  try {
    return (localStorage.getItem(KEY) as ThemeMode | null) ?? 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0d10' : '#f4f5f7');
}

export function setTheme(mode: ThemeMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* storage unavailable — theme applies for this session only */
  }
  applyTheme(mode);
}

export function applyStoredTheme() {
  applyTheme(getTheme());
}
