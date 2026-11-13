import { createFileRoute } from '@tanstack/react-router'
import { SocialPage } from '@/features/social'

export const Route = createFileRoute('/_authenticated/social/')({
  component: SocialPage,
})
