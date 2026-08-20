import { createElement, type ReactNode } from 'react'

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
const ALLOWED_HTML_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'del',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
])
const DROP_HTML_TAGS = new Set(['embed', 'iframe', 'object', 'script', 'style', 'svg', 'template'])

function isSafeHref(value: string): boolean {
  const href = value.trim().toLowerCase()
  return href.startsWith('/') || href.startsWith('#') || /^(https?:|mailto:)/.test(href)
}

function rawHtmlNodes(source: string, keyPrefix: string): ReactNode[] {
  const template = document.createElement('template')
  template.innerHTML = source

  const renderNode = (node: Node, key: string): ReactNode[] => {
    if (node.nodeType === Node.TEXT_NODE) return [node.textContent ?? '']
    if (node.nodeType !== Node.ELEMENT_NODE) return []

    const element = node as HTMLElement
    const tag = element.tagName.toLowerCase()
    if (DROP_HTML_TAGS.has(tag)) return []

    const children = Array.from(element.childNodes).flatMap((child, index) =>
      renderNode(child, `${key}-${index}`)
    )
    if (!ALLOWED_HTML_TAGS.has(tag)) return children

    const props: Record<string, string> = { key }
    const className = element.getAttribute('class')
    if (className) props.className = className
    const title = element.getAttribute('title')
    if (title) props.title = title
    if (tag === 'a') {
      const href = element.getAttribute('href')
      if (href && isSafeHref(href)) props.href = href
    }
    if (tag === 'br' || tag === 'hr') return [createElement(tag, props)]
    return [createElement(tag, props, children)]
  }

  return Array.from(template.content.childNodes).flatMap((node, index) =>
    renderNode(node, `${keyPrefix}-${index}`)
  )
}

function isRawHtmlBlock(line: string): boolean {
  return /^\s*<\/?[a-z][\w-]*(?:\s[^>]*)?>/i.test(line)
}

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
    if (isRawHtmlBlock(line)) {
      const html: string[] = []
      while (index < lines.length && (lines[index] ?? '').trim()) {
        html.push(lines[index] ?? '')
        index += 1
      }
      blocks.push(<div key={`html-${index}`}>{rawHtmlNodes(html.join('\n'), `html-${index}`)}</div>)
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
