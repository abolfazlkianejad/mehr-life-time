import '@/styles/index.css'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import i18n from '@/i18n/config'
import { StudyGoalProgress } from './study-goal-progress'

const HOUR = 60 * 60
const WEEKLY = 35 * HOUR
const DAILY = 6 * HOUR

function thresholds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-threshold]')).map(
    (node) => node.getAttribute('data-threshold') ?? ''
  )
}

describe('StudyGoalProgress', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(async () => {
    await i18n.changeLanguage('fa')
  })

  it('uses the shared thresholds for study-only daily and weekly seconds', async () => {
    const screen = await render(
      <StudyGoalProgress
        todaySeconds={5 * HOUR}
        weekSeconds={35 * HOUR}
        dailyTarget={DAILY}
        weeklyTarget={WEEKLY}
      />
    )

    expect(thresholds(screen.container)).toEqual(['yellow', 'yellow'])
    await expect
      .element(screen.getByText('Study goal progress'))
      .toBeInTheDocument()
    await expect.element(screen.getByText('Daily study')).toBeInTheDocument()
    await expect.element(screen.getByText('Weekly study')).toBeInTheDocument()
  })

  it('moves both bars to green only above the configured targets', async () => {
    const screen = await render(
      <StudyGoalProgress
        todaySeconds={6 * HOUR + 1}
        weekSeconds={42 * HOUR + 1}
        dailyTarget={DAILY}
        weeklyTarget={WEEKLY}
      />
    )

    expect(thresholds(screen.container)).toEqual(['green', 'green'])
  })

  it('shows a safe empty state when no goal is configured', async () => {
    const screen = await render(
      <StudyGoalProgress todaySeconds={3 * HOUR} weekSeconds={12 * HOUR} />
    )

    expect(thresholds(screen.container)).toEqual([])
    await expect
      .element(
        screen.getByText('Set a goal on the Goals page to see progress.')
      )
      .toBeInTheDocument()
  })
})
