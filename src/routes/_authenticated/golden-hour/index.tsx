import { createFileRoute } from '@tanstack/react-router'
import { GoldenHour } from '@/features/modules'

export const Route = createFileRoute('/_authenticated/golden-hour/')({
  component: GoldenHour,
})
