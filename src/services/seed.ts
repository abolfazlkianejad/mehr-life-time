import { addDays, setHours, setMinutes, startOfDay } from 'date-fns'
import {
  type EnergyLogRecord,
  type TimelineBlockRecord,
  type TimelineCategory,
  type EnergyScore,
  type TimelineBlockStatus,
} from '@/types/timeline'
import { type WorkSessionRecord } from '@/types/work'
import { toDateKey, toIsoString } from '@/lib/date-key'
import { createId } from '@/lib/id'

export interface SeedBundle {
  timelineBlocks: TimelineBlockRecord[]
  workSessions: WorkSessionRecord[]
  energyLogs: EnergyLogRecord[]
}

interface SeedBlockSpec {
  title: string
  category: TimelineCategory
  start: [number, number]
  end: [number, number]
  energyLevelRequired: EnergyScore
  status: TimelineBlockStatus
  notes?: string
}

interface SeedSessionSpec {
  clientName: string
  taskType: string
  durationHours: number
  isCompanyWork: boolean
  notes?: string
}

/** A realistic full day so a first-run dashboard is never empty. */
const DAY_BLOCKS: SeedBlockSpec[] = [
  {
    title: 'خواب شبانه',
    category: 'sleep',
    start: [0, 0],
    end: [6, 30],
    energyLevelRequired: 1,
    status: 'completed',
  },
  {
    title: 'صبحانه و آماده‌سازی روز',
    category: 'nutrition',
    start: [6, 45],
    end: [7, 15],
    energyLevelRequired: 1,
    status: 'completed',
  },
  {
    title: 'تمرین بدنسازی - بالاتنه',
    category: 'workout',
    start: [7, 30],
    end: [8, 45],
    energyLevelRequired: 5,
    status: 'completed',
    notes: 'روز سنگین؛ بعد از تمرین حتماً استراحت کوتاه.',
  },
  {
    title: 'کار عمیق: قالب‌های وردپرس',
    category: 'work',
    start: [9, 0],
    end: [11, 30],
    energyLevelRequired: 5,
    status: 'in_progress',
    notes: 'پیاده‌سازی هدر و فوتر جدید کلاینت.',
  },
  {
    title: 'استراحت و ریکاوری',
    category: 'buffer',
    start: [11, 30],
    end: [12, 0],
    energyLevelRequired: 1,
    status: 'planned',
  },
  {
    title: 'ناهار و استراحت کوتاه',
    category: 'nutrition',
    start: [12, 0],
    end: [13, 0],
    energyLevelRequired: 1,
    status: 'planned',
  },
  {
    title: 'مطالعه کنکور ارشد - ریاضی',
    category: 'study',
    start: [13, 0],
    end: [15, 0],
    energyLevelRequired: 4,
    status: 'planned',
    notes: 'فصل مشتق؛ تمرین‌های پایان فصل.',
  },
  {
    title: 'پروژه فریلنس: فروشگاه سردار',
    category: 'freelance',
    start: [15, 30],
    end: [18, 0],
    energyLevelRequired: 4,
    status: 'planned',
    notes: 'افزودن درگاه پرداخت و تست سفارش.',
  },
  {
    title: 'بررسی تسک‌های شرکت',
    category: 'work',
    start: [18, 15],
    end: [19, 15],
    energyLevelRequired: 3,
    status: 'planned',
  },
  {
    title: 'شام',
    category: 'nutrition',
    start: [19, 30],
    end: [20, 15],
    energyLevelRequired: 1,
    status: 'planned',
  },
  {
    title: 'مرور روز و برنامه‌ریزی فردا',
    category: 'buffer',
    start: [20, 30],
    end: [21, 0],
    energyLevelRequired: 2,
    status: 'planned',
  },
  {
    title: 'مطالعه سبک / کتاب',
    category: 'study',
    start: [21, 0],
    end: [22, 30],
    energyLevelRequired: 2,
    status: 'planned',
  },
]

