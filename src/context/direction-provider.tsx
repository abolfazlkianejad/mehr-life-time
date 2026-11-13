import { createContext, useContext, useEffect } from 'react'
import { DirectionProvider as RdxDirProvider } from '@radix-ui/react-direction'
import { useTranslation } from 'react-i18next'
import {
  applyDocumentLanguage,
  DEFAULT_LANGUAGE,
  getLanguageDirection,
  type Direction,
} from '@/i18n/config'

const DEFAULT_DIRECTION: Direction = getLanguageDirection(DEFAULT_LANGUAGE)

export type { Direction }

type DirectionContextType = {
  defaultDir: Direction
  dir: Direction
  setDir: (dir: Direction) => void
  resetDir: () => void
}

const DirectionContext = createContext<DirectionContextType | null>(null)

export function DirectionProvider({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const dir = getLanguageDirection(language)

  // i18next already applies this on `languageChanged`; re-applying on mount
  // keeps `<html dir>`/`<html lang>` authoritative even if something else
  // (a test, an extension or a prerender) touched the root element.
  useEffect(() => {
    applyDocumentLanguage(language)
  }, [language])

  const setDir = (nextDir: Direction) => {
    void i18n.changeLanguage(nextDir === 'rtl' ? 'fa' : 'en')
  }

  const resetDir = () => {
    void i18n.changeLanguage(DEFAULT_LANGUAGE)
  }

  return (
    <DirectionContext
      value={{
        defaultDir: DEFAULT_DIRECTION,
        dir,
        setDir,
        resetDir,
      }}
    >
      <RdxDirProvider dir={dir}>{children}</RdxDirProvider>
    </DirectionContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDirection() {
  const context = useContext(DirectionContext)
  if (!context) {
    throw new Error('useDirection must be used within a DirectionProvider')
  }
  return context
}
