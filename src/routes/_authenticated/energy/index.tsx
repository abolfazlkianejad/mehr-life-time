import { createFileRoute } from '@tanstack/react-router'
import { Energy } from '@/features/modules'

export const Route = createFileRoute('/_authenticated/energy/')({
  component: Energy,
})
