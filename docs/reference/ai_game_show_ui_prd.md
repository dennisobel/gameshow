# AI Game Show — UI Mockup PRD

## 1. Product Concept

A mobile-first multiplayer game-show application where **two players compete head-to-head while an AI game-show host runs the show**.

The experience should feel less like a quiz app and more like a **televised game show compressed into a phone screen**: dramatic countdowns, host reactions, hidden answers, sound cues, score changes, streaks, and short moments of tension.

The AI host is the personality layer. It introduces the round, reads the question, reacts to answers, celebrates correct answers, calls out mistakes, and announces the winner.

For the prototype, **everything is simulated**. There is no backend, real multiplayer networking, real AI, authentication, or persistent game data.

The UI should nevertheless behave as though all of those systems exist.

---

## 2. Prototype Objective

The prototype should allow someone to open the app and play through a complete simulated match.

A tester should be able to experience:

**Home → Create/Join Game → Lobby → Match Start → AI Host → Question → Two-player Face-off → Answer → Reveal → Score → Next Round → Final Round → Winner**

Every important tap should transition to another screen or UI state.

---

## 3. Core Game Concept

### Players

Two players:

- Player 1
- Player 2

Each player has:

- Name
- Avatar
- Score
- Streak
- Optional reaction/emote

### Question Format

Each round contains a question with several hidden answers.

Example:

> **Name something people forget when leaving the house.**

Hidden board:

```text
01  ███████████████
02  ███████████████
03  ███████████████
04  ███████████████
05  ███████████████
```

Possible simulated answers:

```text
Keys
Phone
Wallet
ID
Lights
```

### Face-Off

Both players are presented with the same question.

A short countdown begins:

```text
3
2
1
GO!
```

Each player gets an answer input.

The UI should simulate simultaneous competition by showing both player answer states on-screen:

```text
PLAYER 1              PLAYER 2

[ Type answer... ]     [ Type answer... ]

     SUBMIT               SUBMIT
```

The first valid answer submitted wins the face-off.

### Scoring

For the prototype:

- Correct answer → points awarded.
- First player to submit a correct board answer receives the round point.
- Incorrect answer → strike/error animation.
- If both answers are submitted, the UI determines the outcome based on simulated submission order.
- The AI host announces the result.

---

## 4. Feature Brainstorm

### Game Mechanics

#### Face-Off

Both players answer simultaneously. The first correct answer wins.

#### Classic Board

A question has 3–8 hidden answers that are progressively revealed.

#### Streaks

Consecutive correct answers increase a player's multiplier.

```text
🔥 3 ANSWER STREAK
×2 POINTS
```

#### Steal

After an incorrect answer, the opponent gets a chance to steal the round.

#### Double Points

Occasional rounds automatically award 2× points.

#### Final Round

The final question carries substantially more points.

#### Lightning Round

Questions become extremely short:

```text
10 SECONDS
5 QUESTIONS
GO!
```

#### Sudden Death

If scores are tied after the final round:

> **ONE QUESTION. ONE ANSWER. WINNER TAKES ALL.**

#### Risk / Wager

Players can optionally wager points before certain rounds.

#### Power-Ups

Possible future power-ups:

- **Double Down** — double the points.
- **Second Guess** — change an answer once.
- **Freeze** — add 3 seconds.
- **Peek** — reveal one board answer.

For the first prototype, these can simply exist as visual UI states.

---

## 5. AI Host Features

The host should be one of the most important visual elements.

### Host Personality

Possible host styles:

- Friendly
- Funny
- Sarcastic
- Dramatic
- Competitive
- Family-friendly
- Deadpan

### Host Reactions

Examples:

**Correct**

> “OH! That's on the board!”

**Wrong**

> “Nope. I'm afraid that's not there.”

**Close Game**

> “This is getting VERY interesting.”

**Final Answer**

> “This could decide the entire game.”

### Host Animation

The avatar should:

- Speak
- Change facial expression
- React to answers
- Celebrate
- Look surprised
- Shake head
- Announce scores

### Voice Controls

Prototype UI:

```text
🔊 Host Voice
ON
```

and:

```text
Text captions
ON
```

---

## 6. Social Features

### Reactions

Players can send:

😂 😱 😎 🔥 👀 😭

### Taunts

Short preset reactions:

> “Too easy.”

> “You're cooked.”

> “I knew that one.”

### Audience

Simulated audience reactions:

```text
👏👏👏👏
OOOOHHHH!
🔥🔥🔥
```

### Spectator Mode

Future option for friends to watch the game.

### Share Result

Generate a game-result card:

