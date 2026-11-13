import { Construction } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { HeaderActions } from '@/components/header-actions'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'

type ModuleShellProps = {
  /** Translation key of the module title, e.g. `nav.timeline`. */
  titleKey: string
  /** Optional id for the future module root container. */
  contentId?: string
  /** Render the card body as a bare dashed container (used by the timeline). */
  bare?: boolean
}

/**
 * Translated shell container for modules that are not implemented yet. Keeps
 * every sidebar destination reachable instead of falling through to the
 * not-found route.
 */
export function ModuleShell({
  titleKey,
  contentId,
  bare = false,
}: ModuleShellProps) {
  const { t } = useTranslation()
  const title = t(titleKey)

  return (
    <>
      <Header fixed>
        <HeaderActions />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>{title}</h2>
            <p className='text-muted-foreground'>{t('upcoming.description')}</p>
          </div>
          <Badge variant='secondary'>{t('upcoming.badge')}</Badge>
        </div>

        <Card className='min-h-[50vh] border-dashed'>
          {!bare && (
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <Construction className='size-4' aria-hidden='true' />
                {title}
              </CardTitle>
              <CardDescription>{t('upcoming.description')}</CardDescription>
            </CardHeader>
          )}
          <CardContent
            id={contentId}
            className='h-full min-h-[40vh]'
            aria-label={title}
          />
        </Card>
      </Main>
    </>
  )
}
