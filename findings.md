# Findings: Provider settings UX refinement

## Requirements

- Implement the approved Provider settings UX audit recommendations.
- Keep provider-specific request dialects hidden from users.
- Keep useful reasoning strength control while preserving a simple flow.

## Research Findings

- The current Provider form has one flat `grid-two` card: endpoint, key, model, temperature, reasoning controls, and raw JSON share a visual level.
- The connection test sends its result through the same global toast used for autosave, so users cannot distinguish save state from connectivity state.
- A `FieldError` is a separate grid child; a non-full model error can appear under a neighboring input instead of its own field.
- UI/UX guidance supports visible form labels, inline error feedback, loading/success feedback, native controls, and progressive disclosure for complex inputs.

## Technical Decisions

| Decision                                           | Rationale                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Use semantic `fieldset` and `legend` groups        | They convey grouping to visual and assistive-technology users.                |
| Use native `details`/`summary` for advanced JSON   | Keyboard-accessible progressive disclosure without a custom disclosure state. |
| Pass a distinct connection status to `OptionsView` | Prevents autosave toast text from being presented as a connection result.     |
| Wrap field and error together                      | Preserves layout and associates every error with the correct control.         |

## Resources

- `src/options/App.tsx`
- `src/options/App.css`
- `tests/unit/options/App.spec.tsx`