```text
DENNO
🏆 WINNER

23 — 17

“I survived the final round.”
```

---

## 7. Content Features

### Categories

Possible categories:

- General Knowledge
- Food
- Movies
- Music
- Football
- Kenya
- Africa
- Technology
- Relationships
- Childhood
- Travel
- Work
- Pop Culture

### Question Difficulty

```text
Easy
Medium
Hard
Insane
```

### Custom Games

Players could eventually create games such as:

> **“Office Battle”**

with questions about their company.

### Regional Questions

Potential future modes:

- Kenya
- East Africa
- Africa
- Global

### Language

Future options:

- English
- Swahili
- Mixed English/Swahili

---

## 8. Home Screen

The home screen should immediately communicate:

**“You're about to play a game show.”**

### Layout

```text
┌──────────────────────────┐
│                          │
│       🎤 AI HOST         │
│                          │
│       QUIZ SHOW          │
│                          │
│  Challenge another       │
│  player.                 │
│                          │
│   [ PLAY NOW ]            │
│                          │
│   [ CREATE GAME ]         │
│   [ JOIN GAME ]           │
│                          │
│  Daily Challenge          │
│  Leaderboard              │
│                          │
└──────────────────────────┘
```

The primary CTA should dominate the screen.

---

## 9. Player Setup

After tapping **Play Now**:

```text
WHO'S PLAYING?

PLAYER 1

[ Avatar ]

Name
[ Denno              ]

[ CONTINUE ]
```

Then:

```text
PLAYER 2

[ Avatar ]

Name
[ Player 2           ]

[ READY ]
```

For the prototype, player 2 can use mocked data such as:

> Alex

---

## 10. Lobby

```text
┌──────────────────────────┐
│       GAME LOBBY         │
│                          │
│      🎤                  │
│    AI HOST               │
│                          │
│   DENNO       VS       ALEX
│     ●                    ●
│                          │
│      READY ✓             │
│      READY ✓             │
│                          │
│      GAME SETTINGS       │
│                          │
│ Category   General       │
│ Rounds     5             │
│ Difficulty Medium        │
│                          │
│       [ START ]          │
└──────────────────────────┘
```

---

## 11. Match Introduction

Transition into a dramatic full-screen host experience.

```text
🎤

WELCOME,
DENNO!

versus

ALEX!

5 ROUNDS.
ONE WINNER.

[ LET'S PLAY ]
```

The host can appear large and animated.

Use a strong transition here rather than immediately jumping into the question.

---

## 12. Game Screen

This is the primary screen and should receive the most design attention.

### Recommended Structure

```text
┌──────────────────────────┐
│ ROUND 2 OF 5        ⚙    │
│                          │
│ DENNO          ALEX      │
│  12              10      │
│                          │
│ ──────────────────────── │
│                          │
│ 🎤 AI HOST               │
│                          │
│ “Name something people   │
│  forget before leaving.” │
│                          │
│ ┌──────────────────────┐ │
│ │ 01  ███████████████  │ │
│ │ 02  ███████████████  │ │
│ │ 03  ███████████████  │ │
│ │ 04  ███████████████  │ │
│ │ 05  ███████████████  │ │
│ └──────────────────────┘ │
│                          │
│       00:07              │
│                          │
│ [ ANSWER ] [ ANSWER ]   │
└──────────────────────────┘
```

On very small screens, player controls should become stacked.

---

## 13. Answer State

When the player taps **Answer**:

```text
WHAT'S YOUR ANSWER?

┌─────────────────────────┐
│ Your answer...          │
└─────────────────────────┘

          00:05

[ LOCK ANSWER ]
```

Use a large touch-friendly input.

The input should feel closer to a game control than a standard form.

---

## 14. Answer Submitted State

Once submitted:

```text
ANSWER LOCKED

“PHONE”

          00:03

Waiting for opponent...
```

Do not immediately reveal whether it is correct.

Create a short tension period.

---

## 15. Reveal Animation

Example:

```text
          PHONE

            ↓

     ┌─────────────────┐
     │  02              │
     │  PHONE      +5   │
     └─────────────────┘

      🎤 AI HOST

“YES! PHONE IS ON THE BOARD!”
```

The board answer should physically flip/reveal.

Use sound, vibration/haptics and animation in the prototype where supported.

---

## 16. Incorrect Answer State

```text
          ✕

      NOT ON THE BOARD

         Strike!

        ❌

🎤

“OOOH... NOT THIS TIME.”
```

The strike should feel dramatic.

Then transition to:

```text
ALEX HAS A CHANCE TO STEAL

[ ANSWER ]
```

