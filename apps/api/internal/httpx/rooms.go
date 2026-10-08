package httpx

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"

	"github.com/dennisobel/gameshow/apps/api/internal/live"
	"github.com/dennisobel/gameshow/apps/api/internal/spin"
	"github.com/dennisobel/gameshow/apps/api/internal/store"
)

// ---------------------------------------------------------------- the deck

func toRound(q store.Question, kind string, multiplier, seconds int) live.Round {
	answers := make([]live.Answer, len(q.Answers))
	for i, a := range q.Answers {
		answers[i] = live.Answer{
			ID: a.ID, Rank: a.Rank, Text: a.Text, Points: a.Points,
			PanelCount: a.PanelCount, Aliases: a.Aliases,
		}
	}
	return live.Round{
		QuestionID: q.ID, Prompt: q.Prompt, Kind: kind,
		Multiplier: multiplier, Seconds: seconds, Answers: answers,
	}
}

// deckForGame turns a stored game into what the engine plays: the spun
// questions in their stored order, then the tie-breakers.
func (s *Server) deckForGame(ctx context.Context, game store.Game) (live.Deck, error) {
	var sudden []string
	if cfg, err := s.store.GameConfig(ctx, game.ID); err == nil {
		if list, ok := cfg["sudden"].([]any); ok {
			for _, v := range list {
				if id, ok := v.(string); ok {
					sudden = append(sudden, id)
				}
			}
		}
	}
	if len(sudden) == 0 {
		// A game spun before tie-breakers were stored still needs some.
		if more, err := s.store.RandomApprovedQuestionIDs(ctx, game.QuestionIDs, suddenDeathQuestions); err == nil {
			sudden = more
		}
	}

	all := append(append([]string{}, game.QuestionIDs...), sudden...)
	questions, err := s.store.QuestionsWithAnswers(ctx, all)
	if err != nil {
		return live.Deck{}, err
	}
	byID := map[string]store.Question{}
	for _, q := range questions {
		byID[q.ID] = q
	}
	plan := spin.Plan(game.QuestionIDs, difficultiesOf(questions, game.QuestionIDs), game.Rounds, game.Seed)

	var deck live.Deck
	for i, id := range game.QuestionIDs {
		q, ok := byID[id]
		if !ok || len(q.Answers) == 0 {
			continue
		}
		kind, mult, secs := live.KindNormal, 1, 15
		if i < len(plan) {
			kind, mult, secs = string(plan[i].Kind), plan[i].Multiplier, plan[i].Seconds
		}
		deck.Rounds = append(deck.Rounds, toRound(q, kind, mult, secs))
	}
	for _, id := range sudden {
		if q, ok := byID[id]; ok && len(q.Answers) > 0 {
			deck.Sudden = append(deck.Sudden, toRound(q, live.KindSudden, 1, 15))
		}
	}
	if len(deck.Rounds) == 0 {
		return live.Deck{}, errors.New("game has no playable questions")
	}
	return deck, nil
}

func gameInfo(g store.Game, c store.Category) live.GameInfo {
	return live.GameInfo{
		ID: g.ID, ShareCode: g.ShareCode, Rounds: g.Rounds,
		Category: live.CategoryInfo{Slug: c.Slug, Name: c.Name},
	}
}

// -------------------------------------------------------------- the rooms

type createRoomRequest struct {
	Category   string `json:"category"`
	GameCode   string `json:"gameCode"` // play an already-spun board instead
	Name       string `json:"name"`
	Avatar     int    `json:"avatar"`
	Bot        bool   `json:"bot"`
	Difficulty string `json:"difficulty"`
	Rounds     int    `json:"rounds"`
}

type ticketResponse struct {
	Code  string `json:"code"`
	Seat  int    `json:"seat"`
	Token string `json:"token"`
	Mode  string `json:"mode"`
}

