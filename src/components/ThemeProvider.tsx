import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface ThemeContextType {
  themeMode: string
  themeAccent: string
  setTheme: (mode: string, accent: string) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

// RGB values required for Tailwind's <alpha-value> opacity support
const ACCENT_MAP: Record<string, { 400: string, 500: string, 600: string }> = {
  emerald: { 400: '52 211 153', 500: '16 185 129', 600: '5 150 105' },
  blue: { 400: '96 165 250', 500: '59 130 246', 600: '37 99 235' },
  orange: { 400: '251 146 60', 500: '249 115 22', 600: '234 88 12' },
  yellow: { 400: '250 204 21', 500: '234 179 8', 600: '202 138 4' },
  brown: { 400: '168 162 158', 500: '120 113 108', 600: '87 83 78' },
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeMode] = useState('dark')
  const [themeAccent, setThemeAccent] = useState('emerald')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        supabase.from('profiles').select('theme_mode, theme_accent').eq('id', user.id).single()
          .then(({ data }) => {
            if (data) {
              setThemeMode(data.theme_mode || 'dark')
              setThemeAccent(data.theme_accent || 'emerald')
            }
          })
      }
    })
  }, [])

  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const rootElement = document.getElementById('root')
    
    const transition = 'background-color 0.3s ease'
    html.style.transition = transition
    body.style.transition = transition
    if (rootElement) rootElement.style.transition = transition

    let bgColor = '#0f172a' // Default Dark
    if (themeMode === 'amoled') bgColor = '#000000'
    if (themeMode === 'light') bgColor = '#f1f5f9'
    
    html.style.backgroundColor = bgColor
    body.style.backgroundColor = bgColor
    if (rootElement) rootElement.style.backgroundColor = bgColor

    html.className = themeMode 

    // THE MAGIC: Inject the selected RGB values into the global CSS variables
    const accentColors = ACCENT_MAP[themeAccent] || ACCENT_MAP.emerald
    html.style.setProperty('--accent-400', accentColors[400])
    html.style.setProperty('--accent-500', accentColors[500])
    html.style.setProperty('--accent-600', accentColors[600])

  }, [themeMode, themeAccent])

  return (
    <ThemeContext.Provider value={{ themeMode, themeAccent, setTheme: (m, a) => { setThemeMode(m); setThemeAccent(a); } }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}