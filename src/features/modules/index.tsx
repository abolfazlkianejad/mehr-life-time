import { useTranslation } from 'react-i18next'
import { HeaderActions } from '@/components/header-actions'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { GymPage } from '@/features/gym/gym-page'
import { MorningRoutinePage } from '@/features/modules/morning-routine'

export function MorningRoutine() {
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
