import { describe, expect, it } from 'vitest'
import type { TimelineBlockRecord } from '@/types/timeline'
import type { WorkSessionRecord } from '@/types/work'
import { calculateWorkTime, settleTimelineBlockSeconds, timelineBlockSeconds } from './work-time'

const NOW = Date.parse('2026-10-31T10:00:00.000Z')

function block(id: string, company = true, elapsedSeconds = 120, timerStartedAt?: string): TimelineBlockRecord {
  return {
    id, title: id, category: 'work', startTime: '2026-10-31T09:00:00.000Z', endTime: '2026-10-31T10:00:00.000Z',
    durationMinutes: 60, energyLevelRequired: 3, status: timerStartedAt ? 'in_progress' : 'paused', isConflictFree: true,
    createdAt: '', updatedAt: '', dateKey: '2026-10-31', elapsedSeconds, timerStartedAt, isCompanyWork: company,
  }
}

function session(id: string, durationHours: number, extra: Partial<WorkSessionRecord> = {}): WorkSessionRecord {
  return {
    id, clientName: 'client', taskType: 'other', durationHours, date: '2026-10-31T09:00:00.000Z',
    isCompanyWork: true, createdAt: '', updatedAt: '', dateKey: '2026-10-31', kind: 'company', ...extra,
  }
}

describe('work time aggregation', () => {
  it('counts only a TimelineBlock once', () => {
    expect(calculateWorkTime([block('a')], [], 'all', NOW).seconds).toBe(120)
  })

  it('counts an independent WorkSession', () => {
    expect(calculateWorkTime([], [session('s', 1.5)], 'all', NOW).seconds).toBe(5400)
  })

  it('does not count a WorkSession linked to a TimelineBlock twice', () => {
    const result = calculateWorkTime([block('a')], [session('s', 1, { timelineBlockId: 'a' })], 'all', NOW)
    expect(result.seconds).toBe(120)
    expect(result.independentSessionSeconds).toBe(0)
  })

  it('counts a linked timer interval when its task was rolled outside the report range', () => {
    const linked = session('interval', 0.5, { timelineBlockId: 'rolled-task' })
    const result = calculateWorkTime([], [linked], 'all', NOW)
    expect(result.seconds).toBe(1800)
    expect(result.sessions).toEqual([linked])
  })

  it('adds independent sessions beside TimelineBlocks', () => {
    expect(calculateWorkTime([block('a')], [session('s', 1)], 'all', NOW).seconds).toBe(3720)
  })

  it('counts the active timer through the supplied current time', () => {
    const active = block('a', true, 120, '2026-10-31T09:59:15.000Z')
    expect(timelineBlockSeconds(active, NOW)).toBe(165)
  })

  it('keeps old unlinked WorkSessions as independent time', () => {
    const old = session('legacy', 2)
    expect(calculateWorkTime([block('a')], [old], 'all', NOW).seconds).toBe(7320)
  })

  it('filters company work while retaining freelance work in all mode', () => {
    const rows = [block('company', true, 120), block('freelance', false, 300)]
    const sessions = [session('company-session', 0.5), session('free-session', 1, { isCompanyWork: false, kind: 'freelance' })]
    expect(calculateWorkTime(rows, sessions, 'company', NOW).seconds).toBe(1920)
    expect(calculateWorkTime(rows, sessions, 'all', NOW).seconds).toBe(5820)
  })

  it('settles an active timer before rollover clears its start time', () => {
    const running = block('a', true, 600, '2026-10-31T09:59:15.000Z')
    expect(settleTimelineBlockSeconds(running, NOW)).toBe(645)
  })

  it('clamps invalid or negative time instead of producing NaN', () => {
    expect(timelineBlockSeconds({ elapsedSeconds: -10, timerStartedAt: 'not-a-date' }, NOW)).toBe(0)
    expect(calculateWorkTime([], [session('bad', Number.NaN)], 'all', NOW).seconds).toBe(0)
  })
})
