import { beforeEach, describe, expect, it } from 'vitest'
import { toDateKey } from '@/lib/date-key'
import { destroyDatabase, initializeOfflineStorage } from '@/services/db'
import {
  deleteEducationReport,
  deleteEducationTask,
  detachCourseFromEducationTasks,
  educationElapsedSeconds,
  educationSecondsOnDay,
  finishEducationTaskTimer,
  getActiveEducationTask,
  getEducationReports,
  getEducationReportsByTask,
  getEducationTasks,
  pauseEducationTaskTimer,
  saveEducationReport,
  saveEducationTask,
  settleEducationTask,
  splitStudySecondsByDay,
  startEducationTaskTimer,
  updateEducationReport,
  type EducationTaskInput,
} from '@/services/education'
import {
  deleteEducationItem,
  getEducationItems,
  saveEducationItem,
  updateEducationItem,
} from '@/services/learning'

const REFERENCE = new Date(2026, 0, 15, 9, 0, 0)
const T0 = REFERENCE.getTime()
const DAY_ONE = toDateKey(new Date(2026, 0, 15))
const DAY_TWO = toDateKey(new Date(2026, 0, 16))

async function freshDatabase(): Promise<void> {
  await destroyDatabase()
  await initializeOfflineStorage(REFERENCE)
}

function taskInput(
  overrides: Partial<EducationTaskInput> = {}
): EducationTaskInput {
  return {
    track: 'masters',
    title: 'تمرین آمار',
    priority: 'high',
    dateKey: DAY_ONE,
    time: '09:00',
    estimatedMinutes: 60,
    ...overrides,
  }
}

describe('education courses', () => {
  beforeEach(freshDatabase)

  it('stores the path-specific fields of all three education paths', async () => {
    const masters = await saveEducationItem({
      track: 'masters',
      type: 'course',
      title: 'آمار کاربردی',
      status: 'active',
      progress: 20,
      description: 'درس ارشد',
      resources: 'کتاب آمار، جزوه استاد',
    })
    const university = await saveEducationItem({
      track: 'university',
      type: 'course',
      title: 'اقتصاد خرد',
      status: 'planned',
      progress: 0,
      credits: 3,
      professor: 'دکتر رضایی',
      semester: 'نیم‌سال اول ۱۴۰۵',
    })
    const training = await saveEducationItem({
      track: 'course',
      type: 'course',
      title: 'React پیشرفته',
      status: 'active',
      progress: 35,
      instructor: 'علی محمدی',
      platform: 'یوتیوب',
      estimatedHours: 12.5,
      url: 'https://example.com/react',
    })

    expect(masters.resources).toBe('کتاب آمار، جزوه استاد')
    expect(masters.credits).toBeUndefined()
    expect(university.credits).toBe(3)
    expect(university.professor).toBe('دکتر رضایی')
    expect(training.estimatedHours).toBe(12.5)
    expect(training.url).toBe('https://example.com/react')

    const mastersOnly = await getEducationItems('masters')
    expect(mastersOnly.map((item) => item.title)).toEqual(['آمار کاربردی'])
  })

  it('updates and deletes courses without touching the other paths', async () => {
    const masters = await saveEducationItem({
      track: 'masters',
      type: 'course',
      title: 'آمار',
      status: 'active',
      progress: 10,
    })
    const university = await saveEducationItem({
      track: 'university',
      type: 'course',
      title: 'اقتصاد',
      status: 'planned',
      progress: 0,
      credits: 2,
    })

    const updated = await updateEducationItem(masters.id, {
      title: 'آمار پیشرفته',
      resources: 'فصل ۱ و ۲',
    })
    expect(updated.title).toBe('آمار پیشرفته')
    expect(updated.resources).toBe('فصل ۱ و ۲')

    await deleteEducationItem(masters.id)
    const remaining = await getEducationItems()
    expect(remaining.map((item) => item.id)).toEqual([university.id])
  })

  it('rejects invalid credits, URLs and empty titles', async () => {
    await expect(
      saveEducationItem({
        track: 'university',
        type: 'course',
        title: 'درس',
        status: 'planned',
        progress: 0,
        credits: 61,
      })
    ).rejects.toThrow()
    await expect(
      saveEducationItem({
        track: 'course',
        type: 'course',
        title: 'دوره',
        status: 'planned',
        progress: 0,
        url: 'javascript:alert(1)',
      })
    ).rejects.toThrow()
    await expect(
      saveEducationItem({
        track: 'masters',
        type: 'course',
        title: '   ',
        status: 'planned',
        progress: 0,
      })
    ).rejects.toThrow()
  })
})

