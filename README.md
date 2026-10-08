# On The Board

A two-player game show, hosted by an AI character called Nova. Players race to
name the answers on a hidden board. The questions are written, survey-tested and
scored by an AI pipeline, then banked by category so a player can spin a fresh
game and share it with a friend.

The board is a *survey*, not a quiz: an answer is worth as many points as there
were people (out of 100) who gave it. Be clear about whose answers those are: the
hand-written starter bank holds a person's estimates, and the AI-written questions
hold a *simulated* panel's — a model's idea of what people say, not a poll. Real
play data is what corrects both (see "Known limitations").

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — the design and the reasons
  behind it.
- **[docs/PLAN.md](docs/PLAN.md)** — the build plan this was delivered against.
- **[docs/reference/](docs/reference/)** — the original UI brief and the agentic-RAG spec this was built from.

---

## Run it

Needs Docker. No key is required to run it: without an OpenAI key the generation
pipeline runs on a deterministic fake provider, and without an ElevenLabs key the
host speaks with the browser's built-in voice. The game plays on the seeded bank
either way.

```bash
cp .env.example .env     # optional; every value has a working default
make up                  # or: docker compose up -d --build
```

| | |
| --- | --- |
| Game | <http://localhost:8088> |
| API | <http://localhost:8090/healthz> |
| Generation service | <http://localhost:8000/docs> |

`make up` also publishes the API, the AI service, Postgres and Qdrant on
`127.0.0.1` for local tools (`docker-compose.dev.yml`). A server does not: see
"Deploying to a server".

The API applies its migrations and loads the seed bank on start, so the game is
playable the moment the stack is up. `make down` stops it; `make clean` also
deletes the data.

**Starting clean.** Everything a player creates (accounts, games, matches, the
leaderboard) lives in Postgres alongside the question bank. `make reset-players
CONFIRM=yes` deletes all of the former and keeps the latter, the AI generation
history and the paid-for host voice. Do it after testing and before inviting
anyone, so the leaderboard starts empty.

Ports are set in `.env`. The defaults avoid the Windows reserved ranges and a
few common local services; change them there if any clash.

**Keys** live only in `.env`, which is gitignored and excluded from every image.
`OPENAI_API_KEY` goes to the generation service and nowhere else.
`ELEVENLABS_API_KEY` goes to the API container and nowhere else; browsers never
see either, they ask the API for a line and get audio back.

### Without Docker

```bash
# Postgres and Qdrant still come from compose
make db

make install                       # npm workspaces, Go modules, uv: once

# one terminal each
cd apps/api && DATABASE_URL="postgres://ontheboard:ontheboard@localhost:15432/ontheboard?sslmode=disable" \
               HTTP_ADDR=":8090" go run ./cmd/api

cd apps/ai  && DATABASE_URL="postgres://ontheboard:ontheboard@localhost:15432/ontheboard" \
               QDRANT_URL="http://localhost:16333" uv run uvicorn app.main:app --port 8000

# from the repository root; the page and the API are on different ports in dev,
# so it needs the API's address (or copy apps/web/.env.example to .env.local)
VITE_API_URL=http://localhost:8090 npm run dev
```

---

## Deploying to a server

```bash
git clone git@github.com:dennisobel/gameshow.git && cd gameshow     # or, to update: git pull
./scripts/deploy.sh --check     # is the port free? what would .env gain? changes nothing
./scripts/deploy.sh             # check, create .env with real secrets, build, start, wait
```

**One port.** On a server the stack uses `docker-compose.yml` on its own, which
publishes only the web app (`WEB_PORT`, default 8088). nginx serves the game and
proxies `/v1`, WebSockets included, to the API over the stack's private network.
Postgres, Qdrant, the API and the AI service have no host port at all. So on a machine
that hosts other projects there is exactly one number to keep free; `deploy.sh`
refuses to start, changing nothing, if something else already holds it and names a
free one; and no database is ever reachable from the internet, even when a firewall
allows every port (Docker publishes ports around the host firewall, so a firewall
rule is not protection for a published port). The local-development ports live in
`docker-compose.dev.yml`, bound to `127.0.0.1`.

