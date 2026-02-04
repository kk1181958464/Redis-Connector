/**
 * 设置上下文
 * 管理应用全局设置状态
 */

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { AppSettings, DEFAULT_SETTINGS, ThemeMode, Language, AccentColor, I18N } from '../types/settings';

interface SettingsContextType {
  settings: AppSettings;
  updateSettings: (updates: Partial<AppSettings>) => void;
  setTheme: (theme: ThemeMode) => void;
  setFont: (font: string) => void;
  setLanguage: (lang: Language) => void;
  setKeysPerPage: (count: number) => void;
  setAccentColor: (color: AccentColor) => void;
  t: (key: string) => string;
  effectiveTheme: 'dark' | 'light';
}

const SettingsContext = createContext<SettingsContextType | null>(null);

const STORAGE_KEY = 'app-settings';

// 获取系统主题
function getSystemTheme(): 'dark' | 'light' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

// 从 localStorage 加载设置
function loadSettings(): AppSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        appearance: { ...DEFAULT_SETTINGS.appearance, ...parsed.appearance },
        data: { ...DEFAULT_SETTINGS.data, ...parsed.data },
      };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return DEFAULT_SETTINGS;
}

// 保存设置到 localStorage
function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(getSystemTheme);

  // 计算实际生效的主题
  const effectiveTheme = settings.appearance.theme === 'system'
    ? systemTheme
    : settings.appearance.theme;

  // 监听系统主题变化
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // 应用主题到 DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', effectiveTheme);
  }, [effectiveTheme]);

  // 应用字体到 DOM
  useEffect(() => {
    document.documentElement.style.setProperty('--font-family', settings.appearance.fontFamily);
  }, [settings.appearance.fontFamily]);

  // 应用主题色到 DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-accent', settings.appearance.accentColor);
  }, [settings.appearance.accentColor]);

  // 保存设置
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings(prev => ({
      ...prev,
      ...updates,
      appearance: {
        ...prev.appearance,
        ...(updates.appearance || {}),
      },
      data: {
        ...prev.data,
        ...(updates.data || {}),
      },
    }));
  }, []);

  const setTheme = useCallback((theme: ThemeMode) => {
    setSettings(prev => ({
      ...prev,
      appearance: { ...prev.appearance, theme },
    }));
  }, []);

  const setFont = useCallback((fontFamily: string) => {
    setSettings(prev => ({
      ...prev,
      appearance: { ...prev.appearance, fontFamily },
    }));
  }, []);

  const setLanguage = useCallback((language: Language) => {
    setSettings(prev => ({ ...prev, language }));
  }, []);

  const setKeysPerPage = useCallback((keysPerPage: number) => {
    setSettings(prev => ({
      ...prev,
      data: { ...prev.data, keysPerPage },
    }));
  }, []);

  const setAccentColor = useCallback((accentColor: AccentColor) => {
    setSettings(prev => ({
      ...prev,
      appearance: { ...prev.appearance, accentColor },
    }));
  }, []);

  // 国际化翻译函数
  const t = useCallback((key: string): string => {
    return I18N[settings.language]?.[key] || key;
  }, [settings.language]);

  return (
    <SettingsContext.Provider value={{
      settings,
      updateSettings,
      setTheme,
      setFont,
      setLanguage,
      setKeysPerPage,
      setAccentColor,
      t,
      effectiveTheme,
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextType {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
