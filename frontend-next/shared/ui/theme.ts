/**
 * Enhanced Theme Utilities
 * 
 * Extends the existing storefront/theme.ts with:
 * - System preference support
 * - Single root authority enforcement
 * - CSS variable injection
 * - Better type safety
 * 
 * Part of the Kolbe Fluid Heritage design system.
 * Integrates with existing shared architecture.
 */

import { useEffect, useState } from 'react';

// ============================================================================
// TYPES
// ============================================================================

export type ThemeMode = 'light' | 'dark' | 'system';

// Map to existing StorefrontTheme type
export type StorefrontTheme = 'liquid' | 'dark';

// ============================================================================
// CONSTANTS
// ============================================================================

export const THEME_STORAGE_KEY = 'kolbe-storefront-theme-v1';
export const THEME_ATTRIBUTE = 'data-theme';
export const THEME_EVENT = 'kolbe-theme-change';

// ============================================================================
// SYSTEM PREFERENCE
// ============================================================================

/**
 * Check if system prefers dark mode
 */
export function getSystemPrefersDark(): boolean {
  if (typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

/**
 * Listen for system preference changes
 */
export function onSystemPreferenceChange(callback: (prefersDark: boolean) => void): () => void {
  if (typeof window !== 'undefined') {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => callback(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }
  return () => {};
}

// ============================================================================
// THEME RESOLUTION
// ============================================================================

/**
 * Resolve theme mode to actual theme
 * - 'system' resolves to current system preference
 * - 'light' maps to 'liquid'
 * - 'dark' stays 'dark'
 */
export function resolveTheme(mode: ThemeMode): StorefrontTheme {
  switch (mode) {
    case 'light':
      return 'liquid';
    case 'dark':
      return 'dark';
    case 'system':
      return getSystemPrefersDark() ? 'dark' : 'liquid';
    default:
      return 'liquid';
  }
}

/**
 * Get current theme mode from storage or default
 */
export function getStoredThemeMode(): ThemeMode {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && ['light', 'dark', 'system'].includes(stored)) {
      return stored as ThemeMode;
    }
  }
  return 'light';
}

// ============================================================================
// THEME MANAGER (Singleton)
// ============================================================================

let currentThemeMode: ThemeMode = 'light';
let systemPrefersDark = getSystemPrefersDark();

// Initialize system preference listener
if (typeof window !== 'undefined') {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', (e) => {
    systemPrefersDark = e.matches;
    // Re-apply theme if in system mode
    if (currentThemeMode === 'system') {
      applyTheme(resolveTheme('system'));
    }
  });
}

/**
 * Apply theme to document
 */
function applyTheme(theme: StorefrontTheme) {
  if (typeof document !== 'undefined') {
    const html = document.documentElement;
    html.setAttribute(THEME_ATTRIBUTE, theme);
    html.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
    
    // Dispatch event for React hooks
    window.dispatchEvent(new Event(THEME_EVENT));
  }
}

/**
 * ThemeManager - Singleton for theme management
 */
export const ThemeManager = {
  /**
   * Initialize theme system
   * Call this at app startup
   */
  init: () => {
    systemPrefersDark = getSystemPrefersDark();
    const storedMode = getStoredThemeMode();
    ThemeManager.setMode(storedMode);
  },
  
  /**
   * Set theme mode
   */
  setMode: (mode: ThemeMode) => {
    currentThemeMode = mode;
    const theme = resolveTheme(mode);
    applyTheme(theme);
    
    // Persist preference
    if (typeof window !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
  },
  
  /**
   * Get current theme mode
   */
  getMode: (): ThemeMode => {
    return currentThemeMode;
  },
  
  /**
   * Get current resolved theme
   */
  getTheme: (): StorefrontTheme => {
    return resolveTheme(currentThemeMode);
  },
  
  /**
   * Toggle between light and dark
   */
  toggle: () => {
    const newMode = currentThemeMode === 'light' ? 'dark' : 'light';
    ThemeManager.setMode(newMode);
  },
  
  /**
   * Check if current theme is dark
   */
  isDark: (): boolean => {
    return currentThemeMode === 'dark' || (currentThemeMode === 'system' && systemPrefersDark);
  },
  
  /**
   * Get system preference
   */
  getSystemPreference: (): boolean => {
    return systemPrefersDark;
  },
};

// ============================================================================
// REACT HOOKS
// ============================================================================

/**
 * Use theme hook - tracks theme changes
 */
export function useTheme(): {
  mode: ThemeMode;
  theme: StorefrontTheme;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
} {
  const [mode, setMode] = useState<ThemeMode>(currentThemeMode);
  const [theme, setTheme] = useState<StorefrontTheme>(resolveTheme(currentThemeMode));
  
  useEffect(() => {
    const update = () => {
      setMode(currentThemeMode);
      setTheme(resolveTheme(currentThemeMode));
    };
    
    // Initial update
    update();
    
    // Subscribe to theme changes
    const handler = () => update();
    window.addEventListener(THEME_EVENT, handler);
    
    return () => {
      window.removeEventListener(THEME_EVENT, handler);
    };
  }, []);
  
  return {
    mode,
    theme,
    isDark: ThemeManager.isDark(),
    setMode: ThemeManager.setMode,
    toggle: ThemeManager.toggle,
  };
}

/**
 * Use theme context - for React Context provider pattern
 * Use this when you need to provide theme to a component tree
 */
export function useThemeContext() {
  return useTheme();
}

// ============================================================================
// THEME PROVIDER (React Context)
// ============================================================================

import React, { createContext, useContext } from 'react';

type ThemeContextType = {
  mode: ThemeMode;
  theme: StorefrontTheme;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export type ThemeProviderProps = {
  children: React.ReactNode;
  /** Default theme mode (if not stored) */
  defaultMode?: ThemeMode;
};

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children, defaultMode }) => {
  const value = useTheme();
  
  // Initialize with default mode if provided
  useEffect(() => {
    if (defaultMode) {
      ThemeManager.setMode(defaultMode);
    }
  }, [defaultMode]);
  
  return (
    <ThemeContext.Provider
      value={{
        mode: value.mode,
        theme: value.theme,
        isDark: value.isDark,
        setMode: value.setMode,
        toggle: value.toggle,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useThemeContextProvider = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeContextProvider must be used within a ThemeProvider');
  }
  return context;
};

// ============================================================================
// EXPORTS
// ============================================================================

export {
  THEME_STORAGE_KEY,
  THEME_ATTRIBUTE,
  THEME_EVENT,
  getSystemPrefersDark,
  onSystemPreferenceChange,
  resolveTheme,
  getStoredThemeMode,
  ThemeManager,
};
