package live

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// These tests run a real room over real WebSockets. Two clients stand in for two
// phones, each with its own delay, which is how "first" is proved to mean
// "reached the server first" and not "pressed first on a faster phone".

// ------------------------------------------------------------------ harness

type memPersister struct {
	mu        sync.Mutex
	abandoned []string
	started   []MatchInfo
	subs      []Record
	rounds    []Record
	finished  []Record
}

func (m *memPersister) StartMatch(_ context.Context, i MatchInfo) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.started = append(m.started, i)
	return "match-" + itoa(len(m.started)), nil
}
func (m *memPersister) RecordSubmission(_ context.Context, _ string, r Record) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.subs = append(m.subs, r)
	return nil
}
func (m *memPersister) CloseRound(_ context.Context, _ string, r Record) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rounds = append(m.rounds, r)
	return nil
}
func (m *memPersister) AbandonMatch(_ context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.abandoned = append(m.abandoned, id)
	return nil
}
func (m *memPersister) FinishMatch(_ context.Context, _ string, r Record) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.finished = append(m.finished, r)
	return nil
}

type env struct {
	t    *testing.T
	hub  *Hub
	srv  *httptest.Server
	pers *memPersister
}

// fastTimings runs the show at a quarter of its normal pace so a test finishes
// in seconds, while keeping every ratio between its steps.
func fastTimings() Timings { return DefaultTimings().Scaled(0.25) }

func newEnv(t *testing.T) *env {
	t.Helper()
	pers := &memPersister{}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := NewHub(pers, fastTimings(), log)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws/{code}", func(w http.ResponseWriter, r *http.Request) {
		room := hub.Room(r.PathValue("code"))
		if room == nil {
			http.NotFound(w, r)
			return
		}
		ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		room.Serve(r.Context(), ws)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &env{t: t, hub: hub, srv: srv, pers: pers}
}

func (e *env) create(bot bool, deck Deck) (*Room, SeatTicket) {
	e.t.Helper()
	room, ticket, err := e.hub.Create(CreateParams{
		UserID: "host-user", Player: PlayerInfo{Name: "Nairobi", Avatar: 1}, Bot: bot, Difficulty: "medium",
		Deck: deck, Game: GameInfo{ID: "g1", ShareCode: "SHARE1", Category: CategoryInfo{Slug: "food", Name: "Food"}},
		Respin: func(context.Context) (Deck, GameInfo, error) {
			return testDeck(), GameInfo{ID: "g2", ShareCode: "SHARE2", Category: CategoryInfo{Slug: "food", Name: "Food"}}, nil
		},
	})
	if err != nil {
		e.t.Fatalf("create room: %v", err)
	}
	t := e.t
	t.Cleanup(func() { room.Close("test over") })
	return room, ticket
}

type phone struct {
	t     *testing.T
	name  string
	ws    *websocket.Conn
	delay time.Duration // how long this phone's messages take to reach the server

	mu     sync.Mutex
	frames []string
	last   stateMsg
	errs   []errorMsg
	typing []int64
	closed bool
}

func (e *env) dial(name, code, token string, delay time.Duration) *phone {
	e.t.Helper()
	url := "ws" + strings.TrimPrefix(e.srv.URL, "http") + "/ws/" + code
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		e.t.Fatalf("%s: dial: %v", name, err)
	}
	p := &phone{t: e.t, name: name, ws: ws, delay: delay}
	e.t.Cleanup(func() { _ = ws.CloseNow() })
	p.raw(clientMsg{T: "hello", Token: token}, 0)
	go p.read()
	return p
}

func (p *phone) read() {
	for {
		_, data, err := p.ws.Read(context.Background())
		if err != nil {
			p.mu.Lock()
			p.closed = true
			p.mu.Unlock()
			return
		}
		p.mu.Lock()
		p.frames = append(p.frames, string(data))
		var head struct {
			T string `json:"t"`
		}
		_ = json.Unmarshal(data, &head)
		switch head.T {
		case "state":
			var s stateMsg
			if json.Unmarshal(data, &s) == nil {
				p.last = s
			}
		case "error":
			var m errorMsg
			if json.Unmarshal(data, &m) == nil {
				p.errs = append(p.errs, m)
			}
		case "typing":
			var m typingMsg
			if json.Unmarshal(data, &m) == nil {
				p.typing = append(p.typing, m.Until)
			}
		}
		p.mu.Unlock()
	}
}

