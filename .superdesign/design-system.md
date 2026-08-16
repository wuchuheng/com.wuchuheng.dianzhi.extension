# Dianzhi Design System

## Product and surfaces

Dianzhi is a reading assistant for English selections. It has four compact surfaces: an anchored page popover, a full-height native Chrome Side Panel, an Options tab, and a small status Popup. The popover and panel share tool tabs, messages, reasoning, status, and composer primitives.

## Visual direction

- Quiet macOS-inspired utility, not a literal OS clone.
- Use system UI fonts only: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Light neutral canvas `#f6f7f9`; white surfaces; ink `#172033`; secondary `#667085`.
- Brand/action blue `#2764ff`; active background `#edf3ff`; danger `#d92d20`; success `#079455`.
- Borders `#e4e7ec`; focus ring `rgba(39,100,255,.28)`.
- Radii: 8px controls, 12px cards, 14px main popover. Shadows: restrained neutral ambient shadow.
- Spacing uses a 4px base; compact controls are 30-34px high; body type is 13-14px.

## Components and behavior

- Tool tabs are horizontal pills with a clearly filled active state, keyboard cycling, and no decorative gradients.
- Messages use subtle role differentiation; assistant Markdown remains readable and compact.
- Reasoning is a collapsed disclosure with secondary styling and is hidden when reasoning is disabled.
- Composer is a bordered multiline field with a compact send action. Streaming uses a quiet animated dot and explicit stop action.
- Icon actions always have labels/tooltips and visible focus.
- Popover arrow visually joins the selected text to the panel. Expanded mode widens the same anchored surface.
- Side Panel uses a sticky tab header, scrollable complete history, and bottom composer; it has no new-chat or archive controls.
- Respect `prefers-reduced-motion`; never animate every token.
