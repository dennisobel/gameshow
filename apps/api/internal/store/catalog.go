package store

import (
	"context"
	"encoding/json"
)

func (s *Store) Categories(ctx context.Context) ([]Category, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.slug, c.name, c.tagline, c.icon, c.accent, c.locale, c.sort_order,
		       count(q.id) FILTER (WHERE q.status = 'approved') AS question_count
		  FROM categories c
		  LEFT JOIN questions q ON q.category_id = c.id
		 WHERE c.is_active
		 GROUP BY c.id
		 ORDER BY c.sort_order, c.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Category{}
	for rows.Next() {
		var c Category
		if err := rows.Scan(&c.ID, &c.Slug, &c.Name, &c.Tagline, &c.Icon, &c.Accent,
			&c.Locale, &c.SortOrder, &c.QuestionCount); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) CategoryBySlug(ctx context.Context, slug string) (Category, error) {
	var c Category
	err := s.pool.QueryRow(ctx, `
		SELECT c.id, c.slug, c.name, c.tagline, c.icon, c.accent, c.locale, c.sort_order,
		       (SELECT count(*) FROM questions q WHERE q.category_id = c.id AND q.status = 'approved')
		  FROM categories c WHERE c.slug = $1 AND c.is_active`, slug).
		Scan(&c.ID, &c.Slug, &c.Name, &c.Tagline, &c.Icon, &c.Accent, &c.Locale, &c.SortOrder, &c.QuestionCount)
	return c, translate(err)
}

// ApprovedQuestionIDs lists the playable pool for a category, in a stable order
// so that a given spin seed always resolves to the same questions.
func (s *Store) ApprovedQuestionIDs(ctx context.Context, categoryID string) ([]string, []string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, difficulty FROM questions
		 WHERE category_id = $1 AND status = 'approved'
		 ORDER BY id`, categoryID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	var ids, diffs []string
	for rows.Next() {
		var id, d string
		if err := rows.Scan(&id, &d); err != nil {
			return nil, nil, err
		}
		ids = append(ids, id)
		diffs = append(diffs, d)
	}
	return ids, diffs, rows.Err()
}

// RandomApprovedQuestionIDs picks up to n approved questions at random, none of
// them in `exclude`. It tops up the tie-breakers when a category is too small to
// supply them itself.
func (s *Store) RandomApprovedQuestionIDs(ctx context.Context, exclude []string, n int) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id FROM questions
		 WHERE status = 'approved' AND NOT (id = ANY($1::uuid[]))
		 ORDER BY random() LIMIT $2`, exclude, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// QuestionsWithAnswers loads full questions, answers included, preserving the
// order of the ids given.
func (s *Store) QuestionsWithAnswers(ctx context.Context, ids []string) ([]Question, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT q.id, q.category_id, c.slug, q.prompt, q.difficulty, q.status::text, q.source::text,
		       q.panel_size, q.panel_coverage, q.quality_score,
		       COALESCE(
		           (SELECT json_agg(json_build_object(
		                       'id', a.id, 'rank', a.rank, 'text', a.text,
		                       'points', a.points, 'panelCount', a.panel_count,
		                       'aliases', a.aliases) ORDER BY a.rank)
		              FROM answers a WHERE a.question_id = q.id),
		           '[]'::json)
		  FROM questions q
		  JOIN categories c ON c.id = q.category_id
		 WHERE q.id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byID := map[string]Question{}
	for rows.Next() {
		var q Question
		var raw []byte
		if err := rows.Scan(&q.ID, &q.CategoryID, &q.CategorySlug, &q.Prompt, &q.Difficulty,
			&q.Status, &q.Source, &q.PanelSize, &q.PanelCoverage, &q.QualityScore, &raw); err != nil {
			return nil, err
		}
		var answers []struct {
			ID         string   `json:"id"`
			Rank       int      `json:"rank"`
			Text       string   `json:"text"`
			Points     int      `json:"points"`
			PanelCount int      `json:"panelCount"`
			Aliases    []string `json:"aliases"`
		}
		if err := json.Unmarshal(raw, &answers); err != nil {
			return nil, err
		}
		for _, a := range answers {
			q.Answers = append(q.Answers, Answer{
				ID: a.ID, Rank: a.Rank, Text: a.Text,
				Points: a.Points, PanelCount: a.PanelCount, Aliases: a.Aliases,
			})
		}
		byID[q.ID] = q
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]Question, 0, len(ids))
	for _, id := range ids {
		if q, ok := byID[id]; ok {
			out = append(out, q)
		}
	}
	return out, nil
}

func (s *Store) RecordQuestionServed(ctx context.Context, ids []string) {
	if len(ids) == 0 {
		return
	}
	_, _ = s.pool.Exec(ctx,
		`UPDATE questions SET times_served = times_served + 1 WHERE id = ANY($1)`, ids)
}

func (s *Store) RecordQuestionSolved(ctx context.Context, id string) {
	_, _ = s.pool.Exec(ctx, `UPDATE questions SET times_solved = times_solved + 1 WHERE id = $1`, id)
}

// ------------------------------------------------------------- review queue

func (s *Store) ReviewQueue(ctx context.Context, limit int) ([]ReviewItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT q.id, c.slug, q.prompt, q.difficulty, q.status::text, q.source::text,
		       q.panel_size, q.panel_coverage, q.quality_score, q.judge_scores,
		       q.review_note, q.generation_id, q.created_at,
		       COALESCE(
		           (SELECT json_agg(json_build_object(
		                       'id', a.id, 'rank', a.rank, 'text', a.text,
		                       'points', a.points, 'panelCount', a.panel_count,
		                       'aliases', a.aliases) ORDER BY a.rank)
		              FROM answers a WHERE a.question_id = q.id),
		           '[]'::json)
		  FROM questions q
		  JOIN categories c ON c.id = q.category_id
		 WHERE q.status = 'review'
		 ORDER BY q.quality_score DESC, q.created_at
		 LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []ReviewItem{}
	for rows.Next() {
		var it ReviewItem
		var judge, answers []byte
		if err := rows.Scan(&it.ID, &it.CategorySlug, &it.Prompt, &it.Difficulty, &it.Status,
			&it.Source, &it.PanelSize, &it.PanelCoverage, &it.QualityScore, &judge,
			&it.ReviewNote, &it.GenerationID, &it.CreatedAt, &answers); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(judge, &it.JudgeScores)
		_ = json.Unmarshal(answers, &it.Board)
		out = append(out, it)
	}
	return out, rows.Err()
}

func (s *Store) SetQuestionStatus(ctx context.Context, id, status, note string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE questions SET status = $2::question_status, review_note = $3 WHERE id = $1`,
		id, status, note)
	if err != nil {
		return translate(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// EnqueueGeneration adds a job for the Python worker to pick up.
func (s *Store) EnqueueGeneration(ctx context.Context, categoryID string, requestedBy *string, request any) (string, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return "", err
	}
	var id string
	err = s.pool.QueryRow(ctx, `
		INSERT INTO generations (category_id, requested_by, request)
		VALUES ($1, $2, $3) RETURNING id`, categoryID, requestedBy, body).Scan(&id)
	return id, translate(err)
}

type GenerationStatus struct {
	ID         string         `json:"id"`
	Status     string         `json:"status"`
	Category   string         `json:"category"`
	Request    map[string]any `json:"request"`
	Result     map[string]any `json:"result"`
	CostUSD    float64        `json:"costUsd"`
	LatencyMS  int            `json:"latencyMs"`
	Error      string         `json:"error,omitempty"`
	CreatedAt  string         `json:"createdAt"`
	FinishedAt *string        `json:"finishedAt,omitempty"`
}

func (s *Store) Generations(ctx context.Context, limit int) ([]GenerationStatus, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT g.id, g.status, COALESCE(c.slug, ''), g.request, g.result,
		       g.cost_usd, g.latency_ms, g.error,
		       to_char(g.created_at, 'YYYY-MM-DD"T"HH24:MI:SSZ'),
		       to_char(g.finished_at, 'YYYY-MM-DD"T"HH24:MI:SSZ')
		  FROM generations g
		  LEFT JOIN categories c ON c.id = g.category_id
		 ORDER BY g.created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []GenerationStatus{}
	for rows.Next() {
		var g GenerationStatus
		var req, res []byte
		if err := rows.Scan(&g.ID, &g.Status, &g.Category, &req, &res,
			&g.CostUSD, &g.LatencyMS, &g.Error, &g.CreatedAt, &g.FinishedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(req, &g.Request)
		_ = json.Unmarshal(res, &g.Result)
		out = append(out, g)
	}
	return out, rows.Err()
}