describe('education tasks', () => {
  beforeEach(freshDatabase)

  it('creates, edits and deletes a task in the shared model', async () => {
    const task = await saveEducationTask(taskInput(), T0)
    expect(task.status).toBe('pending')
    expect(task.actualSeconds).toBe(0)

    const edited = await saveEducationTask(
      {
        ...taskInput({
          title: 'تمرین فصل سوم',
          priority: 'urgent',
          time: '14:30',
        }),
        id: task.id,
      },
      T0
    )
    expect(edited.id).toBe(task.id)
    expect(edited.title).toBe('تمرین فصل سوم')
    expect(edited.priority).toBe('urgent')
    expect(edited.time).toBe('14:30')

    await deleteEducationTask(task.id)
    expect(await getEducationTasks()).toEqual([])
  })

  it('rejects a course that belongs to another education path', async () => {
    const universityCourse = await saveEducationItem({
      track: 'university',
      type: 'course',
      title: 'اقتصاد',
      status: 'active',
      progress: 0,
      credits: 2,
    })
    await expect(
      saveEducationTask(
        taskInput({ track: 'masters', courseId: universityCourse.id }),
        T0
      )
    ).rejects.toThrow()

    const missing = await expect(
      saveEducationTask(taskInput({ courseId: 'does-not-exist' }), T0)
    ).rejects.toThrow()
    void missing
  })

  it('rejects a 12-hour or malformed time and an invalid date', async () => {
    await expect(
      saveEducationTask(taskInput({ time: '9:00' }), T0)
    ).rejects.toThrow()
    await expect(
      saveEducationTask(taskInput({ time: '09:00 PM' }), T0)
    ).rejects.toThrow()
    await expect(
      saveEducationTask(taskInput({ dateKey: '1405/01/01' }), T0)
    ).rejects.toThrow()
    await expect(
      saveEducationTask(taskInput({ estimatedMinutes: 0 }), T0)
    ).rejects.toThrow()
  })
})

