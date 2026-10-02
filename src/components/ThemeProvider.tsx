import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type ThemeMode = 'light' | 'dark'

export function normalizeThemeMode(value: unknown): ThemeMode {
  if (value === 'light') return 'light'
  if (value === 'dark') return 'dark'
  if (value === 'amoled') return 'dark'
  if (value === 'system') return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return 'light'
}

interface ThemeContextType {
  themeMode: ThemeMode
  setTheme: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('rr_theme_mode')
    const normalized = normalizeThemeMode(saved)
    localStorage.setItem('rr_theme_mode', normalized)
    return normalized
  })

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeMode(mode)
    localStorage.setItem('rr_theme_mode', mode)
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('profiles').select('theme_mode').eq('id', user.id).single().then(({ data }) => {
        if (data?.theme_mode) setTheme(normalizeThemeMode(data.theme_mode))
      })
    })
  }, [setTheme])

  useEffect(() => {
    const canvas = themeMode === 'light' ? '#faf9f5' : '#141413'
    document.documentElement.dataset.theme = themeMode
    document.documentElement.style.colorScheme = themeMode
    document.documentElement.style.backgroundColor = canvas
    document.body.style.backgroundColor = canvas
    document.getElementById('root')?.style.setProperty('background-color', canvas)
  }, [themeMode])

  return <ThemeContext.Provider value={{ themeMode, setTheme }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