---

## 17. Score Animation

Don't simply change:

```text
12 → 17
```

Animate it.

Example:

```text
DENNO
12

      +5

17
```

The score can briefly enlarge and pulse.

---

## 18. Round Result

After the answer sequence:

```text
ROUND 2 COMPLETE

        DENNO
         +5

        17

────────────────

ALEX
10

[ NEXT ROUND ]
```

The host gets the final word:

> “Two rounds down. And we've got a game!”

---

## 19. Between-Round Screen

This creates breathing room.

```text
━━━━━━━━━━━━━━━━━━

       SCOREBOARD

      DENNO   17
       ALEX   10

━━━━━━━━━━━━━━━━━━

          🎤

“Ready for round three?”

[ CONTINUE ]
```

---

## 20. Final Round

Make this visually different from normal rounds.

```text
          FINAL ROUND

         🔥🔥🔥

       30 POINTS

      DENNO   17
      ALEX    16

“THIS CHANGES EVERYTHING.”

[ ENTER FINAL ROUND ]
```

The UI should communicate that this matters.

---

## 21. Victory Screen

```text
┌──────────────────────────┐
│                          │
│        🏆 WINNER         │
│                          │
│          DENNO           │
│                          │
│           27             │
│                          │
│       ALEX               │
│        23                │
│                          │
│  🎤 “WHAT A GAME!”       │
│                          │
│ [ PLAY AGAIN ]           │
│                          │
│ [ SHARE RESULT ]         │
└──────────────────────────┘
```

Use celebratory animation.

---

## 22. Losing Player State

Avoid making the loser feel punished.

```text
GOOD GAME.

ALEX
23

DENNO
27

🎤

“That was CLOSE.”

[ REMATCH ]
```

---

## 23. Navigation Architecture

```text
HOME
 │
 ├── PLAY NOW
 │     │
 │     ├── PLAYER SETUP
 │     │
 │     ├── LOBBY
 │     │
 │     └── MATCH INTRO
 │              │
 │              ▼
 │           ROUND
 │              │
 │       ┌──────┴──────┐
 │       ▼             ▼
 │    CORRECT        WRONG
 │       │             │
 │       │          STEAL
 │       │             │
 │       └──────┬──────┘
 │              ▼
 │        ROUND RESULT
 │              │
 │              ▼
 │        SCOREBOARD
 │              │
 │        ┌─────┴─────┐
 │        ▼           ▼
 │     NEXT ROUND   FINAL
 │                    │
 │                    ▼
 │                RESULTS
 │
 ├── CREATE GAME
 │
 ├── JOIN GAME
 │
 └── SETTINGS
```

---

## 24. UI State Machine

The prototype should model game states explicitly.

```text
HOME
↓
SETUP
↓
LOBBY
↓
INTRO
↓
QUESTION
↓
COUNTDOWN
↓
ANSWERING
↓
ANSWER_LOCKED
↓
REVEAL
↓
ROUND_RESULT
↓
SCOREBOARD
↓
NEXT_ROUND
↓
FINAL_ROUND
↓
GAME_RESULT
```

Additional branches:

```text
ANSWERING
   ↓
WRONG
   ↓
STEAL
   ↓
REVEAL
```

and:

```text
ANSWERING
   ↓
TIME UP
   ↓
OPPONENT ANSWER
```

---

## 25. Simulated Multiplayer Behavior

Because there is no backend, the UI should **fake multiplayer intelligently**.

For example, when Player 1 submits:

```text
ALEX IS ANSWERING...

● ● ●
```

Then the prototype can automatically generate:

> Alex submitted “Wallet”

This gives the impression that another player is connected.

Another option is a prototype toggle:

```text
SIMULATION MODE

Player 1
Player 2
Host
```

This is useful for testing every state without requiring two devices.

---

## 26. Prototype-Only Controls

Add a hidden developer/prototype panel.

```text
SIMULATION

[ Correct Answer ]
[ Wrong Answer ]
[ Player 1 Wins ]
[ Player 2 Wins ]
[ Timeout ]
[ Trigger Steal ]
[ Reveal Board ]
[ Final Round ]
[ Force Tie ]
```

This should not appear in the normal user experience.

It will make UI testing dramatically easier.

---

## 27. Visual Design Direction

### Overall Feeling

Think:

**TV game show + modern mobile game + conversational AI.**

Avoid making it look like:

- A corporate quiz app
- A school examination
- A generic trivia app
- A chatbot

### Typography

Use large, bold typography for:

- Questions
- Scores
- Countdown
- Round numbers
- Results

Use smaller typography for supporting information.

