import { createFileRoute } from '@tanstack/react-router'
import { MorningRoutine } from '@/features/modules'

export const Route = createFileRoute('/_authenticated/morning-routine/')({
  component: MorningRoutine,
})
