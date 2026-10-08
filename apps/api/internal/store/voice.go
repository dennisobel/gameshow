package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// VoiceGet returns a cached line, if there is one, and notes that it was used.
func (s *Store) VoiceGet(ctx context.Context, hash string) ([]byte, bool, error) {
	var audio []byte
	err := s.pool.QueryRow(ctx, `
		UPDATE voice_cache SET hits = hits + 1, last_used_at = now()
		 WHERE hash = $1
		RETURNING audio`, hash).Scan(&audio)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return audio, true, nil
}

// VoicePut keeps a finished line. Two requests racing to store the same line is
// fine: the second is simply ignored.
func (s *Store) VoicePut(ctx context.Context, hash, voice, model, personality, text string, audio []byte, chars int) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO voice_cache (hash, voice, model, personality, text, audio, chars)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (hash) DO NOTHING`, hash, voice, model, personality, text, audio, chars)
	return translate(err)
}

// VoiceSpent is how many characters have been sent to the speech service today.
func (s *Store) VoiceSpent(ctx context.Context) (int, error) {
	var chars int
	err := s.pool.QueryRow(ctx, `SELECT COALESCE((SELECT chars FROM voice_usage WHERE day = current_date), 0)`).Scan(&chars)
	return chars, err
}

// VoiceSpend adds to today's total.
func (s *Store) VoiceSpend(ctx context.Context, chars int) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO voice_usage (day, chars, requests) VALUES (current_date, $1, 1)
		ON CONFLICT (day) DO UPDATE SET chars = voice_usage.chars + EXCLUDED.chars,
		                                requests = voice_usage.requests + 1`, chars)
	return err
}
