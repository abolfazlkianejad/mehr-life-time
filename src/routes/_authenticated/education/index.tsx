import z from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { LearningPage } from '@/features/learning'

const educationSearchSchema = z.object({
  tab: z
    .enum(['masters', 'university', 'course', 'tasks', 'reports'])
    .optional()
    .catch(undefined),
})

export const Route = createFileRoute('/_authenticated/education/')({
  validateSearch: educationSearchSchema,
  component: LearningPage,
})
