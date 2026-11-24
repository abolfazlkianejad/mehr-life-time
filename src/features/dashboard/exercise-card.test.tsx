import '@/styles/index.css'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { GymSession } from '@/services/gym'
import i18n from '@/i18n/config'
import type { ExerciseActivity } from './exercise-activities'
import { ExerciseCard, type ExerciseAction } from './exercise-card'

const SATURDAY = '2026-01-17'
const NOW = Date.parse('2026-01-17T12:00:00.000Z')

function activity(overrides: Partial<ExerciseActivity> = {}): ExerciseActivity {
  return {
    key: 'gym-plan:0:2026-01-17',
    title: 'Push day',
    dateKey: SATURDAY,
    weekday: 0,
    plannedMinutes: 45,
    exerciseNames: ['Bench press', 'Shoulder press'],
    status: 'planned',
    elapsedSeconds: 0,
    order: 0,
    ...overrides,
  }
}

function runningSession(): GymSession {
  return {
    id: 'gym-session-1',
    dateKey: SATURDAY,
    weekday: 0,
    title: 'Push day',
    status: 'draft',
    startedAt: '2026-01-17T08:00:00.000Z',
    timerStartedAt: '2026-01-17T11:30:00.000Z',
    elapsedSeconds: 600,
    createdAt: '2026-01-17T08:00:00.000Z',
    updatedAt: '2026-01-17T11:30:00.000Z',
  }
}

async function renderCard(
  item: ExerciseActivity,
  onAction: (target: ExerciseActivity, action: ExerciseAction) => void = vi.fn()
) {
  const screen = await render(
    <ul>
      <ExerciseCard
        activity={item}
        now={NOW}
        busy={false}
        startBlocked={false}
        onAction={onAction}
      />
    </ul>
  )
  return { screen, onAction }
}

describe('ExerciseCard', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(async () => {
    await i18n.changeLanguage('fa')
  })

  it('renders a distinct, dated workout card without a Finish action for a plan', async () => {
    const { screen } = await renderCard(activity())

    const item = screen.container.querySelector('li')
    expect(item?.className).toContain('border-s-fuchsia-500')
    await expect
      .element(screen.getByRole('button', { name: 'Start workout' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Finish workout' }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByText('Planned', { exact: true }))
      .toBeInTheDocument()
    await expect.element(screen.getByText('Saturday')).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: 'Workout details' })
    )
    await expect.element(screen.getByText('Bench press')).toBeInTheDocument()
  })

  it('sends pause and finish actions for a real running session', async () => {
    const session = runningSession()
    const onAction = vi.fn()
    const { screen } = await renderCard(
      activity({
        key: `gym-session:${session.id}`,
        session,
        status: 'running',
        elapsedSeconds: 2400,
        plannedMinutes: 45,
      }),
      onAction
    )

    await userEvent.click(screen.getByRole('button', { name: 'Pause workout' }))
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ key: `gym-session:${session.id}` }),
      'pause'
    )

    await userEvent.click(
      screen.getByRole('button', { name: 'Finish workout' })
    )
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ key: `gym-session:${session.id}` }),
      'finish'
    )
  })

  it('hides timer controls and shows actual time for a completed session', async () => {
    const session = {
      ...runningSession(),
      status: 'done' as const,
      actualSeconds: 2700,
    }
    const { screen } = await renderCard(
      activity({
        key: `gym-session:${session.id}`,
        session,
        status: 'done',
        elapsedSeconds: 2700,
      })
    )

    await expect
      .element(screen.getByRole('button', { name: 'Finish workout' }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Pause workout' }))
      .not.toBeInTheDocument()
    await expect.element(screen.getByText('Completed')).toBeInTheDocument()
  })
})
