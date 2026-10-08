package live

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"log/slog"
	mrand "math/rand/v2"
	"sync"
	"time"

	"github.com/dennisobel/gameshow/apps/api/internal/spin"
)

// Errors the REST layer turns into answers.
var (
	ErrRoomClosed = errors.New("that game has ended")
	ErrRoomFull   = errors.New("that game already has two players")
	ErrStarted    = errors.New("that game has already started")
	ErrBadToken   = errors.New("this seat is not yours")
	ErrSeatTaken  = errors.New("the computer has taken over that seat")
	ErrBusy       = errors.New("the show is full right now, try again in a minute")
	ErrTooMany    = errors.New("you already have several games open")
)

// SeatTicket is the secret that lets one browser tab hold one seat. It belongs
// to the tab, not the account: two tabs in one browser share a login but must be
// two different players.
type SeatTicket struct {
	Seat  int    `json:"seat"`
	Token string `json:"token"`
}

// GameInfo says which spun game the room is playing.
type GameInfo struct {
	ID        string
	ShareCode string
	Category  CategoryInfo
	Rounds    int
}

// Spinner makes a fresh deck from the same category, for a rematch.
type Spinner func(ctx context.Context) (Deck, GameInfo, error)

// MatchInfo is what the database needs to know when a match begins.
type MatchInfo struct {
	GameID   string
	RoomCode string
	Mode     string
	Users    [2]string
	Players  [2]PlayerInfo
	Bot      bool
}

// Persister writes a match down. The room calls it from its own goroutine, never
// from the middle of a round.
type Persister interface {
	StartMatch(ctx context.Context, m MatchInfo) (matchID string, err error)
	RecordSubmission(ctx context.Context, matchID string, rec Record) error
	CloseRound(ctx context.Context, matchID string, rec Record) error
	FinishMatch(ctx context.Context, matchID string, rec Record) error
	// AbandonMatch marks a match that will never finish: the room closed under it.
	AbandonMatch(ctx context.Context, matchID string) error
}

type persistItem struct {
	rec  Record
	info MatchInfo
}

type seatState struct {
	token      string
	userID     string
	conn       *conn
	lastSeen   time.Time
	lastTyping int64
	lastReact  int64
}

// Room is one game: two seats, one engine, one clock.
type Room struct {
	hub        *Hub
	code       string
	mode       string // live | bot
	hostUser   string
	difficulty string
	created    time.Time
	log        *slog.Logger

	mu         sync.Mutex
	eng        *Engine
	game       GameInfo
	seats      [2]seatState
	respin     Spinner
	respinning bool
	timer      *time.Timer
	seq        int64
	closed     bool
	lastActive time.Time
	resultAt   time.Time
	persist    chan persistItem
}

