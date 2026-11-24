import type { TimelineBlockRecord } from '@/types/timeline'
import type { WorkSessionRecord } from '@/types/work'
import { calculateWorkTime, timelineBlockSeconds } from '@/lib/work-time'

export { calculateWorkTime, timelineBlockSeconds }

export function taskElapsedSeconds(
  task: Pick<TimelineBlockRecord, 'elapsedSeconds' | 'timerStartedAt'>,
  now = Date.now()
): number {
  return timelineBlockSeconds(task, now)
}

export function formatDuration(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds)
    ? Math.max(0, Math.floor(seconds))
    : 0
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const remainder = safeSeconds % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

export function summarizeTaskReport(
  tasks: TimelineBlockRecord[],
  mode: 'company' | 'all',
  now = Date.now(),
  sessions: WorkSessionRecord[] = []
) {
  const summary = calculateWorkTime(tasks, sessions, mode, now)
  return {
    tasks: tasks.filter(
      (task) => mode === 'all' || task.isCompanyWork !== false
    ),
    sessions: summary.sessions,
    seconds: summary.seconds,
  }
}
