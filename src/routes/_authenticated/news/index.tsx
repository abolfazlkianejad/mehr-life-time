import { createFileRoute } from '@tanstack/react-router'
import { NewsRadarPage } from '@/features/news'

export const Route = createFileRoute('/_authenticated/news/')({
  component: NewsRadarPage,
})