func newToken() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic("live: no randomness available: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func nowMs() int64 { return time.Now().UnixMilli() }

// ------------------------------------------------------------------- info

// PublicRoom is what anyone holding the code may see before joining.
type PublicRoom struct {
	Code     string       `json:"code"`
	Mode     string       `json:"mode"`
	Status   string       `json:"status"` // open | full | playing | finished
	Category CategoryInfo `json:"category"`
	Host     PlayerInfo   `json:"host"`
	Rounds   int          `json:"rounds"`
}

func (r *Room) Code() string { return r.code }

func (r *Room) Public() PublicRoom {
	r.mu.Lock()
	defer r.mu.Unlock()
	status := "open"
	switch {
	case r.closed || r.eng.Screen() == ScreenResult:
		status = "finished"
	case r.eng.InProgress():
		status = "playing"
	case r.eng.Seated(1):
		status = "full"
	}
	return PublicRoom{
		Code: r.code, Mode: r.mode, Status: status, Category: r.game.Category,
		Host: r.eng.players[0].PlayerInfo, Rounds: r.eng.Rounds(),
	}
}

func (r *Room) roomInfo(seat int) RoomInfo {
	return RoomInfo{
		Code: r.code, Mode: r.mode, Me: seat, Category: r.game.Category,
		ShareCode: r.game.ShareCode, Rounds: r.eng.Rounds(), Difficulty: r.difficulty,
	}
}

// ---------------------------------------------------------------- joining

// Join seats the second player.
func (r *Room) Join(userID string, info PlayerInfo) (SeatTicket, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	switch {
	case r.closed:
		return SeatTicket{}, ErrRoomClosed
	case r.mode != "live" || r.eng.Seated(1):
		return SeatTicket{}, ErrRoomFull
	case r.eng.Screen() != ScreenLobby:
		return SeatTicket{}, ErrStarted
	}
	now := nowMs()
	r.eng.Seat(1, info, true)
	r.seats[1] = seatState{token: newToken(), userID: userID, lastSeen: time.Now()}
	r.touch()
	r.after(now)
	return SeatTicket{Seat: 1, Token: r.seats[1].token}, nil
}

func (r *Room) touch() { r.lastActive = time.Now() }

func (r *Room) attach(token string, c *conn) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return 0, ErrRoomClosed
	}
	seat := -1
	for i := 0; i < 2; i++ {
		t := r.seats[i].token
		if t != "" && subtle.ConstantTimeCompare([]byte(t), []byte(token)) == 1 {
			seat = i
		}
	}
	if seat < 0 {
		return 0, ErrBadToken
	}
	if !r.eng.Human(seat) {
		return 0, ErrSeatTaken
	}
	if old := r.seats[seat].conn; old != nil {
		old.close("replaced by a newer connection")
	}
	r.seats[seat].conn = c
	r.seats[seat].lastSeen = time.Now()
	c.seat = seat
	now := nowMs()
	r.eng.SetConnected(seat, true, now)
	r.touch()
	r.after(now)
	return seat, nil
}

func (r *Room) detach(c *conn) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.seats[c.seat].conn != c {
		return
	}
	r.seats[c.seat].conn = nil
	r.seats[c.seat].lastSeen = time.Now()
	now := nowMs()
	r.eng.SetConnected(c.seat, false, now)
	r.after(now)
}

// -------------------------------------------------------------- messages

