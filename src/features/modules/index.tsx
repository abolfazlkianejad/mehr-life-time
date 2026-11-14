import { useTranslation } from 'react-i18next'
import { HeaderActions } from '@/components/header-actions'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { GymPage } from '@/features/gym/gym-page'
import { EnergyLogPage } from '@/features/modules/energy-log'
import { MorningRoutinePage } from '@/features/modules/morning-routine'
import { WorkTasksPage } from '@/features/tasks/work-tasks-page'

export function Timeline() {
  return <WorkTasksPage />
}

export function GoldenHour() {
  return <MorningRoutinePage />
}

export function Gym() {
  const { t } = useTranslation()
  return (
    <>
      <Header fixed>
        <HeaderActions />
      </Header>
      <Main className='flex flex-1 flex-col gap-5'>
        <h2 className='text-2xl font-bold'>{t('nav.gym')}</h2>
        <GymPage />
      </Main>
    </>
  )
}

export function Energy() {
  return <EnergyLogPage />
}
