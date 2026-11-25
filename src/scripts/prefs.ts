// Reader preferences: accent colour and a few toggles, saved in localStorage.
// The inline script in Base.astro applies the same values before first paint; keep the two in step.
// Stored values are checked against fixed lists, so a tampered entry can't put anything odd in the DOM.

export const ACCENTS = ['green', 'amber', 'cyan', 'pink', 'violet'] as const;
export type Accent = (typeof ACCENTS)[number];

export interface Prefs {
  accent: Accent;
  crt: boolean;
  mono: boolean;
  cat: boolean;
  calm: boolean;
}

export const DEFAULTS: Prefs = { accent: 'green', crt: false, mono: false, cat: true, calm: false };

export function loadPrefs(): Prefs {
  let raw: Partial<Record<keyof Prefs, unknown>> = {};
  try {
    raw = JSON.parse(localStorage.getItem('prefs') ?? '{}') ?? {};
  } catch {}
  return {
    accent: ACCENTS.includes(raw.accent as Accent) ? (raw.accent as Accent) : DEFAULTS.accent,
    crt: raw.crt === true,
    mono: raw.mono === true,
    cat: raw.cat !== false,
    calm: raw.calm === true,
  };
}

export function applyPrefs(p: Prefs) {
  const d = document.documentElement.dataset;
  if (p.accent === 'green') delete d.accent;
  else d.accent = p.accent;
  const flag = (key: 'crt' | 'mono' | 'calm' | 'nocat', on: boolean) => (on ? (d[key] = '') : delete d[key]);
  flag('crt', p.crt);
  flag('mono', p.mono);
  flag('calm', p.calm);
  flag('nocat', !p.cat);
}

export function savePrefs(p: Prefs) {
  applyPrefs(p);
  try {
    localStorage.setItem('prefs', JSON.stringify(p));
  } catch {}
  document.dispatchEvent(new CustomEvent('prefschange', { detail: p }));
}

export function updatePrefs(change: Partial<Prefs>) {
  savePrefs({ ...loadPrefs(), ...change });
}

export function setTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('theme', theme);
  } catch {}
  document.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
}