// raw sends a message after the given delay, as a slow network would.
func (p *phone) raw(m clientMsg, after time.Duration) {
	if after > 0 {
		time.Sleep(after)
	}
	b, _ := json.Marshal(m)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = p.ws.Write(ctx, websocket.MessageText, b)
}

// send queues a message that will reach the server after this phone's delay,
// without making the caller wait.
func (p *phone) send(m clientMsg) {
	go p.raw(m, p.delay)
}

func (p *phone) state() stateMsg {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.last
}

func (p *phone) framesSince(i int) []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.frames[i:]...)
}

func (p *phone) frameCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.frames)
}

func (p *phone) waitFor(what string, ok func(stateMsg) bool) stateMsg {
	p.t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if s := p.state(); s.T == "state" && ok(s) {
			return s
		}
		time.Sleep(5 * time.Millisecond)
	}
	p.t.Fatalf("%s: timed out waiting for %s (screen=%s phase=%v)", p.name, what, p.state().View.Screen, phaseOf(p.state()))
	return stateMsg{}
}

func showSeat(p *int) string {
	if p == nil {
		return "nobody"
	}
	return "player " + itoa(*p)
}

func phaseOf(s stateMsg) Phase {
	if s.View.Round == nil {
		return ""
	}
	return s.View.Round.Phase
}

func inPhase(p Phase) func(stateMsg) bool {
	return func(s stateMsg) bool { return phaseOf(s) == p }
}

// twoPhones seats two players in a fresh room and connects both.
func (e *env) twoPhones(deck Deck, delayA, delayB time.Duration) (*Room, *phone, *phone) {
	e.t.Helper()
	room, host := e.create(false, deck)
	guest, err := room.Join("guest-user", PlayerInfo{Name: "Mombasa", Avatar: 4})
	if err != nil {
		e.t.Fatalf("join: %v", err)
	}
	a := e.dial("Nairobi", room.Code(), host.Token, delayA)
	b := e.dial("Mombasa", room.Code(), guest.Token, delayB)
	a.waitFor("both seated and connected", func(s stateMsg) bool { return s.View.Connected[0] && s.View.Connected[1] })
	b.waitFor("both seated and connected", func(s stateMsg) bool { return s.View.Connected[0] && s.View.Connected[1] })
	return room, a, b
}

// ------------------------------------------------------------------- tests

func TestWhenOnePlayerPressesStartTheOtherStartsToo(t *testing.T) {
	e := newEnv(t)
	_, a, b := e.twoPhones(testDeck(), 0, 0)

	if s := b.state(); s.View.Screen != ScreenLobby {
		t.Fatalf("before anyone starts, Mombasa should be in the lobby, got %s", s.View.Screen)
	}

	// Mombasa (the guest) presses start; Nairobi does nothing at all.
	b.send(clientMsg{T: "start"})
	a.waitFor("the intro on Nairobi's phone", func(s stateMsg) bool { return s.View.Screen == ScreenIntro })
	b.waitFor("the intro on Mombasa's phone", func(s stateMsg) bool { return s.View.Screen == ScreenIntro })

	// And the other way round, in a fresh room.
	_, c, d := e.twoPhones(testDeck(), 0, 0)
	c.send(clientMsg{T: "start"})
	d.waitFor("the intro after the host started", func(s stateMsg) bool { return s.View.Screen == ScreenIntro })
}

func TestEachPhoneIsToldWhoItIsPlayingAgainst(t *testing.T) {
	e := newEnv(t)
	_, a, b := e.twoPhones(testDeck(), 0, 0)
	sa, sb := a.state(), b.state()
	if sa.View.Players[0].Name != "Nairobi" || sa.View.Players[1].Name != "Mombasa" {
		t.Fatalf("Nairobi sees %q vs %q", sa.View.Players[0].Name, sa.View.Players[1].Name)
	}
	if sb.View.Players[0].Name != "Mombasa" || sb.View.Players[1].Name != "Nairobi" {
		t.Fatalf("Mombasa sees %q vs %q", sb.View.Players[0].Name, sb.View.Players[1].Name)
	}
	if sa.Room.Me != 0 || sb.Room.Me != 1 {
		t.Fatalf("seats reported as %d and %d", sa.Room.Me, sb.Room.Me)
	}
	if sa.Room.Code == "" || sa.Room.Code != sb.Room.Code {
		t.Fatalf("both phones should share one room code, got %q and %q", sa.Room.Code, sb.Room.Code)
	}
}