func (s *Server) handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	var req createRoomRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	name := cleanName(req.Name)
	if name == "" {
		writeFieldError(w, "name_required", "Tell the host what to call you.", "name")
		return
	}
	switch req.Difficulty {
	case "easy", "medium", "hard", "insane":
	default:
		req.Difficulty = "medium"
	}

	ctx := r.Context()
	uid := claimsFrom(ctx).UserID

	var game store.Game
	var cat store.Category
	var err error
	if code := strings.ToUpper(strings.TrimSpace(req.GameCode)); code != "" {
		game, cat, err = s.store.GameByCode(ctx, code)
	} else {
		game, cat, err = s.spinGame(ctx, uid, req.Category, req.Rounds, req.Difficulty)
	}
	if err != nil {
		writeSpinError(w, err)
		return
	}
	deck, err := s.deckForGame(ctx, game)
	if err != nil {
		s.log.Error("build deck", "err", err, "game", game.ShareCode)
		writeError(w, http.StatusInternalServerError, "internal", "Could not set up that game.")
		return
	}

	// A rematch is a fresh board in the same category, never the one just played.
	respin := func(ctx context.Context) (live.Deck, live.GameInfo, error) {
		g, c, err := s.spinGame(ctx, uid, cat.Slug, game.Rounds, req.Difficulty)
		if err != nil {
			return live.Deck{}, live.GameInfo{}, err
		}
		d, err := s.deckForGame(ctx, g)
		return d, gameInfo(g, c), err
	}

	room, ticket, err := s.hub.Create(live.CreateParams{
		UserID:     uid,
		Player:     live.PlayerInfo{Name: name, Avatar: clampAvatar(req.Avatar)},
		Bot:        req.Bot,
		Difficulty: req.Difficulty,
		Deck:       deck,
		Game:       gameInfo(game, cat),
		Respin:     respin,
	})
	if err != nil {
		writeRoomError(w, err)
		return
	}
	pub := room.Public()
	writeJSON(w, http.StatusCreated, ticketResponse{Code: room.Code(), Seat: ticket.Seat, Token: ticket.Token, Mode: pub.Mode})
}

func (s *Server) handleRoomPeek(w http.ResponseWriter, r *http.Request) {
	room := s.hub.Room(strings.ToUpper(strings.TrimSpace(r.PathValue("code"))))
	if room == nil {
		writeError(w, http.StatusNotFound, "not_found", "No game with that code. Check it with your host.")
		return
	}
	writeJSON(w, http.StatusOK, room.Public())
}

type joinRoomRequest struct {
	Name   string `json:"name"`
	Avatar int    `json:"avatar"`
}

func (s *Server) handleRoomJoin(w http.ResponseWriter, r *http.Request) {
	var req joinRoomRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	room := s.hub.Room(strings.ToUpper(strings.TrimSpace(r.PathValue("code"))))
	if room == nil {
		writeError(w, http.StatusNotFound, "not_found", "No game with that code. Check it with your host.")
		return
	}
	name := cleanName(req.Name)
	if name == "" {
		writeFieldError(w, "name_required", "Tell the host what to call you.", "name")
		return
	}
	ticket, err := room.Join(claimsFrom(r.Context()).UserID, live.PlayerInfo{Name: name, Avatar: clampAvatar(req.Avatar)})
	if err != nil {
		writeRoomError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ticketResponse{Code: room.Code(), Seat: ticket.Seat, Token: ticket.Token, Mode: "live"})
}

func writeRoomError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, live.ErrRoomClosed):
		writeError(w, http.StatusGone, "game_closed", err.Error())
	case errors.Is(err, live.ErrRoomFull):
		writeError(w, http.StatusConflict, "room_full", err.Error())
	case errors.Is(err, live.ErrStarted):
		writeError(w, http.StatusConflict, "already_started", err.Error())
	case errors.Is(err, live.ErrTooMany):
		writeError(w, http.StatusTooManyRequests, "too_many_games", err.Error())
	case errors.Is(err, live.ErrBusy):
		writeError(w, http.StatusServiceUnavailable, "busy", err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal", "Something went wrong on our side.")
	}
}