// handle carries out one thing a phone said.
func (r *Room) handle(c *conn, m clientMsg) {
	if m.T == "ping" {
		c.trySend(mustJSON(pongMsg{T: "pong", C: m.C, S: nowMs()}))
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.seats[c.seat].conn != c {
		return
	}
	now := nowMs()
	seat := c.seat
	r.touch()
	changed := false

	switch m.T {
	case "start":
		if err := r.eng.Start(now); err != nil {
			c.trySend(errMsg("cannot_start", err.Error()))
			return
		}
		changed = true

	case "lock":
		if err := r.eng.Lock(seat, m.Text, now); err != nil {
			code, msg := "refused", err.Error()
			if errors.Is(err, ErrNotAccepting) {
				code, msg = "too_late", "Too late: the round has moved on."
			}
			c.trySend(errMsg(code, msg))
			return
		}
		changed = true

	case "typing":
		s := &r.seats[seat]
		if now-s.lastTyping < 400 || !r.eng.Typing(seat, now) {
			return
		}
		s.lastTyping = now
		if o := r.seats[other(seat)].conn; o != nil {
			o.trySend(mustJSON(typingMsg{T: "typing", Until: now + r.eng.tm.TypingTTL}))
		}
		return

	case "freeze":
		if err := r.eng.Freeze(seat, now); err != nil {
			c.trySend(errMsg("refused", err.Error()))
			return
		}
		changed = true

	case "react":
		r.react(seat, m.E, now)
		return

	case "rematch":
		ready, err := r.eng.Rematch(seat)
		if err != nil {
			c.trySend(errMsg("refused", err.Error()))
			return
		}
		if ready && !r.respinning && r.respin != nil {
			r.respinning = true
			go r.restart()
		}
		changed = true

	case "decide":
		if err := r.eng.Decide(seat, m.Choice, now); err != nil {
			if m.Choice == "leave" {
				r.closeLocked("left")
				return
			}
			c.trySend(errMsg("refused", err.Error()))
			return
		}
		changed = true

	case "pause":
		if err := r.eng.Pause(now); err != nil {
			c.trySend(errMsg("refused", err.Error()))
			return
		}
		changed = true

	case "resume":
		r.eng.Resume(now)
		changed = true

	case "level":
		if r.mode == "bot" && r.eng.Screen() == ScreenLobby {
			r.eng.SetDifficulty(m.Level)
			r.difficulty = m.Level
			changed = true
		}

	case "leave":
		r.leave(seat, now)
		return
	}

	if changed {
		r.after(now)
	}
}

func validReaction(s string) bool {
	n := 0
	for _, r := range s {
		n++
		if r < 0x20 || n > 24 {
			return false
		}
	}
	return n > 0
}

// react passes a reaction to the other player. If the other player is the
// computer it sometimes answers back, as it always has; it is labelled as the
// computer wherever a player can see it.
func (r *Room) react(seat int, e string, now int64) {
	if !validReaction(e) {
		return
	}
	s := &r.seats[seat]
	if now-s.lastReact < 350 {
		return
	}
	s.lastReact = now
	o := other(seat)
	if c := r.seats[o].conn; c != nil && r.eng.Human(o) {
		c.trySend(mustJSON(reactionMsg{T: "reaction", E: e}))
		return
	}
	if !r.eng.Human(o) && mrand.Float64() < 0.6 {
		replies := []string{"😎", "🔥", "👀", "😂", "👏"}
		reply := replies[mrand.IntN(len(replies))]
		delay := time.Duration(900+mrand.IntN(900)) * time.Millisecond
		time.AfterFunc(delay, func() {
			r.mu.Lock()
			defer r.mu.Unlock()
			if c := r.seats[seat].conn; c != nil && !r.closed {
				c.trySend(mustJSON(reactionMsg{T: "reaction", E: reply}))
			}
		})
	}
}

func (r *Room) leave(seat int, now int64) {
	switch {
	case r.eng.Screen() == ScreenLobby && seat == 0:
		r.closeLocked("host_left")
	case r.eng.Screen() == ScreenLobby:
		if c := r.seats[1].conn; c != nil {
			c.close("left")
		}
		r.eng.Unseat(1)
		r.seats[1] = seatState{}
		r.after(now)
	case r.eng.InProgress():
		if c := r.seats[seat].conn; c != nil {
			r.seats[seat].conn = nil
			c.close("left")
		}
		r.eng.Abandon(seat, now)
		r.after(now)
	default:
		if c := r.seats[seat].conn; c != nil {
			c.close("left")
		}
	}
}

// restart fetches a fresh deck for a rematch. The database call happens with the
// room unlocked, so a slow query cannot stall the other player's screen.
func (r *Room) restart() {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	deck, game, err := r.respin(ctx)

	r.mu.Lock()
	defer r.mu.Unlock()
	r.respinning = false
	if r.closed {
		return
	}
	if err != nil {
		r.log.Error("rematch spin failed", "room", r.code, "err", err)
		for i := 0; i < 2; i++ {
			if c := r.seats[i].conn; c != nil {
				c.trySend(errMsg("rematch_failed", "Could not set up a new game. Try again."))
			}
		}
		return
	}
	now := nowMs()
	r.game = game
	r.eng.Restart(deck, now)
	r.resultAt = time.Time{}
	r.after(now)
}

// ----------------------------------------------------------- state fan-out

// after is called with the lock held whenever the engine may have changed. It
// queues what should be written down, tells both phones, and sets the alarm for
// the next thing that needs to happen on its own.
func (r *Room) after(now int64) {
	for _, rec := range r.eng.DrainRecords() {
		item := persistItem{rec: rec}
		if rec.Kind == RecMatchStarted {
			item.info = r.matchInfo()
		}
		select {
		case r.persist <- item:
		default:
			r.log.Error("persist queue full; dropping a record", "room", r.code, "kind", rec.Kind)
		}
	}
	r.seq++
	for i := 0; i < 2; i++ {
		if c := r.seats[i].conn; c != nil {
			c.trySend(r.stateFor(i, now))
		}
	}
	if _, done := r.eng.Outcome(); done && r.resultAt.IsZero() {
		r.resultAt = time.Now()
	}
	r.arm(now)
}

func (r *Room) stateFor(seat int, now int64) []byte {
	v := r.eng.View(seat, now)
	v.Seq = r.seq
	return mustJSON(stateMsg{T: "state", View: v, Room: r.roomInfo(seat)})
}

func (r *Room) matchInfo() MatchInfo {
	return MatchInfo{
		GameID: r.game.ID, RoomCode: r.code, Mode: r.mode, Bot: r.mode == "bot",
		Users:   [2]string{r.seats[0].userID, r.seats[1].userID},
		Players: [2]PlayerInfo{r.eng.players[0].PlayerInfo, r.eng.players[1].PlayerInfo},
	}
}

func (r *Room) arm(now int64) {
	due := r.eng.NextDue()
	if due == 0 {
		r.timer.Stop()
		return
	}
	r.timer.Reset(time.Duration(max(0, due-now)+1) * time.Millisecond)
}

// onTimer is the alarm: something is due, so let the show carry on.
func (r *Room) onTimer() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	now := nowMs()
	r.eng.Tick(now)
	r.after(now)
}

