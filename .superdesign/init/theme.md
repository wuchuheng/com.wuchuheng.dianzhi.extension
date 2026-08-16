# Theme

## Compact token summary

- Framework: React 19 + Vite + Tailwind CSS 4, with surface-specific vanilla CSS.
- Current scaffold font: `system-ui, Avenir, Helvetica, Arial, sans-serif`.
- Current scaffold accent: `#646cff`; content demo blue: `#288cd7`.
- Existing radii: 8px and 12px; shadows use neutral black at 10% opacity.
- No production Dianzhi token system exists yet. The approved target is a compact light macOS-inspired system shared by popover, Side Panel, Options, and Popup.

## Raw source

`src/content/index.css`:

```css
@import 'tailwindcss';
@source "./**/*.{ts,tsx,html}";
@import './views/App.css';
```

`src/options/index.css`, `src/popup/index.css`, and `src/sidepanel/index.css` currently contain the default Vite theme: system font, dark `#242424` page background, `#646cff` links, 8px buttons, and a light-color-scheme media override. These files are slated for replacement by the approved Dianzhi tokens.
