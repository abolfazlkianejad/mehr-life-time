import {
  LayoutDashboard,
  CalendarClock,
  Sunrise,
  GraduationCap,
  Dumbbell,
  BatteryCharging,
  ListTodo,
  Bell,
  Palette,
  Settings,
  Wrench,
  UserCog,
  Monitor,
  Wallet,
  Share2,
  ClipboardCheck,
  Newspaper,
  FolderGit2,
  Utensils,
  HardDrive,
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
          title: 'nav.tasks',
          url: '/tasks',
          icon: ListTodo,
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
          title: 'nav.social',
          url: '/social',
          icon: Share2,
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
          title: 'nav.timeline',
          url: '/timeline',
          icon: CalendarClock,
        },
        {
          title: 'nav.goldenHour',
          url: '/golden-hour',
          icon: Sunrise,
        },
        {
          title: 'nav.energy',
          url: '/energy',
          icon: BatteryCharging,
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