// persistLoop writes the match down in order, off the hot path. A database
// outage costs history, never a round.
func (r *Room) persistLoop(p Persister) {
	var matchID string
	for item := range r.persist {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		var err error
		switch item.rec.Kind {
		case RecMatchStarted:
			matchID, err = p.StartMatch(ctx, item.info)
		case RecSubmission:
			if matchID != "" {
				err = p.RecordSubmission(ctx, matchID, item.rec)
			}
		case RecRoundClosed:
			if matchID != "" {
				err = p.CloseRound(ctx, matchID, item.rec)
			}
		case RecMatchFinished:
			if matchID != "" {
				err = p.FinishMatch(ctx, matchID, item.rec)
				// A finished match must never be marked abandoned by a later close.
				matchID = ""
			}
		case RecMatchAbandoned:
			if matchID != "" {
				err = p.AbandonMatch(ctx, matchID)
				matchID = ""
			}
		}
		cancel()
		if err != nil {
			r.log.Error("could not record match event", "room", r.code, "kind", item.rec.Kind, "err", err)
		}
	}
}

// ------------------------------------------------------------------ closing

// Close ends the room and tells everyone in it.
func (r *Room) Close(reason string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.closeLocked(reason)
}

func (r *Room) closeLocked(reason string) {
	if r.closed {
		return
	}
	r.closed = true
	r.timer.Stop()
	if r.eng.InProgress() {
		// The match will never reach a result; say so rather than leave it "active".
		select {
		case r.persist <- persistItem{rec: Record{Kind: RecMatchAbandoned}}:
		default:
		}
	}
	for i := 0; i < 2; i++ {
		if c := r.seats[i].conn; c != nil {
			c.trySend(mustJSON(closedMsg{T: "closed", Reason: reason}))
			c.closeSoon()
		}
	}
	close(r.persist)
	r.hub.remove(r.code)
}

// idle reports how stale the room is, for the janitor.
func (r *Room) idle() (closed bool, connected int, lastActive time.Time, resultAt time.Time, screen Screen) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := 0; i < 2; i++ {
		if r.seats[i].conn != nil {
			connected++
		}
	}
	return r.closed, connected, r.lastActive, r.resultAt, r.eng.Screen()
}

// freeAbandonedSeat lets a guest who claimed a seat and never connected go, so
// the host is not left waiting on someone who closed their tab.
func (r *Room) freeAbandonedSeat(after time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.eng.Screen() != ScreenLobby || !r.eng.Seated(1) || r.mode != "live" {
		return
	}
	s := r.seats[1]
	if s.conn != nil || time.Since(s.lastSeen) < after {
		return
	}
	r.eng.Unseat(1)
	r.seats[1] = seatState{}
	r.after(nowMs())
}