**Secrets.** `deploy.sh` creates `.env` (mode 600) with `APP_ENV=production` and fresh
random `JWT_SECRET`, `AI_SERVICE_TOKEN` and `POSTGRES_PASSWORD`, and never changes a
value that is already there. Add `OPENAI_API_KEY` and `ELEVENLABS_API_KEY` yourself
for AI-written questions and the host's voice; without them the stack still runs, on
the offline fake provider and the browser's voice.

**Plain HTTP.** Served from a bare IP the game is at `http://<ip>:<port>`. The game,
its WebSockets and the voice all work. Browsers disable the clipboard API on such
pages, so the copy and invite buttons fall back to an older method and, failing that,
show the code or link to read out. For HTTPS, terminate TLS in a reverse proxy and
point it at the web port.

**Backups.** The data is in two Docker volumes, `ontheboard_postgres-data` and
`ontheboard_qdrant-data`. A dump of the database:
`docker compose exec -T postgres pg_dump -U ontheboard ontheboard > backup.sql`.

---

## Playing

### With a friend

Press **Play a friend**, give yourself a name, and a room opens with a four-letter
code and an invite link. Send either to your friend, who can be on any phone in
any city. They open the link (or press **Join game** and type the code), enter
**their own** name, and appear in your lobby the moment they arrive. **Either of
you can press Start**: the game begins on both phones at the same instant.

From there the server runs the show. The countdown, the clock, the reveals and
the move to the next round all happen on the server and are pushed to both
phones, so the two screens cannot disagree and nobody has to tap "next".

**Who answers first.** Both players type at the same time. Each phone shows that
the other player is *typing*, and then that they have *locked in*, but never what
they wrote until it is revealed to both. The first answer to reach the server
stops the clock on both screens:

- if it is on the board, that player wins the round, and the slower answer is shown
  afterwards as "too slow";
- if it is not, it is a strike, and the other player gets a ten-second steal.

"First" means *first to reach the server*, not whose finger was quicker on a faster
phone or network. There is no latency compensation, so a very slow connection is a
real disadvantage (see Known limitations).

**If someone drops.** Losing signal pauses the show for both players, exactly where
it stopped, for 30 seconds. If they return (or reload the page) they are put back
in the same round and the clock they lost is given back. If they do not, the player
who stayed chooses: keep waiting, finish against the computer from the same
question, or leave.

**Rematch** needs both players to ask, and deals a fresh board from the same
category.

