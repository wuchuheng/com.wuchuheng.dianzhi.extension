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

const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

function splitCells(row: string): string[] {
  // `row` is guaranteed to start and end with a pipe.
  return row
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

function alignFromDelimiter(cell: string): 'left' | 'right' | 'center' | undefined {
  if (cell.startsWith(':') && cell.endsWith(':')) return 'center'
  if (cell.startsWith(':')) return 'left'
  if (cell.endsWith(':')) return 'right'
  return undefined
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
    const headerLine = lines[index] ?? ''
    if (/^\|.*\|\s*$/.test(headerLine) && TABLE_DELIMITER.test(lines[index + 1] ?? '')) {
      const header = splitCells(headerLine)
      const aligns = splitCells(lines[index + 1] ?? '').map(alignFromDelimiter)
      const columnCount = header.length
      const rows: string[][] = []
      index += 2
      while (index < lines.length && /^\|.*\|\s*$/.test(lines[index] ?? '')) {
        rows.push(splitCells(lines[index] ?? ''))
        index += 1
      }
      const cells = (row: string[], tag: 'th' | 'td', keyPrefix: string) =>
        Array.from({ length: columnCount }, (_, col) => {
          const Cell = tag
          return (
            <Cell key={col} style={aligns[col] ? { textAlign: aligns[col] } : undefined}>
              {inline(row[col] ?? '', `${keyPrefix}-${col}`)}
            </Cell>
          )
        })
      blocks.push(
        <table key={`t-${index}`}>
          <thead>
            <tr>{cells(header, 'th', 'th')}</tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{cells(row, 'td', `td-${rowIndex}`)}</tr>
            ))}
          </tbody>
        </table>
      )
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
