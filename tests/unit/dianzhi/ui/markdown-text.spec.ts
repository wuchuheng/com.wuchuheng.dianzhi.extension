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

  it('keeps one blank line between paragraphs', () => {
    expect(markdownToPlainText('para one\n\n\n\npara two')).toBe('para one\n\npara two')
  })

  it('returns an empty string for blank input', () => {
    expect(markdownToPlainText('')).toBe('')
    expect(markdownToPlainText('   \n  \n')).toBe('')
  })
})
