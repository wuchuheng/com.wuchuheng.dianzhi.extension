import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { Markdown } from '@/dianzhi/ui/Markdown'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

async function renderMarkdown(source: string) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<Markdown source={source} />)
  })
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

describe('Markdown tables', () => {
  it('renders a GFM table as table/thead/tbody with header and body cells', async () => {
    const host = await renderMarkdown('| 单词 | 音标 |\n|------|------|\n| run | /rʌn/ |')
    const table = host?.querySelector('table')
    expect(table).not.toBeNull()
    expect(table?.querySelector('thead')?.textContent).toContain('单词')
    const headers = [...(table?.querySelectorAll('th') ?? [])].map((th) => th.textContent)
    expect(headers).toEqual(['单词', '音标'])
    const bodyRows = table?.querySelectorAll('tbody tr')
    expect(bodyRows?.length).toBe(1)
    expect(bodyRows?.[0]?.querySelectorAll('td')?.length).toBe(2)
    expect(bodyRows?.[0]?.querySelector('td')?.textContent).toBe('run')
  })

  it('renders inline bold and code inside table cells', async () => {
    const host = await renderMarkdown('| 词 | 说明 |\n|----|------|\n| **run** | `v.` 跑 |')
    const table = host?.querySelector('table')
    expect(table?.querySelector('tbody strong')?.textContent).toBe('run')
    expect(table?.querySelector('tbody code')?.textContent).toBe('v.')
  })

  it('works for a single-column table', async () => {
    const host = await renderMarkdown('| 说明 |\n| --- |\n| 内容 |')
    const table = host?.querySelector('table')
    expect(table).not.toBeNull()
    expect(table?.querySelector('th')?.textContent).toBe('说明')
    expect(table?.querySelector('td')?.textContent).toBe('内容')
  })

  it('applies text-align from delimiter colons', async () => {
    const host = await renderMarkdown('| a | b |\n|:---|---:|\n| 1 | 2 |')
    const ths = host?.querySelectorAll('th')
    expect((ths?.[0] as HTMLElement | undefined)?.style.textAlign).toBe('left')
    expect((ths?.[1] as HTMLElement | undefined)?.style.textAlign).toBe('right')
  })

  it('pads ragged rows to the header column count', async () => {
    const host = await renderMarkdown('| a | b |\n|---|---|\n| 1 |')
    expect(host?.querySelectorAll('tbody tr td')?.length).toBe(2)
    expect(host?.querySelector('tbody tr td')?.textContent).toBe('1')
  })

  it('stops the table at a blank line and continues with normal blocks', async () => {
    const host = await renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n之后')
    const table = host?.querySelector('table')
    expect(table).not.toBeNull()
    const paragraphs = [...(host?.querySelectorAll('p') ?? [])].map((p) => p.textContent)
    expect(paragraphs).toEqual(['之后'])
  })

  it('does not treat an unseparated pipe line as a table', async () => {
    const host = await renderMarkdown('| just a pipe')
    expect(host?.querySelector('table')).toBeNull()
  })
})

describe('Markdown horizontal rules', () => {
  it('renders a standalone --- line as a horizontal rule instead of paragraph text', async () => {
    const host = await renderMarkdown('Before\n\n---\n\nAfter')
    expect(host?.querySelector('hr')).not.toBeNull()
    expect(
      [...(host?.querySelectorAll('p') ?? [])].map((paragraph) => paragraph.textContent)
    ).toEqual(['Before', 'After'])
  })
})

describe('Markdown headings', () => {
  it('renders heading levels one through five', async () => {
    const host = await renderMarkdown('# one\n## two\n### three\n#### four\n##### five')
    expect(host?.querySelector('h1')?.textContent).toBe('one')
    expect(host?.querySelector('h2')?.textContent).toBe('two')
    expect(host?.querySelector('h3')?.textContent).toBe('three')
    expect(host?.querySelector('h4')?.textContent).toBe('four')
    expect(host?.querySelector('h5')?.textContent).toBe('five')
  })
})

describe('Markdown raw HTML', () => {
  it('renders allowed HTML elements but excludes unsafe content and attributes', async () => {
    const host = await renderMarkdown(
      '<div class="example"><mark>重点</mark><br /><a href="/docs">文档</a></div>\n\n<script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">危险链接</a>'
    )

    expect(host?.querySelector('.example mark')?.textContent).toBe('重点')
    expect(host?.querySelector('.example br')).not.toBeNull()
    expect(host?.querySelector('a[href="/docs"]')?.textContent).toBe('文档')
    expect(host?.querySelector('script')).toBeNull()
    expect(host?.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(host?.querySelector('[onclick]')).toBeNull()
    expect(host?.querySelectorAll('a[href]')).toHaveLength(1)
  })
})
