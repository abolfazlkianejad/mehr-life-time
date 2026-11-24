import '@/styles/index.css'
import type { TimelineBlockRecord } from '@/types/timeline'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import i18n from '@/i18n/config'
import { WorkTasksPanel } from './work-tasks-page'

const { mocks } = vi.hoisted(() => {
  const task: TimelineBlockRecord = {
    id: 'work-1',
    title: 'Prepare weekly report',
    category: 'work',
    startTime: new Date(2026, 0, 15, 9, 0).toISOString(),
    endTime: new Date(2026, 0, 15, 10, 0).toISOString(),
    durationMinutes: 60,
    energyLevelRequired: 3,
    status: 'planned',
    isConflictFree: true,
    dateKey: '2026-01-15',
    notes: 'Send the first draft to the project manager.',
    createdAt: '2026-01-15T08:00:00.000Z',
    updatedAt: '2026-01-15T08:00:00.000Z',
  }
  const noop = vi.fn(async () => undefined)
  const empty = vi.fn(async () => [])
  return {
    mocks: {
      task,
      getWorkTasksByDate: vi.fn(async () => [task]),
      getAllWorkTasks: vi.fn(async () => [task]),
      getLegacyTasks: empty,
      runStartupRollover: empty,
      autoRolloverStaleWorkTasks: empty,
      getProjects: empty,
      getAlarms: empty,
      cancelTaskAlarm: noop,
      saveAlarm: noop,
      notifyAlarmsChanged: vi.fn(),
      completeWorkTask: noop,
      deleteWorkTask: noop,
      getTimelineBlocksByRange: empty,
      getWorkSessionsByRange: empty,
      pauseWorkTaskTimer: noop,
      rolloverWorkTask: noop,
      saveWorkTask: noop,
      startWorkTaskTimer: noop,
      stopWorkTaskTimer: noop,
      updateWorkTask: noop,
    },
  }
})

vi.mock('@/services/db', () => ({
  autoRolloverStaleWorkTasks: mocks.autoRolloverStaleWorkTasks,
  completeWorkTask: mocks.completeWorkTask,
  deleteWorkTask: mocks.deleteWorkTask,
  getAllWorkTasks: mocks.getAllWorkTasks,
  getLegacyTasks: mocks.getLegacyTasks,
  getTimelineBlocksByRange: mocks.getTimelineBlocksByRange,
  getWorkSessionsByRange: mocks.getWorkSessionsByRange,
  getWorkTasksByDate: mocks.getWorkTasksByDate,
  pauseWorkTaskTimer: mocks.pauseWorkTaskTimer,
  rolloverWorkTask: mocks.rolloverWorkTask,
  runStartupRollover: mocks.runStartupRollover,
  saveWorkTask: mocks.saveWorkTask,
  startWorkTaskTimer: mocks.startWorkTaskTimer,
  stopWorkTaskTimer: mocks.stopWorkTaskTimer,
  updateWorkTask: mocks.updateWorkTask,
}))

vi.mock('@/services/alarms', () => ({
  ALARMS_CHANGED_EVENT: 'alarms-changed',
  cancelTaskAlarm: mocks.cancelTaskAlarm,
  getAlarms: mocks.getAlarms,
  saveAlarm: mocks.saveAlarm,
  notifyAlarmsChanged: mocks.notifyAlarmsChanged,
}))

vi.mock('@/services/projects', () => ({ getProjects: mocks.getProjects }))

async function renderPanel() {
  return await render(<WorkTasksPanel embedded />)
}

describe('WorkTasksPanel description', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    mocks.getWorkTasksByDate.mockResolvedValue([mocks.task])
    mocks.getAllWorkTasks.mockResolvedValue([mocks.task])
  })

  afterEach(async () => {
    await i18n.changeLanguage('fa')
  })

  it('hides saved notes until the compact row is clicked', async () => {
    const screen = await renderPanel()
    const description = mocks.task.notes!

    const toggle = screen.getByRole('button', { name: 'Task description' })
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect.element(screen.getByText(description)).not.toBeInTheDocument()

    await userEvent.click(toggle)

    const body = screen.getByText(description)
    await expect.element(body).toBeInTheDocument()
    expect(body.element().getAttribute('dir')).toBe('auto')
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(toggle)
    await expect.element(screen.getByText(description)).not.toBeInTheDocument()
  })

  it('does not render an expandable row for whitespace-only notes', async () => {
    mocks.getWorkTasksByDate.mockResolvedValue([
      { ...mocks.task, notes: '   ' },
    ])
    const screen = await renderPanel()

    await expect
      .element(screen.getByRole('button', { name: 'Task description' }))
      .not.toBeInTheDocument()
  })

  it('renders Markdown safely inside opened notes', async () => {
    const notes =
      '# Handoff\n\n- **Send** draft\n- Run `npm test`\n\nAsk for review.'
    mocks.getWorkTasksByDate.mockResolvedValue([{ ...mocks.task, notes }])
    const screen = await renderPanel()

    await userEvent.click(
      screen.getByRole('button', { name: 'Task description' })
    )

    expect(
      screen.getByRole('heading', { name: 'Handoff' }).element().tagName
    ).toBe('H1')
    expect(
      screen.container.querySelectorAll('[data-slot="collapsible-content"] li')
    ).toHaveLength(2)
    expect(screen.getByText('Send').element().parentElement?.tagName).toBe(
      'STRONG'
    )
    expect(screen.getByText('npm test').element().tagName).toBe('CODE')
    expect(screen.container.querySelector('img')).toBeNull()
  })

  it('opens only one task, resets after remount and never writes saved notes', async () => {
    const first = { ...mocks.task, id: 'work-1', notes: 'First saved note.' }
    const second = {
      ...mocks.task,
      id: 'work-2',
      title: 'Second task',
      notes: 'Second saved note.',
    }
    const snapshot = JSON.stringify([first, second])
    mocks.getWorkTasksByDate.mockResolvedValue([first, second])
    mocks.getAllWorkTasks.mockResolvedValue([first, second])
    mocks.saveWorkTask.mockClear()
    mocks.updateWorkTask.mockClear()

    const screen = await renderPanel()
    const toggle = (index: number) =>
      screen.getByRole('button', { name: 'Task description' }).nth(index)
    for (const index of [0, 1]) {
      await expect
        .element(toggle(index))
        .toHaveAttribute('aria-expanded', 'false')
    }

    await userEvent.click(toggle(0))

    await expect.element(toggle(0)).toHaveAttribute('aria-expanded', 'true')
    await expect.element(toggle(1)).toHaveAttribute('aria-expanded', 'false')
    await expect.element(screen.getByText(first.notes!)).toBeInTheDocument()
    await expect
      .element(screen.getByText(second.notes!))
      .not.toBeInTheDocument()

    await screen.unmount()
    const reloaded = await renderPanel()
    for (const index of [0, 1]) {
      await expect
        .element(
          reloaded.getByRole('button', { name: 'Task description' }).nth(index)
        )
        .toHaveAttribute('aria-expanded', 'false')
    }

    expect(JSON.stringify([first, second])).toBe(snapshot)
    expect(mocks.saveWorkTask).not.toHaveBeenCalled()
    expect(mocks.updateWorkTask).not.toHaveBeenCalled()
  })
})