// The press that reaches the server first wins, whoever pressed first. Nairobi's
// phone is slow (400ms to the server) and Mombasa's is quick (10ms). Nairobi
// presses 150ms before Mombasa, so Mombasa's answer arrives some 240ms ahead of
// Nairobi's, and Mombasa wins. The gap is deliberately generous: this test runs
// on busy machines, and what it proves is ordering, not timer precision.
func TestTheServerDecidesWhoWasFirstNotThePhone(t *testing.T) {
	e := newEnv(t)
	_, a, b := e.twoPhones(testDeck(), 400*time.Millisecond, 10*time.Millisecond)
	a.send(clientMsg{T: "start"})
	a.waitFor("the face-off", inPhase(PhaseFaceoff))
	b.waitFor("the face-off", inPhase(PhaseFaceoff))

	a.send(clientMsg{T: "lock", Text: "keys"}) // pressed first, arrives at +400ms
	time.Sleep(150 * time.Millisecond)
	b.send(clientMsg{T: "lock", Text: "keys"}) // pressed 150ms later, arrives at +160ms

	sa := a.waitFor("the verdict", inPhase(PhaseCorrect))
	sb := b.waitFor("the verdict", inPhase(PhaseCorrect))

	if w := sb.View.Round.Winner; w == nil || *w != 0 {
		t.Fatalf("on Mombasa's phone the winner should be Mombasa (player 0), got %s", showSeat(w))
	}
	if w := sa.View.Round.Winner; w == nil || *w != 1 {
		t.Fatalf("on Nairobi's phone the winner should be Mombasa (player 1), got %s", showSeat(w))
	}
	if sb.View.Players[0].Score != 30 || sa.View.Players[1].Score != 30 {
		t.Fatalf("Mombasa should have 30 points on both screens: %v / %v", sb.View.Players[0].Score, sa.View.Players[1].Score)
	}
	if sa.View.Players[0].Score != 0 {
		t.Fatalf("Nairobi answered the same slot second; they must not score")
	}
}

func TestBothScreensFreezeAndRevealTogether(t *testing.T) {
	e := newEnv(t)
	_, a, b := e.twoPhones(testDeck(), 0, 0)
	a.send(clientMsg{T: "start"})
	a.waitFor("the face-off", inPhase(PhaseFaceoff))
	b.waitFor("the face-off", inPhase(PhaseFaceoff))

	a.send(clientMsg{T: "lock", Text: "phone"})
	sa := a.waitFor("the reveal", inPhase(PhaseReveal))
	sb := b.waitFor("the reveal", inPhase(PhaseReveal))

	if sa.View.Round.FrozenAt == nil || sb.View.Round.FrozenAt == nil {
		t.Fatalf("the clock should be frozen on both screens")
	}
	if *sa.View.Round.FrozenAt != *sb.View.Round.FrozenAt {
		t.Fatalf("the two screens froze at different moments: %d vs %d", *sa.View.Round.FrozenAt, *sb.View.Round.FrozenAt)
	}
	if sb.View.Round.Current == nil || sb.View.Round.Current.Text != "phone" || sb.View.Round.Current.Player != 1 {
		t.Fatalf("Mombasa should be shown Nairobi's answer: %+v", sb.View.Round.Current)
	}
}

func TestTypingIsSharedButTheWordsAreNot(t *testing.T) {
	e := newEnv(t)
	_, a, b := e.twoPhones(testDeck(), 0, 0)
	a.send(clientMsg{T: "start"})
	a.waitFor("the face-off", inPhase(PhaseFaceoff))
	b.waitFor("the face-off", inPhase(PhaseFaceoff))

	mark := b.frameCount()
	a.send(clientMsg{T: "typing"})
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		b.mu.Lock()
		n := len(b.typing)
		b.mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	b.mu.Lock()
	got := len(b.typing)
	b.mu.Unlock()
	if got == 0 {
		t.Fatalf("Mombasa was never told Nairobi is typing")
	}
	for _, f := range b.framesSince(mark) {
		if strings.Contains(f, "keys") {
			t.Fatalf("a typing signal carried text: %s", f)
		}
	}
}

