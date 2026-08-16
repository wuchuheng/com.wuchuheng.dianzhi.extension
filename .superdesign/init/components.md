# Shared UI Components

## `src/components/Input.tsx` — Switch

Compact controlled boolean switch.

```tsx
type SwitchProps = {
  enabled: boolean
  onChange: (enabled: boolean) => void
}
export const Switch: React.FC<SwitchProps> = ({ enabled, onChange }) => {
  return (
    <label className="relative inline-flex cursor-pointer items-center">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={enabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <div className="h-5 w-9 rounded-full bg-gray-200 transition peer-checked:bg-blue-500" />
      <div className="absolute left-1 top-1 h-3 w-3 rounded-full bg-white transition peer-checked:translate-x-4" />
    </label>
  )
}
```

`ErrorBoundary` is infrastructure rather than a design primitive. The remaining components (`HelloWorld`, `HelloInCSUI`, `MacWindowShell`) are scaffold/demo UI and are not reusable Dianzhi primitives.
