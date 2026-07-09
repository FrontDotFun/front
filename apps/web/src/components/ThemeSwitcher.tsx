import { type FC, useEffect, useState } from 'react';
import { THEMES, THEME_LABELS, type ThemeName, getTheme, applyTheme, onThemeChange } from '../lib/theme';

/** Four phosphor tubes — click to swap the terminal's phosphor. */
export const ThemeSwitcher: FC = () => {
  const [active, setActive] = useState<ThemeName>(getTheme);

  useEffect(() => onThemeChange(setActive), []);

  return (
    <div className="theme-switch" title={`Phosphor: ${THEME_LABELS[active]}`}>
      {THEMES.map((t) => (
        <button
          key={t}
          className={`theme-chip theme-chip-${t} ${t === active ? 'theme-chip-active' : ''}`}
          onClick={() => applyTheme(t)}
          aria-label={`${THEME_LABELS[t]} theme`}
        />
      ))}
    </div>
  );
};
