import type { TimelineBlockRecord } from '@/types/timeline'
import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  summarizeTaskReport,
  taskElapsedSeconds,
} from '@/features/tasks/work-task-utils'

const task = (
  id: string,
  isCompanyWork: boolean,
  elapsedSeconds: number
): TimelineBlockRecord => ({
  id,
  title: id,
  category: isCompanyWork ? 'work' : 'freelance',
  startTime: '2026-10-31T09:00:00.000Z',
  endTime: '2026-10-31T10:00:00.000Z',
  durationMinutes: 60,
  energyLevelRequired: 3,
  status: 'paused',
  isConflictFree: true,
  createdAt: '',
  updatedAt: '',
  dateKey: '2026-10-31',
  isCompanyWork,
  elapsedSeconds,
})

describe('work task timing and reports', () => {
  it('retains accumulated seconds and includes live elapsed seconds', () => {
    expect(
      taskElapsedSeconds(
        { elapsedSeconds: 120, timerStartedAt: '2026-10-31T10:00:00.000Z' },
        Date.parse('2026-10-31T10:01:05.000Z')
      )
    ).toBe(185)
    expect(formatDuration(3665)).toBe('01:01:05')
  })
  it('filters company work or includes every task for a compact report', () => {
    const rows = [task('company', true, 3600), task('freelance', false, 1800)]
    expect(summarizeTaskReport(rows, 'company').seconds).toBe(3600)
    expect(summarizeTaskReport(rows, 'all').seconds).toBe(5400)
  })
})
