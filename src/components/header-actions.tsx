import { cn } from '@/lib/utils'
import { ConfigDrawer } from '@/components/config-drawer'
import { LanguageToggle } from '@/components/language-toggle'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'

type HeaderActionsProps = {
  className?: string
  /** Hide the search trigger on pages that provide their own search UI. */
  search?: boolean
  /** Optional extra controls rendered before the shared actions. */
  children?: React.ReactNode
}

/**
 * The shared top-bar action cluster: search, language switch, theme switch,
 * config drawer and profile menu. Used by every authenticated page header so
 * the controls stay in a consistent order in both LTR and RTL.
 */
export function HeaderActions({
  className,
  search = true,
  children,
}: HeaderActionsProps) {
  return (
    <div className={cn('ms-auto flex items-center gap-2 sm:gap-4', className)}>
      {search && <Search />}
      {children}
      <LanguageToggle />
      <ThemeSwitch />
      <ConfigDrawer />
      <ProfileDropdown />
    </div>
  )
}
