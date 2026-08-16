# Chrome Extension Surfaces

| Surface         | URL/path                   | Entry                    | Layout                                |
| --------------- | -------------------------- | ------------------------ | ------------------------------------- |
| Content popover | Injected on `https://*/*`  | `src/content/main.tsx`   | Shadow DOM host                       |
| Side Panel      | `src/sidepanel/index.html` | `src/sidepanel/main.tsx` | Native tab-specific Chrome Side Panel |
| Options         | `src/options/index.html`   | `src/options/main.tsx`   | Full extension tab                    |
| Popup           | `src/popup/index.html`     | `src/popup/main.tsx`     | Browser-action popup                  |
| Offscreen       | `src/offscreen/index.html` | `src/offscreen/main.ts`  | Non-visual OPFS/SQLite owner          |

Routing is declared in `manifest.config.ts`; React Router is not used.
