import { useTranslation } from 'react-i18next'
import { ContentSection } from '../components/content-section'
import { AlarmSettings } from './alarm-settings'

export function SettingsNotifications() {
  const { t } = useTranslation()
  return (
    <ContentSection title={t('alarms.title')} desc={t('alarms.subtitle')}>
      <AlarmSettings />
    </ContentSection>
  )
}
