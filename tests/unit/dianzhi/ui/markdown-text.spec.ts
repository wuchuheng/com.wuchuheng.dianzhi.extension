import { describe, expect, it } from 'vitest'
import { markdownToPlainText } from '@/dianzhi/ui/markdown-text'

describe('markdownToPlainText', () => {
  it('strips inline bold and code markers', () => {
    expect(markdownToPlainText('**hello** world')).toBe('hello world')
    expect(markdownToPlainText('run `npm test` now')).toBe('run npm test now')
  })

  it('unwraps headings, list items, and blockquotes', () => {
    expect(markdownToPlainText('# Title')).toBe('Title')
    expect(markdownToPlainText('## Section **bold**')).toBe('Section bold')
    expect(markdownToPlainText('- item one\n- item two')).toBe('item one\nitem two')
    expect(markdownToPlainText('1. first\n2. second')).toBe('first\nsecond')
    expect(markdownToPlainText('> quoted')).toBe('quoted')
  })

  it('unwraps fourth- and fifth-level headings', () => {
    expect(markdownToPlainText('#### Detail')).toBe('Detail')
    expect(markdownToPlainText('##### Note')).toBe('Note')
  })

  it('collapses table rows into pipes-joined cells and drops the delimiter row', () => {
    const source = '| 单词 | 音标 |\n|------|------|\n| run | /rʌn/ |'
    expect(markdownToPlainText(source)).toBe('单词 | 音标\nrun | /rʌn/')
  })

  it('strips inline markers inside table cells', () => {
    expect(markdownToPlainText('| **a** | `b` |\n|---|---|\n| 1 | 2 |')).toBe('a | b\n1 | 2')
  })

  it('keeps one blank line between paragraphs', () => {
    expect(markdownToPlainText('para one\n\n\n\npara two')).toBe('para one\n\npara two')
  })

  it('omits horizontal rules because they have no plain-text content', () => {
    expect(markdownToPlainText('Before\n\n---\n\nAfter')).toBe('Before\n\nAfter')
  })

  it('returns an empty string for blank input', () => {
    expect(markdownToPlainText('')).toBe('')
    expect(markdownToPlainText('   \n  \n')).toBe('')
  })
})
