-- Initial schema for On The Board.
-- See docs/ARCHITECTURE.md §6 for the reasoning behind this model.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email and slugs
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram dedup when Qdrant is unavailable

-- ---------------------------------------------------------------- identity

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         citext UNIQUE,
    password_hash text,
    display_name  text        NOT NULL,
    avatar        smallint    NOT NULL DEFAULT 0,
    is_guest      boolean     NOT NULL DEFAULT true,
    role          text        NOT NULL DEFAULT 'player',
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT users_role_valid CHECK (role IN ('player', 'editor', 'admin')),
    -- A guest has no credentials; a registered user has both. Upgrading a guest
    -- in place flips all three columns together, which keeps the user id stable
    -- and so preserves their game history.
    CONSTRAINT users_credentials_match_kind CHECK (
        (is_guest AND email IS NULL AND password_hash IS NULL) OR
        (NOT is_guest AND email IS NOT NULL AND password_hash IS NOT NULL)
    )
);

-- Rotating refresh tokens. Stored only as a hash: a database leak must not hand
-- over live sessions. `family_id` groups every token descended from one login so
-- that replay of a stolen token can revoke the whole family at once.
CREATE TABLE refresh_tokens (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    family_id  uuid        NOT NULL,
    token_hash bytea       NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    revoked_at timestamptz,
    user_agent text        NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx   ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- ------------------------------------------------------------ question bank

CREATE TABLE categories (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug       citext      NOT NULL UNIQUE,
    name       text        NOT NULL,
    tagline    text        NOT NULL DEFAULT '',
    icon       text        NOT NULL DEFAULT 'star',
    accent     text        NOT NULL DEFAULT '#9b7bff',
    locale     text        NOT NULL DEFAULT 'en',
    sort_order int         NOT NULL DEFAULT 100,
    is_active  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE question_status AS ENUM ('draft', 'review', 'approved', 'retired');
CREATE TYPE question_source AS ENUM ('seed', 'ai', 'human');

CREATE TABLE questions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id uuid NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
    prompt      text NOT NULL,
    -- Lowercased, punctuation-stripped form. Carries the uniqueness constraint
    -- and backs the trigram index, so near-identical prompts collide on insert
    -- even if the pipeline's novelty check missed them.
    prompt_norm text NOT NULL,
    difficulty  text NOT NULL DEFAULT 'medium',
    status      question_status NOT NULL DEFAULT 'review',
    source      question_source NOT NULL DEFAULT 'ai',
    locale      text NOT NULL DEFAULT 'en',

    -- Evidence from the simulated survey (ARCHITECTURE §4).
    panel_size     int           NOT NULL DEFAULT 0,
    panel_coverage numeric(4, 3) NOT NULL DEFAULT 0,
    quality_score  numeric(3, 2) NOT NULL DEFAULT 0,
    judge_scores   jsonb         NOT NULL DEFAULT '{}'::jsonb,
    review_note    text          NOT NULL DEFAULT '',

    -- Live performance. times_solved/times_served is the headline health metric.
    times_served int NOT NULL DEFAULT 0,
    times_solved int NOT NULL DEFAULT 0,

    generation_id uuid,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT questions_difficulty_valid CHECK (difficulty IN ('easy', 'medium', 'hard', 'insane')),
    CONSTRAINT questions_unique_per_category UNIQUE (category_id, prompt_norm)
);
CREATE INDEX questions_pick_idx ON questions (category_id, status, difficulty);
CREATE INDEX questions_trgm_idx ON questions USING gin (prompt_norm gin_trgm_ops);

CREATE TABLE answers (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id uuid     NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
    rank        smallint NOT NULL,
    text        text     NOT NULL,
    points      smallint NOT NULL,
    -- How many of the simulated panel gave this answer, and their share. These
    -- are measurements, not invented numbers: points derive from them.
    panel_count int           NOT NULL DEFAULT 0,
    share       numeric(4, 3) NOT NULL DEFAULT 0,
    -- Accepted phrasings, harvested from the panel's raw responses and widened
    -- over time by what real players actually type.
    aliases    text[]      NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT answers_rank_unique CHECK (rank > 0),
    UNIQUE (question_id, rank)
);

-- --------------------------------------------------- generation provenance

CREATE TABLE generations (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind         text NOT NULL DEFAULT 'question_batch',
    category_id  uuid REFERENCES categories (id) ON DELETE SET NULL,
    status       text NOT NULL DEFAULT 'queued',
    requested_by uuid REFERENCES users (id) ON DELETE SET NULL,
    request      jsonb NOT NULL DEFAULT '{}'::jsonb,
    result       jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- Lineage. Without these, "why did the bank change in March" is unanswerable.
    prompt_version text          NOT NULL DEFAULT '',
    models         jsonb         NOT NULL DEFAULT '{}'::jsonb,
    tokens         jsonb         NOT NULL DEFAULT '{}'::jsonb,
    cost_usd       numeric(10, 6) NOT NULL DEFAULT 0,
    latency_ms     int           NOT NULL DEFAULT 0,

    attempts  smallint NOT NULL DEFAULT 0,
    error     text     NOT NULL DEFAULT '',
    locked_at timestamptz,
    locked_by text NOT NULL DEFAULT '',

    created_at  timestamptz NOT NULL DEFAULT now(),
    started_at  timestamptz,
    finished_at timestamptz,

    CONSTRAINT generations_status_valid
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
-- Partial index: the worker only ever asks for queued rows.
CREATE INDEX generations_queue_idx ON generations (created_at) WHERE status = 'queued';

-- One row per graph node transition: the trace behind every banked question.
CREATE TABLE generation_events (
    id            bigserial PRIMARY KEY,
    generation_id uuid NOT NULL REFERENCES generations (id) ON DELETE CASCADE,
    node          text NOT NULL,
    status        text NOT NULL,
    detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
    latency_ms    int   NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX generation_events_gen_idx ON generation_events (generation_id, id);

-- ------------------------------------------------------------------- play

-- A spin. Storing both the seed and the resolved question list makes a share
-- code reproducible and immune to later bank changes: whoever opens the link
-- plays exactly the game that was spun, even if a question is retired later.
CREATE TABLE games (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    share_code   text NOT NULL UNIQUE,
    owner_id     uuid REFERENCES users (id) ON DELETE SET NULL,
    category_id  uuid NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
    title        text     NOT NULL DEFAULT '',
    rounds       smallint NOT NULL,
    difficulty   text     NOT NULL DEFAULT 'medium',
    seed         bigint   NOT NULL,
    question_ids uuid[]   NOT NULL,
    config       jsonb    NOT NULL DEFAULT '{}'::jsonb,
    plays        int      NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX games_owner_idx ON games (owner_id, created_at DESC);

CREATE TABLE matches (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id      uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    host_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
    status       text NOT NULL DEFAULT 'active',

    p1_name   text     NOT NULL,
    p1_avatar smallint NOT NULL DEFAULT 0,
    p1_score  int      NOT NULL DEFAULT 0,
    p2_name   text     NOT NULL,
    p2_avatar smallint NOT NULL DEFAULT 3,
    p2_score  int      NOT NULL DEFAULT 0,
    p2_is_bot boolean  NOT NULL DEFAULT true,

    winner      smallint,
    started_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,

    CONSTRAINT matches_status_valid CHECK (status IN ('active', 'finished', 'abandoned')),
    CONSTRAINT matches_winner_valid  CHECK (winner IS NULL OR winner IN (0, 1))
);
CREATE INDEX matches_game_idx ON matches (game_id);
CREATE INDEX matches_host_idx ON matches (host_user_id, started_at DESC);

CREATE TABLE match_rounds (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id    uuid     NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
    round_no    smallint NOT NULL,
    question_id uuid     NOT NULL REFERENCES questions (id) ON DELETE RESTRICT,
    winner      smallint,
    points      int      NOT NULL DEFAULT 0,
    stolen      boolean  NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),

    UNIQUE (match_id, round_no),
    CONSTRAINT match_rounds_winner_valid CHECK (winner IS NULL OR winner IN (0, 1))
);

-- Every answer a player types, matched or not. This is the flywheel: unmatched
-- answers that many players give are alias candidates, and questions nobody can
-- crack are retirement candidates.
CREATE TABLE submissions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id          uuid     NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
    question_id       uuid     NOT NULL REFERENCES questions (id) ON DELETE RESTRICT,
    round_no          smallint NOT NULL,
    player            smallint NOT NULL,
    raw_text          text     NOT NULL,
    normalized        text     NOT NULL,
    matched_answer_id uuid REFERENCES answers (id) ON DELETE SET NULL,
    correct           boolean  NOT NULL DEFAULT false,
    is_steal          boolean  NOT NULL DEFAULT false,
    ms_elapsed        int      NOT NULL DEFAULT 0,
    created_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT submissions_player_valid CHECK (player IN (0, 1))
);
CREATE INDEX submissions_match_idx    ON submissions (match_id, round_no);
-- Supports the alias-gap query: unmatched answers, grouped by question.
CREATE INDEX submissions_unmatched_idx ON submissions (question_id, normalized)
    WHERE matched_answer_id IS NULL;

CREATE TABLE feedback (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid REFERENCES users (id) ON DELETE SET NULL,
    question_id uuid REFERENCES questions (id) ON DELETE CASCADE,
    match_id    uuid REFERENCES matches (id) ON DELETE SET NULL,
    kind        text NOT NULL,
    value       smallint,
    note        text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT feedback_kind_valid
        CHECK (kind IN ('question_rating', 'answer_missing', 'bug', 'report'))
);
CREATE INDEX feedback_question_idx ON feedback (question_id, created_at DESC);

-- ---------------------------------------------------------------- triggers

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER questions_touch_updated_at
    BEFORE UPDATE ON questions
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
