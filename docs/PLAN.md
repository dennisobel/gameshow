# Build plan

Companion to [ARCHITECTURE.md](ARCHITECTURE.md). Ordered so that each stage is
verifiable on its own and nothing is built on an unproven layer.

Definition of done for the whole plan: `docker compose up` brings up five
services; a visitor can sign in as a guest, pick a category, spin a game, play all
five rounds against the simulated opponent with answers checked server-side, see a
winner, and send a friend a link that reproduces the same game. The AI pipeline
can generate, survey, judge and bank new questions, and its full graph runs in
tests without a model provider key.

---

### Stage 1 — Foundation

- `docker-compose.yml`: postgres 17, qdrant, api, ai, web. Healthchecks on every
  service; dependency ordering by health, not by start.
- `.env.example` with every variable, documented, and safe local defaults.
- `Makefile` for the common loops (`up`, `down`, `migrate`, `seed`, `test`, `generate`).

**Verify:** `docker compose config` parses; postgres and qdrant report healthy.

### Stage 2 — Schema and seed

- Numbered SQL migrations for the model in ARCHITECTURE §6.
- A migration runner embedded in the Go binary, so a container start is a safe
  deploy.
- Seed: 8 categories and the existing prototype questions converted to seed-source
  bank rows, so the system is playable before the AI has produced anything.

**Verify:** migrations apply to an empty database and are idempotent; seed loads;
row counts assert.

### Stage 3 — Go API

Config, structured logging, request IDs, panic recovery, CORS, rate limiting.

- Auth: guest, register, login, refresh rotation, logout, upgrade-in-place.
- Read: categories, game by share code (board hidden).
- Write: spin, start match, submit answer (**server-side verdict**), finish match,
  feedback.
- Admin/editor: review queue, approve/reject, enqueue generation.

**Verify:** `go vet` and `go test ./...` green, including integration tests against
the compose Postgres. Matching and spin determinism covered by table tests.

### Stage 4 — Python AI service

- FastAPI app, health endpoints, internal generate endpoint, queue worker polling
  Postgres with `SKIP LOCKED`.
- Provider interface with two implementations: OpenAI, and a deterministic fake
  for tests.
- LangGraph graph: plan → write → gate → novelty → panel → cluster → board →
  judge → route, with a single bounded revision loop.
- Qdrant hybrid search with RRF for dedup and example retrieval; trigram-only
  degradation when Qdrant is unavailable.
- Prompts as versioned files, each carrying its own version string.

**Verify:** `pytest` runs the whole graph on the fake provider and asserts the
board, the coverage rejection, the duplicate rejection and the revision loop.

### Stage 5 — Wire the web app

- Typed API client, token storage and refresh.
- Category picker and spin on the home screen; `/g/:code` share route.
- Round screen takes verdicts from the server, keeping the existing reveal timing.
- Offline fallback preserved: no API, bundled fixtures, local matching, and the UI
  says results are not being saved.

**Verify:** `tsc --noEmit` and `vite build` clean; headless driver plays a full
match against the real API.

### Stage 6 — End-to-end

- Bring the whole stack up from clean, migrate, seed, run a scripted full match
  through a real browser, screenshot each screen.
- Run the generation pipeline against the fake provider end to end and confirm a
  question lands in the review queue with its full provenance row.
- README: how to run it, how to run it with a real key, how to run the tests.

**Verify:** no console errors; a share link opened in a second browser context
yields an identical question sequence.

---

## Risk register

| Risk | Mitigation |
| --- | --- |
| The model provider may behave differently from the fake used in tests | **Realised, and it mattered.** The fake provider passed everything; the first live batches banked 1 question in 12, because 60 independent model calls collapse onto the modal answer. Found by running it, diagnosed from the raw panel output, fixed by asking for a wave of ~20 people per call, and re-measured. The fake now mimics a wave, but a fake can only ever confirm what its author already believed: the live run is the test. |
| Panel of 60 is slow or costly | Waves of ~20 per call make a panel 3 calls, not 60: a generation batch dropped from about $0.23 to $0.06-0.15 live. Per-job cost is recorded on the row; panel size is bounded at both the API and the worker, because it multiplies spend. |
| A queued job is run twice | **Realised.** The API wrote the job row and then a "nudge" that enqueued a second copy, doubling every batch. Reproduced for free on the fake provider, fixed so that the nudge can only wake the worker, and re-verified: one request, one row. |
| "Online" play was shipped as a simulation | **Realised, and it cost trust.** Create and Join were screens that faked a friend arriving after a timer, and the "online" opponent was a bot planned by the server but played inside the player's own browser. Anyone with two browsers saw two unrelated games, one of which "answered" for somebody who was not there. Nothing had been wrong in a unit test; it was wrong in the experience. Fixed by moving the match onto the server (Section 7A of the architecture), removing the simulated opponent from anything labelled online, and checking the result the way the complaint was made: two different browsers, played at once. |
| A match run in the browser can be cheated, and a score reported by the browser cannot be trusted | **Realised in the old design**: `/finish` accepted whatever scores the client sent, and the leaderboard ranked them. With the match on the server there is no endpoint that takes a result from a client, and the leaderboard counts only server-scored games between two different people. |
| The first-answer rule is only fair if both phones see the same clock | One clock, on the server. Each phone is told server times and converts them with a measured offset; the first lock freezes the clock on both screens at the same instant. Verified with two real browsers and, in the Go suite, with two clients given different network delays. |
| A paid voice makes every new line cost money | Lines are cached by a hash of what shapes the audio, simultaneous requests share one call, a daily character budget caps spend, and any failure falls back to the browser's voice. Measured on the live key: the expressive model was about five seconds a sentence, so the fast models are the default. |
| Scope: five services and a full rewrite of the client | Stages are independently verifiable; the client keeps working offline at every stage, so a half-finished API never breaks the game. |
| Server-side verdicts add latency to play | The reveal already pauses 2.3s; the check lands inside it. Measured, not assumed. |
| Docker Desktop instability on the host | Every service also runs natively (`go run`, `uvicorn`, `vite`); compose is the deployment target, not the only path. |
