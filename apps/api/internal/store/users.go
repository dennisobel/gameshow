package store

import (
	"context"
	"time"
)

const userCols = `id, email, display_name, avatar, is_guest, role, created_at`

func scanUser(row interface{ Scan(...any) error }) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Email, &u.DisplayName, &u.Avatar, &u.IsGuest, &u.Role, &u.CreatedAt)
	return u, translate(err)
}

func (s *Store) CreateGuest(ctx context.Context, displayName string, avatar int) (User, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO users (display_name, avatar, is_guest)
		VALUES ($1, $2, true)
		RETURNING `+userCols, displayName, avatar)
	return scanUser(row)
}

func (s *Store) CreateUser(ctx context.Context, email, passwordHash, displayName string, avatar int) (User, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name, avatar, is_guest)
		VALUES ($1, $2, $3, $4, false)
		RETURNING `+userCols, email, passwordHash, displayName, avatar)
	return scanUser(row)
}

// UpgradeGuest turns an existing guest row into a full account, keeping the id
// so the player's games and history survive signing up.
func (s *Store) UpgradeGuest(ctx context.Context, userID, email, passwordHash, displayName string) (User, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE users
		   SET email = $2, password_hash = $3,
		       display_name = COALESCE(NULLIF($4, ''), display_name),
		       is_guest = false
		 WHERE id = $1 AND is_guest
		RETURNING `+userCols, userID, email, passwordHash, displayName)
	return scanUser(row)
}

func (s *Store) UserByID(ctx context.Context, id string) (User, error) {
	return scanUser(s.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id = $1`, id))
}

// UserByEmail also returns the stored hash, which is why it is separate from
// UserByID: no other call site should be able to read it by accident.
func (s *Store) UserByEmail(ctx context.Context, email string) (User, string, error) {
	var u User
	var hash *string
	err := s.pool.QueryRow(ctx, `
		SELECT `+userCols+`, password_hash FROM users WHERE email = $1`, email).
		Scan(&u.ID, &u.Email, &u.DisplayName, &u.Avatar, &u.IsGuest, &u.Role, &u.CreatedAt, &hash)
	if err != nil {
		return User{}, "", translate(err)
	}
	if hash == nil {
		return User{}, "", ErrNotFound
	}
	return u, *hash, nil
}

func (s *Store) UpdateProfile(ctx context.Context, id, displayName string, avatar int) (User, error) {
	return scanUser(s.pool.QueryRow(ctx, `
		UPDATE users
		   SET display_name = COALESCE(NULLIF($2, ''), display_name),
		       avatar = $3,
		       last_seen_at = now()
		 WHERE id = $1
		RETURNING `+userCols, id, displayName, avatar))
}

func (s *Store) TouchUser(ctx context.Context, id string) {
	_, _ = s.pool.Exec(ctx, `UPDATE users SET last_seen_at = now() WHERE id = $1`, id)
}

// ---------------------------------------------------------------- sessions

type RefreshRecord struct {
	ID       string
	UserID   string
	FamilyID string
	Expires  time.Time
	Used     *time.Time
	Revoked  *time.Time
}

func (s *Store) StoreRefreshToken(ctx context.Context, userID, familyID string, hash []byte, expires time.Time, userAgent string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id`, userID, familyID, hash, expires, userAgent).Scan(&id)
	return id, translate(err)
}

func (s *Store) RefreshTokenByHash(ctx context.Context, hash []byte) (RefreshRecord, error) {
	var r RefreshRecord
	err := s.pool.QueryRow(ctx, `
		SELECT id, user_id, family_id, expires_at, used_at, revoked_at
		  FROM refresh_tokens WHERE token_hash = $1`, hash).
		Scan(&r.ID, &r.UserID, &r.FamilyID, &r.Expires, &r.Used, &r.Revoked)
	return r, translate(err)
}

func (s *Store) MarkRefreshUsed(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `UPDATE refresh_tokens SET used_at = now() WHERE id = $1`, id)
	return err
}

// RevokeFamily kills every token descended from one login. Called both on
// logout and when a already-used token is presented again, which is the
// signature of a stolen token being replayed.
func (s *Store) RevokeFamily(ctx context.Context, familyID string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, familyID)
	return err
}
