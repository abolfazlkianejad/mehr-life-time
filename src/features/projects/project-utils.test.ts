import { describe, expect, it } from 'vitest'
import {
  isProjectFinished,
  projectProgress,
} from '@/features/projects/project-utils'

describe('project progress', () => {
  it('counts only completed tasks and updates when a task is reopened', () => {
    const tasks = [
      { id: 'a', status: 'completed' },
      { id: 'b', status: 'planned' },
      { id: 'c', status: 'in_progress' },
      { id: 'd', status: 'skipped' },
    ]
    const before = projectProgress(tasks)
    expect(before).toEqual({ total: 4, done: 1, remaining: 3, percent: 25 })

    const reopened = tasks.map((task) =>
      task.id === 'a' ? { ...task, status: 'planned' } : task
    )
    expect(projectProgress(reopened)).toEqual({
      total: 4,
      done: 0,
      remaining: 4,
      percent: 0,
    })

    const finished = tasks.map((task) => ({ ...task, status: 'completed' }))
    expect(projectProgress(finished)).toEqual({
      total: 4,
      done: 4,
      remaining: 0,
      percent: 100,
    })
  })

  it('returns 0% instead of dividing by zero for a project without tasks', () => {
    expect(projectProgress([])).toEqual({
      total: 0,
      done: 0,
      remaining: 0,
      percent: 0,
    })
  })

  it('treats completed and archived projects as finished', () => {
    expect(isProjectFinished('completed')).toBe(true)
    expect(isProjectFinished('archived')).toBe(true)
    expect(isProjectFinished('active')).toBe(false)
  })
})
