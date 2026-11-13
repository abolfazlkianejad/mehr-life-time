import { createFileRoute } from '@tanstack/react-router'
import { Gym } from '@/features/modules'

export const Route = createFileRoute('/_authenticated/gym/')({
  component: Gym,
})
