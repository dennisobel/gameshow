package httpx

import (
	"context"
	"math/rand/v2"
	"net/http"
	"slices"
	"strings"

	"github.com/dennisobel/gameshow/apps/api/internal/spin"
	"github.com/dennisobel/gameshow/apps/api/internal/store"
)

// ------------------------------------------------------------- categories

func (s *Server) handleCategories(w http.ResponseWriter, r *http.Request) {
	cats, err := s.store.Categories(r.Context())
	if err != nil {
		writeStoreError(w, err, "")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"categories": cats})
}

// ------------------------------------------------------------------- spin

type spinRequest struct {
	Category   string `json:"category"`
	Rounds     int    `json:"rounds"`
	Difficulty string `json:"difficulty"`
}

type spinResponse struct {
	Code     string         `json:"code"`
	Category store.Category `json:"category"`
	Rounds   int            `json:"rounds"`
	Title    string         `json:"title"`
}

// spinError is a spin that cannot be done, with the answer to give.
type spinError struct {
	status int
	code   string
	msg    string
}

func (e *spinError) Error() string { return e.msg }

func writeSpinError(w http.ResponseWriter, err error) {
	if se, ok := err.(*spinError); ok {
		writeError(w, se.status, se.code, se.msg)
		return
	}
	writeStoreError(w, err, "No such category.")
}

// suddenDeathQuestions is how many tie-breakers a game carries. Two is plenty:
// a tie that survives two single-question rounds is called a draw.
const suddenDeathQuestions = 2

// spinGame picks a set of questions from a category and stores the result, so a
// share code replays exactly this game.
func (s *Server) spinGame(ctx context.Context, ownerID, categorySlug string, rounds int, difficulty string) (store.Game, store.Category, error) {
	if rounds <= 0 {
		rounds = 5
	}
	rounds = min(rounds, 10)

	cat, err := s.store.CategoryBySlug(ctx, strings.TrimSpace(categorySlug))
	if err != nil {
		return store.Game{}, store.Category{}, err
	}
	ids, diffs, err := s.store.ApprovedQuestionIDs(ctx, cat.ID)
	if err != nil {
		return store.Game{}, store.Category{}, err
	}
	if len(ids) < rounds {
		return store.Game{}, store.Category{}, &spinError{http.StatusConflict, "bank_too_small",
			"That category does not have enough approved questions yet."}
	}

	seed := spin.NewSeed()
	plan := spin.Plan(ids, diffs, rounds, seed)
	questionIDs := make([]string, len(plan))
	for i, p := range plan {
		questionIDs[i] = p.QuestionID
	}
	sudden := s.pickSuddenDeath(ctx, ids, questionIDs, seed)

	// Retry on the rare share-code collision rather than failing the spin.
	var code string
	for attempt := 0; attempt < 5 && code == ""; attempt++ {
		candidate := spin.NewShareCode(6)
		exists, err := s.store.ShareCodeExists(ctx, candidate)
		if err != nil {
			return store.Game{}, store.Category{}, err
		}
		if !exists {
			code = candidate
		}
	}
	if code == "" {
		return store.Game{}, store.Category{}, &spinError{http.StatusInternalServerError, "internal", "Could not allocate a share code."}
	}

	var owner *string
	if ownerID != "" {
		owner = &ownerID
	}
	game, err := s.store.CreateGame(ctx, store.NewGame{
		ShareCode:   code,
		OwnerID:     owner,
		CategoryID:  cat.ID,
		Title:       cat.Name,
		Rounds:      rounds,
		Difficulty:  difficulty,
		Seed:        seed,
		QuestionIDs: questionIDs,
		Config:      map[string]any{"plan": plan, "sudden": sudden},
	})
	if err != nil {
		return store.Game{}, store.Category{}, err
	}
	s.store.RecordQuestionServed(ctx, questionIDs)
	return game, cat, nil
}

// pickSuddenDeath chooses the tie-breakers: questions from the same category that
// are not already in the game, topped up from elsewhere in the bank if the
// category is small. They come from the same approved bank as everything else.
func (s *Server) pickSuddenDeath(ctx context.Context, pool, chosen []string, seed int64) []string {
	var rest []string
	for _, id := range pool {
		if !slices.Contains(chosen, id) {
			rest = append(rest, id)
		}
	}
	rng := rand.New(rand.NewPCG(uint64(seed), 0x5EED))
	rng.Shuffle(len(rest), func(i, j int) { rest[i], rest[j] = rest[j], rest[i] })
	picked := rest[:min(len(rest), suddenDeathQuestions)]

	if need := suddenDeathQuestions - len(picked); need > 0 {
		exclude := append(slices.Clone(chosen), picked...)
		if more, err := s.store.RandomApprovedQuestionIDs(ctx, exclude, need); err == nil {
			picked = append(slices.Clone(picked), more...)
		}
	}
	return slices.Clone(picked)
}

func (s *Server) handleSpin(w http.ResponseWriter, r *http.Request) {
	var req spinRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	game, cat, err := s.spinGame(r.Context(), claimsFrom(r.Context()).UserID, req.Category, req.Rounds, req.Difficulty)
	if err != nil {
		writeSpinError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, spinResponse{
		Code: game.ShareCode, Category: cat, Rounds: game.Rounds, Title: game.Title,
	})
}

