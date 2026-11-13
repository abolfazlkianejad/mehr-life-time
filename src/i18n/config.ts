import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import fa from './locales/fa.json'

export const SUPPORTED_LANGUAGES = ['fa', 'en'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]

export type Direction = 'rtl' | 'ltr'

export const DEFAULT_LANGUAGE: Language = 'fa'
export const LANGUAGE_STORAGE_KEY = 'app-language'

const LANGUAGE_DIRECTIONS: Record<Language, Direction> = {
  fa: 'rtl',
  en: 'ltr',
}

/** Translation keys holding the native name of each language. */
const LANGUAGE_LABEL_KEYS: Record<Language, string> = {
  fa: 'language.fa',
  en: 'language.en',
}

export function isLanguage(value: unknown): value is Language {
  return SUPPORTED_LANGUAGES.some((language) => language === value)
}

export function getLanguageDirection(language: string | undefined): Direction {
  return isLanguage(language)
    ? LANGUAGE_DIRECTIONS[language]
    : LANGUAGE_DIRECTIONS[DEFAULT_LANGUAGE]
}

export function getNextLanguage(language: string | undefined): Language {
  return getLanguageDirection(language) === 'rtl' ? 'en' : 'fa'
}

export function getLanguageLabelKey(language: Language): string {
  return LANGUAGE_LABEL_KEYS[language]
}

function readStoredLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (isLanguage(stored)) return stored
  } catch {
    return DEFAULT_LANGUAGE
  }
  return DEFAULT_LANGUAGE
}

function persistLanguage(language: string): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // storage unavailable (private mode); preference stays in memory only
  }
}

/**
 * Keeps the document in sync with the active language so Persian renders
 * right-to-left and English left-to-right, with a matching `lang` attribute for
 * screen readers, hyphenation and font fallback.
 */
export function applyDocumentLanguage(language: string | undefined): void {
  const root = document.documentElement
  root.lang = isLanguage(language) ? language : DEFAULT_LANGUAGE
  root.dir = getLanguageDirection(language)
}

/**
 * Mirrors the active language into the document title and description so
 * browser tabs, bookmarks and link previews follow the chosen language.
 */
function applyDocumentMetadata(): void {
  document.title = i18n.t('app.name')
  const description = i18n.t('app.tagline')
  const meta = document.querySelector("meta[name='description']")
  if (meta) meta.setAttribute('content', description)
}

const initialLanguage = readStoredLanguage()

// Applied before `init` so the very first paint already has the correct
// direction, avoiding a left-to-right flash of Persian content. The resolved
// default is persisted as well, so the stored preference always reflects what
// is on screen.
applyDocumentLanguage(initialLanguage)
persistLanguage(initialLanguage)

i18n.on('languageChanged', (language) => {
  applyDocumentLanguage(language)
  applyDocumentMetadata()
  persistLanguage(language)
})

// `initAsync: false` keeps initialisation synchronous: the bundled resources
// are already in memory, so translations are ready before the first render and
// no untranslated key is ever painted.
void i18n.use(initReactI18next).init({
  resources: {
    fa: { translation: fa },
    en: { translation: en },
  },
  lng: initialLanguage,
  fallbackLng: 'en',
  supportedLngs: [...SUPPORTED_LANGUAGES],
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  initAsync: false,
})

applyDocumentMetadata()

export default i18n
