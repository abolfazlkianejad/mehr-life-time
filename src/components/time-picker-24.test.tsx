import { useState } from 'react'
import '@/styles/index.css'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { localizeClockTime } from '@/lib/time'
import i18n from '@/i18n/config'
import { TimePicker24 } from './time-picker-24'

function Controlled({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial)
  return (
    <div>
      <TimePicker24 value={value} onChange={setValue} ariaLabel='ساعت' />
      <output data-testid='value'>{value}</output>
    </div>
  )
}

async function openPicker(screen: Awaited<ReturnType<typeof render>>) {
  await userEvent.click(screen.getByRole('button', { name: 'ساعت' }))
  await expect.element(screen.getByRole('dialog')).toBeInTheDocument()
}

async function pick(
  screen: Awaited<ReturnType<typeof render>>,
  hour: string,
  minute: string
) {
  await openPicker(screen)
  await userEvent.click(screen.getByRole('option', { name: `ساعت ${hour}` }))
  await expect
    .element(screen.getByTestId('value'))
    .toHaveTextContent(`${hour}:00`)
  await userEvent.click(screen.getByRole('option', { name: `دقیقه ${minute}` }))
}

describe('TimePicker24', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('fa')
  })

  afterEach(async () => {
    await i18n.changeLanguage('fa')
  })

  it('renders the stored value as 24-hour time with no text field', async () => {
    const screen = await render(<Controlled initial='09:05' />)

    await expect
      .element(screen.getByRole('button', { name: 'ساعت' }))
      .toHaveTextContent('۰۹:۰۵')
    await expect.element(screen.getByTestId('value')).toHaveTextContent('09:05')
    expect(screen.container.querySelector('input')).toBeNull()
    expect(document.body.textContent).not.toMatch(/\b(AM|PM)\b/)
  })

  it('offers exactly 24 hours and 60 minutes', async () => {
    const screen = await render(<Controlled initial='12:00' />)
    await openPicker(screen)

    const hours = screen.getByRole('listbox', { name: 'ساعت' }).element()
    const minutes = screen.getByRole('listbox', { name: 'دقیقه' }).element()
    expect(hours.querySelectorAll('[role="option"]')).toHaveLength(24)
    expect(minutes.querySelectorAll('[role="option"]')).toHaveLength(60)
    await expect
      .element(screen.getByRole('option', { name: 'ساعت 23' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('option', { name: 'ساعت 24' }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('option', { name: 'دقیقه 59' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('option', { name: 'دقیقه 60' }))
      .not.toBeInTheDocument()
  })

  it.each(['00:00', '09:05', '12:00', '13:30', '23:59'])(
    'selects %s from the 24-hour picker',
    async (expected) => {
      const screen = await render(<Controlled initial='00:00' />)
      const [hour, minute] = expected.split(':') as [string, string]

      await pick(screen, hour, minute)

      await expect
        .element(screen.getByTestId('value'))
        .toHaveTextContent(expected)
      await expect
        .element(screen.getByRole('button', { name: 'ساعت' }))
        .toHaveTextContent(localizeClockTime(expected, 'fa'))
      await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    }
  )

  it('shows ASCII 24-hour time in the English UI', async () => {
    await i18n.changeLanguage('en')
    const screen = await render(<Controlled initial='21:05' />)

    await expect
      .element(screen.getByRole('button', { name: 'ساعت' }))
      .toHaveTextContent('21:05')
  })
})
