import '@/styles/index.css'
import type { TimelineBlockRecord } from '@/types/timeline'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { EducationTask } from '@/services/education'
import i18n from '@/i18n/config'
import { TasksOverview } from './tasks-overview'

const DATE_KEY = '2026-01-15'
const NOW = Date.parse('2026-01-15T09:00:00.000Z')

function educationTask(description: string, id = 'edu-1'): EducationTask {
  return {
    id,
    track: 'masters',
    title: id === 'edu-1' ? 'Study chapter four' : `Study task ${id}`,
    description,
    priority: 'medium',
    dateKey: DATE_KEY,
    time: '09:00',
    estimatedMinutes: 60,
    status: 'pending',
    actualSeconds: 0,
    createdAt: '2026-01-15T08:00:00.000Z',
    updatedAt: '2026-01-15T08:00:00.000Z',
  }
}

function workTask(notes: string, id = 'work-1'): TimelineBlockRecord {
  return {
    id,
    title: id === 'work-1' ? 'Prepare weekly report' : `Work task ${id}`,
    category: 'work',
    startTime: new Date(2026, 0, 15, 9, 0).toISOString(),
    endTime: new Date(2026, 0, 15, 10, 0).toISOString(),
    durationMinutes: 60,
    energyLevelRequired: 3,
    status: 'planned',
    isConflictFree: true,
    dateKey: DATE_KEY,
    notes,
    createdAt: '2026-01-15T08:00:00.000Z',
    updatedAt: '2026-01-15T08:00:00.000Z',
  }
}

function renderOverview(
  tasks: Partial<Parameters<typeof TasksOverview>[0]> = {}
) {
  return render(
    <TasksOverview
      workTasks={[]}
      educationTasks={[]}
      educationItems={[]}
      projects={[]}
      exerciseActivities={[]}
      now={NOW}
      loading={false}
      loadError={false}
      dateKey={DATE_KEY}
      onDateChange={vi.fn()}
      onChanged={vi.fn(async () => undefined)}
      {...tasks}
    />
  )
}

async function expectToggle(
  description: string,
  screen: Awaited<ReturnType<typeof render>>
) {
  const toggle = await screen.getByRole('button', {
    name: 'Task description',
  })
  await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect.element(screen.getByText(description)).not.toBeInTheDocument()

  await userEvent.click(toggle)

  const body = screen.getByText(description)
  await expect.element(body).toBeInTheDocument()
  expect(body.element().getAttribute('dir')).toBe('auto')
  await expect.element(toggle).toHaveAttribute('aria-expanded', 'true')

  await userEvent.click(toggle)
  await expect.element(screen.getByText(description)).not.toBeInTheDocument()
}

describe('TasksOverview descriptions', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(async () => {
    await i18n.changeLanguage('fa')
  })

  it('hides and reveals an education description in its own row', async () => {
    const description = 'Read the chapter and solve every practice question.'
    const screen = await renderOverview({
      educationTasks: [educationTask(description)],
    })
    await expectToggle(description, screen)
  })

  it('hides and reveals work-task notes in the same compact row', async () => {
    const notes = 'Send the first draft to the project manager.'
    const screen = await renderOverview({ workTasks: [workTask(notes)] })
    await expectToggle(notes, screen)
  })

  it('does not render a row without a saved description', async () => {
    const empty = await renderOverview({
      workTasks: [workTask('   ')],
      educationTasks: [educationTask('')],
    })
    await expect
      .element(empty.getByRole('button', { name: 'Task description' }))
      .not.toBeInTheDocument()
  })

  it('renders Markdown safely inside an opened description', async () => {
    const description =
      '# Weekly plan\n\n## Focus\n\n- **Draft** report\n- Run `npm test`\n\nKeep the original text unchanged.'
    const screen = await renderOverview({
      educationTasks: [educationTask(description)],
    })

    await userEvent.click(
      screen.getByRole('button', { name: 'Task description' })
    )

    expect(
      screen.getByRole('heading', { name: 'Weekly plan' }).element().tagName
    ).toBe('H1')
    expect(
      screen.getByRole('heading', { name: 'Focus' }).element().tagName
    ).toBe('H2')
    expect(
      screen.container.querySelectorAll('[data-slot="collapsible-content"] li')
    ).toHaveLength(2)
    expect(screen.getByText('Draft').element().parentElement?.tagName).toBe(
      'STRONG'
    )
    expect(screen.getByText('npm test').element().tagName).toBe('CODE')
    expect(screen.container.querySelector('img')).toBeNull()
  })

  it('opens one description at a time, resets after remount and leaves stored tasks untouched', async () => {
    const firstDescription = '# First\n\nSaved first description.'
    const secondDescription = 'Saved second description.'
    const workNotes = 'Saved work notes.'
    const first = educationTask(firstDescription, 'edu-1')
    const second = educationTask(secondDescription, 'edu-2')
    const work = workTask(workNotes, 'work-2')
    const onChanged = vi.fn(async () => undefined)
    const props = {
      educationTasks: [first, second],
      workTasks: [work],
      onChanged,
    }
    const screen = await renderOverview(props)

    const toggle = (index: number) =>
      screen.getByRole('button', { name: 'Task description' }).nth(index)
    for (const index of [0, 1, 2]) {
      await expect
        .element(toggle(index))
        .toHaveAttribute('aria-expanded', 'false')
    }

    await userEvent.click(toggle(0))

    await expect.element(toggle(0)).toHaveAttribute('aria-expanded', 'true')
    await expect.element(toggle(1)).toHaveAttribute('aria-expanded', 'false')
    await expect.element(toggle(2)).toHaveAttribute('aria-expanded', 'false')
    await expect
      .element(screen.getByText('Saved first description.'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText(secondDescription))
      .not.toBeInTheDocument()
    await expect.element(screen.getByText(workNotes)).not.toBeInTheDocument()

    await screen.unmount()
    const reloaded = await renderOverview(props)
    for (const index of [0, 1, 2]) {
      await expect
        .element(
          reloaded.getByRole('button', { name: 'Task description' }).nth(index)
        )
        .toHaveAttribute('aria-expanded', 'false')
    }

    expect(first).toEqual(educationTask(firstDescription, 'edu-1'))
    expect(second).toEqual(educationTask(secondDescription, 'edu-2'))
    expect(work).toEqual(workTask(workNotes, 'work-2'))
    expect(onChanged).not.toHaveBeenCalled()
  })
})
