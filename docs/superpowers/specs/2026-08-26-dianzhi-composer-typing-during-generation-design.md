# Dianzhi Composer Typing During Generation Design

Status: approved via collaborative brainstorming (2026-08-26). Allows the user to keep
typing into the chat input while a provider reply is streaming, while **send stays
disabled** during generation.

## 1. Goal

Today, while the AI is generating a reply, the chat input (`Composer` textarea) is
fully `disabled`: the user cannot type a single character until the stream ends. The
single send/stop button correctly becomes a Stop control during streaming, and `submit()`
already refuses to send while a run is active — but the disabled textarea is the problem.

This change: during generation the textarea stays **editable** and accepts new drafts,
while sending remains **blocked** (the button shows Stop; Enter does nothing; no message
can be dispatched until the stream finishes). After the stream ends, the user's draft is
still in the box and sends normally.

**Product decisions (2026-08-26):**

- **Enter while streaming does nothing** (shift-Enter stays the newline gesture); the
  Enter = send contract is preserved and simply no-ops while send is disabled.
- **Focus returns to the input after send**, so the user can start typing the next
  message immediately while the AI is still generating (applies to both the content
  popover and the Side Panel).

## 2. Decisions

| Decision        | Choice                                                                                   | Rationale                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `disabled` prop | Means hard-lock of the whole composer (typing **and** send), independent of `streaming`  | Keeps a real lock for future callers; no caller currently needs it                                |
| `streaming`     | Only flips the button to Stop and suppresses send; textarea stays editable               | Removes the conflation that caused the bug (callers were passing `disabled={streaming}`)          |
| Enter           | No-op while `streaming`; `Shift+Enter` still inserts a newline                           | Preserves the documented Enter=send keyboard contract                                             |
| Focus           | Popover and Side Panel return focus to the textarea on send, including immediately after | Supports "keep typing while generating"; only modifies the existing `if (streaming) return` guard |
| Scope           | Shared `Composer` primitive only; Options `ToolTestPane` is untouched                    | Its textareas are not disabled while running; only the run button is                              |

## 3. Architecture

Pure UI change in the shared React `Composer` + its two render sites. No protocol,
background, offscreen, or content-messaging changes. No manifest/permission changes.

### 3.1 Composer (`src/dianzhi/ui/Composer.tsx`)

No functional change needed — the send-suppression already exists:

```ts
const active = streaming
const submit = () => {
  if (!disabled && !active && value.trim()) onSend()
}
```

and the button already resolves to Stop while `active`:

```ts
disabled={!active && (disabled || !value.trim())}
```

The textarea is `disabled={disabled}` — so once callers stop passing
`disabled={streaming}`, it stays enabled during streaming. The only edits are TSDoc
clarifications so the two props can't be conflated again:

- `disabled` — hard-disables the whole composer (no typing, no send).
- `streaming` — provider run in flight; textarea stays editable, the single button becomes
  a Stop control, and send is suppressed (Enter and click).

### 3.2 Callers

- `src/content/views/App.tsx` — the `<Composer>` render drops `disabled={streaming}` and
  keeps `streaming={streaming}`.
- `src/sidepanel/App.tsx` — the `<Composer>` render drops `disabled={streaming}` and keeps
  `streaming={streaming}`.

### 3.3 Focus after send

Both apps focus the composer through an effect that currently bails out while streaming:

- `src/content/views/App.tsx` (`useLayoutEffect`, chat mode): remove `if (streaming) return`.
- `src/sidepanel/App.tsx` (`useEffect`, has snapshot): remove `if (streaming) return`.

The effect still runs on `streaming` flips, so after clicking Send the textarea is focused
again immediately and stays editable for the next draft. When the stream ends (or is
stopped), focus behavior is unchanged.

## 4. Behavior matrix

| State                  | Textarea | Button   | Enter | Send dispatches? |
| ---------------------- | -------- | -------- | ----- | ---------------- |
| Idle, empty            | editable | disabled | no-op | no               |
| Idle, has draft        | editable | Send     | sends | yes              |
| `disabled` (hard-lock) | locked   | disabled | no-op | no               |
| `streaming`, draft     | editable | Stop     | no-op | **no**           |

## 5. Tests

- **`tests/unit/dianzhi/ui/Composer.spec.tsx`** (new, `createRoot` + `act` style):
  - textarea is editable and accepts input while `streaming`.
  - Enter does not call `onSend` and click calls `onStop` while `streaming`.
  - idle + draft: Enter and click call `onSend`.
  - `disabled` hard-locks the textarea and suppresses Send.
- **`tests/unit/content/views/App.spec.tsx`** (extend): content popover in chat mode with
  a `streaming` assistant message renders an editable textarea (regression for the caller
  wiring).
- **`tests/unit/sidepanel/App.spec.tsx`** (extend): same editable-textarea assertion with
  a `streaming` snapshot.
- Existing suite must stay green: `pnpm run test`.

## 6. Files changed

| Path                                                                                    | Change                                                                    |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/dianzhi/ui/Composer.tsx`                                                           | TSDoc for `disabled` / `streaming` contracts                              |
| `src/content/views/App.tsx`                                                             | drop `disabled={streaming}`; drop `if (streaming) return` in focus effect |
| `src/sidepanel/App.tsx`                                                                 | drop `disabled={streaming}`; drop `if (streaming) return` in focus effect |
| `tests/unit/dianzhi/ui/Composer.spec.tsx`                                               | **new** props-contract tests                                              |
| `tests/unit/content/views/App.spec.tsx`                                                 | editable-textarea-while-streaming case                                    |
| `tests/unit/sidepanel/App.spec.tsx`                                                     | editable-textarea-while-streaming case                                    |
| `docs/superpowers/specs/2026-08-26-dianzhi-composer-typing-during-generation-design.md` | this document                                                             |

## 7. Non-goals

- No queued/auto-send of the draft when the stream ends (send stays disabled during
  generation, per requirement).
- No change to the Options `ToolTestPane` inputs.
- No change to the Enter=send / Shift+Enter=newline keyboard contract while idle.
- No protocol, storage, or background-context changes.
