import { Outlet } from '@tanstack/react-router'
import {
  Monitor,
  Bell,
  HardDrive,
  Palette,
  Wrench,
  UserCog,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Separator } from '@/components/ui/separator'
import { HeaderActions } from '@/components/header-actions'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { SidebarNav } from './components/sidebar-nav'

const sidebarNavItems = [
  {
    titleKey: 'nav.profile',
    href: '/settings',
    icon: <UserCog size={18} />,
  },
  {
    titleKey: 'nav.account',
    href: '/settings/account',
    icon: <Wrench size={18} />,
  },
  {
    titleKey: 'nav.appearance',
    href: '/settings/appearance',
    icon: <Palette size={18} />,
  },
  {
    titleKey: 'nav.notifications',
    href: '/settings/notifications',
    icon: <Bell size={18} />,
  },
  {
    titleKey: 'nav.display',
    href: '/settings/display',
    icon: <Monitor size={18} />,
  },
  {
    titleKey: 'nav.data',
    href: '/settings/data',
    icon: <HardDrive size={18} />,
  },
]

export function Settings() {
  const { t } = useTranslation()

  return (
    <>
      {/* ===== Top Heading ===== */}
      <Header>
        <HeaderActions />
      </Header>

      <Main fixed>
        <div className='space-y-0.5'>
          <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>
            {t('nav.settings')}
          </h1>
          <p className='text-muted-foreground'>{t('settings.description')}</p>
        </div>
        <Separator className='my-4 lg:my-6' />
        <div className='flex flex-1 flex-col space-y-2 overflow-hidden md:space-y-2 lg:flex-row lg:space-y-0 lg:space-x-12'>
          <aside className='top-0 lg:sticky lg:w-1/5'>
            <SidebarNav
              items={sidebarNavItems.map((item) => ({
                href: item.href,
                title: t(item.titleKey),
                icon: item.icon,
              }))}
            />
          </aside>
          <div className='flex w-full overflow-y-hidden p-1'>
            <Outlet />
          </div>
        </div>
      </Main>
    </>
  )
}