const DAY_SESSIONS: SeedSessionSpec[] = [
  {
    clientName: 'دیجیتال‌مارکتینگ پارس',
    taskType: 'header',
    durationHours: 2.5,
    isCompanyWork: true,
    notes: 'هدر و منوی موبایل سایت اصلی.',
  },
  {
    clientName: 'دیجیتال‌مارکتینگ پارس',
    taskType: 'footer',
    durationHours: 1.5,
    isCompanyWork: true,
  },
  {
    clientName: 'فروشگاه سردار',
    taskType: 'plugin',
    durationHours: 2,
    isCompanyWork: false,
    notes: 'درگاه پرداخت اختصاصی.',
  },
  {
    clientName: 'آکادمی رهنما',
    taskType: 'course',
    durationHours: 1,
    isCompanyWork: false,
    notes: 'طراحی صفحه دوره جدید.',
  },
]

const DAY_ENERGY: Array<{
  hour: number
  minute: number
  score: EnergyScore
  note: string
}> = [
  { hour: 7, minute: 0, score: 4, note: 'بعد از خواب کامل، سرحال.' },
  { hour: 9, minute: 30, score: 5, note: 'اوج تمرکز صبح.' },
  { hour: 13, minute: 30, score: 3, note: 'افت انرژی بعد از ناهار.' },
  { hour: 16, minute: 0, score: 4, note: 'بعد از قهوه دوباره متمرکز.' },
  { hour: 21, minute: 30, score: 2, note: 'خستگی پایان روز.' },
]

function atTime(day: Date, hour: number, minute: number): Date {
  return setMinutes(setHours(startOfDay(day), hour), minute)
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000))
}

/**
 * Builds deterministic seed content anchored to `reference` (defaults to today)
 * so the timeline, work log and energy chart all show meaningful data offline.
 */
export function buildSeedBundle(reference: Date = new Date()): SeedBundle {
  const today = startOfDay(reference)
  const timestamp = toIsoString(reference)
  const dateKey = toDateKey(today)

  const timelineBlocks: TimelineBlockRecord[] = DAY_BLOCKS.map((spec) => {
    const start = atTime(today, spec.start[0], spec.start[1])
    const end = atTime(today, spec.end[0], spec.end[1])
    return {
      id: createId('block'),
      title: spec.title,
      category: spec.category,
      startTime: toIsoString(start),
      endTime: toIsoString(end),
      durationMinutes: minutesBetween(start, end),
      energyLevelRequired: spec.energyLevelRequired,
      status: spec.status,
      isConflictFree: true,
      notes: spec.notes,
      createdAt: timestamp,
      updatedAt: timestamp,
      dateKey,
    }
  })

  const workSessions: WorkSessionRecord[] = DAY_SESSIONS.map((spec) => ({
    id: createId('session'),
    clientName: spec.clientName,
    taskType: spec.taskType,
    durationHours: spec.durationHours,
    date: timestamp,
    isCompanyWork: spec.isCompanyWork,
    notes: spec.notes,
    createdAt: timestamp,
    updatedAt: timestamp,
    dateKey,
    kind: spec.isCompanyWork ? 'company' : 'freelance',
  }))

  const energyLogs: EnergyLogRecord[] = [
    ...DAY_ENERGY.map((entry) => ({
      id: createId('energy'),
      timestamp: toIsoString(atTime(today, entry.hour, entry.minute)),
      score: entry.score,
      note: entry.note,
      createdAt: timestamp,
      updatedAt: timestamp,
      dateKey,
    })),
    // A short previous-day history makes the energy trend chart non-flat.
    ...([2, 1] as const).flatMap((daysAgo) => {
      const day = addDays(today, -daysAgo)
      return [
        {
          id: createId('energy'),
          timestamp: toIsoString(atTime(day, 9, 0)),
          score: (daysAgo === 1 ? 3 : 2) as EnergyScore,
          note:
            daysAgo === 1
              ? 'شروع روز با انرژی متوسط.'
              : 'خواب کم، انرژی پایین.',
          createdAt: toIsoString(day),
          updatedAt: toIsoString(day),
          dateKey: toDateKey(day),
        },
        {
          id: createId('energy'),
          timestamp: toIsoString(atTime(day, 17, 0)),
          score: (daysAgo === 1 ? 4 : 3) as EnergyScore,
          note: 'بهبود انرژی در بعدازظهر.',
          createdAt: toIsoString(day),
          updatedAt: toIsoString(day),
          dateKey: toDateKey(day),
        },
      ]
    }),
  ]

  return { timelineBlocks, workSessions, energyLogs }
}
