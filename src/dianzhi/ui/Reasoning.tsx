import { Markdown } from './Markdown'

export function Reasoning({ enabled, content }: { enabled: boolean; content: string }) {
  if (!enabled || !content.trim()) return null
  return (
    <details className="dz-reasoning">
      <summary>思考过程</summary>
      <Markdown source={content} />
    </details>
  )
}