describe('education timer', () => {
  beforeEach(freshDatabase)

  it('runs start, pause, resume and finish using real timestamps', async () => {
    const task = await saveEducationTask(taskInput(), T0)

    const started = await startEducationTaskTimer(task.id, T0)
    expect(started.status).toBe('in_progress')
    expect(started.timerStartedAt).toBe(new Date(T0).toISOString())

    const paused = await pauseEducationTaskTimer(task.id, T0 + 90_000)
    expect(paused.status).toBe('paused')
    expect(paused.timerStartedAt).toBeUndefined()
    expect(paused.actualSeconds).toBe(90)

    const resumed = await startEducationTaskTimer(task.id, T0 + 180_000)
    expect(resumed.timerStartedAt).toBe(new Date(T0 + 180_000).toISOString())

    const finished = await finishEducationTaskTimer(task.id, T0 + 240_000)
    expect(finished.status).toBe('completed')
    expect(finished.completedAt).toBeDefined()
    expect(finished.actualSeconds).toBe(150)
    expect(finished.dailySeconds?.[DAY_ONE]).toBe(150)
  })

  it('pauses the previous task when another task starts and keeps only one timer', async () => {
    const first = await saveEducationTask(taskInput({ title: 'تسک اول' }), T0)
    const second = await saveEducationTask(taskInput({ title: 'تسک دوم' }), T0)

    await startEducationTaskTimer(first.id, T0)
    await startEducationTaskTimer(second.id, T0 + 60_000)

    const tasks = await getEducationTasks()
    const active = tasks.filter((task) => task.timerStartedAt)
    expect(active).toHaveLength(1)
    expect(active[0].id).toBe(second.id)

    const settledFirst = tasks.find((task) => task.id === first.id)
    expect(settledFirst?.status).toBe('paused')
    expect(settledFirst?.actualSeconds).toBe(60)
    expect((await getActiveEducationTask())?.id).toBe(second.id)

    // The paused task can be resumed later without losing its settled time.
    await startEducationTaskTimer(first.id, T0 + 120_000)
    const resumed = await pauseEducationTaskTimer(first.id, T0 + 150_000)
    expect(resumed.actualSeconds).toBe(90)
  })

  it('serialises simultaneous starts so exactly one timer survives', async () => {
    const first = await saveEducationTask(taskInput({ title: 'اول' }), T0)
    const second = await saveEducationTask(taskInput({ title: 'دوم' }), T0)

    await Promise.all([
      startEducationTaskTimer(first.id, T0 + 1_000),
      startEducationTaskTimer(second.id, T0 + 1_000),
    ])

    const active = (await getEducationTasks()).filter(
      (task) => task.timerStartedAt
    )
    expect(active).toHaveLength(1)
    expect(await getActiveEducationTask()).toBeDefined()
  })

  it('restores the running timer and elapsed time after a reload', async () => {
    const task = await saveEducationTask(taskInput(), T0)
    await startEducationTaskTimer(task.id, T0)

    // A reload only reads persisted records again.
    const reloaded = (await getEducationTasks())[0]
    expect(reloaded.timerStartedAt).toBe(new Date(T0).toISOString())
    expect(educationElapsedSeconds(reloaded, T0 + 125_000)).toBe(125)

    const paused = await pauseEducationTaskTimer(task.id, T0 + 125_000)
    expect(paused.actualSeconds).toBe(125)
  })

  it('never counts overlapping intervals twice', async () => {
    const task = await saveEducationTask(taskInput(), T0)
    await startEducationTaskTimer(task.id, T0)
    await startEducationTaskTimer(task.id, T0 + 40_000)

    // Re-starting the same task keeps its original interval start instead of
    // opening a second interval.
    const running = (await getEducationTasks())[0]
    expect(running.timerStartedAt).toBe(new Date(T0).toISOString())

    const paused = await pauseEducationTaskTimer(task.id, T0 + 100_000)
    expect(paused.actualSeconds).toBe(100)
  })

  it('splits a cross-midnight interval over both local days', () => {
    const start = new Date(2026, 0, 15, 23, 0, 0)
    const end = new Date(2026, 0, 16, 0, 30, 0).getTime()
    const split = splitStudySecondsByDay(start.toISOString(), end)

    expect(split[DAY_ONE]).toBe(3600)
    expect(split[DAY_TWO]).toBe(1800)
    expect(split[DAY_ONE] + split[DAY_TWO]).toBe(5400)
  })

  it('settles a cross-midnight interval into daily buckets', () => {
    const start = new Date(2026, 0, 15, 23, 0, 0)
    const task = {
      actualSeconds: 0,
      dailySeconds: { [DAY_ONE]: 600 },
      timerStartedAt: start.toISOString(),
      status: 'in_progress' as const,
    }
    const settled = settleEducationTask(
      task,
      new Date(2026, 0, 16, 0, 30, 0).getTime()
    )

    expect(settled.actualSeconds).toBe(5400)
    expect(settled.dailySeconds?.[DAY_ONE]).toBe(4200)
    expect(settled.dailySeconds?.[DAY_TWO]).toBe(1800)
    expect(educationSecondsOnDay(settled, DAY_ONE)).toBe(4200)
    expect(settled.timerStartedAt).toBeUndefined()
    expect(settled.status).toBe('paused')
  })

  it('refuses to start a completed task', async () => {
    const task = await saveEducationTask(taskInput({ status: 'completed' }), T0)
    await expect(startEducationTaskTimer(task.id, T0)).rejects.toThrow()
  })
})

