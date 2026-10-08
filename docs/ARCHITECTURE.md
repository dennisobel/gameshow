# On The Board — System Architecture

Status: accepted · Supersedes nothing · Last updated 2026-10-08

This document is for engineers working on this repository. It explains what we are
building, the decisions that shape it, and why each one was made. Where a decision
follows a principle from *AI Engineering* (Chip Huyen), the chapter is cited so the
reasoning can be checked rather than taken on trust.

---

## 1. What we are building

A two-player game show, hosted by an AI character, where players race to name the
answers on a hidden board. The inspiration is the televised survey game — *Family
Feud* and its many national versions — but the product is deliberately its own
thing: its own host, its own scoring, its own board design, its own terminology.

The prototype in `apps/web/src/` already proves the experience works. This document covers
turning it into a product:

| Capability | What it means |
| --- | --- |
| **AI question authoring** | Questions are written, tested and scored by an AI pipeline, not hand-authored. |
| **Categories** | Every question belongs to a category. Players choose one. |
| **Spin** | A player picks a category and gets a fresh 5-round game, instantly. |
| **Share** | Every spun game has a short code and URL. A friend opening it plays the *same* game. |
| **Accounts** | Guest play by default; real accounts for people who want their history kept. |
| **Persistence** | Games, matches, scores and every answer a player types are stored. |

Out of scope for now, by instruction: payments and pay-to-play. Section 11 notes
where they would slot in so nothing we build now has to be undone.

---

## 2. The decision that shapes everything else

**AI is not in the gameplay request path.**

The naive design generates a question when the player presses PLAY. That design
fails on three axes at once:

- **Latency.** A question that has been properly written, survey-tested and judged
  takes tens of seconds to produce. A game show cannot pause for that.
- **Cost.** It puts a model call on the hottest path in the product, paid again on
  every single play, including replays of the same question.
- **Availability.** The model provider becomes a hard dependency of the core loop.
  Their outage is our outage.

So instead: **the AI fills a bank; gameplay reads the bank.** Generation is a
background pipeline. A spin is a seeded sample from already-approved questions and
completes in milliseconds.

This is Huyen's *critical vs complementary* distinction (Ch. 1) resolved
deliberately — the game must work when the AI does not. It is also her guidance
that **proactive features can be precomputed and shown opportunistically, so
latency matters less** (Ch. 1), and that an exact cache is the right answer for
expensive repeated work (Ch. 10, step 4). The question bank *is* that cache, and
it happens to be the product's most valuable asset.

Three consequences follow, and they are all good ones:

1. **We can afford quality.** Because generation cost is amortised over every
   future play of that question, we can spend heavily per question: multiple
   candidates, a simulated survey of 60+ respondents, an independent judge. A
   per-request design could never justify that.
2. **A spin still feels generative.** With a few hundred approved questions per
   category, each spin draws a genuinely different set. Players experience variety
   without us paying for it per play.
3. **Graceful degradation is free.** If the AI service is down, the bank is still
   there and every game plays as normal. (The game server itself is the one thing
   that cannot degrade: a live match runs on it, Section 7A.)

---

## 3. Topology

```
                            Browser (React SPA)
                                    │  HTTPS, JSON + SSE
                                    ▼
                    ┌───────────────────────────────┐
                    │        api  (Go)              │   the only public surface
                    │  auth · categories · spin     │
                    │  share · match · verdicts     │
                    │  feedback · admin review      │
                    └───────┬───────────────┬───────┘
                            │               │ enqueue job / internal call
                   SQL      │               │
                            ▼               ▼
                   ┌─────────────┐   ┌──────────────────────────────┐
                   │ postgres    │   │   ai  (Python, FastAPI)      │
                   │ system of   │◄──┤   LangGraph generation graph │
                   │ record      │   │   writer→panel→board→judge   │
                   │ + job queue │   └──────────┬───────────────────┘
                   └─────────────┘              │ hybrid search
                                                ▼
                                       ┌──────────────────┐
                                       │ qdrant           │
                                       │ dedup · examples │
                                       │ · grounding      │
                                       └──────────────────┘
```

Five services. The browser talks to **one** of them.

**Why the browser never reaches the AI service.** One public surface means one
auth system, one rate limiter, one CORS policy, one audit log. The AI service
holds the provider API key and must never be reachable from a browser — that is
the simplest possible defence against the prompt-attack class in Ch. 5.

