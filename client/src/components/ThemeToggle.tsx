import { useState } from 'react';

// Single source of truth for applying the theme; index.html's pre-paint
// script does the identical dance inline to avoid a flash before JS loads.
function applyTheme(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0B120D' : '#F7FAF8');
}

export function setTheme(dark: boolean): void {
  localStorage.setItem('yo-theme', dark ? 'dark' : 'light');
  applyTheme(dark);
}

// Shared hook so the two placements (compact icon in the desktop nav,
// full-width row inside the mobile box-switcher popup) read and flip the
// same stored theme. They're breakpoint-exclusive — only one renders at
// a time — so independent local state can't drift apart.
export function useTheme(): { dark: boolean; toggle: () => void } {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  return {
    dark,
    toggle: () => {
      const next = !dark;
      setTheme(next);
      setDark(next);
    },
  };
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

// Compact icon for the desktop nav bar.
export function ThemeToggle() {
  const { dark, toggle } = useTheme();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

// Full-width, thumb-sized row for the mobile box-switcher popup (hidden on
// desktop, where the compact icon in the nav takes over).
export function ThemeMenuItem() {
  const { dark, toggle } = useTheme();

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <span className="flex h-4 w-4 items-center justify-center">{dark ? <SunIcon /> : <MoonIcon />}</span>
      {dark ? 'Light mode' : 'Dark mode'}
    </button>
  );
}
