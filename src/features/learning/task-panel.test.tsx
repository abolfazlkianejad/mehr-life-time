import '@/styles/index.css'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { EducationTask } from '@/services/education'
import i18n from '@/i18n/config'
import { TaskCard } from './task-panel'

function taskWithDescription(
  description?: string,
  overrides: Partial<EducationTask> = {}
): EducationTask {
  return {
    id: 'task-1',
    track: 'masters',
    title: 'Study chapter four',
    ...(description !== undefined ? { description } : {}),
    priority: 'medium',
    dateKey: '2026-01-15',
    time: '09:00',
    estimatedMinutes: 60,
    status: 'pending',
    actualSeconds: 0,
    createdAt: '2026-01-15T08:00:00.000Z',
    updatedAt: '2026-01-15T08:00:00.000Z',
    ...overrides,
  }
}

async function renderCard(description?: string) {
  return await render(
    <TaskCard
      task={taskWithDescription(description)}
      reports={[]}
      items={[]}
      now={Date.parse('2026-01-15T09:00:00.000Z')}
      onChanged={vi.fn(async () => undefined)}
      onError={vi.fn()}
      onEdit={vi.fn()}
    />
  )
}

describe('TaskCard description', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(async () => {
    await i18n.changeLanguage('fa')
  })

  it('hides a saved description until its compact row is clicked', async () => {
    const description =
      'Review every formula, then write a one page summary and solve the practice questions.'
    const screen = await renderCard(description)

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

  it('does not render an empty row for missing or whitespace descriptions', async () => {
    for (const description of [undefined, '', '   ']) {
      const screen = await renderCard(description)
      await expect
        .element(screen.getByRole('button', { name: 'Task description' }))
        .not.toBeInTheDocument()
    }
  })

  it('renders long right-to-left text with automatic direction in the Persian UI', async () => {
    await i18n.changeLanguage('fa')
    const description =
      'خلاصه کردن تمام نکات فصل چهارم و حل تمرین‌های تکمیلی قبل از آزمون آزمایشی'
    const screen = await renderCard(description)

    expect(document.documentElement.dir).toBe('rtl')
    await userEvent.click(screen.getByRole('button', { name: 'توضیح وظیفه' }))
    const body = screen.getByText(description)
    await expect.element(body).toBeInTheDocument()
    expect(body.element().getAttribute('dir')).toBe('auto')
  })

  it('renders Markdown safely inside an opened description', async () => {
    const description =
      '# Goals\n\n- **Review** chapter four\n- Run `npm test`\n\nFinish before Friday.'
    const screen = await renderCard(description)

    await userEvent.click(
      screen.getByRole('button', { name: 'Task description' })
    )

    expect(
      screen.getByRole('heading', { name: 'Goals' }).element().tagName
    ).toBe('H1')
    expect(
      screen.container.querySelectorAll('[data-slot="collapsible-content"] li')
    ).toHaveLength(2)
    expect(screen.getByText('Review').element().parentElement?.tagName).toBe(
      'STRONG'
    )
    expect(screen.getByText('npm test').element().tagName).toBe('CODE')
    expect(screen.container.querySelector('img')).toBeNull()
  })

  it('opens only the clicked card and starts closed again after a remount', async () => {
    const firstDescription = 'First saved description'
    const secondDescription = 'Second saved description'
    const first = taskWithDescription(firstDescription, {
      id: 'task-1',
      title: 'First task',
    })
    const second = taskWithDescription(secondDescription, {
      id: 'task-2',
      title: 'Second task',
    })
    const onChanged = vi.fn(async () => undefined)
    const props = {
      reports: [],
      items: [],
      now: Date.parse('2026-01-15T09:00:00.000Z'),
      onChanged,
      onError: vi.fn(),
      onEdit: vi.fn(),
    }
    const screen = await render(
      <>
        <TaskCard task={first} {...props} />
        <TaskCard task={second} {...props} />
      </>
    )

    const toggle = (index: number) =>
      screen.getByRole('button', { name: 'Task description' }).nth(index)
    await expect.element(toggle(0)).toHaveAttribute('aria-expanded', 'false')
    await expect.element(toggle(1)).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(toggle(0))

    await expect.element(toggle(0)).toHaveAttribute('aria-expanded', 'true')
    await expect.element(toggle(1)).toHaveAttribute('aria-expanded', 'false')
    await expect.element(screen.getByText(firstDescription)).toBeInTheDocument()
    await expect
      .element(screen.getByText(secondDescription))
      .not.toBeInTheDocument()

    await screen.unmount()
    const reloaded = await render(<TaskCard task={first} {...props} />)
    await expect
      .element(reloaded.getByRole('button', { name: 'Task description' }))
      .toHaveAttribute('aria-expanded', 'false')
    await expect
      .element(reloaded.getByText(firstDescription))
      .not.toBeInTheDocument()

    expect(first).toEqual(
      taskWithDescription(firstDescription, {
        id: 'task-1',
        title: 'First task',
      })
    )
    expect(onChanged).not.toHaveBeenCalled()
  })
})
