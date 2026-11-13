import { createFileRoute } from '@tanstack/react-router'
import { DataSettingsPage } from '@/features/settings/data'

export const Route = createFileRoute('/_authenticated/settings/data')({
  component: DataSettingsPage,
})