// --------------------------------------------------------- game by code

// roundView is what the client is allowed to see before a round is played:
// the prompt, and the shape of the board. Answer text is withheld until the
// player earns it or the round closes (ARCHITECTURE §7).
type roundView struct {
	Round      int        `json:"round"`
	QuestionID string     `json:"questionId"`
	Prompt     string     `json:"prompt"`
	Kind       string     `json:"kind"`
	Multiplier int        `json:"multiplier"`
	Seconds    int        `json:"seconds"`
	Difficulty string     `json:"difficulty"`
	PanelSize  int        `json:"panelSize"`
	Slots      []slotView `json:"slots"`
}

type slotView struct {
	Rank   int `json:"rank"`
	Points int `json:"points"`
}

type gameView struct {
	Code      string         `json:"code"`
	Title     string         `json:"title"`
	Category  store.Category `json:"category"`
	Rounds    []roundView    `json:"rounds"`
	Plays     int            `json:"plays"`
	CreatedAt string         `json:"createdAt"`
}

func (s *Server) handleGameByCode(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(strings.TrimSpace(r.PathValue("code")))
	game, cat, err := s.store.GameByCode(r.Context(), code)
	if err != nil {
		writeStoreError(w, err, "No game with that code.")
		return
	}
	questions, err := s.store.QuestionsWithAnswers(r.Context(), game.QuestionIDs)
	if err != nil {
		writeStoreError(w, err, "")
		return
	}
	plan := spin.Plan(game.QuestionIDs, difficultiesOf(questions, game.QuestionIDs), game.Rounds, game.Seed)

	view := gameView{
		Code: game.ShareCode, Title: game.Title, Category: cat,
		Plays: game.Plays, CreatedAt: game.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	}
	byID := map[string]store.Question{}
	for _, q := range questions {
		byID[q.ID] = q
	}
	// The stored question order is authoritative; the plan only supplies the
	// round dressing, so a retired question cannot reshuffle a shared game.
	for i, id := range game.QuestionIDs {
		q, ok := byID[id]
		if !ok {
			continue
		}
		rv := roundView{
			Round: i + 1, QuestionID: q.ID, Prompt: q.Prompt,
			Kind: "normal", Multiplier: 1, Seconds: 15,
			Difficulty: q.Difficulty, PanelSize: q.PanelSize,
		}
		if i < len(plan) {
			rv.Kind, rv.Multiplier, rv.Seconds = string(plan[i].Kind), plan[i].Multiplier, plan[i].Seconds
		}
		for _, a := range q.Answers {
			rv.Slots = append(rv.Slots, slotView{Rank: a.Rank, Points: a.Points * rv.Multiplier})
		}
		view.Rounds = append(view.Rounds, rv)
	}
	writeJSON(w, http.StatusOK, view)
}

func difficultiesOf(qs []store.Question, order []string) []string {
	byID := map[string]string{}
	for _, q := range qs {
		byID[q.ID] = q.Difficulty
	}
	out := make([]string, len(order))
	for i, id := range order {
		if d, ok := byID[id]; ok {
			out[i] = d
		} else {
			out[i] = "medium"
		}
	}
	return out
}

func (s *Server) handleMyGames(w http.ResponseWriter, r *http.Request) {
	games, err := s.store.GamesByOwner(r.Context(), claimsFrom(r.Context()).UserID,
		clampLimit(r.URL.Query().Get("limit"), 20, 100))
	if err != nil {
		writeStoreError(w, err, "")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"games": games})
}

// ---------------------------------------------------- leaderboard, feedback

func (s *Server) handleLeaderboard(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.Leaderboard(r.Context(), clampLimit(r.URL.Query().Get("limit"), 20, 100))
	if err != nil {
		writeStoreError(w, err, "")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"leaderboard": rows})
}

type feedbackRequest struct {
	QuestionID string `json:"questionId"`
	MatchID    string `json:"matchId"`
	Kind       string `json:"kind"`
	Value      *int   `json:"value"`
	Note       string `json:"note"`
}

func (s *Server) handleFeedback(w http.ResponseWriter, r *http.Request) {
	var req feedbackRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	switch req.Kind {
	case "question_rating", "answer_missing", "bug", "report":
	default:
		writeFieldError(w, "bad_kind", "Unknown feedback kind.", "kind")
		return
	}
	uid := claimsFrom(r.Context()).UserID
	var qid, mid *string
	if req.QuestionID != "" {
		qid = &req.QuestionID
	}
	if req.MatchID != "" {
		mid = &req.MatchID
	}
	if err := s.store.RecordFeedback(r.Context(), &uid, qid, mid, req.Kind, req.Value, trimTo(req.Note, 2000)); err != nil {
		writeStoreError(w, err, "")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func trimTo(s string, n int) string {
	s = strings.TrimSpace(s)
	if len([]rune(s)) > n {
		return string([]rune(s)[:n])
	}
	return s
}
