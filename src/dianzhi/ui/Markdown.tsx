import type { ReactNode } from 'react'

export interface MarkdownProps {
  source: string
}

function inline(source: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    if (match.index > cursor) nodes.push(source.slice(cursor, match.index))
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-${match.index}`}>{token.slice(2, -2)}</strong>)
    } else {
      nodes.push(<code key={`${keyPrefix}-${match.index}`}>{token.slice(1, -1)}</code>)
    }
    cursor = match.index + token.length
  }
  if (cursor < source.length) nodes.push(source.slice(cursor))
  return nodes
}

export function Markdown({ source }: MarkdownProps) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  for (let index = 0; index < lines.length; ) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      const content = inline(heading[2] ?? '', `h-${index}`)
      const level = heading[1]?.length
      blocks.push(
        level === 1 ? (
          <h1 key={index}>{content}</h1>
        ) : level === 2 ? (
          <h2 key={index}>{content}</h2>
        ) : (
          <h3 key={index}>{content}</h3>
        )
      )
      index += 1
      continue
    }
    if (/^[-*]\s+/.test(line)) {
      const items: ReactNode[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index] ?? '')) {
        const item = (lines[index] ?? '').replace(/^[-*]\s+/, '')
        items.push(<li key={index}>{inline(item, `li-${index}`)}</li>)
        index += 1
      }
      blocks.push(<ul key={`ul-${index}`}>{items}</ul>)
      continue
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: ReactNode[] = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index] ?? '')) {
        const item = (lines[index] ?? '').replace(/^\d+\.\s+/, '')
        items.push(<li key={index}>{inline(item, `ol-${index}`)}</li>)
        index += 1
      }
      blocks.push(<ol key={`ol-${index}`}>{items}</ol>)
      continue
    }
    if (line.startsWith('> ')) {
      blocks.push(<blockquote key={index}>{inline(line.slice(2), `q-${index}`)}</blockquote>)
      index += 1
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length && (lines[index] ?? '').trim()) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    blocks.push(<p key={`p-${index}`}>{inline(paragraph.join('\n'), `p-${index}`)}</p>)
  }
  return <div className="dz-markdown">{blocks}</div>
}
