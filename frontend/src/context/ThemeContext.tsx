import React, { createContext, useContext, useState, useEffect } from 'react';
import { ThemeId, ThemeConfig, THEME_PRESETS, OrbStyle, OrbConfig, ORB_PRESETS } from '../types/theme';

interface ThemeContextType {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  currentConfig: ThemeConfig;
  themesList: ThemeConfig[];
  orbStyle: OrbStyle;
  setOrbStyle: (style: OrbStyle) => void;
  orbList: OrbConfig[];
  chatFont: string;
  setChatFont: (font: string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    if (typeof document !== 'undefined') {
      const domTheme = document.documentElement.getAttribute('data-theme') as ThemeId;
      if (domTheme && THEME_PRESETS[domTheme]) {
        return domTheme;
      }
    }
    const saved = localStorage.getItem('omni_theme') as ThemeId;
    return (saved && THEME_PRESETS[saved]) ? saved : 'dark';
  });

  const [orbStyle, setOrbStyleState] = useState<OrbStyle>(() => {
    const saved = localStorage.getItem('omni_orb_style') as OrbStyle;
    return (saved && ORB_PRESETS[saved]) ? saved : 'vortex';
  });

  const [chatFont, setChatFontState] = useState<string>(() => {
    return localStorage.getItem('omni_chat_font') || 'Inter Modern';
  });

  const setTheme = (newTheme: ThemeId) => {
    if (THEME_PRESETS[newTheme]) {
      setThemeState(newTheme);
      localStorage.setItem('omni_theme', newTheme);
      document.documentElement.setAttribute('data-theme', newTheme);
    }
  };

  const setOrbStyle = (newOrb: OrbStyle) => {
    if (ORB_PRESETS[newOrb]) {
      setOrbStyleState(newOrb);
      localStorage.setItem('omni_orb_style', newOrb);
    }
  };

  const setChatFont = (newFont: string) => {
    setChatFontState(newFont);
    localStorage.setItem('omni_chat_font', newFont);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-chat-font', newFont);
    }
  };

  React.useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-chat-font', chatFont);
  }, [theme, chatFont]);

  const currentConfig = THEME_PRESETS[theme];
  const themesList = Object.values(THEME_PRESETS);
  const orbList = Object.values(ORB_PRESETS);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, currentConfig, themesList, orbStyle, setOrbStyle, orbList, chatFont, setChatFont }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

