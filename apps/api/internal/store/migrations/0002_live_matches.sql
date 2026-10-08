-- Live two-player matches.
--
-- A match now has two seats, and either seat can be a real person or the
-- computer. The leaderboard counts only matches between two different people
-- that the server itself scored, so a player cannot climb it by beating the
-- computer or by reporting a score of their own.

ALTER TABLE matches
    ADD COLUMN p1_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN p2_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN mode       text NOT NULL DEFAULT 'bot',
    ADD COLUMN room_code  text,
    ADD CONSTRAINT matches_mode_valid CHECK (mode IN ('live', 'bot'));

-- Matches recorded before seats had owners belonged to whoever started them.
UPDATE matches SET p1_user_id = host_user_id WHERE p1_user_id IS NULL;

-- The leaderboard reads finished live matches by seat.
CREATE INDEX matches_live_p1_idx ON matches (p1_user_id) WHERE status = 'finished' AND mode = 'live';
CREATE INDEX matches_live_p2_idx ON matches (p2_user_id) WHERE status = 'finished' AND mode = 'live';
