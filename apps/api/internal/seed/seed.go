// Package seed loads the hand-authored starter bank.
//
// It exists so the game is playable the moment the stack comes up, before the
// AI pipeline has produced anything. Seed rows are marked source='seed' so they
// can always be told apart from generated ones.
package seed

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed seed.json
var seedJSON []byte

type file struct {
	Categories []category `json:"categories"`
}

type category struct {
	Slug      string     `json:"slug"`
	Name      string     `json:"name"`
	Tagline   string     `json:"tagline"`
	Icon      string     `json:"icon"`
	Accent    string     `json:"accent"`
	SortOrder int        `json:"sort_order"`
	Questions []question `json:"questions"`
}

type question struct {
	Prompt     string   `json:"prompt"`
	Difficulty string   `json:"difficulty"`
	Answers    []answer `json:"answers"`
}

type answer struct {
	Text       string   `json:"text"`
	PanelCount int      `json:"panel_count"`
	Aliases    []string `json:"aliases"`
}

type Report struct {
	Categories     int
	QuestionsAdded int
	Skipped        int
}

// Normalize must agree with the matching package's normalisation of prompts,
// because prompt_norm carries the uniqueness constraint.
func normalizePrompt(s string) string {
	var b strings.Builder
	prevSpace := true
	for _, r := range strings.ToLower(strings.TrimSpace(s)) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			prevSpace = false
		case r == '\'':
		default:
			if !prevSpace {
				b.WriteByte(' ')
				prevSpace = true
			}
		}
	}
	return strings.TrimSpace(b.String())
}

// Load is idempotent: categories are upserted and questions are inserted only
// when their normalised prompt is new, so running it on every boot is safe and
// never clobbers edits made in the review queue.
func Load(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) (Report, error) {
	var f file
	if err := json.Unmarshal(seedJSON, &f); err != nil {
		return Report{}, fmt.Errorf("parse seed.json: %w", err)
	}

	var rep Report
	for _, c := range f.Categories {
		var categoryID string
		err := pool.QueryRow(ctx, `
			INSERT INTO categories (slug, name, tagline, icon, accent, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (slug) DO UPDATE
			   SET name = EXCLUDED.name, tagline = EXCLUDED.tagline,
			       icon = EXCLUDED.icon, accent = EXCLUDED.accent,
			       sort_order = EXCLUDED.sort_order
			RETURNING id`,
			c.Slug, c.Name, c.Tagline, c.Icon, c.Accent, c.SortOrder).Scan(&categoryID)
		if err != nil {
			return rep, fmt.Errorf("category %s: %w", c.Slug, err)
		}
		rep.Categories++

		for _, q := range c.Questions {
			total := 0
			for _, a := range q.Answers {
				total += a.PanelCount
			}
			if total == 0 {
				rep.Skipped++
				continue
			}

			err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
				var questionID string
				// panel_size 100 reads as "we asked 100 people", so a board
				// answer's points state how many of them said it.
				err := tx.QueryRow(ctx, `
					INSERT INTO questions (category_id, prompt, prompt_norm, difficulty,
					                       status, source, panel_size, panel_coverage, quality_score)
					VALUES ($1, $2, $3, $4, 'approved', 'seed', 100, $5, 4.5)
					ON CONFLICT (category_id, prompt_norm) DO NOTHING
					RETURNING id`,
					categoryID, q.Prompt, normalizePrompt(q.Prompt), q.Difficulty,
					float64(total)/100.0).Scan(&questionID)
				if err == pgx.ErrNoRows {
					rep.Skipped++
					return nil // already present
				}
				if err != nil {
					return err
				}

				for i, a := range q.Answers {
					if _, err := tx.Exec(ctx, `
						INSERT INTO answers (question_id, rank, text, points, panel_count, share, aliases)
						VALUES ($1, $2, $3, $4, $5, $6, $7)`,
						questionID, i+1, a.Text, a.PanelCount, a.PanelCount,
						float64(a.PanelCount)/100.0, a.Aliases); err != nil {
						return err
					}
				}
				rep.QuestionsAdded++
				return nil
			})
			if err != nil {
				return rep, fmt.Errorf("question %q: %w", q.Prompt, err)
			}
		}
	}

	log.Info("seed loaded",
		"categories", rep.Categories, "questionsAdded", rep.QuestionsAdded, "alreadyPresent", rep.Skipped)
	return rep, nil
}
