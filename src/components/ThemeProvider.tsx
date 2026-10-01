import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface ThemeContextType {
  themeMode: string
  themeAccent: string
  setTheme: (mode: string, accent: string) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

// RGB values required for Tailwind's <alpha-value> opacity support
const ACCENT_MAP: Record<string, { 400: string, 500: string, 600: string }> = {
  emerald: { 400: '52 211 153', 500: '16 185 129', 600: '4 120 87' },
  blue: { 400: '96 165 250', 500: '59 130 246', 600: '29 78 216' },
  orange: { 400: '251 146 60', 500: '249 115 22', 600: '194 65 12' },
  yellow: { 400: '250 204 21', 500: '234 179 8', 600: '161 98 7' },
  brown: { 400: '168 162 158', 500: '120 113 108', 600: '68 64 60' },
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem('rr_theme_mode') || 'system')
  const [themeAccent, setThemeAccent] = useState(() => localStorage.getItem('rr_theme_accent') || 'emerald')

  const setTheme = useCallback((mode: string, accent: string) => {
    setThemeMode(mode)
    setThemeAccent(accent)
    localStorage.setItem('rr_theme_mode', mode)
    localStorage.setItem('rr_theme_accent', accent)
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        supabase.from('profiles').select('theme_mode, theme_accent').eq('id', user.id).single()
            .then(({ data }) => {
            if (data) {
              const mode = ['amoled', 'light'].includes(data.theme_mode) ? data.theme_mode : 'system'
              setTheme(mode, data.theme_accent || 'emerald')
            }
          })
      }
    })
  }, [setTheme])

  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const rootElement = document.getElementById('root')
    
    const transition = 'background-color 0.3s ease'
    html.style.transition = transition
    body.style.transition = transition
    if (rootElement) rootElement.style.transition = transition

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const resolvedMode = themeMode === 'amoled' ? 'amoled'
      : themeMode === 'light' ? 'light'
      : media.matches ? 'dark' : 'light'
    const bgColor = resolvedMode === 'amoled' ? '#000000' : resolvedMode === 'light' ? '#f4f7fb' : '#0f172a'

    html.dataset.theme = resolvedMode
    html.style.colorScheme = resolvedMode === 'light' ? 'light' : 'dark'
    
    html.style.backgroundColor = bgColor
    body.style.backgroundColor = bgColor
    if (rootElement) rootElement.style.backgroundColor = bgColor

    // THE MAGIC: Inject the selected RGB values into the global CSS variables
    const accentColors = ACCENT_MAP[themeAccent] || ACCENT_MAP.emerald
    html.style.setProperty('--accent-400', accentColors[400])
    html.style.setProperty('--accent-500', accentColors[500])
    html.style.setProperty('--accent-600', accentColors[600])

    if (themeMode === 'system') {
      media.addEventListener('change', applySystemTheme)
      return () => media.removeEventListener('change', applySystemTheme)
    }

    function applySystemTheme() {
      const mode = media.matches ? 'dark' : 'light'
      const color = mode === 'dark' ? '#0f172a' : '#f4f7fb'
      html.dataset.theme = mode
      html.style.colorScheme = mode
      html.style.backgroundColor = color
      body.style.backgroundColor = color
      if (rootElement) rootElement.style.backgroundColor = color
    }
  }, [themeMode, themeAccent])

  return (
    <ThemeContext.Provider value={{ themeMode, themeAccent, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
