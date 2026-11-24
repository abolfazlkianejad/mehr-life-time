import type { ReactNode } from 'react'

const INLINE_PATTERN = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__)/g

interface TaskDescriptionProps {
  value: string
  className?: string
}

function renderInline(value: string, keyPrefix: string): ReactNode[] {
  return value
    .split(INLINE_PATTERN)
    .filter((part) => part.length > 0)
    .map((part, index) => {
      const key = `${keyPrefix}-inline-${index}`

      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code
            key={key}
            dir='auto'
            className='rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]'
          >
            {part.slice(1, -1)}
          </code>
        )
      }

      if (
        (part.startsWith('**') && part.endsWith('**')) ||
        (part.startsWith('__') && part.endsWith('__'))
      ) {
        return (
          <strong
            key={key}
            dir='auto'
            className='font-semibold text-foreground'
          >
            {renderInline(part.slice(2, -2), key)}
          </strong>
        )
      }

      return (
        <span key={key} dir='auto'>
          {part}
        </span>
      )
    })
}

function renderHeading(level: number, children: ReactNode, key: string) {
  const base = 'font-semibold text-foreground'
  switch (level) {
    case 1:
      return (
        <h1 key={key} dir='auto' className={`${base} text-base`}>
          {children}
        </h1>
      )
    case 2:
      return (
        <h2 key={key} dir='auto' className={`${base} text-sm`}>
          {children}
        </h2>
      )
    case 3:
      return (
        <h3 key={key} dir='auto' className={`${base} text-sm`}>
          {children}
        </h3>
      )
    case 4:
      return (
        <h4 key={key} dir='auto' className={`${base} text-sm`}>
          {children}
        </h4>
      )
    case 5:
      return (
        <h5 key={key} dir='auto' className={`${base} text-sm`}>
          {children}
        </h5>
      )
    default:
      return (
        <h6 key={key} dir='auto' className={`${base} text-sm`}>
          {children}
        </h6>
      )
  }
}

function renderMarkdown(value: string): ReactNode[] {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let list: string[] = []
  let blockIndex = 0

  const nextKey = () => `task-description-block-${blockIndex++}`

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    const text = paragraph.join('\n').trim()
    if (text) {
      const key = nextKey()
      blocks.push(
        <p
          key={key}
          dir='auto'
          className='leading-relaxed break-words whitespace-pre-wrap'
        >
          {renderInline(text, key)}
        </p>
      )
    }
    paragraph = []
  }

  const flushList = () => {
    if (list.length === 0) return
    const key = nextKey()
    blocks.push(
      <ul key={key} dir='auto' className='list-disc space-y-0.5 ps-5'>
        {list.map((item, index) => (
          <li key={`${key}-item-${index}`} className='break-words'>
            {renderInline(item, `${key}-item-${index}`)}
          </li>
        ))}
      </ul>
    )
    list = []
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed)
    if (heading) {
      flushParagraph()
      flushList()
      const key = nextKey()
      blocks.push(
        renderHeading(heading[1].length, renderInline(heading[2], key), key)
      )
      continue
    }

    const bullet = /^[-*]\s+(.+)$/.exec(trimmed)
    if (bullet) {
      flushParagraph()
      list.push(bullet[1])
      continue
    }

    flushList()
    paragraph.push(line)
  }

  flushParagraph()
  flushList()
  return blocks
}

/** Renders a saved task description as safe React elements; no HTML is injected. */
export function TaskDescription({
  value,
  className = '',
}: TaskDescriptionProps) {
  return (
    <div className={`w-full min-w-0 space-y-2 break-words ${className}`}>
      {renderMarkdown(value)}
    </div>
  )
}
