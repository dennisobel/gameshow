package store

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
)

type NewGame struct {
	ShareCode   string
	OwnerID     *string
	CategoryID  string
	Title       string
	Rounds      int
	Difficulty  string
	Seed        int64
	QuestionIDs []string
	Config      any
}

func (s *Store) CreateGame(ctx context.Context, g NewGame) (Game, error) {
	cfg, err := json.Marshal(g.Config)
	if err != nil {
		return Game{}, err
	}
	var out Game
	err = s.pool.QueryRow(ctx, `
		INSERT INTO games (share_code, owner_id, category_id, title, rounds, difficulty, seed, question_ids, config)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, share_code, owner_id, category_id, title, rounds, difficulty, seed, question_ids, plays, created_at`,
		g.ShareCode, g.OwnerID, g.CategoryID, g.Title, g.Rounds, g.Difficulty, g.Seed, g.QuestionIDs, cfg).
		Scan(&out.ID, &out.ShareCode, &out.OwnerID, &out.CategoryID, &out.Title, &out.Rounds,
			&out.Difficulty, &out.Seed, &out.QuestionIDs, &out.Plays, &out.CreatedAt)
	return out, translate(err)
}

func (s *Store) GameByCode(ctx context.Context, code string) (Game, Category, error) {
	var g Game
	var c Category
	err := s.pool.QueryRow(ctx, `
		SELECT g.id, g.share_code, g.owner_id, g.category_id, g.title, g.rounds, g.difficulty,
		       g.seed, g.question_ids, g.plays, g.created_at,
		       c.id, c.slug, c.name, c.tagline, c.icon, c.accent, c.locale
		  FROM games g JOIN categories c ON c.id = g.category_id
		 WHERE g.share_code = $1`, code).
		Scan(&g.ID, &g.ShareCode, &g.OwnerID, &g.CategoryID, &g.Title, &g.Rounds, &g.Difficulty,
			&g.Seed, &g.QuestionIDs, &g.Plays, &g.CreatedAt,
			&c.ID, &c.Slug, &c.Name, &c.Tagline, &c.Icon, &c.Accent, &c.Locale)
	return g, c, translate(err)
}

func (s *Store) GameByID(ctx context.Context, id string) (Game, error) {
	var g Game
	err := s.pool.QueryRow(ctx, `
		SELECT id, share_code, owner_id, category_id, title, rounds, difficulty, seed,
		       question_ids, plays, created_at
		  FROM games WHERE id = $1`, id).
		Scan(&g.ID, &g.ShareCode, &g.OwnerID, &g.CategoryID, &g.Title, &g.Rounds,
			&g.Difficulty, &g.Seed, &g.QuestionIDs, &g.Plays, &g.CreatedAt)
	return g, translate(err)
}

func (s *Store) GameConfig(ctx context.Context, gameID string) (map[string]any, error) {
	var raw []byte
	if err := s.pool.QueryRow(ctx, `SELECT config FROM games WHERE id = $1`, gameID).Scan(&raw); err != nil {
		return nil, translate(err)
	}
	var cfg map[string]any
	return cfg, json.Unmarshal(raw, &cfg)
}

func (s *Store) GamesByOwner(ctx context.Context, ownerID string, limit int) ([]Game, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, share_code, owner_id, category_id, title, rounds, difficulty, seed,
		       question_ids, plays, created_at
		  FROM games WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2`, ownerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Game{}
	for rows.Next() {
		var g Game
		if err := rows.Scan(&g.ID, &g.ShareCode, &g.OwnerID, &g.CategoryID, &g.Title, &g.Rounds,
			&g.Difficulty, &g.Seed, &g.QuestionIDs, &g.Plays, &g.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// ShareCodeExists lets the caller retry on the rare collision rather than
// surfacing a unique-violation to the player.
func (s *Store) ShareCodeExists(ctx context.Context, code string) (bool, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM games WHERE share_code = $1`, code).Scan(&n)
	return n > 0, err
}

// --------------------------------------------------------------- matches

