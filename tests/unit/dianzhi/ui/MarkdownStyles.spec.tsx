import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function boldWeight(cssPath: string): string {
  const style = document.createElement('style')
  style.textContent = readFileSync(new URL(cssPath, import.meta.url), 'utf8')
  document.head.appendChild(style)
  const strong = document.createElement('strong')
  const markdown = document.createElement('div')
  markdown.className = 'dz-markdown'
  markdown.appendChild(strong)
  document.body.appendChild(markdown)
  const weight = getComputedStyle(strong).fontWeight
  markdown.remove()
  style.remove()
  return weight
}

function markdownWhiteSpace(cssPath: string): string {
  const style = document.createElement('style')
  style.textContent = readFileSync(new URL(cssPath, import.meta.url), 'utf8')
  document.head.appendChild(style)
  const markdown = document.createElement('div')
  markdown.className = 'dz-markdown'
  document.body.appendChild(markdown)
  const whiteSpace = getComputedStyle(markdown).whiteSpace
  markdown.remove()
  style.remove()
  return whiteSpace
}

describe('Markdown emphasis styles', () => {
  it('uses an explicit 700 weight for bold CJK text in both Markdown surfaces', () => {
    expect(boldWeight('../../../../src/content/views/App.css')).toBe('700')
    expect(boldWeight('../../../../src/sidepanel/App.css')).toBe('700')
  })

  it('preserves model-authored line breaks in both Markdown surfaces', () => {
    expect(markdownWhiteSpace('../../../../src/content/views/App.css')).toBe('pre-wrap')
    expect(markdownWhiteSpace('../../../../src/sidepanel/App.css')).toBe('pre-wrap')
  })
})
