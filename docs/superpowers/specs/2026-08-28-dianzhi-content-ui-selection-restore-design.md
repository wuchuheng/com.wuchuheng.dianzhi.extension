# Content UI Selection Restore Design

## Status

Approved in design review on 2026-08-28. This specification extends the
approved Tab UI Session Coordinator design. It does not change the existing
meaning of `latestUI`.

## Goal

When a user closes the Content Script (CS) UI and later presses `Ctrl + [`,
restore the CS UI and accurately reselect the text that started its current
selection session.

The same shortcut must continue to restore the native Chrome Side Panel when
the Side Panel was the last UI. A CS-to-Side-Panel handoff is therefore not a
CS restore case.

## Scope

- Correct the CS close lifecycle report so Background no longer considers a
  hidden popover to be visible.
- Persist a serializable, validated CS selection bookmark in the tab UI state
  only while CS is the latest UI.
- Restore and re-highlight the original DOM `Range` when CS is restored.
- Provide a safe, visible recovery state when the original selection can no
  longer be identified uniquely.
- Test state transitions, bookmark reconstruction, protocol validation, and
  all CS close paths.

## Non-goals

- Restoring a CS selection after the browser restarts.
- Preserving a CS bookmark after CS ownership changes to Side Panel ownership.
- Guessing a selection from `selectedText` alone.
- Creating another selection session, provider run, or conversation while
  restoring an existing session.
- Recovering a session after a normalized page URL change; the existing
  navigation reset remains authoritative.

## Existing State-Machine Contract

`latestUI` remains the authority for the next `Ctrl + [` action:

| Current state | Action | Result |
| --- | --- | --- |
| CS UI appeared | `Ctrl + [` | Render Side Panel; `latestUI = sidePanel` |
| Side Panel appeared | `Ctrl + [` | Close Side Panel; `latestUI` stays `sidePanel` |
| Neither appeared; `latestUI = contentScript` | `Ctrl + [` | Restore CS UI |
| Neither appeared; `latestUI = sidePanel` | `Ctrl + [` | Open Side Panel |

Closing a surface changes only its presence. It does not change `latestUI`.
Thus, closing CS preserves a CS restore candidate, whereas closing Side Panel
preserves a Side Panel restore candidate.

## Runtime State

Extend the persisted, service-worker-suspension-safe `TabSessionState` with a
CS-only restore record:

```ts
type ContentRestore = {
  selectionSessionId: number
  bookmark: SelectionBookmark
  anchorRect: AnchorRect
}

interface TabSessionState {
  // Existing fields
  tabId: number
  windowId: number
  pageUrl: string
  contentUIAppeared: boolean
  sidePanelAppeared: boolean
  latestUI: UiSurface
  selectionSessionId: number | null

  // Present only when latestUI is contentScript.
  contentRestore?: ContentRestore
}
```

`ContentRestore` is valid only when all of the following are true:

- `latestUI === 'contentScript'`;
- its `selectionSessionId` equals `TabSessionState.selectionSessionId`;
- its bookmark passes protocol validation.

The coordinator clears an invalid record while loading stored state rather
than attempting a partial recovery.

## Selection Bookmark

The bookmark is a serializable DOM position, not merely page x/y coordinates:

```ts
type SelectionBookmark = {
  startPath: number[]
  startOffset: number
  endPath: number[]
  endOffset: number
  selectedText: string
  prefix: string
  suffix: string
}
```

`startPath` and `endPath` identify text nodes from the document root through
child-node indices. Offsets identify the exact range within those text nodes.
`selectedText`, `prefix`, and `suffix` are integrity guards: a reconstructed
range is acceptable only when all applicable values match. `anchorRect` is
used only after an accepted range has been reconstructed, to place the CS UI.
It cannot itself select text.

Content creates the bookmark immediately after it captures and expands the
user selection. It sends it with the selection-routing request, alongside the
current anchor rectangle. Background continues to derive browser identity
from the sender and Chrome metadata; the bookmark is presentation data and is
never treated as page identity.

## Ownership and Lifecycle