// What one phone is sent must never contain what the other typed, until it is
// shown to both; nor any board slot that has not been earned.
func TestNothingSecretCrossesTheWire(t *testing.T) {
	e := newEnv(t)
	_, a, b := e.twoPhones(testDeck(), 0, 0)
	markA, markB := a.frameCount(), b.frameCount()
	a.send(clientMsg{T: "start"})
	a.waitFor("the face-off", inPhase(PhaseFaceoff))
	b.waitFor("the face-off", inPhase(PhaseFaceoff))

	// Everything sent so far: no answer on the board may appear anywhere.
	for _, f := range append(a.framesSince(markA), b.framesSince(markB)...) {
		for _, secret := range []string{"Keys", "Phone", "Wallet", "Umbrella", "Lights"} {
			if strings.Contains(f, secret) {
				t.Fatalf("%q reached a phone before it was earned: %.200s", secret, f)
			}
		}
	}

	// Nairobi locks first; Mombasa's lock lands during the reveal and is queued.
	markA = a.frameCount()
	a.send(clientMsg{T: "lock", Text: "keys"})
	a.waitFor("the reveal", inPhase(PhaseReveal))
	b.send(clientMsg{T: "lock", Text: "mombasa-secret-answer"})
	b.waitFor("Mombasa's answer to be accepted", func(s stateMsg) bool {
		return s.View.Round != nil && len(s.View.Round.Subs) == 2
	})
	a.waitFor("Nairobi to see two locks", func(s stateMsg) bool {
		return s.View.Round != nil && len(s.View.Round.Subs) == 2
	})
	for _, f := range a.framesSince(markA) {
		if strings.Contains(f, "mombasa-secret-answer") {
			t.Fatalf("Nairobi was sent Mombasa's answer before it was revealed: %.300s", f)
		}
	}
	// The unclaimed answers are still secret too.
	for _, f := range append(a.framesSince(markA), b.framesSince(markB)...) {
		for _, secret := range []string{"Wallet", "Umbrella", "Lights", "Phone"} {
			if strings.Contains(f, secret) {
				t.Fatalf("%q reached a phone while only 'Keys' was earned", secret)
			}
		}
	}

	// Once the late answer is shown, both are entitled to it.
	a.waitFor("the late answer", inPhase(PhaseLate))
	if s := a.state(); s.View.Round.Current == nil || s.View.Round.Current.Text != "mombasa-secret-answer" {
		t.Fatalf("after the reveal Nairobi should see Mombasa's answer: %+v", s.View.Round.Current)
	}
}

func TestADroppedPlayerCanComeBackToTheSameMoment(t *testing.T) {
	e := newEnv(t)
	room, a, b := e.twoPhones(testDeck(), 0, 0)
	a.send(clientMsg{T: "start"})
	a.waitFor("the face-off", inPhase(PhaseFaceoff))
	b.waitFor("the face-off", inPhase(PhaseFaceoff))

	before := b.state().View.Round.Deadline
	_ = a.ws.CloseNow() // Nairobi's phone loses signal

	sb := b.waitFor("the pause", func(s stateMsg) bool { return s.View.Paused })
	if sb.View.Pause == nil || sb.View.Pause.Reason != "disconnect" || sb.View.Pause.Seat != 1 {
		t.Fatalf("Mombasa should be told Nairobi (player 1) dropped: %+v", sb.View.Pause)
	}
	// Mombasa cannot answer into a paused game.
	b.send(clientMsg{T: "lock", Text: "keys"})
	time.Sleep(60 * time.Millisecond)
	if p := phaseOf(b.state()); p != PhaseFaceoff {
		t.Fatalf("an answer during the pause should not move the round, phase = %s", p)
	}

	// Nairobi's phone reconnects with the same ticket.
	a2 := e.dial("Nairobi again", room.Code(), room.seats[0].token, 0)
	a2.waitFor("the show to resume", func(s stateMsg) bool { return !s.View.Paused && phaseOf(s) == PhaseFaceoff })
	sb = b.waitFor("the show to resume", func(s stateMsg) bool { return !s.View.Paused })
	if after := sb.View.Round.Deadline; after == nil || before == nil || *after < *before {
		t.Fatalf("the clock should only ever move forward by the time lost: before=%v after=%v", before, after)
	}

	// And they can play on.
	a2.send(clientMsg{T: "lock", Text: "keys"})
	a2.waitFor("a verdict", inPhase(PhaseCorrect))
}

func TestAnImpostorCannotTakeASeat(t *testing.T) {
	e := newEnv(t)
	room, _ := e.create(false, testDeck())
	p := e.dial("impostor", room.Code(), "not-a-real-token", 0)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		p.mu.Lock()
		n := len(p.errs)
		p.mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.errs) == 0 || p.errs[0].Code != "bad_token" {
		t.Fatalf("a wrong ticket should be refused with bad_token, got %+v", p.errs)
	}
	if p.last.T == "state" {
		t.Fatalf("an impostor was sent the game state")
	}
}