### Shapes

Prefer:

- Large cards
- Strong game panels
- Big buttons
- High contrast
- Minimal navigation chrome

Avoid excessive tiny UI elements.

---

## 28. AI Host Design

The host is essentially the application's **main character**.

A good prototype could use a stylized host avatar rather than attempting photorealism.

Host container:

```text
      ┌───────────────┐
      │               │
      │   AI HOST     │
      │               │
      │   animated    │
      │     avatar    │
      │               │
      └───────────────┘

   “Let's see if that's
      on the board...”
```

The host can occupy different amounts of the screen depending on the moment.

During answering: **smaller**.

During announcements: **larger**.

During victory: **full-screen**.

---

## 29. Motion Design

Motion is important because this is a game show.

Use animations for:

- Countdown
- Question entrance
- Board reveal
- Correct answers
- Wrong answers
- Score changes
- Host reactions
- Round transitions
- Final result
- Winner celebration

The prototype should feel alive even with static/mock data.

---

## 30. Sound / Haptic UI

Expose sound settings:

```text
GAME SOUND        ON
HOST VOICE        ON
MUSIC             ON
HAPTICS           ON
```

Important moments should have distinct feedback:

**Countdown** — tick / tick / tick

**Correct** — reveal + success sound

**Wrong** — buzzer

**Victory** — celebration

---

## 31. Responsive Mobile Behavior

Design primarily for:

- 375 × 812
- 390 × 844
- 430 × 932

Portrait orientation should be the default.

Buttons should generally be large enough to comfortably tap with one thumb.

Important controls should remain near the lower portion of the screen.

Avoid desktop-style navigation.

---

## 32. Accessibility

The prototype should support:

- Large text
- High contrast
- Captions for host dialogue
- Sound-independent feedback
- Color-independent correct/incorrect states
- Reduced-motion setting

Do not communicate correctness only through green/red.

Use:

```text
✓ CORRECT
✕ WRONG
```

as well as visual styling.

---

## 33. Settings Screen

Minimal settings:

```text
SETTINGS

Host Voice             ON
Game Sounds            ON
Music                  ON
Haptics                ON

Host Personality
[ Funny ▼ ]

Difficulty
[ Medium ▼ ]

Language
[ English ▼ ]

[ ABOUT ]
```

---

## 34. Recommended MVP Prototype Scope

Do **not** try to build every brainstormed feature into the first mockup.

The clickable prototype should focus on one excellent game loop:

**Home → Player Setup → Lobby → Host Intro → Question → Face-Off → Answer → Reveal → Score → Next Round → Final Round → Winner**

Use one category and approximately **5 mocked questions**.

Include:

- AI host
- Two players
- Countdown
- Answer input
- Hidden answer board
- Correct answer
- Wrong answer
- Strike
- Steal
- Score animation
- Round transitions
- Final round
- Winner screen
- Rematch

Everything else can live behind placeholder UI.

---

## 35. Prototype Data

Use hardcoded mock data.

Example:

```text
Question:
“Name something people forget before leaving the house.”

Answers:
1. Keys
2. Phone
3. Wallet
4. ID
5. Lights
```

Second example:

```text
Question:
“Name something you might find in a refrigerator.”

Answers:
1. Milk
2. Eggs
3. Cheese
4. Vegetables
5. Juice
```

This is **UI fixture data**, not a backend requirement.

---

## 36. Key UX Principle

The application should make the user feel that **the host is running the show**, rather than that the user is navigating an app.

Transitions should generally feel like:

> **Host speaks → player reacts → game changes**

rather than:

> **User navigates menu → user navigates submenu → user presses button**

The AI host is the connective tissue between game states.

---

## 37. Final Prototype Acceptance Criteria

The UI mockup is successful when a first-time user can:

1. Launch the app.
2. Start a game.
3. Set two player names.
4. Reach the lobby.
5. Start the match.
6. Hear/read the AI host introduction.
7. See a question and hidden answer board.
8. Experience a countdown.
9. Enter an answer.
10. See the simulated opponent respond.
11. See the answer revealed.
12. See correct/incorrect feedback.
13. See the score change.
14. Move to another round.
15. Experience a final round.
16. See a winner.
17. Start a rematch.

No backend functionality should be necessary to demonstrate any of those interactions.

---

## 38. Product Direction Note

For the first UI version, avoid trying to replicate *Family Feud* literally. Borrow the underlying tension of a televised survey game, but give the product its own visual identity, host personality, terminology, scoring system, and board design.

That will make the eventual product easier to differentiate and gives the AI host room to become the defining part of the experience.