**Why Go for the API and Python for the AI.** Instructed, and independently
correct: the CRUD surface benefits from Go's static typing, trivial deployment and
goroutine concurrency; the agent and retrieval ecosystem (LangGraph, embeddings,
Qdrant clients) is Python-first. The seam between them is a job table and a small
internal HTTP contract, not a shared library, so neither language leaks into the
other.

**Why no message broker.** Postgres `SELECT … FOR UPDATE SKIP LOCKED` is a correct
and durable job queue at this scale. Adding Redis or NATS would buy throughput we
do not need and cost a service we would have to operate. Revisit if generation
volume ever justifies it.

**Deviations from the supplied agentic-RAG spec** (`docs/reference/agentic_rag_architecture_stack.md`),
and why:

| Spec says | We do | Reason |
| --- | --- | --- |
| MongoDB for app data + LangGraph checkpoints | Postgres for both | Instructed (Go + Postgres). `langgraph-checkpoint-postgres` covers checkpointing, so we keep one database instead of two. |
| Next.js + Vercel AI SDK | Existing Vite React SPA + SSE | The prototype is built and good. Generation progress needs a token stream far less than it needs a job-status stream. |
| LlamaParse / LlamaIndex ingestion | Deferred | Nothing to parse yet. It returns the moment we support "upload your handbook, get an Office Battle" (Section 11). |
| Cohere Rerank v3 | Interface present, off by default | Honest reason: no key in this environment, and reranking 20→4 matters far less when the retrieval job is *dedup* (a similarity threshold) rather than context assembly. Hybrid + RRF is implemented; the reranker is a pluggable step. |
| LangSmith tracing | Optional, env-gated; Postgres trace table always on | We must not depend on a vendor to answer "why was this question rejected". Every node transition is written to `generation_events` regardless (Ch. 10: observability is not optional). |

Kept from the spec, because they are right: LangGraph as the control plane,
hybrid dense+sparse retrieval with RRF fusion, Qdrant in Docker, total
observability, and the decoupling of agent control flow from retrieval.

---

## 4. How a question gets made

This is the heart of the product. A game-show question is **not** a trivia
question — it has no correct answer. It is a *survey*: the board is whatever a
room full of people actually said, ranked by how many said it. Any design that
asks a model to invent five plausible answers and assign made-up point values
produces questions that feel wrong, because the point values encode nothing.

So we run the survey.

Huyen notes that a foundation model is "an aggregation of the opinions of the
masses" (Ch. 2) and that **AI can simulate humans** for data generation (Ch. 8).
That is exactly the tool this problem needs. The pipeline is a LangGraph state
machine:

```
 plan ─▶ write ─▶ format gate ─▶ novelty ─▶ PANEL ─▶ cluster ─▶ board ─▶ judge ─▶ route
          ▲            │             │                            │          │
          └────────────┴─────────────┴──── revise (max 1) ────────┴──────────┘
                                                                              │
                                              approve ──┬── review ──┬── reject
                                                        ▼            ▼
                                                      bank      human queue
```

| Node | Model role | What it does |
| --- | --- | --- |
| **plan** | writer | Expands a category into subtopics, so a batch covers the category instead of circling one idea. Ch. 8's topic→subtopic recipe for coverage and diversity. |
| **write** | writer | Drafts K candidate questions for a subtopic, given retrieved high-scoring examples from the same category as few-shot context. |
| **format gate** | free | Deterministic checks: length, approved stems, no yes/no, no single-fact trivia, no proper-noun dependency, banned-topic list. Cheap checks run on 100% of candidates (Ch. 4). |
| **novelty** | free + embed | Hybrid search against the existing bank. Rejects near-duplicates. See Section 5. |
| **panel** | panel, parallel | **The survey.** N≈60 simulated respondents, each with a different persona, asked in waves of ~20 per call; one short answer per person. See "Why the panel is asked in waves" below. |
| **cluster** | free + panel | Normalises and merges responses into answer clusters ("phone" / "my cell" / "smartphone" / "simu" → **Phone**). |
| **board** | free | Top 5–8 clusters become the board. Points are derived from real tally share. |
| **judge** | judge — *a different model from the writer* | Scores the question on a rubric: fun, clarity, breadth, fairness, safety — discrete 1–5 with a written reason. |
| **route** | free | approve / review / reject, by thresholds. |

