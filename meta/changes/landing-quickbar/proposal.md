# Landing quickbar: expressions + speak on stage, gear for tuning

## Why

Owner: "the landing page should be combined a little - have an option for
speak and the emotions, and then a settings icon that opens the tuning
panel intuitively." Expressions and speak were buried in the hidden tuning
panel; the "tune" text button was not an obvious settings affordance.

## What

- A stage quickbar (bottom centre, always visible) carries the seven
  expression buttons and speak; they move OUT of the tuning panel. Active
  expression highlighted; neutral pre-selected.
- The "tune" text button becomes a gear icon (U+2699) with title/aria
  label; behaviour unchanged (?tune still auto-opens).
- Speak hardening: an audio ERROR from SpeechSynthesis no longer cancels
  the 3.5 s viseme window (voiceless/headless contexts kept killing the
  visual demo instantly); only natural audio end closes it early.

## Non-goals

- No src/ changes; engine demo and harnesses untouched.

## Affected nodes

- hologlyph.adapter (demo landing page only)
