import { useState } from 'react'
import '@/styles/index.css'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { jalaliToDateKey } from '@/lib/jalali'
import i18n from '@/i18n/config'
import { JalaliDatePicker } from './jalali-date-picker'

function Controlled({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial)
  return (
    <div>
      <JalaliDatePicker value={value} onChange={setValue} ariaLabel='تاریخ' />
      <output data-testid='value'>{value}</output>
    </div>
  )
}

async function openPicker(screen: Awaited<ReturnType<typeof render>>) {
  await userEvent.click(screen.getByRole('button', { name: 'تاریخ' }))
  await expect.element(screen.getByRole('dialog')).toBeInTheDocument()
}

describe('JalaliDatePicker', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('fa')
  })

  afterEach(async () => {
    await i18n.changeLanguage('fa')
  })

  it('shows the stored Jalali date and never exposes a text field', async () => {
    const screen = await render(<Controlled initial='2026-11-12' />)

    await expect
      .element(screen.getByRole('button', { name: 'تاریخ' }))
      .toHaveTextContent('۱۴۰۵/۰۸/۲۱')
    await expect
      .element(screen.getByTestId('value'))
      .toHaveTextContent('2026-11-12')
    expect(screen.container.querySelector('input')).toBeNull()
  })

  it('selects a day from the Jalali calendar without shifting it', async () => {
    const screen = await render(<Controlled initial='2026-11-12' />)
    await openPicker(screen)

    await expect
      .element(screen.getByRole('combobox', { name: 'ماه' }))
      .toHaveValue('8')
    await expect
      .element(screen.getByRole('combobox', { name: 'سال' }))
      .toHaveValue('1405')

    await userEvent.click(
      screen.getByRole('button', { name: '۲۲ آبان ۱۴۰۵', exact: true })
    )

    await expect
      .element(screen.getByTestId('value'))
      .toHaveTextContent(jalaliToDateKey(1405, 8, 22))
  })

  it('navigates between Jalali months in both directions', async () => {
    const screen = await render(<Controlled initial='2026-11-12' />)
    await openPicker(screen)

    await userEvent.click(screen.getByRole('button', { name: 'ماه قبل' }))
    await expect
      .element(screen.getByRole('combobox', { name: 'ماه' }))
      .toHaveValue('7')

    await userEvent.click(screen.getByRole('button', { name: 'ماه بعد' }))
    await userEvent.click(screen.getByRole('button', { name: 'ماه بعد' }))
    await expect
      .element(screen.getByRole('combobox', { name: 'ماه' }))
      .toHaveValue('9')
  })

  it('supports the first and last day of a Jalali month', async () => {
    const screen = await render(<Controlled initial='2026-11-12' />)

    await openPicker(screen)
    await userEvent.click(
      screen.getByRole('button', { name: '۱ آبان ۱۴۰۵', exact: true })
    )
    await expect
      .element(screen.getByTestId('value'))
      .toHaveTextContent(jalaliToDateKey(1405, 8, 1))

    await openPicker(screen)
    await userEvent.click(
      screen.getByRole('button', { name: '۳۰ آبان ۱۴۰۵', exact: true })
    )
    await expect
      .element(screen.getByTestId('value'))
      .toHaveTextContent(jalaliToDateKey(1405, 8, 30))
  })

  it('keeps the calendar Jalali in the English UI', async () => {
    await i18n.changeLanguage('en')
    const screen = await render(<Controlled initial='2026-11-12' />)

    await expect
      .element(screen.getByRole('button', { name: 'تاریخ' }))
      .toHaveTextContent('۱۴۰۵/۰۸/۲۱')

    await openPicker(screen)
    await expect
      .element(screen.getByRole('combobox', { name: 'Month' }))
      .toHaveValue('8')
    await expect.element(screen.getByText('Aban')).toBeInTheDocument()
    await expect
      .element(screen.getByRole('combobox', { name: 'Year' }))
      .toHaveValue('1405')
  })
})
