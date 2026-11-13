import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  getLanguageLabelKey,
  getNextLanguage,
  type Language,
} from '@/i18n/config'
import { Button } from '@/components/ui/button'

/**
 * One-click language switch. Selecting a language updates `i18next`, which in
 * turn drives `<html lang>` / `<html dir>` and persists the choice to
 * `localStorage`.
 */
export function LanguageToggle() {
  const { t, i18n } = useTranslation()
  const nextLanguage: Language = getNextLanguage(i18n.resolvedLanguage)
  const label = t(getLanguageLabelKey(nextLanguage))
  const description = t('language.toggle')

  return (
    <Button
      variant='ghost'
      size='sm'
      className='h-8 gap-1.5 rounded-full px-2.5'
      aria-label={description}
      title={description}
      onClick={() => {
        void i18n.changeLanguage(nextLanguage)
      }}
    >
      <Languages className='size-4' aria-hidden='true' />
      <span className='hidden sm:inline'>{label}</span>
    </Button>
  )
}