**Playing across cities.** Two people on the same machine or network need nothing
more than `http://<your-address>:8088`. To play someone elsewhere the game has to
be reachable from the internet. For a quick test, `make tunnel` opens a temporary
public address with [Cloudflare's free quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
(install `cloudflared`, or set `CLOUDFLARED=/path/to/it`; no account is needed and
the address changes every time). **Open that address in your own browser too and
create the game from there**: the invite link is built from the page you are on, so
a game created on `localhost` would hand your friend a link that only opens on your
computer. The lobby warns you if you do. While the tunnel runs, anyone who has the
address can reach the game, so close it (Ctrl+C) when you are done, and set your own
`JWT_SECRET` first (see `.env.example`): the development default is public.

### Against the computer

**Play computer** opens a room with the computer in the other seat. It is labelled
as the computer everywhere, it is judged by exactly the same rules, and it can be
paused. Difficulty is in Settings. These games do not count for the leaderboard.

### Leaderboard and sharing

The leaderboard counts wins in **live games between two different people**, scored
by the server. It starts empty. Nothing on it is invented, and nobody can post a
score of their own: the browser never reports a result.

The result screen offers a link like `http://localhost:8088/g/N3Q8FW`. Whoever
opens it plays the *same five questions in the same order*, because the spin stored
its question list, not just its seed.

### The host's voice

With an ElevenLabs key set, the host's lines are spoken in a real voice. The API
asks ElevenLabs once for each distinct line and keeps the audio in Postgres, so a
line costs credits the first time and nothing after that, for every player. A daily
character cap (`VOICE_DAILY_CHARS`, default 2500) stops one session spending a plan;
when it is used up, or the voice is unavailable for any reason, the browser's own
voice takes over without interrupting the game. See `.env.example`.

Answer judging is done by the server too. The board is never sent to a phone until
a slot is won or the round closes. Matching is deliberately generous: plurals,
typos, filler words and the phrasings real people use ("my mobile" for *Phone*) all
count.

---

## Generating questions

A question is written, then **put to a simulated survey panel of 60 people**,
then tallied into a board, then scored by a separate judge. The panel is what
makes the boards good: points are a tally of the panel, the aliases are the
phrasings the panel actually used, and a question whose answers scatter — or
whose top answer takes the whole room — is rejected on evidence rather than
opinion.

```bash
make generate C=food N=5          # write, survey and judge 5 new questions
make review                       # what is waiting for a human
```

New questions land in a **review queue** rather than going straight into play.
An editor sees each board with the answers it will accept, and decides:

```http
GET  /v1/admin/review
POST /v1/admin/review/{id}   {"decision": "approve" | "reject" | "retire", "note": "..."}
POST /v1/admin/generate      {"category": "food", "count": 3}
```

These need an editor's token. `make editor-token` prints one (it creates a guest,
promotes it in the database and refreshes the session so the role is in the token):

```bash
TOKEN=$(make -s editor-token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8088/v1/admin/review
```

Set `AUTO_APPROVE=true` once you trust the pipeline — the gate is configuration,
not code.

### With OpenAI

Put the key in `.env` (gitignored; only the `ai` container receives it — the
browser and the Go API never see it):

```bash
OPENAI_API_KEY=sk-...            # OPEN_AI_SECRET_KEY is accepted as well
MODEL_STRONG=gpt-5.5             # writes the questions
MODEL_JUDGE=gpt-5.4              # scores them — a DIFFERENT model from the writer
MODEL_FAST=gpt-5.4-mini          # plays the survey panel
```

Three roles, three models, and the split is deliberate — see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §4. In short: the judge must not be
the writer (a model grades its own output generously), and the panel must not be a
reasoning model (it spends its whole budget thinking before writing two words).
Which request parameters a model accepts differs between releases — `gpt-5.5`
refuses any temperature but the default — so the provider finds out by calling and
adapts, rather than keeping a list that would go stale.

Every run records its models, token counts, prompt version and cost on the
`generations` row, so the cost of a question is a fact rather than an estimate.
A model that is missing from the price table in
`apps/ai/app/providers/openai_provider.py` is counted as *unpriced* and the report says
its cost is a lower bound, rather than quietly reporting it as free.

**What a live run looks like** (real OpenAI calls, October 2026, list prices):

| | |
| --- | --- |
| One generation batch of 3 questions | about **$0.06–0.15**, 20–60 seconds |
| Questions that survived the gates, first live batches | **1 in 12** — the panel collapsed (see below) |
| After the panel fix | Food **1 of 3**; Kenya **0 of 6**, all five that reached the judge scored 3/5 |
| Cost before / after the panel fix | about $0.23 → $0.06–0.15 per batch |

Those are two runs in two categories. They are enough to show that something was
badly wrong and that it is now fixed; they are not enough to quote a yield. Run
your own batches and watch the rejection reasons — they are written in plain words
for exactly this.