func TestOnlyTwoPeopleFitAndOnlyBeforeTheStart(t *testing.T) {
	e := newEnv(t)
	room, host := e.create(false, testDeck())
	if _, err := room.Join("g1", PlayerInfo{Name: "One"}); err != nil {
		t.Fatal(err)
	}
	if _, err := room.Join("g2", PlayerInfo{Name: "Two"}); err != ErrRoomFull {
		t.Fatalf("a third player: got %v, want ErrRoomFull", err)
	}
	_ = host

	// A game against the computer has no second human seat to take.
	bot, _ := e.create(true, testDeck())
	if _, err := bot.Join("g3", PlayerInfo{Name: "Three"}); err != ErrRoomFull {
		t.Fatalf("joining a game against the computer: got %v, want ErrRoomFull", err)
	}
}

func TestAGameAgainstTheComputerPlaysOnItsOwn(t *testing.T) {
	e := newEnv(t)
	oneRound := testDeck()
	oneRound.Rounds = oneRound.Rounds[:1]
	room, host := e.create(true, oneRound)
	me := e.dial("me", room.Code(), host.Token, 0)
	me.waitFor("the lobby", func(s stateMsg) bool { return s.View.Screen == ScreenLobby })
	if s := me.state(); s.View.Controllers[1] != "bot" || s.View.Players[1].Name != "Computer" {
		t.Fatalf("the opponent must be labelled as the computer: %+v %q", s.View.Controllers, s.View.Players[1].Name)
	}
	me.send(clientMsg{T: "start"})
	me.waitFor("the face-off", inPhase(PhaseFaceoff))
	me.waitFor("the end of the match", func(s stateMsg) bool { return s.View.Screen == ScreenResult })
}

func TestRematchNeedsBothAndDealsAFreshGame(t *testing.T) {
	e := newEnv(t)
	oneRound := testDeck()
	oneRound.Rounds = oneRound.Rounds[:1]
	oneRound.Rounds[0].Kind = KindNormal
	_, a, b := e.twoPhones(oneRound, 0, 0)

	a.send(clientMsg{T: "start"})
	a.waitFor("the face-off", inPhase(PhaseFaceoff))
	a.send(clientMsg{T: "lock", Text: "keys"})
	a.waitFor("the result", func(s stateMsg) bool { return s.View.Screen == ScreenResult })
	b.waitFor("the result", func(s stateMsg) bool { return s.View.Screen == ScreenResult })

	a.send(clientMsg{T: "rematch"})
	b.waitFor("Nairobi's rematch request to show", func(s stateMsg) bool { return s.View.Rematch[1] })
	if b.state().View.Screen != ScreenResult {
		t.Fatalf("one player asking must not restart the game")
	}
	b.send(clientMsg{T: "rematch"})
	a.waitFor("a fresh game", func(s stateMsg) bool { return s.View.Screen == ScreenIntro })
	b.waitFor("a fresh game", func(s stateMsg) bool { return s.View.Screen == ScreenIntro })
	if s := a.state(); s.View.Players[0].Score != 0 || s.View.Players[1].Score != 0 || s.Room.ShareCode != "SHARE2" {
		t.Fatalf("a rematch starts from zero on a new board: %+v %q", s.View.Players, s.Room.ShareCode)
	}
}

