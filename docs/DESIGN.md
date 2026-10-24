# Design system

OpenSourceEditor is a dark graphite editor with emerald and cyan accents. The rules below are what keeps it consistent; the tokens live in `src/styles/tokens.css` and are the only place colours are defined.

## Colour
| Role | Token | Value |
|---|---|---|
| App background / panels / raised (menus, dialogs, active tab) | `--bg` `--panel` `--raised` | `#101416` `#171D1F` `#1D2527` |
| Wells (text fields), canvas surround | `--inset` `--canvas` | `#0D1213` `#0B0F10` |
| Borders | `--line` `--line-strong` | `#303B3D` `#3F4D50` |
| Text: primary / secondary / muted | `--text` `--text-2` `--muted` | `#E7EEEE` `#A4B4B5` `#8A9D9F` |
| Emerald: selection, focus, active state, the primary action | `--accent` | `#45D6A0` |
| Cyan: playhead, keyframes, markers, informational highlights | `--cyan` | `#57C9D8` |
| Error / warning | `--danger` `--warn` | `#F08A85` `#E0B052` |

The suggested muted text `#748587` measured 4.42:1 on panels and 4.05:1 on raised surfaces, below WCAG AA (4.5:1), so it was lifted to `#8A9D9F`. `tests/contrast.test.ts` fails the build if any text token drops below 4.5:1 on any surface it is used on, or if the accent colours lose contrast against their backgrounds.

Colour is never the only signal: media kinds also have glyphs, state also has text or an icon.

## Glass (about a tenth of the interface)
Translucency (`--glass`, `backdrop-filter: blur`) is used only on floating layers: menus and context menus, dialogs, the command palette, tooltips, and the landing call-to-action. The timeline, media bin, Inspector, layer panel and canvas are solid. Blur is applied only where `backdrop-filter` is supported, and the layer is already legible without it.

## Shape, size, space
- Control heights 28 px (24 px for compact), minimum target 24 x 24 px (checked in `tests/browser/smoke-inspector.cjs`).
- Radii 2 / 3 / 4 px. No pills, no large cards.
- 4 px spacing rhythm (`--s1`..`--s6`).
- One icon set (`src/ui/Icon.tsx`), 12 to 18 px, stroke only. No emoji.

## Motion
Short (90 to 140 ms), ease-out, and only for things that need to read as a change: dialogs and menus appearing, drawers opening, hover and press feedback, the landing page entrance. `prefers-reduced-motion: reduce` removes all of it (tested).

## Inspector language
- Clips: **Basic** (position and size, opacity, crop, speed, transition), **Audio**, **Color**, **Effects**, **Advanced** (keyframes, exact placement in pixels, timing). Text clips: Text, Basic, Style, Advanced.
- Photo layers: **Arrange**, **Appearance**, **Color**, **Effects**, **Mask** (plus Text / Shape / Adjust / Children where the layer type has them).
- Technical terms get a one-line description: as a tooltip and as `aria-description` on the slider. Each section may carry one short hint line. Nothing is hidden behind a mode switch.
- A number field and a slider for the same value always edit the same document value (Basic and Advanced show one position in % and in pixels).
- Effects are a fixed set of adjustable looks, not an ordered stack, so the Applied list offers "remove" (back to neutral) rather than reorder or disable.
- With nothing selected, the Inspector shows a getting-started list whose ticks come from the real project state.