> **The first live run exposed a real flaw, and it is worth knowing about.**
> Sixty independent model calls — one per simulated person — collapse onto the most
> common answer however different the personas are: "Fish" was 60 of 60 for *a food
> that leaves a smell in the kitchen*. The quality gates correctly refused every
> such board, but that also meant almost nothing got through. The panel is now asked
> in **waves of ~20 people per call** (`PANEL_WAVE_SIZE`), which spreads naturally
> and is about six times cheaper. The fake provider used in the tests could not have
> found this, because its panel was built to look realistic. Only a live run could.

---

## Tests

```bash
make test        # all three suites
make test-api    # Go: the match engine, rooms over WebSockets, matching, spin, auth, voice
make test-ai     # Python: the whole generation graph, offline
make test-web    # typecheck + production build
```

The Go suite is the one that guards the multiplayer promises:

- **The match engine** is a pure state machine run on a fake clock. Tests cover who
  is first when two answers arrive milliseconds apart, the steal, double and final
  multipliers (applied once), streaks, sudden death, pausing and rejoining, and a
  few hundred *randomised whole matches* that check the rules still hold at every
  step. The tests were themselves checked by planting bugs in a copy of the engine
  and confirming each one fails a test.
- **Rooms** are tested over real WebSockets with two clients that have different
  network delays, proving that the order answers *reach the server* decides who was
  first, that starting on one phone starts both, and that the raw bytes sent to one
  phone never contain the other's unrevealed answer or any unearned board slot.
- **Voice** is tested against a fake provider: caching, one request shared between
  simultaneous players, the daily budget, and that the key never reaches a log or a
  response.

The Python suite runs the entire generation graph against a fake provider that
returns a Zipf-shaped spread of answers under several phrasings, so clustering,
the board gates, the revision loop and routing are all genuinely exercised
without a key and without spending anything.

Two players in two different browsers (Chrome and Firefox) were also driven
through a whole match against the running stack, as a final check on what unit
tests cannot see: that the screens agree, that the browser really receives and
plays the voice, and that reloading mid-round puts a player back.

`LIVE_SPEED=4` makes the whole show run four times faster, for tests only.

---

## Layout

This is a monorepo: three apps, one set of docs, one place to run all of it from.

```
apps/
  web/              the game: React SPA (Vite, TypeScript, Tailwind)
    src/api/          typed API client, session handling
    src/game/         what the screens draw from, the live connection, host script
    src/screens/      one file per screen
    Dockerfile        the nginx image; builds from the repository root
  api/              Go service: accounts, rooms, the live match, the host's voice
    internal/live     the match: engine (pure rules), rooms, WebSocket protocol
    internal/voice    ElevenLabs, cache, daily budget
    internal/matching answer matching
    internal/spin     deterministic spin + share codes
    internal/store/   SQL and migrations
  ai/               Python service: FastAPI + LangGraph question pipeline
    app/graph/        plan, write, gate, novelty, panel, cluster, board, judge
    app/prompts/      versioned prompt files, kept out of the code
    app/providers/    OpenAI, and the deterministic fake
docs/               architecture and plan; the original briefs are in docs/reference
scripts/            helpers the Makefile calls
docker-compose.yml  postgres · qdrant · api · ai · web
Makefile            the one entry point for all of it (`make help`)
package.json        the npm workspace root: owns the lockfile and the web scripts
go.work             lets editors find the Go module under apps/api
netlify.toml        a static-site deploy of apps/web
```

Each app keeps the toolchain native to its language, and the root ties them
together:

- **JavaScript** is an npm workspace. Run `npm install` once at the root; there is a
  single `package-lock.json`, and `npm run dev`, `build` and `typecheck` at the root
  run the web app's scripts. A second JavaScript app or shared package would go under
  `apps/` or `packages/` and be picked up automatically.
- **Go** is the module in `apps/api` (`github.com/dennisobel/gameshow/apps/api`).
- **Python** is the `uv` project in `apps/ai` (`pyproject.toml` and `uv.lock`).
- **Docker.** The API and AI images build from their own folders. The web image
  builds from the repository root, because it installs from the workspace's root
  lockfile; `apps/web/Dockerfile.dockerignore` is an allow-list that keeps the rest
  of the repository, and `.env`, out of that build.
