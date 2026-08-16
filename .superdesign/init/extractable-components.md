# Extractable Components

## ErrorBoundary

- Source: `src/components/ErrorBoundary.tsx`
- Category: basic
- Description: Cross-surface React error fallback.
- Extractable props: fallback
- Hardcoded: retry behavior and default error copy

## Switch

- Source: `src/components/Input.tsx`
- Category: basic
- Description: Controlled compact boolean switch.
- Extractable props: enabled
- Hardcoded: track/thumb structure and colors

No production layout component exists yet. The new `ToolTabs`, `MessageList`, `Composer`, and status primitives should become the shared Dianzhi component set.
