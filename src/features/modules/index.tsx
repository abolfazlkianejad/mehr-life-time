import { HeaderActions } from '@/components/header-actions'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { GymTracker } from '@/features/modules/gym-tracker'
import { useTranslation } from 'react-i18next'
import { WorkTasksPage } from '@/features/tasks/work-tasks-page'
import { MorningRoutinePage } from '@/features/modules/morning-routine'
import { EnergyLogPage } from '@/features/modules/energy-log'

export function Timeline() {
  return <WorkTasksPage />
}

export function GoldenHour() {
  return <MorningRoutinePage />
}

export function Gym() {
  const { t } = useTranslation()
  return <><Header fixed><HeaderActions /></Header><Main className='flex flex-1 flex-col gap-5'><h2 className='text-2xl font-bold'>{t('nav.gym')}</h2><GymTracker /></Main></>
}

export function Energy() {
  return <EnergyLogPage />
}
