import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

const getInitialTheme = (): Theme => {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem('theme');
  return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'light';
};

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    window.localStorage.setItem('theme', newTheme);
    setThemeState(newTheme);
  };

  return { theme, setTheme };
}