func TestEveryRoundAndAnswerIsWrittenDown(t *testing.T) {
	e := newEnv(t)
	oneRound := testDeck()
	oneRound.Rounds = oneRound.Rounds[:1]
	_, a, b := e.twoPhones(oneRound, 0, 0)
	b.send(clientMsg{T: "start"})
	a.waitFor("the face-off", inPhase(PhaseFaceoff))
	a.send(clientMsg{T: "lock", Text: "wallet"})
	a.waitFor("the result", func(s stateMsg) bool { return s.View.Screen == ScreenResult })

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		e.pers.mu.Lock()
		done := len(e.pers.finished) == 1
		e.pers.mu.Unlock()
		if done {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	e.pers.mu.Lock()
	defer e.pers.mu.Unlock()
	if len(e.pers.started) != 1 {
		t.Fatalf("matches started = %d, want 1", len(e.pers.started))
	}
	info := e.pers.started[0]
	if info.Mode != "live" || info.Users != [2]string{"host-user", "guest-user"} || info.Players[1].Name != "Mombasa" {
		t.Fatalf("match info = %+v", info)
	}
	if len(e.pers.subs) != 1 || !e.pers.subs[0].Correct || e.pers.subs[0].AnswerID != "a3" {
		t.Fatalf("submissions = %+v", e.pers.subs)
	}
	if len(e.pers.rounds) != 1 || e.pers.rounds[0].Winner != 0 || e.pers.rounds[0].Points != 20 {
		t.Fatalf("rounds = %+v", e.pers.rounds)
	}
	if len(e.pers.finished) != 1 || e.pers.finished[0].Winner != 0 || e.pers.finished[0].Scores != [2]int{20, 0} {
		t.Fatalf("finished = %+v", e.pers.finished)
	}
}

func TestAMatchCutOffMidwayIsRecordedAsAbandoned(t *testing.T) {
	e := newEnv(t)
	room, a, b := e.twoPhones(testDeck(), 0, 0)
	a.send(clientMsg{T: "start"})
	a.waitFor("the face-off", inPhase(PhaseFaceoff))
	b.waitFor("the face-off", inPhase(PhaseFaceoff))
	room.Close("test: cut off")

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		e.pers.mu.Lock()
		n := len(e.pers.abandoned)
		e.pers.mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	e.pers.mu.Lock()
	defer e.pers.mu.Unlock()
	if len(e.pers.abandoned) != 1 || e.pers.abandoned[0] != "match-1" {
		t.Fatalf("abandoned = %v, want [match-1]", e.pers.abandoned)
	}
}

func TestAFinishedMatchIsNeverMarkedAbandoned(t *testing.T) {
	e := newEnv(t)
	oneRound := testDeck()
	oneRound.Rounds = oneRound.Rounds[:1]
	room, a, _ := e.twoPhones(oneRound, 0, 0)
	a.send(clientMsg{T: "start"})
	a.waitFor("the face-off", inPhase(PhaseFaceoff))
	a.send(clientMsg{T: "lock", Text: "keys"})
	a.waitFor("the result", func(s stateMsg) bool { return s.View.Screen == ScreenResult })
	time.Sleep(200 * time.Millisecond)
	room.Close("test: after the result")
	time.Sleep(300 * time.Millisecond)

	e.pers.mu.Lock()
	defer e.pers.mu.Unlock()
	if len(e.pers.abandoned) != 0 || len(e.pers.finished) != 1 {
		t.Fatalf("abandoned=%v finished=%d; a finished match must stay finished", e.pers.abandoned, len(e.pers.finished))
	}
}

func TestAMessageThatIsNotJSONIsIgnoredNotFatal(t *testing.T) {
	e := newEnv(t)
	_, a, b := e.twoPhones(testDeck(), 0, 0)
	a.send(clientMsg{T: "start"})
	a.waitFor("the face-off", inPhase(PhaseFaceoff))

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = b.ws.Write(ctx, websocket.MessageText, []byte("{not json"))
	_ = b.ws.Write(ctx, websocket.MessageText, []byte("null"))
	_ = b.ws.Write(ctx, websocket.MessageText, []byte(`{"t":"no-such-thing"}`))

	time.Sleep(100 * time.Millisecond)
	if s := a.state(); s.View.Paused {
		t.Fatalf("one phone's garbage paused the game for the other")
	}
	b.mu.Lock()
	closed := b.closed
	b.mu.Unlock()
	if closed {
		t.Fatalf("a malformed message should not disconnect the sender")
	}
	a.send(clientMsg{T: "lock", Text: "keys"})
	a.waitFor("a verdict", inPhase(PhaseCorrect))
}

func TestAnOversizedMessageDropsOnlyItsSender(t *testing.T) {
	e := newEnv(t)
	room, a, b := e.twoPhones(testDeck(), 0, 0)
	a.send(clientMsg{T: "start"})
	a.waitFor("the face-off", inPhase(PhaseFaceoff))

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = b.ws.Write(ctx, websocket.MessageText, bytes.Repeat([]byte("x"), 10_000))

	// Mombasa is cut off; Nairobi is told, and the show waits for Mombasa.
	a.waitFor("the pause", func(s stateMsg) bool {
		return s.View.Paused && s.View.Pause != nil && s.View.Pause.Reason == "disconnect"
	})

	b2 := e.dial("Mombasa again", room.Code(), room.seats[1].token, 0)
	a.waitFor("the show to resume", func(s stateMsg) bool { return !s.View.Paused })
	b2.waitFor("the face-off again", inPhase(PhaseFaceoff))
}