- **`make help`** lists everything: `make install`, `make up`, `make test`, and so on.

The game's wire protocol has two ends, `apps/api/internal/live/view.go` and
`apps/web/src/game/wire.ts`. They are kept in step by hand, which is the main
reason they live in one repository: a change to one is reviewed beside the other.

---

## Known limitations

- **Games live in the API's memory.** A room, and the match in it, belongs to the one
  API process. Restarting it ends every game in progress (finished matches are
  already saved). Running several API instances would need sticky routing or a
  shared room store; one instance comfortably serves a great many rooms.
- **A slow connection is a disadvantage.** "First" is the order answers reach the
  server, with no allowance for a player's latency. Two people in the same country
  will rarely notice; a player on a poor mobile link answering against one on fibre
  might.
- **Room codes are four characters.** They are short on purpose so they can be read
  aloud, which means they can be guessed. Creation and joining are rate limited and
  a room holds two people, but there is no way yet to remove an unwanted second
  player other than leaving and opening a new room.
- **The voice is paid per new line.** A game speaks roughly a thousand characters of
  lines that have not been said before, so a free ElevenLabs plan (about 10,000
  credits a month at half a credit per character) covers a handful of games before
  the cache fills with the repeating lines. Lines that name the players are unique
  to them. The default voice is "Adam" because the free plan can use nothing else;
  more characterful voices need a paid plan (`ELEVENLABS_VOICE_ID`). The expressive
  `eleven_v3` model was measured at about five seconds for one sentence, too slow to
  land with the screen, so the fast models are the default.
- **Hosting.** The bundled nginx passes WebSockets through. Netlify serves only the
  static app (`netlify.toml`, which builds `apps/web`), and its redirects cannot
  carry a WebSocket, so a Netlify deployment must set `VITE_API_URL` in its build
  environment to the public API and list the site in `CORS_ORIGINS`. That
  configuration is written but has not been run on Netlify.
- **Pass-and-play was removed.** Two people on one phone no longer fits a game where
  each player sees themselves on the left and the other's answer stays hidden.
- **No payments.** Excluded by instruction.
- **AI-written boards are a model's idea of what people say.** They lean toward
  what is common in English web text and can miss local specifics — asked where to
  get off a matatu, the fast model put "Market" ahead of "Stage". The review queue
  exists for this, and the `submissions` table records every answer real players
  type that a board rejected, which is the data for correcting boards later.
  That correction loop is recorded but not yet automated.
- **The judge is strict, and the writer drifts toward bland.** After the panel fix
  the bottleneck moved: on a Kenya batch five of six boards passed the gates and
  were then scored 3/5 for being safe but plain. `MIN_JUDGE_OVERALL` (default 3.5,
  i.e. a 4 or 5 to pass) controls how strict. Questions the judge rejects are not
  kept, so there is no way yet to see whether it is too harsh; storing near-misses
  for an editor to rescue is the obvious next step.
- **Answer matching will not stretch a shortened phrase to a longer answer.** On
  a live AI-written board, "talking", "loud chewing" and "chewing with mouth open"
  all scored, but "eating fast" missed "Eating Too Fast" and "chewing" missed
  "Chewing Loud". Accepting those risks false hits ("eating" would match two
  answers), so it has been left alone, but players will notice.
- **The dense vector encoder is lexical, not neural.** It is a hashed
  character-n-gram projection, which catches rephrasing but not synonymy, and it
  needs no key or model download. `DenseEncoder` in `apps/ai/app/retrieval/embed.py`
  is the seam for a neural encoder.
- **Refresh tokens are returned in the response body** as well as set as an
  HttpOnly cookie, so that a cross-origin `npm run dev` still works. Deployed
  behind the bundled nginx the app is same-origin and the cookie is the one that
  matters; drop the body copy if you never need the split-origin mode.
