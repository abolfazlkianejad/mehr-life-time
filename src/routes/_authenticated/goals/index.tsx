import { createFileRoute } from '@tanstack/react-router'
import { GoalsPage } from '@/features/goals'

export const Route = createFileRoute('/_authenticated/goals/')({
  component: GoalsPage,
})