// ------------------------------------------------------------------- hub

// Hub keeps track of every open room.
type Hub struct {
	mu       sync.Mutex
	rooms    map[string]*Room
	store    Persister
	tm       Timings
	log      *slog.Logger
	maxRooms int
	perUser  int
}

func NewHub(store Persister, tm Timings, log *slog.Logger) *Hub {
	return &Hub{rooms: map[string]*Room{}, store: store, tm: tm, log: log, maxRooms: 2000, perUser: 6}
}

// CreateParams is everything needed to open a room.
type CreateParams struct {
	UserID     string
	Player     PlayerInfo
	Bot        bool
	Difficulty string
	Deck       Deck
	Game       GameInfo
	Respin     Spinner
}

func (h *Hub) Create(p CreateParams) (*Room, SeatTicket, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.rooms) >= h.maxRooms {
		return nil, SeatTicket{}, ErrBusy
	}
	if p.UserID != "" {
		open := 0
		for _, r := range h.rooms {
			if r.hostUser == p.UserID {
				open++
			}
		}
		if open >= h.perUser {
			return nil, SeatTicket{}, ErrTooMany
		}
	}

	code := ""
	for tries := 0; tries < 20; tries++ {
		c := spin.NewShareCode(4)
		if _, taken := h.rooms[c]; !taken {
			code = c
			break
		}
	}
	if code == "" {
		return nil, SeatTicket{}, ErrBusy
	}

	mode := "live"
	if p.Bot {
		mode = "bot"
	}
	if p.Difficulty == "" {
		p.Difficulty = "medium"
	}
	r := &Room{
		hub: h, code: code, mode: mode, hostUser: p.UserID, difficulty: p.Difficulty,
		created: time.Now(), log: h.log.With("room", code), game: p.Game, respin: p.Respin,
		eng:        New(h.tm, p.Deck, newRNG(uint64(time.Now().UnixNano())), p.Difficulty),
		persist:    make(chan persistItem, 512),
		lastActive: time.Now(),
	}
	r.timer = time.AfterFunc(time.Hour, r.onTimer)
	r.timer.Stop()

	r.eng.Seat(0, p.Player, true)
	r.seats[0] = seatState{token: newToken(), userID: p.UserID, lastSeen: time.Now()}
	if p.Bot {
		r.eng.Seat(1, PlayerInfo{Name: "Computer", Avatar: 5}, false)
	}
	go r.persistLoop(h.store)

	h.rooms[code] = r
	return r, SeatTicket{Seat: 0, Token: r.seats[0].token}, nil
}

func (h *Hub) Room(code string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.rooms[code]
}

func (h *Hub) remove(code string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.rooms, code)
}

// Open reports how many rooms exist, for the health endpoint.
func (h *Hub) Open() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.rooms)
}

// Run sweeps away rooms nobody is using, until ctx ends.
func (h *Hub) Run(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			h.mu.Lock()
			rooms := make([]*Room, 0, len(h.rooms))
			for _, r := range h.rooms {
				rooms = append(rooms, r)
			}
			h.mu.Unlock()
			for _, r := range rooms {
				r.Close("server_stopping")
			}
			return
		case <-t.C:
			h.sweep()
		}
	}
}

func (h *Hub) sweep() {
	h.mu.Lock()
	rooms := make([]*Room, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, r)
	}
	h.mu.Unlock()

	for _, r := range rooms {
		r.freeAbandonedSeat(2 * time.Minute)
		closed, connected, last, resultAt, screen := r.idle()
		if closed {
			continue
		}
		switch {
		case connected == 0 && time.Since(last) > 10*time.Minute:
			r.Close("abandoned")
		case screen == ScreenLobby && time.Since(last) > 45*time.Minute:
			r.Close("expired")
		case screen == ScreenResult && !resultAt.IsZero() && time.Since(resultAt) > 20*time.Minute:
			r.Close("finished")
		}
	}
}
