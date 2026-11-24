import '@/styles/index.css'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { TaskDescription } from './task-description'

describe('TaskDescription', () => {
  it('renders headings, lists, bold and inline code as structured elements', async () => {
    const value = [
      '# Report',
      '',
      '## Details',
      '',
      '- **First** item',
      '* Use `npm test`',
      '',
      'Final paragraph.',
    ].join('\n')
    const screen = await render(<TaskDescription value={value} />)

    const heading1 = screen.getByRole('heading', { name: 'Report' })
    expect(heading1.element().tagName).toBe('H1')
    const heading2 = screen.getByRole('heading', { name: 'Details' })
    expect(heading2.element().tagName).toBe('H2')

    const items = screen.container.querySelectorAll('li')
    expect(items).toHaveLength(2)

    const boldText = screen.getByText('First')
    expect(boldText.element().parentElement?.tagName).toBe('STRONG')
    const code = screen.getByText('npm test')
    expect(code.element().tagName).toBe('CODE')
    await expect
      .element(screen.getByText('Final paragraph.'))
      .toBeInTheDocument()
  })

  it('keeps injected HTML as plain text without creating elements or running handlers', async () => {
    const injected =
      '<img src=x onerror="window.__taskDescriptionInjected = true">'
    const script = '<script>window.__taskDescriptionInjected = true</script>'
    const screen = await render(
      <TaskDescription value={`${injected}\n${script}`} />
    )

    expect(screen.container.querySelector('img')).toBeNull()
    expect(screen.container.querySelector('script')).toBeNull()
    expect(
      (window as Window & { __taskDescriptionInjected?: boolean })
        .__taskDescriptionInjected
    ).toBeUndefined()
    await expect
      .element(screen.getByText(new RegExp('<img src=x')))
      .toBeInTheDocument()
  })

  it('applies automatic direction to Persian and English blocks', async () => {
    const screen = await render(
      <TaskDescription
        value={[
          '# English heading',
          '',
          'خلاصه فصل چهارم و حل تمرینها',
          '',
          '- Complete `task`',
          '- تمرین **فصل چهارم**',
        ].join('\n')}
      />
    )

    expect(
      screen
        .getByRole('heading', { name: 'English heading' })
        .element()
        .getAttribute('dir')
    ).toBe('auto')
    const paragraph = screen.container.querySelector('p')
    expect(paragraph?.getAttribute('dir')).toBe('auto')
    expect(paragraph?.textContent).toContain('خلاصه فصل چهارم')
    expect(screen.container.querySelector('ul')?.getAttribute('dir')).toBe(
      'auto'
    )
  })
})
