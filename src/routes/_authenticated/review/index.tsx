import { createFileRoute } from '@tanstack/react-router'
import { DayReviewPage } from '@/features/review'

export const Route = createFileRoute('/_authenticated/review/')({ component: DayReviewPage })