### Model roles

The pipeline asks for a *role*, never a model name. Three roles, each configured
independently (`MODEL_STRONG`, `MODEL_JUDGE`, `MODEL_FAST`), and the split follows
from what each job needs rather than from vendor tiers:

| Role | Default | Why this one |
| --- | --- | --- |
| **writer** | `gpt-5.5` | Quality matters and volume is tiny (a handful of calls per batch). Wants *high* temperature for variety, which every model supports at its default — so the strongest model fits. In a live probe it also followed "never address the player as *you*" far more reliably than the cheaper models, which is a hard gate here. |
| **judge** | `gpt-5.4` | Must differ from the writer (see 4 below), and wants a *low* temperature so that scores are reproducible. `gpt-5.5` rejects any temperature but its default, which rules it out for this role even though it is stronger. |
| **panel** | `gpt-5.4-mini` | ~60 tiny calls per question, so call count dominates cost. It must **not** be a reasoning model: `gpt-5-mini` spent its entire 64-token budget thinking and returned nothing. |

Models differ in which request parameters they accept, and that changes between
releases, so the provider does not keep a list. A 400 that names `temperature` or
`reasoning_effort` makes it drop that parameter *for that model* and remember —
found by calling the model, not by trusting a table that would go stale.

Four properties of this design are worth stating explicitly, because they are
what make the questions good:

