// @vitest-environment node

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../../../src/dianzhi/ui/Markdown'

describe('safe Markdown', () => {
  it('escapes HTML while supporting the bounded formatting set', () => {
    const html = renderToStaticMarkup(
      <Markdown source={'## Heading\n\n**bold** and `code` <script>alert(1)</script>\n\n- item'} />
    )

    expect(html).toContain('<h2>Heading</h2>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('<ul>')
  })
})
