import { createFileRoute } from '@tanstack/react-router'
import { NutritionPage } from '@/features/nutrition'

export const Route = createFileRoute('/_authenticated/nutrition/')({
  component: NutritionPage,
})