**1. Points mean something.** A board answer's points come from the share of the
simulated panel that said it, so "Keys" scoring higher than "Lights" is a tally,
not a number a model made up. (It is a tally of *simulated* people — see "Why the
panel is asked in waves" below for what that does and does not guarantee.)

**2. The panel measures whether the question is any good.** If the 60 responses
scatter across 50 distinct clusters, the question is too open to be playable, and
we reject it on *coverage* — the share of the panel captured by the top answers.
If one answer takes 90%, it is too obvious and we reject it too. This is a
quality signal no amount of prompting the writer could produce, and it is
measured rather than judged.

**3. The panel writes the alias list for free.** Every raw response that clustered
into "Phone" becomes an accepted alias for that answer during play. These are not
synonyms invented by a model — they are the actual spread of phrasings that
appeared when something very like our player base was asked the question. This
makes answer matching dramatically more forgiving, which is the single biggest
source of player frustration in this genre.

**4. The judge is not the writer.** Different model, different prompt, and it
never sees which model wrote the candidate. Ch. 3 documents self-bias — a model
favouring its own output by up to 25% — along with position and verbosity bias.
A judge grading its own homework would quietly approve everything.

This is enforced by configuration, not hoped for: the judge is its own role with
its own model, and the service logs a warning at startup if `MODEL_JUDGE` and
`MODEL_STRONG` are ever set to the same thing. It is also *partial* independence,
and worth being honest about: with a single vendor the two models share training
lineage and some of the same blind spots. Using a judge from a different vendor
would be stronger; the provider interface is the seam for that.

### Why the panel is asked in waves

The first design put one question to sixty respondents as sixty *independent*
calls, each with its own persona. It looked right and it does not work. Measured
against the live model, the panel collapses onto the modal answer however
different the personas are:

| Question | What 60 independent calls said |
| --- | --- |
| A food that leaves a smell in the kitchen | `fish` 54, `fried fish` 6 |
| A place to ask a matatu driver to drop you | `stage` 57, `bus stop` 3 |
| Something people forget leaving the house | `keys` 85%, `phone` 15% |
| A reason someone is late for work | `traffic` 90% |

Age, job and household do not change the *first* thing a model reaches for. This
is the homogenisation Ch. 8 warns about — models over-produce the probable answer
and under-produce the tail. Raising the temperature barely moved it (`Fish` 92% →
87%). The quality gates did their job and refused every one of these boards, which
is why it was noticed: the first live batches banked **1 question in 12**.

What fixed it was asking one call to imagine a *group* of different people
answering in turn. A model that can see it has already said "stage" eight times
varies on its own. On the same questions that gave `Keys 43 / Phone 20 / Wallet 15 /
Lunch 5 / Passport 5` for the first, and a usable spread for four of the five tried.
It is also about six times cheaper, since a panel is three calls instead of sixty.
`PANEL_WAVE_SIZE=1` restores one call per person.

Three things this does **not** do, which matter more than the numbers:

- **It is a simulation, not a survey.** Every board in the AI-written bank is what
  a language model believes people say, shaped by what is common in the text it was
  trained on. It will over-represent some answers and miss locally specific ones
  (asked about matatu stops, the fast model put "Market" first). The
  `submissions` table exists to correct this: answers real players type that the
  board rejects, and questions nobody can solve, are the signal for fixing a board.
  The hand-authored seed bank is the same kind of estimate, written by a person
  rather than sampled.
- **It is no longer independent sampling.** Within a wave the respondents are not
  independent draws. The gates still mean something — the same run correctly
  rejected a question as too narrow ("lights go out" really has three answers) and
  another as too scattered — but "measured from sixty independent people" would
  overstate it.
- **Passing the gates is not the same as being good.** After the change, the
  panel stopped being the bottleneck and the judge became it: on a Kenya batch,
  five of six boards passed the gates and were then scored 3/5 for being safe but
  plain, or for overlapping answers. That is a question-quality problem — the
  writer drifted toward bland domestic prompts — and `MIN_JUDGE_OVERALL` is the
  knob that trades review volume against strictness. It has deliberately not been
  loosened to make the numbers look better.

**Bounded revision.** A rejection from the format gate or the judge is fed back to
the writer once, with the reason, for a single revision attempt. Reflection
materially improves agent output (Ch. 6) but every extra loop multiplies cost and
compounds error, so the loop has a hard bound of one.

**Provenance is recorded for everything.** Every question stores the prompt
version, the model IDs, panel size, the raw tally, the judge's scores and reasons,
token counts, cost and latency. Ch. 8 warns that AI generation obscures data
lineage; Ch. 10 asks us to know *why* an output happened. The `generations` and
`generation_events` tables are the answer to both.

### Human in the loop

Approval thresholds start strict and open up as we gain evidence, following
Microsoft's Crawl-Walk-Run framing (Ch. 1):

- **Crawl (now):** everything lands in the review queue. An editor approves.
- **Walk:** auto-approve above a high combined score; queue the rest.
- **Run:** auto-approve by default; queue only the uncertain and sample the rest.

The gate is a config value, not a code change.

---

## 5. What retrieval is actually for

RAG is in this system because it does three specific jobs, not because the stack
diagram has a vector database on it.

**Deduplication (load-bearing).** Before a question enters the bank we must know
whether we already have it. Dense vectors catch paraphrase — "something you forget
leaving the house" vs "what people leave behind at home" — and sparse BM25 catches
shared rare terms that embeddings smooth away. Neither alone is sufficient, which
is the textbook argument for hybrid search. Candidate lists are merged with
Reciprocal Rank Fusion, `score = Σ 1/(k + rank)` with k=60 (Ch. 6).

**Few-shot examples.** The writer is shown the highest-scoring existing questions
in the same category. Examples beat description for steering output (Ch. 5), and
retrieving them keeps the prompt short and the examples relevant.

**Grounding for locale packs.** Categories like *Kenya*, *Africa* and *Pop Culture*
need the writer anchored to a curated reference corpus, or it will produce
confidently stale or subtly foreign references. This is classic RAG and it is what
lets the product be genuinely local rather than generically global.

Chunking is trivial here — a question is one chunk — so most of the chunking
literature does not apply. Each point carries its category, locale, status and
quality score as payload for filtered search (Ch. 6, contextual retrieval).

---

## 6. Data model

Postgres is the system of record. Qdrant holds only derived vectors and can be
rebuilt from Postgres at any time; it is a cache, not a source of truth.

```
users ──< refresh_tokens
  │
  ├──< games >── categories
  │      │
  │      └──< matches ──< match_rounds >── questions
  │                 │
  │                 └──< submissions >── answers
  │
  └──< feedback

categories ──< questions ──< answers
                   │
                   └── generations ──< generation_events
```

Notes on the parts that carry weight:

- **`questions.status`** — `draft` → `review` → `approved` → `retired`. Only
  `approved` is ever served. Retirement is how a question leaves play without
  destroying the history of matches that used it.
- **`answers.aliases`** — the accepted phrasings from the panel, plus anything
  learned from real play.
- **`games.seed` + `games.question_ids`** — a spin stores both the seed and the
  resolved question list. The share code is therefore reproducible *and* immune to
  later bank changes: your friend plays exactly the game you played, even if a
  question is retired tomorrow.
- **`submissions`** — every answer a player types, matched or not, with the time
  taken. This is the flywheel (Ch. 1, Ch. 10): unmatched answers that many players
  give are alias candidates; questions nobody can crack are retirement candidates.
- **`generation_events`** — one row per graph node transition. The trace.

---

## 7. Keeping the board secret

The prototype matches answers in the browser, which means the browser must know
the answers. Shipping the board to the client before the reveal makes the game
trivially cheatable by anyone who opens devtools.

So **answer checking is server-side.** `GET /v1/games/{code}` returns prompts,
answer *counts* and point values — enough to render a hidden board — but no answer
text. The client posts what the player typed; the API returns the verdict and,
once the round closes, the full board.

Three things make this affordable rather than a compromise:

1. The round trip is ~50 ms, and it lands inside the deliberate 2.3-second reveal
   pause the design already has. The tension beat hides the network.
2. Matching logic lives in one place and can be improved without shipping a client.
3. Every check produces a `submissions` row — the flywheel data — as a side effect
   of being correct rather than as extra instrumentation.

There is no client-side matcher any more, and no bundled questions: the build that
shipped fixtures and a browser-run opponent was a prototype, and it was removed
when live play arrived. What a phone is allowed to know is decided in one place
(`internal/live/view.go`), described next.

---

## 7A. Live play

Two people, two phones, one match. The rule that shapes this part of the system:
**the match runs on the server and nowhere else.** A phone sends what its player did
(pressed start, typed, locked an answer) and receives the state of the show to draw.
It never runs a clock, never judges an answer, and never holds a board slot it has
not earned.

An earlier build did the opposite: each browser ran its own private match against a
server-planned opponent labelled "online". Two people opening the game in two
browsers saw two unrelated games, one of which "answered" for a player who was not
there. Nothing could be made true across two screens while each screen kept its own
clock. The fix was not a transport bolted onto that design; it was moving the match.

### The pieces

```
phone ──WebSocket──▶ nginx ──▶ api ── Room ── Engine   (pure rules, no I/O)
phone ──WebSocket──▶            │      │
                                │      └── persist queue ──▶ Postgres (off the hot path)
                                └── REST: create / peek / join a room
```

- **Engine** (`internal/live/engine.go`) is a pure state machine: no goroutines, no
  I/O, no wall clock. Every call is handed the time. It owns the phases of a round,
  scoring, streaks, steals, sudden death, pausing, and the computer opponent (which
  plays through the same `Lock` path as a person). Because it takes time as an
  argument, the rules are tested on a fake clock, including answers that arrive
  milliseconds apart, and a few hundred randomised whole matches check its invariants.
- **Room** (`room.go`) wraps one engine with two seats and their sockets, and a
  single timer set to the next moment the engine needs attention. All access is under
  one mutex; sends to a phone never block (a phone that cannot keep up is dropped and
  catches up from the next full state).
- **Hub** tracks open rooms, enforces caps (rooms per player, total) and sweeps
  abandoned ones.
- **Persistence** is a queue drained by the room's own goroutine. A slow or failed
  database write costs history, never a round.

### The protocol

JSON over a WebSocket. A phone sends small intentions: `start`, `typing`, `lock`,
`freeze`, `react`, `rematch`, `decide`, `ping`. The server answers with the **whole
state** each time it changes rather than a stream of deltas: a phone that drops for a
few seconds is fully caught up by the next message. The first message is `hello`
carrying a **seat ticket**; the ticket is never in a URL, so it never reaches an
access log.

A seat ticket belongs to a browser *tab* (sessionStorage), not to an account. Two tabs
of one browser share a login but must be two different players, and a reload must put
a player back in their seat.

### What each phone is told

`View(seat)` is the only way state reaches a phone, and it enforces three rules:

1. **You are always player 0.** Each player sees themselves on the left; the view swaps
   seats for whoever is at seat 1, so nothing in the browser knows which seat it holds.
2. **A board slot's text is withheld until it is earned** or the round closes.
3. **The other player's locked answer is just "locked" until the reveal.** They can
   see that you are typing and that you locked in. Never what you wrote.

These are tested on the exact bytes a socket would carry, not on the data structure
they came from, and the randomised test checks them after every step.

### Who was first

Locks arrive one at a time under the room's lock, so "first" is simply the order the
server received them. The first lock stops the clock on both screens at the same
instant and begins the reveal. If it is on the board that player wins the round; if
not, it is a strike and the other player gets a ten-second steal. An answer that
reaches the server during that reveal, from a player whose screen had not yet frozen,
is accepted as second: shown afterwards as "too slow", or used as the steal if the
first answer was wrong. There is deliberately no latency compensation: it would need
the server to trust a client-reported timestamp.

### Dropping and coming back

A dropped connection pauses the show for both players, exactly where it stopped, for
a grace period. Reconnecting (or reloading, which resumes from the stored ticket)
gives the lost time back by shifting every pending deadline. If the grace period
runs out the player who stayed chooses: keep waiting, finish against the computer
from the same question (the leaver's seat becomes the computer), or leave.

### The host's voice

`internal/voice` turns a line into speech through ElevenLabs and keeps the result.
The cache key is a hash of everything that shapes the audio (voice, model, delivery,
words), so a line is paid for once however many players hear it; simultaneous
requests for a new line share one provider call; and a daily character budget stops a
single session spending a plan. Any failure returns a plain status and the browser
falls back to its own voice. The key lives in the API container only.

### Limits, stated

Rooms live in the process's memory, so a restart ends games in progress and a second
API instance would need sticky routing or a shared room store. The match record that
reaches Postgres is written by the server from what it saw; no result is ever
reported by a browser, which is also what makes the leaderboard honest.

---

## 8. Identity

Three facts drive the design: players must be able to start instantly, a share
link must work for a stranger, and anyone who cares about their history should be
able to keep it.

- **Guest first.** `POST /v1/auth/guest` mints a real user row flagged `is_guest`.
  No friction, and every guest already has an identity to attach games to.
- **Upgrade in place.** Setting an email and password on a guest account preserves
  its ID, so the history survives signing up. This is the main reason guests get a
  real row rather than an anonymous token.
- **Argon2id** for password hashing, with per-password salts and tuned parameters.
- **Short-lived JWT access token (15 min) + rotating opaque refresh token.**
  Refresh tokens are stored only as hashes, are single-use, and are revoked as a
  family on reuse — detecting replay of a stolen token.
- **Roles:** `player`, `editor` (review queue), `admin`.

---

## 9. Failure, and what the player sees

Every dependency is assumed to fail, and each failure has a defined player-visible
behaviour. The game show must keep running.

| Failure | Behaviour |
| --- | --- |
| AI service down | No effect on play. Generation jobs queue; the bank is already full. |
| Model provider down/ratelimited | Generation retries with backoff and marks the job `failed` with the reason. Gameplay unaffected. |
| Qdrant down | Generation degrades to trigram-only dedup and logs the degradation. Gameplay unaffected. |
| API unreachable | The app says it cannot reach the game server and offers Retry. There is no offline mode: a live match needs the server, and the bundled fixtures that used to fake one are gone. |
| Postgres down | New games cannot be created. Matches already running continue (the engine is in memory); their history is queued and lost if the outage outlasts the queue. The leaderboard shows an error rather than stale or invented data. |
| A player's connection drops | The show is held for both players for a grace period, then the player who stayed chooses (Section 7A). |
| ElevenLabs down, out of credit, or over the daily budget | The browser's own voice speaks instead. Nothing waits on it. |
| API restarts | Games in progress end, and players are told so. Finished matches were already saved. |

What degrades gracefully is everything *around* a match: the AI pipeline, the vector
store and the voice can each be down without a player noticing. The match itself is
the product, and it has one server.

---

## 10. Observability and cost

Ch. 10 asks for metrics, logs and traces designed around the failure modes you
actually have. Ours:

**Generation quality** — approval rate; rejection reason histogram (format /
duplicate / coverage / judge); mean judge score per criterion; panel coverage
distribution; cost and token count per approved question; p50/p95 wall time.

**Gameplay** — spins per category; board-hit rate per question (too easy / too
hard); unmatched-answer rate (the alias-gap signal); round completion; rematch
rate; share-link opens.

**The one number that matters.** `times_solved / times_served` per question, and
the rate of answers that players type which the board does not accept. A question
bank is good when players feel the board agrees with them. That is the business
metric the quality metrics must be tied to (Ch. 4).

**Cost control.** Panel calls dominate volume, so the panel runs on the cheapest
model that is not a reasoning model, while writing and judging run on stronger
ones — Ch. 10's model-router argument. Every call's tokens and cost are summed
onto the job's row, so the cost of a question is a fact, not an estimate.

Two honest notes on that accounting. Prices are OpenAI's published list prices,
held in one table (`PRICING` in `openai_provider.py`); a model that is not in it
is counted as *unpriced* and the report says its cost is a lower bound, rather
than quietly reporting it as free. And OpenAI's prompt caching is automatic but
only begins at 1,024 prompt tokens, which most of our prompts fall under, so
little caching is expected here: the savings come from call volume and model
choice, not from the cache.

---

## 11. Deliberately deferred

Recorded so that nothing built now blocks them.

- **Real-time multiplayer.** The `matches` model is already two-player and
  server-authoritative; the missing piece is a websocket/SSE transport and a
  server-side clock. No schema change.
- **Payments / pay-to-play.** Excluded by instruction. It would attach to `users`
  and `matches`; nothing in the current model resists it.
- **Custom games from documents** ("Office Battle"). This is where LlamaParse and
  LlamaIndex come back: parse an uploaded document, ground the writer on it, run
  the same graph. The pipeline is unchanged; only the `plan` node's source differs.
- **Swahili and mixed-language packs.** The schema carries `locale` throughout and
  the UI already exposes the setting as *coming soon*; the work is a locale-aware
  panel and judge, not a migration.
- **Preference-tuned question selection.** Once `submissions` has volume, the bank
  can be ordered by measured enjoyment rather than judge score.

---

## 12. Repository layout

A monorepo. Each app keeps the toolchain native to its language (an npm workspace,
a Go module, a `uv` project); the root's `Makefile` and `docker-compose.yml` run
all of it.

```
apps/
  web/              React SPA (Vite) and its nginx image
    src/game/         what the screens draw from, the live connection, host script
    src/api/          API client, auth, hooks
  api/              Go service
    cmd/api           entrypoint
    internal/         http, auth, store, spin, matching, config
    internal/live     the match: engine (pure rules), rooms, WebSocket protocol
    internal/voice    the host's voice: ElevenLabs, cache, daily budget
    internal/store/migrations/   numbered SQL migrations
  ai/               Python service
    app/              FastAPI app, worker
    app/graph/        LangGraph nodes: plan, write, gate, novelty, panel, cluster, board, judge
    app/prompts/      versioned prompt templates (separate from code — Ch. 5)
    app/providers/    openai + deterministic fake, behind one interface
    tests/
docs/               this document, PLAN.md, and the original briefs in reference/
scripts/            helpers the Makefile calls
docker-compose.yml  postgres · qdrant · api · ai · web
```

The one place a monorepo earns its keep here is the wire protocol between the match
server and the phones: `apps/api/internal/live/view.go` and
`apps/web/src/game/wire.ts` describe the same JSON and are changed together, in one
review. They are kept in step by hand; generating one from the other is the obvious
next step if they ever drift.

Prompts live in `app/prompts/` as versioned files, never inline in code: they are
reusable, testable, reviewable by non-engineers and diffable — all four reasons
given in Ch. 5.

---

## 13. Testing strategy

The pipeline must be testable without a model provider, or it is untestable in CI
and on any machine without a key.

Every provider call goes through one interface with two implementations: the real
OpenAI client, and a **deterministic fake** that returns fixture responses
seeded by a hash of the prompt. The fake makes the entire graph — including
clustering, board building, routing and the revision loop — exercisable offline
and reproducible. This is the same discipline Ch. 4 asks for when it says to
evaluate every component independently as well as end to end.

- **Go:** unit tests for matching, spin determinism, auth tokens; integration
  tests against a real Postgres from compose.
- **Python:** graph tests against the fake provider; clustering and board-building
  are pure functions and tested as such.
- **Web:** typecheck and production build; the existing headless browser driver
  replays a full match.
