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

describe('Markdown emphasis styles', () => {
  it('uses an explicit 700 weight for bold CJK text in both Markdown surfaces', () => {
    expect(boldWeight('../../../../src/content/views/App.css')).toBe('700')
    expect(boldWeight('../../../../src/sidepanel/App.css')).toBe('700')
  })
})