// handleRoomSocket upgrades to a WebSocket and hands the connection to the room.
// The seat ticket is sent as the first message, not in the URL, so it never ends
// up in an access log.
func (s *Server) handleRoomSocket(w http.ResponseWriter, r *http.Request) {
	room := s.hub.Room(strings.ToUpper(strings.TrimSpace(r.PathValue("code"))))
	if room == nil {
		writeError(w, http.StatusNotFound, "not_found", "No game with that code.")
		return
	}
	// The server's per-request deadlines are for ordinary requests; a game is
	// meant to last. Clear them before the connection is taken over.
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Time{})
	_ = rc.SetWriteDeadline(time.Time{})

	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: s.originPatterns()})
	if err != nil {
		s.log.Warn("websocket upgrade refused", "err", err, "origin", r.Header.Get("Origin"))
		return
	}
	room.Serve(r.Context(), ws)
}

// originPatterns lists the extra hosts allowed to open a game socket. The page's
// own host is always allowed, which is the case behind the web container.
func (s *Server) originPatterns() []string {
	var out []string
	for _, o := range s.cfg.CORSOrigins {
		o = strings.TrimPrefix(strings.TrimPrefix(o, "https://"), "http://")
		if o != "" {
			out = append(out, o)
		}
	}
	return out
}

// ---------------------------------------------------------- persistence

// livePersister writes a live match to Postgres. The room calls it from its own
// goroutine, so a slow query is a delayed history entry, never a delayed round.
type livePersister struct{ st *store.Store }

func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (p livePersister) StartMatch(ctx context.Context, m live.MatchInfo) (string, error) {
	p1, p2 := optional(m.Users[0]), optional(m.Users[1])
	if m.Bot {
		p2 = nil
	}
	match, err := p.st.CreateMatch(ctx, store.NewMatch{
		GameID: m.GameID, HostID: p1, P1User: p1, P2User: p2,
		P1Name: m.Players[0].Name, P1Avatar: m.Players[0].Avatar,
		P2Name: m.Players[1].Name, P2Avatar: m.Players[1].Avatar,
		P2IsBot: m.Bot, Mode: m.Mode, RoomCode: m.RoomCode,
	})
	return match.ID, err
}

func (p livePersister) RecordSubmission(ctx context.Context, matchID string, rec live.Record) error {
	return p.st.RecordSubmission(ctx, store.Submission{
		MatchID: matchID, QuestionID: rec.QuestionID, RoundNo: rec.Round, Player: rec.Seat,
		RawText: trimTo(rec.Raw, 120), Normalized: rec.Normalized, AnswerID: optional(rec.AnswerID),
		Correct: rec.Correct, IsSteal: rec.IsSteal, MsElapsed: rec.MsElapsed,
	})
}

func winnerPtr(w int) *int {
	if w < 0 {
		return nil
	}
	return &w
}

func (p livePersister) CloseRound(ctx context.Context, matchID string, rec live.Record) error {
	return p.st.CloseRound(ctx, store.RoundResult{
		MatchID: matchID, RoundNo: rec.Round, QuestionID: rec.QuestionID,
		Winner: winnerPtr(rec.Winner), Points: rec.Points, Stolen: rec.Stolen,
		P1Score: rec.Scores[0], P2Score: rec.Scores[1],
	})
}

func (p livePersister) AbandonMatch(ctx context.Context, matchID string) error {
	return p.st.AbandonMatch(ctx, matchID)
}

func (p livePersister) FinishMatch(ctx context.Context, matchID string, rec live.Record) error {
	_, err := p.st.FinishMatch(ctx, matchID, rec.Scores[0], rec.Scores[1], winnerPtr(rec.Winner))
	return err
}
