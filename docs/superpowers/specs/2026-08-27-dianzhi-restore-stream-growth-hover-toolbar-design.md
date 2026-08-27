# Restore Stream Growth and Hover Toolbar Design

## Goal

Restore the Side Panel's original continuously growing assistant-message animation while keeping scroll movement synchronized inside the strict 150px bottom guard. Make message toolbars visually quiet by reserving their row but revealing their controls only while the related message is hovered or contains keyboard focus.

## Streaming behavior

- Only the latest assistant message is wrapped by `StreamingMessageGrowth`.
- The wrapper animates only while that message has `status: 'streaming'` and drains its remaining height backlog after the terminal update.
- Each committed wrapper-height delta is applied directly to `scrollTop`; no second scroll animation competes with the message animation.
- Scroll synchronization is allowed only when the distance before growth is strictly less than 150px.
- Reduced-motion mode reveals the natural height immediately.

## Toolbar and spacing behavior

- The toolbar stays as a sibling below its message bubble and retains a 24px minimum-height slot, preventing layout shift.
- It has no background, border, or shadow.
- It is transparent and non-interactive by default, then becomes visible for `.dz-message-item:hover` and `.dz-message-item:focus-within`.
- User-message metadata remains right aligned; assistant metadata remains left aligned.
- The message-list gap is reduced from 30px to 4px so the reserved toolbar row supplies nearly all inter-message spacing.
- The pending dots remain inside an empty streaming assistant bubble and therefore remain visible without hovering.

## Verification

- Unit tests prove that only the latest assistant message receives the growth wrapper.
- Side Panel tests prove that the wrapper is enabled and committed height deltas obey the strict 150px scroll guard.
- Existing toolbar, pending, throughput, copy, retry, reduced-motion, lint, typecheck, and build gates remain green.