type NewMatch struct {
	GameID   string
	HostID   *string
	P1User   *string
	P2User   *string
	P1Name   string
	P1Avatar int
	P2Name   string
	P2Avatar int
	P2IsBot  bool
	// Mode is "live" for two people, "bot" for a game against the computer.
	Mode     string
	RoomCode string
}

func (s *Store) CreateMatch(ctx context.Context, m NewMatch) (Match, error) {
	var out Match
	err := s.tx(ctx, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			INSERT INTO matches (game_id, host_user_id, p1_user_id, p2_user_id, p1_name, p1_avatar,
			                     p2_name, p2_avatar, p2_is_bot, mode, room_code)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULLIF($11, ''))
			RETURNING id, game_id, status, p1_name, p1_avatar, p1_score,
			          p2_name, p2_avatar, p2_score, p2_is_bot, winner, started_at, finished_at`,
			m.GameID, m.HostID, m.P1User, m.P2User, m.P1Name, m.P1Avatar,
			m.P2Name, m.P2Avatar, m.P2IsBot, m.Mode, m.RoomCode).
			Scan(&out.ID, &out.GameID, &out.Status, &out.P1Name, &out.P1Avatar, &out.P1Score,
				&out.P2Name, &out.P2Avatar, &out.P2Score, &out.P2IsBot, &out.Winner,
				&out.StartedAt, &out.Finished); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE games SET plays = plays + 1 WHERE id = $1`, m.GameID)
		return err
	})
	return out, translate(err)
}

func (s *Store) MatchByID(ctx context.Context, id string) (Match, error) {
	var m Match
	err := s.pool.QueryRow(ctx, `
		SELECT id, game_id, status, p1_name, p1_avatar, p1_score,
		       p2_name, p2_avatar, p2_score, p2_is_bot, winner, started_at, finished_at
		  FROM matches WHERE id = $1`, id).
		Scan(&m.ID, &m.GameID, &m.Status, &m.P1Name, &m.P1Avatar, &m.P1Score,
			&m.P2Name, &m.P2Avatar, &m.P2Score, &m.P2IsBot, &m.Winner, &m.StartedAt, &m.Finished)
	return m, translate(err)
}

type Submission struct {
	MatchID    string
	QuestionID string
	RoundNo    int
	Player     int
	RawText    string
	Normalized string
	AnswerID   *string
	Correct    bool
	IsSteal    bool
	MsElapsed  int
}

func (s *Store) RecordSubmission(ctx context.Context, sub Submission) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO submissions (match_id, question_id, round_no, player, raw_text,
		                         normalized, matched_answer_id, correct, is_steal, ms_elapsed)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		sub.MatchID, sub.QuestionID, sub.RoundNo, sub.Player, sub.RawText,
		sub.Normalized, sub.AnswerID, sub.Correct, sub.IsSteal, sub.MsElapsed)
	return translate(err)
}

type RoundResult struct {
	MatchID    string
	RoundNo    int
	QuestionID string
	Winner     *int
	Points     int
	Stolen     bool
	P1Score    int
	P2Score    int
}

// CloseRound records the outcome and the running scores in one transaction, so
// a dropped connection mid-round cannot leave the scoreboard disagreeing with
// the round history.
func (s *Store) CloseRound(ctx context.Context, r RoundResult) error {
	return translate(s.tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO match_rounds (match_id, round_no, question_id, winner, points, stolen)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (match_id, round_no) DO UPDATE
			   SET winner = EXCLUDED.winner, points = EXCLUDED.points, stolen = EXCLUDED.stolen`,
			r.MatchID, r.RoundNo, r.QuestionID, r.Winner, r.Points, r.Stolen); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE matches SET p1_score = $2, p2_score = $3 WHERE id = $1`,
			r.MatchID, r.P1Score, r.P2Score); err != nil {
			return err
		}
		if r.Winner != nil {
			_, err := tx.Exec(ctx,
				`UPDATE questions SET times_solved = times_solved + 1 WHERE id = $1`, r.QuestionID)
			return err
		}
		return nil
	}))
}

