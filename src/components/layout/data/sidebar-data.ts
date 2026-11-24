import {
  LayoutDashboard,
  Sunrise,
  GraduationCap,
  Dumbbell,
  Palette,
  Settings,
  Wrench,
  UserCog,
  Monitor,
  Wallet,
  ClipboardCheck,
  Newspaper,
  FolderGit2,
  Utensils,
  HardDrive,
  Target,
  TrendingUp,
  Bell,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  teams: [
    {
      name: 'Life OS',
      logo: GraduationCap,
      plan: 'Offline-first',
    },
  ],
  navGroups: [
    {
      title: 'nav.group',
      items: [
        {
          title: 'nav.dashboard',
          url: '/',
          icon: LayoutDashboard,
        },
        {
          title: 'nav.goals',
          url: '/goals',
          icon: Target,
        },
        {
          title: 'nav.analytics',
          url: '/analytics',
          icon: TrendingUp,
        },
        {
          title: 'nav.education',
          url: '/education',
          icon: GraduationCap,
        },
        {
          title: 'nav.projects',
          url: '/projects',
          icon: FolderGit2,
        },
        {
          title: 'nav.nutrition',
          url: '/nutrition',
          icon: Utensils,
        },
        {
          title: 'nav.gym',
          url: '/gym',
          icon: Dumbbell,
        },
        {
          title: 'nav.news',
          url: '/news',
          icon: Newspaper,
        },
        {
          title: 'nav.finance',
          url: '/finance',
          icon: Wallet,
        },
        {
          title: 'nav.review',
          url: '/review',
          icon: ClipboardCheck,
        },
      ],
    },
    {
      title: 'nav.general',
      items: [
        {
          title: 'nav.morningRoutine',
          url: '/morning-routine',
          icon: Sunrise,
        },
      ],
    },
    {
      title: 'nav.other',
      items: [
        {
          title: 'nav.settings',
          icon: Settings,
          items: [
            {
              title: 'nav.profile',
              url: '/settings',
              icon: UserCog,
            },
            {
              title: 'nav.account',
              url: '/settings/account',
              icon: Wrench,
            },
            {
              title: 'nav.appearance',
              url: '/settings/appearance',
              icon: Palette,
            },
            {
              title: 'nav.notifications',
              url: '/settings/notifications',
              icon: Bell,
            },
            {
              title: 'nav.display',
              url: '/settings/display',
              icon: Monitor,
            },
            {
              title: 'nav.data',
              url: '/settings/data',
              icon: HardDrive,
            },
          ],
        },
      ],
    },
  ],
}
