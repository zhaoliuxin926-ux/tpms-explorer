export const THEME_KEY = 'tpms-theme-platform';
export const PALETTE_KEY = 'tpms-palette-platform';
export type ThemePref = 'light' | 'dark' | 'system';
/** engine=工程青蓝（默认）；teach=教学青绿（与 app.html 同源 #0d9488） */
export type PalettePref = 'engine' | 'teach';

export function applyTheme(pref: ThemePref): void {
  const resolved: 'light' | 'dark' =
    pref === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : pref;
  document.documentElement.setAttribute('data-theme', resolved);
  try { localStorage.setItem(THEME_KEY, pref); } catch { /* ignore */ }
  document.querySelectorAll<HTMLButtonElement>('.theme-opt').forEach((btn) => {
    const active = btn.dataset.themeSet === pref;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

export function applyPalette(pref: PalettePref): void {
  document.documentElement.setAttribute('data-palette', pref);
  try { localStorage.setItem(PALETTE_KEY, pref); } catch { /* ignore */ }
  document.querySelectorAll<HTMLButtonElement>('.palette-opt').forEach((btn) => {
    const active = btn.dataset.paletteSet === pref;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

export function initTheme(): void {
  let saved: ThemePref = 'system';
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') saved = v;
  } catch { /* ignore */ }
  applyTheme(saved);
  document.querySelectorAll<HTMLButtonElement>('.theme-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pref = btn.dataset.themeSet as ThemePref;
      applyTheme(pref);
    });
  });
  // 用户选择“跟随系统”时，实时响应系统偏好变化
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = (): void => {
    let pref: ThemePref = 'system';
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === 'light' || v === 'dark' || v === 'system') pref = v;
    } catch { /* ignore */ }
    if (pref === 'system') applyTheme('system');
  };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
  else if (typeof (mq as unknown as { addListener?: (cb: () => void) => void }).addListener === 'function') {
    (mq as unknown as { addListener: (cb: () => void) => void }).addListener(onChange);
  }

  let pal: PalettePref = 'engine';
  try {
    const v = localStorage.getItem(PALETTE_KEY);
    if (v === 'teach' || v === 'engine') pal = v;
  } catch { /* ignore */ }
  applyPalette(pal);
  document.querySelectorAll<HTMLButtonElement>('.palette-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyPalette(btn.dataset.paletteSet as PalettePref);
    });
  });
}