func (s *Store) FinishMatch(ctx context.Context, matchID string, p1, p2 int, winner *int) (Match, error) {
	var m Match
	err := s.pool.QueryRow(ctx, `
		UPDATE matches
		   SET status = 'finished', p1_score = $2, p2_score = $3, winner = $4, finished_at = now()
		 WHERE id = $1 AND status = 'active'
		RETURNING id, game_id, status, p1_name, p1_avatar, p1_score,
		          p2_name, p2_avatar, p2_score, p2_is_bot, winner, started_at, finished_at`,
		matchID, p1, p2, winner).
		Scan(&m.ID, &m.GameID, &m.Status, &m.P1Name, &m.P1Avatar, &m.P1Score,
			&m.P2Name, &m.P2Avatar, &m.P2Score, &m.P2IsBot, &m.Winner, &m.StartedAt, &m.Finished)
	if errors.Is(translate(err), ErrNotFound) {
		// Already finished: return the row as it stands rather than erroring, so
		// a retried request is harmless.
		return s.MatchByID(ctx, matchID)
	}
	return m, translate(err)
}

// AbandonMatch marks a match that was cut off before it finished.
func (s *Store) AbandonMatch(ctx context.Context, matchID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE matches SET status = 'abandoned', finished_at = now()
		 WHERE id = $1 AND status = 'active'`, matchID)
	return translate(err)
}

// AbandonStaleMatches runs at start-up. Rooms live in the API's memory, so a
// match still "active" when the process starts belongs to a room that no longer
// exists and will never finish.
func (s *Store) AbandonStaleMatches(ctx context.Context) (int64, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE matches SET status = 'abandoned', finished_at = now() WHERE status = 'active'`)
	return tag.RowsAffected(), translate(err)
}

// ------------------------------------------------------------- leaderboard

type LeaderRow struct {
	DisplayName string `json:"name"`
	Avatar      int    `json:"avatar"`
	BestScore   int    `json:"best"`
	Played      int    `json:"played"`
	Won         int    `json:"won"`
}

// Leaderboard ranks players by wins in live matches.
//
// Only matches the server scored itself count, and only when the two seats were
// different people: beating the computer, or playing yourself in two tabs, earns
// nothing. A player is shown under the name they last played with.
func (s *Store) Leaderboard(ctx context.Context, limit int) ([]LeaderRow, error) {
	rows, err := s.pool.Query(ctx, `
		WITH seats AS (
		    SELECT p1_user_id AS user_id, p1_name AS name, p1_avatar AS avatar,
		           p1_score AS score, (winner = 0) AS won, started_at
		      FROM matches
		     WHERE status = 'finished' AND mode = 'live'
		       AND p1_user_id IS NOT NULL AND p1_user_id IS DISTINCT FROM p2_user_id
		    UNION ALL
		    SELECT p2_user_id, p2_name, p2_avatar, p2_score, (winner = 1), started_at
		      FROM matches
		     WHERE status = 'finished' AND mode = 'live'
		       AND p2_user_id IS NOT NULL AND p1_user_id IS DISTINCT FROM p2_user_id
		), latest AS (
		    SELECT DISTINCT ON (user_id) user_id, name, avatar
		      FROM seats ORDER BY user_id, started_at DESC
		)
		SELECT l.name, l.avatar,
		       max(s.score)                  AS best,
		       count(*)                      AS played,
		       count(*) FILTER (WHERE s.won) AS won
		  FROM seats s JOIN latest l USING (user_id)
		 GROUP BY l.user_id, l.name, l.avatar
		 ORDER BY won DESC, best DESC, played ASC
		 LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []LeaderRow{}
	for rows.Next() {
		var r LeaderRow
		if err := rows.Scan(&r.DisplayName, &r.Avatar, &r.BestScore, &r.Played, &r.Won); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) RecordFeedback(ctx context.Context, userID *string, questionID, matchID *string, kind string, value *int, note string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO feedback (user_id, question_id, match_id, kind, value, note)
		VALUES ($1, $2, $3, $4, $5, $6)`, userID, questionID, matchID, kind, value, note)
	return translate(err)
}