### A new selection routes to CS

After Background creates the selection session and makes CS the owner, it
stores the supplied `ContentRestore`. A new CS selection replaces the prior
record atomically with its replacement selection session.

### The user closes CS

The close button, Escape shortcut, and outside-pointer path share one close
operation. It hides the popover and reports `ui.surfaceStatus: destroyed`.
Background sets `contentUIAppeared` to `false`, but retains `latestUI`,
`selectionSessionId`, and `contentRestore` when `latestUI` is `contentScript`.

### CS hands off to Side Panel

When `Ctrl + [` changes CS ownership to Side Panel, Background completes the
panel render/handoff and then atomically sets `latestUI = sidePanel` and
clears `contentRestore`. This prevents an old CS bookmark from influencing a
later Side Panel restoration.

### Side Panel closes

Closing Side Panel only changes its presence. Its `latestUI = sidePanel`
remains, and no CS restore record is retained or consulted. The next
`Ctrl + [` opens Side Panel.

### Other invalidation events

Clear `contentRestore` when a normalized page URL changes, a tab closes, a
new selection replaces the current selection session, Side Panel becomes the
owner, or the stored record fails validation. It is also omitted from all
Side Panel commands.

## Restore Protocol and Content Behavior

Add an optional `contentRestore` field to the `shortcut.panelToggle` result.
Background includes it only for a Content restore response whose state is
valid and whose `latestUI` is `contentScript`. No Side Panel command or Side
Panel route result includes this field.

On `action: 'restore'` and `currentUI: 'contentScript'`, Content uses this
ordered algorithm:

1. Try its still-live local `Range` and validate it against the bookmark.
2. Resolve the stored DOM paths and offsets into a new `Range`; validate its
   text and context guards.
3. If the path changed, search for candidates matching `selectedText` with the
   stored prefix and suffix. Reconstruct a range only when exactly one
   candidate passes validation.
4. If a range is restored, replace document selection with that range, derive
   its current rectangle, render the CS UI, and report CS as appeared.
5. If no unique, validated range exists, render the existing session without a
   page highlight and show: "The original selection changed. Select the text
   again to anchor this conversation." Do not select a best-effort candidate.

The result's `anchorRect` may provide an initial placement only after range
validation; the current range rectangle is authoritative after DOM layout.

## Errors and Observability

Malformed bookmark data is rejected with the existing invalid-event contract.
Background logs the operation, tab/session identifiers, restore outcome, and
safe reason category (`live-range`, `dom-bookmark`, `context-search`,
`ambiguous`, `not-found`, or `invalid-bookmark`). Logs must not include full
selected text or surrounding page context.

Unexpected Content restore failures leave the existing conversation intact,
set the visible recovery message, and report CS appearance once the UI is
shown. They do not start a provider run or mutate the selection session.

## Tests

- Coordinator state transitions: CS close then restore CS; CS-to-Side-Panel
  handoff clears the record; Side Panel close then restores Side Panel.
- Stored-state validation: accept only a CS-owned, session-matching,
  well-formed bookmark; discard every other record.
- Protocol parsing and serialization: reject malformed paths, offsets,
  context, rectangles, and unintended bookmark fields on Side Panel paths.
- Selection restoration: exact live-range restore; DOM-path restore; unique
  context-search restore; duplicate candidate rejection; missing candidate
  fallback.
- Content lifecycle: close button, Escape, and outside click all report CS
  destruction; a successful restore reselects the original text; a failed
  restore shows the recovery message without a false highlight.
- Real Chrome verification: close CS by each supported method, restore it via
  `Ctrl + [`, verify the exact selected text/highlight, hand off to Side Panel,
  close it, then verify the next shortcut restores Side Panel instead.

## Files Expected to Change During Implementation

- `src/dianzhi/domain/ui-session-protocol.ts`
- `src/background/ui-session-coordinator.ts`
- `src/content/views/App.tsx`
- `src/content/selection/controller.ts`
- a focused selection-bookmark/restore module and its unit tests
- coordinator, protocol, and Content UI tests
