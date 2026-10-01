# On The Board — AI Game Show UI prototype

A clickable, mobile-first prototype of the two-player game show described in [ai_game_show_ui_prd.md](ai_game_show_ui_prd.md). An AI host, **Nova**, runs the show. Everything is simulated: there's no backend, no networking, and no real AI.

## Run it

```bash
npm install
npm run dev        # open the printed URL; on desktop it renders inside a phone frame
npm run build      # type-check + production build to dist/
```

Designed for 375×812, 390×844 and 430×932 in portrait. On phones it fills the screen.

## The game loop

Home → Player setup → Lobby → Host intro → Question → 3·2·1·GO → Face-off → Answer locked → Reveal → Correct / Strike → Steal → Board reveal → Round result → Scoreboard → … → Final round (×3) → Winner / Good game → Rematch. A tie after the final round goes to **Sudden death**.

**Rules in the prototype**
- Both players race to lock an answer (15s). Answers are revealed in lock order, and the first one on the board takes that answer's points.
- If the first answer is wrong (a strike), the opponent can steal. If they already locked an answer, it's used. Otherwise they get a fresh 10-second steal window.
- Round 3 is double points and the final round is ×3. A 3-answer streak doubles points in normal rounds.
- The opponent is a simulated player whose speed and accuracy follow the **Difficulty** setting.

## Tester controls (hidden from normal users)

Press **Shift + D** (or **`**), or triple-tap the **LIVE** badge or the round chip. Adding `?dev` to the URL shows a small **SIM** launcher.

- **Simulation mode**: play as Player 1, Player 2, Both (pass & play), or Host (watch two bots).
- **Force**: correct/wrong answer, Player 1/2 wins, timeout, trigger steal, reveal board, final round, force tie.
- **Jump to state**: any screen. The current `SCREEN · PHASE` state is shown at the top of the panel.

## Code map

| Path | What's there |
|---|---|
| `src/game/machine.ts` | The game as an explicit state machine (reducer). Timers, bot behaviour, scoring, and dev commands. |
| `src/game/questions.ts` | Fixture data: 5 boards, 2 sudden-death boards, answer aliases. |
| `src/game/host.ts` | Nova's lines for each event, in 4 personalities. |
| `src/game/match.ts` | Answer matching: normalisation, aliases, typo tolerance. |
| `src/game/GameContext.tsx` | Provider: clock, settings, sound/voice/haptics effects, toasts, reactions. |
| `src/screens/` | One file per screen. `Round.tsx` covers the face-off, answer sheet, reveal, and steal. |
| `src/components/` | Host avatar, answer board, scorebar and timer, overlays, sheets (settings, simulation, share). |
| `src/lib/sound.ts` | Web Audio sound kit: ticks, buzzer, reveal, fanfare, crowd "ooh". No audio files. |

**Stack:** Vite, React 19, TypeScript, Tailwind CSS v4, Motion, Radix primitives (shadcn-style), and Phosphor icons. The host voice uses the browser's Web Speech API.

## Accessibility

Captions for every host line, with a screen-reader live region. Correct/incorrect is always shown with ✓/✕ and text, never by colour alone. Settings include large text, high contrast, and reduced motion (which follows the OS by default). Touch targets are at least 44px, focus rings are visible, and opening Settings mid-round pauses the clock.
