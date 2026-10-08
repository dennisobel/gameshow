package store

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"sort"
	"strings"
)

//go:embed all:migrations
var migrationFS embed.FS

// Migrate applies every migration that has not run yet, in filename order, each
// inside its own transaction. Applied names are recorded in schema_migrations,
// so running this on every container start is safe and idempotent.
//
// An advisory lock serialises concurrent starts: two replicas booting at once
// must not both try to create the same table.
func (s *Store) Migrate(ctx context.Context, log *slog.Logger) error {
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	const lockID = 8771234501 // arbitrary, but fixed for this schema
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, lockID); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	defer func() { _, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, lockID) }()

	if _, err := conn.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			name       text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	applied := map[string]bool{}
	rows, err := conn.Query(ctx, `SELECT name FROM schema_migrations`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			return err
		}
		applied[n] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	entries, err := fs.ReadDir(migrationFS, "migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		if applied[name] {
			continue
		}
		body, err := migrationFS.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		t, err := conn.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err := t.Exec(ctx, string(body)); err != nil {
			_ = t.Rollback(ctx)
			return fmt.Errorf("migration %s: %w", name, err)
		}
		if _, err := t.Exec(ctx, `INSERT INTO schema_migrations (name) VALUES ($1)`, name); err != nil {
			_ = t.Rollback(ctx)
			return err
		}
		if err := t.Commit(ctx); err != nil {
			return err
		}
		log.Info("migration applied", "name", name)
	}
	return nil
}
