/**
 * Pure helpers for the project module.
 *
 * Project progress is derived from the linked tasks, so the numbers always
 * match the task list instead of a manually maintained counter.
 */

export interface ProjectTaskLike {
  status: string
}

export interface ProjectProgress {
  total: number
  done: number
  remaining: number
  /** Progress in percent (0–100). */
  percent: number
}

/** Counts finished and remaining tasks of a project. */
export function projectProgress(tasks: ProjectTaskLike[]): ProjectProgress {
  const done = tasks.filter(
    (task) => task.status === 'completed' || task.status === 'skipped'
  ).length
  const total = tasks.length
  return {
    total,
    done,
    remaining: total - done,
    percent: total ? Math.round((done / total) * 100) : 0,
  }
}

/** Label of a project status for badges and filters. */
export function isProjectFinished(status: string): boolean {
  return status === 'completed' || status === 'archived'
}
