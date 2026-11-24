import { createFileRoute, redirect } from '@tanstack/react-router'

// Tasks are now the second tab of the unified projects page.
export const Route = createFileRoute('/_authenticated/tasks/')({
  beforeLoad: () => {
    throw redirect({ to: '/projects' })
  },
})