describe('education progress reports', () => {
  beforeEach(freshDatabase)

  async function seededTask(courseId?: string) {
    return saveEducationTask(
      taskInput({ track: courseId ? 'university' : 'masters', courseId }),
      T0
    )
  }

  it('keeps multiple reports per task with timestamps and duration', async () => {
    const task = await seededTask()
    await startEducationTaskTimer(task.id, T0)
    await pauseEducationTaskTimer(task.id, T0 + 600_000)

    const first = await saveEducationReport(
      {
        taskId: task.id,
        summary: 'فصل اول تمام شد',
        topics: 'توزیع نرمال',
        exercises: '۱۲ تمرین',
        problems: 'تمرین ۴ سخت بود',
        resumePoint: 'از تمرین ۵',
      },
      T0 + 720_000
    )
    const second = await saveEducationReport(
      { taskId: task.id, summary: 'مرور تمرین‌ها' },
      T0 + 900_000
    )

    expect(first.durationSeconds).toBe(600)
    expect(first.taskTitle).toBe(task.title)
    expect(first.taskStatus).toBe('paused')
    expect(first.dateKey).toBe(DAY_ONE)
    expect(second.id).not.toBe(first.id)

    const history = await getEducationReportsByTask(task.id)
    expect(history).toHaveLength(2)
    expect(history.map((report) => report.id).sort()).toEqual(
      [first.id, second.id].sort()
    )
  })

  it('edits one report without changing the others or the snapshot', async () => {
    const task = await seededTask()
    const first = await saveEducationReport(
      { taskId: task.id, summary: 'اول' },
      T0
    )
    const second = await saveEducationReport(
      { taskId: task.id, summary: 'دوم' },
      T0 + 60_000
    )

    const edited = await updateEducationReport(
      first.id,
      { summary: 'اول اصلاح شد', topics: 'مباحث جدید', problems: '' },
      T0 + 120_000
    )

    expect(edited.summary).toBe('اول اصلاح شد')
    expect(edited.topics).toBe('مباحث جدید')
    expect(edited.createdAt).toBe(first.createdAt)
    expect(edited.durationSeconds).toBe(first.durationSeconds)
    expect(edited.taskTitle).toBe(first.taskTitle)

    const untouched = (await getEducationReports()).find(
      (report) => report.id === second.id
    )
    expect(untouched?.summary).toBe('دوم')

    await deleteEducationReport(second.id)
    expect(await getEducationReports()).toHaveLength(1)
  })

  it('snapshots the course title for filters', async () => {
    const course = await saveEducationItem({
      track: 'university',
      type: 'course',
      title: 'اقتصاد خرد',
      status: 'active',
      progress: 0,
      credits: 3,
    })
    const task = await seededTask(course.id)
    const report = await saveEducationReport(
      { taskId: task.id, summary: 'کلاس اول' },
      T0
    )

    expect(report.courseId).toBe(course.id)
    expect(report.courseTitle).toBe('اقتصاد خرد')

    // Removing the course detaches tasks but keeps report history intact.
    await detachCourseFromEducationTasks(course.id)
    const [detachedTask] = await getEducationTasks()
    expect(detachedTask.courseId).toBeUndefined()
    expect((await getEducationReports())[0].courseTitle).toBe('اقتصاد خرد')
  })

  it('deletes the reports together with their task', async () => {
    const task = await seededTask()
    const other = await saveEducationTask(taskInput({ title: 'دیگر' }), T0)
    await saveEducationReport({ taskId: task.id, summary: 'اول' }, T0)
    await saveEducationReport({ taskId: task.id, summary: 'دوم' }, T0 + 1_000)
    await saveEducationReport({ taskId: other.id, summary: 'سایر' }, T0 + 2_000)

    await deleteEducationTask(task.id)

    expect(await getEducationTasks()).toHaveLength(1)
    const reports = await getEducationReports()
    expect(reports).toHaveLength(1)
    expect(reports[0].taskId).toBe(other.id)
  })

  it('requires a non-empty report text', async () => {
    const task = await seededTask()
    await expect(
      saveEducationReport({ taskId: task.id, summary: '   ' }, T0)
    ).rejects.toThrow()
    await expect(
      saveEducationReport({ taskId: 'missing-task', summary: 'متن' }, T0)
    ).rejects.toThrow()
  })
})
