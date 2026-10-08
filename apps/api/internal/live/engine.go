package live

import (
	"math/rand/v2"

	"github.com/dennisobel/gameshow/apps/api/internal/matching"
)

const (
	outcomeNone = -2
	outcomeDraw = -1

	pauseManual     = "manual"
	pauseDisconnect = "disconnect"
)

// Engine is one match. It is not safe for concurrent use: the room serialises
// every call.
type Engine struct {
	tm         Timings
	deck       Deck
	rng        *rand.Rand
	difficulty string

	screen    Screen
	players   [2]Player
	seated    [2]bool // somebody, or the computer, holds the seat
	human     [2]bool
	connected [2]bool

	roundIndex int
	sudden     int // 0 until a tie-breaker is reached, then 1-based
	round      *RoundState
	history    []RoundRecord
	host       [2]HostState
	fx         []Fx
	fxSeq      int
	delta      *Delta
	outcome    int
	nextAt     int64 // when a non-round screen moves on by itself; 0 = never

	paused      bool
	pausedAt    int64
	pauseReason string
	pausedBy    int
	graceUntil  int64
	decision    bool

	rematch [2]bool
	records []Record
}

// New creates a match in the lobby.
func New(tm Timings, deck Deck, rng *rand.Rand, difficulty string) *Engine {
	deck.prepare()
	e := &Engine{
		tm:         tm,
		deck:       deck,
		rng:        rng,
		difficulty: difficulty,
		screen:     ScreenLobby,
		outcome:    outcomeNone,
	}
	e.say("lobby", "smug", nil)
	return e
}

func (e *Engine) Screen() Screen       { return e.screen }
func (e *Engine) Rounds() int          { return len(e.deck.Rounds) }
func (e *Engine) Paused() bool         { return e.paused }
func (e *Engine) Human(seat int) bool  { return e.human[seat] }
func (e *Engine) Name(seat int) string { return e.players[seat].Name }

// Scores returns both scores in seat order.
func (e *Engine) Scores() [2]int { return [2]int{e.players[0].Score, e.players[1].Score} }

// Outcome reports the finished result: a seat, -1 for a draw, and ok=false while
// the match is still being played.
func (e *Engine) Outcome() (winner int, ok bool) {
	if e.outcome == outcomeNone {
		return 0, false
	}
	return e.outcome, true
}

// InProgress is true from the intro to the final result.
func (e *Engine) InProgress() bool { return e.screen != ScreenLobby && e.screen != ScreenResult }

// DrainRecords hands over what has happened since the last call.
func (e *Engine) DrainRecords() []Record {
	out := e.records
	e.records = nil
	return out
}

// ------------------------------------------------------------- small helpers

func (e *Engine) say(event, mood string, vars map[string]any) {
	for i := range e.host {
		e.host[i] = HostState{Event: event, Vars: vars, Mood: mood, Key: e.host[i].Key + 1}
	}
}

func (e *Engine) sayTo(seat int, event, mood string, vars map[string]any) {
	e.host[seat] = HostState{Event: event, Vars: vars, Mood: mood, Key: e.host[seat].Key + 1}
}

func (e *Engine) emit(kind, name string) {
	e.fxSeq++
	e.fx = append(e.fx, Fx{ID: e.fxSeq, Kind: kind, Name: name})
	if len(e.fx) > 12 {
		e.fx = e.fx[len(e.fx)-12:]
	}
}

func (e *Engine) record(r Record) { e.records = append(e.records, r) }

func (r *RoundState) setPhase(p Phase, now, nextAt int64) {
	r.Phase = p
	r.PhaseStart = now
	r.NextAt = nextAt
}

func newRound(def *Round, number int, now int64, tm Timings) *RoundState {
	tiles := make([]Tile, len(def.Answers))
	for i, a := range def.Answers {
		tiles[i] = Tile{Kind: TileHidden, By: -1, Points: a.Points * def.Multiplier}
	}
	return &RoundState{
		Def:        def,
		Number:     number,
		Phase:      PhaseQuestion,
		PhaseStart: now,
		NextAt:     now + tm.QuestionTime(def.Prompt),
		StartedAt:  now,
		Duration:   int64(def.Seconds) * 1000,
		StealBy:    -1,
		Winner:     -1,
		Tiles:      tiles,
	}
}

func (e *Engine) currentDef() *Round {
	if e.sudden > 0 {
		if e.sudden-1 < len(e.deck.Sudden) {
			return &e.deck.Sudden[e.sudden-1]
		}
		return nil
	}
	if e.roundIndex < len(e.deck.Rounds) {
		return &e.deck.Rounds[e.roundIndex]
	}
	return nil
}

// ------------------------------------------------------------------- seating

// Seat puts a player in a seat. A seat held by the computer is always connected.
func (e *Engine) Seat(seat int, info PlayerInfo, human bool) {
	e.players[seat] = Player{PlayerInfo: info}
	e.seated[seat] = true
	e.human[seat] = human
	e.connected[seat] = !human
	e.sayLobby()
}

// Unseat empties a seat in the lobby.
func (e *Engine) Unseat(seat int) {
	if e.screen != ScreenLobby {
		return
	}
	e.players[seat] = Player{}
	e.seated[seat] = false
	e.human[seat] = false
	e.connected[seat] = false
	e.sayLobby()
}

func (e *Engine) Seated(seat int) bool { return e.seated[seat] }

func (e *Engine) sayLobby() {
	if e.screen != ScreenLobby {
		return
	}
	// Until the other seat is taken there is nobody to name; the host talks about
	// the room instead of "Alex and ." to a lobby with one person in it.
	if !e.seated[0] || !e.seated[1] {
		e.say("create", "happy", map[string]any{"p1": e.players[0].Name})
		return
	}
	e.say("lobby", "smug", map[string]any{"p1": e.players[0].Name, "p2": e.players[1].Name})
}

// SetConnected records that a seat's player is, or is no longer, connected. A
// player dropping mid-match pauses the show for them; coming back resumes it
// exactly where it stopped.
func (e *Engine) SetConnected(seat int, on bool, now int64) {
	if !e.human[seat] || e.connected[seat] == on {
		return
	}
	e.connected[seat] = on
	if on {
		if e.paused && e.pauseReason == pauseDisconnect && e.allHumansConnected() {
			e.resume(now)
		}
		return
	}
	if e.InProgress() && !e.paused {
		e.paused = true
		e.pausedAt = now
		e.pauseReason = pauseDisconnect
		e.pausedBy = seat
		e.graceUntil = now + e.tm.RejoinGrace
		e.decision = false
	}
}

// Abandon is a player deliberately leaving mid-match. Unlike a dropped
// connection there is nothing to wait for, so the player who stayed is asked what
// to do straight away.
func (e *Engine) Abandon(seat int, now int64) {
	e.SetConnected(seat, false, now)
	if e.paused && e.pauseReason == pauseDisconnect && e.pausedBy == seat {
		e.graceUntil = now
		e.decision = true
	}
}

// SetDifficulty changes how well the computer plays. Unknown levels are ignored.
func (e *Engine) SetDifficulty(level string) {
	if _, ok := botLevels[level]; ok {
		e.difficulty = level
	}
}

func (e *Engine) allHumansConnected() bool {
	for s := 0; s < 2; s++ {
		if e.human[s] && !e.connected[s] {
			return false
		}
	}
	return true
}

// Decide is the waiting player's answer to "your opponent has not come back".
func (e *Engine) Decide(seat int, choice string, now int64) error {
	if !e.paused || e.pauseReason != pauseDisconnect || !e.decision || seat == e.pausedBy {
		return ErrNothingToDecide
	}
	switch choice {
	case "wait":
		e.graceUntil = now + e.tm.RejoinGrace
		e.decision = false
	case "bot":
		// The seat that left is played by the computer from here, mid-question.
		e.human[e.pausedBy] = false
		e.connected[e.pausedBy] = true
		e.resume(now)
		if r := e.round; r != nil && e.screen == ScreenRound {
			switch {
			case r.Phase == PhaseFaceoff && r.answerOpen():
				e.planBots(false, now)
			case r.Phase == PhaseSteal && r.StealOpen && r.answerOpen():
				e.planBots(true, now)
			}
		}
	default:
		return ErrNothingToDecide
	}
	return nil
}

// -------------------------------------------------------------------- pausing

// Pause stops the clock. Only a game with a single person in it can be paused;
// in a game between two people there is no one entitled to stop the other.
func (e *Engine) Pause(now int64) error {
	if e.human[0] && e.human[1] {
		return ErrBotRoomOnly
	}
	if e.paused || !e.InProgress() {
		return nil
	}
	e.paused = true
	e.pausedAt = now
	e.pauseReason = pauseManual
	return nil
}

func (e *Engine) Resume(now int64) {
	if e.paused && e.pauseReason == pauseManual {
		e.resume(now)
	}
}

func (e *Engine) resume(now int64) {
	by := now - e.pausedAt
	e.paused = false
	e.pauseReason = ""
	e.decision = false
	e.graceUntil = 0
	if by > 0 {
		e.shift(by)
	}
}

// shift moves every pending time forward, so a pause costs nobody any clock.
func (e *Engine) shift(by int64) {
	add := func(v int64) int64 {
		if v == 0 {
			return 0
		}
		return v + by
	}
	e.nextAt = add(e.nextAt)
	if r := e.round; r != nil {
		r.NextAt = add(r.NextAt)
		r.Deadline = add(r.Deadline)
		r.FrozenAt = add(r.FrozenAt)
		r.StartedAt += by
		r.PhaseStart += by
		for i := range r.TypingUntil {
			r.TypingUntil[i] = add(r.TypingUntil[i])
			r.TypingFrom[i] = add(r.TypingFrom[i])
		}
		for _, p := range r.bot {
			if p != nil {
				p.At += by
				p.TypingFrom += by
			}
		}
	}
}

// --------------------------------------------------------------- transitions

// Start moves the lobby to the intro. Either player can press it; both phones
// change together because both are looking at this one state.
func (e *Engine) Start(now int64) error {
	if e.screen != ScreenLobby {
		return ErrWrongScreen
	}
	if !e.seated[0] || !e.seated[1] || !e.allHumansConnected() {
		return ErrNeedBothSeats
	}
	e.startMatch(now)
	return nil
}

func (e *Engine) startMatch(now int64) {
	for i := range e.players {
		e.players[i].Score, e.players[i].Streak, e.players[i].FreezeUsed = 0, 0, false
	}
	e.roundIndex, e.sudden = 0, 0
	e.round, e.history, e.delta = nil, nil, nil
	e.outcome = outcomeNone
	e.rematch = [2]bool{}
	e.paused, e.pauseReason, e.decision = false, "", false
	e.screen = ScreenIntro
	e.nextAt = now + e.tm.Intro
	e.say("intro", "excited", map[string]any{
		"p1": e.players[0].Name, "p2": e.players[1].Name,
		"rounds": capitalize(numberWord(len(e.deck.Rounds))),
	})
	e.emit("sfx", "sting")
	e.record(Record{Kind: RecMatchStarted})
}

func (e *Engine) beginRound(now int64) {
	def := e.currentDef()
	if def == nil {
		e.finishGame(outcomeDraw, now)
		return
	}
	number := e.roundIndex + 1
	if e.sudden > 0 {
		number = e.sudden
	}
	e.round = newRound(def, number, now, e.tm)
	e.screen = ScreenRound
	e.nextAt = 0

	event, mood := "roundIntro", "happy"
	switch def.Kind {
	case KindDouble:
		event, mood = "doubleIntro", "excited"
	case KindFinal:
		event, mood = "finalQuestion", "excited"
	case KindSudden:
		event, mood = "suddenQuestion", "excited"
	}
	e.say(event, mood, map[string]any{"n": number, "nWord": numberWord(number)})
	e.emit("sfx", "whoosh")
}

func (e *Engine) startFaceoff(at int64) {
	r := e.round
	r.StartedAt = at
	r.Duration = int64(r.Def.Seconds) * 1000
	r.Deadline = at + r.Duration
	r.FrozenAt = 0
	r.setPhase(PhaseFaceoff, at, 0)
	e.planBots(false, at)
	e.say("faceoff", "thinking", nil)
}

// judgeText finds the board slot a typed answer reaches, or -1.
func judgeText(r *RoundState, text string) int {
	res := matching.Match(r.Def.matchable, text)
	if res.Answer == nil {
		return -1
	}
	for i, a := range r.Def.Answers {
		if a.Rank == res.Answer.Rank {
			return i
		}
	}
	return -1
}

func (e *Engine) newSub(seat int, text string, now int64, steal bool) *Sub {
	r := e.round
	return &Sub{Seat: seat, Text: text, At: now - r.StartedAt, Match: judgeText(r, text), Steal: steal}
}

// Lock is a player committing to an answer. It is where "who was first" is
// settled: calls arrive one at a time, in the order the server received them.
func (e *Engine) Lock(seat int, text string, now int64) error {
	r := e.round
	if e.screen != ScreenRound || r == nil {
		return ErrNotAccepting
	}
	if e.paused {
		return ErrPaused
	}
	text = tidy(text)
	if text == "" {
		return ErrEmptyAnswer
	}

	switch {
	case r.Phase == PhaseFaceoff && r.answerOpen():
		if r.hasSub(seat) {
			return ErrAlreadyLocked
		}
		e.lockFaceoff(seat, text, now)
	case r.Phase == PhaseSteal && r.StealOpen && r.answerOpen():
		if seat != r.StealBy {
			return ErrNotYours
		}
		e.lockSteal(seat, text, now)
	case r.Phase == PhaseReveal && !r.IsSteal && len(r.Subs) == 1 && !r.hasSub(seat):
		// Typed before the freeze reached this phone. It arrived second, so it
		// is second: shown after the round is decided, or used for the steal.
		e.lockQueued(seat, text, now)
	default:
		return ErrNotAccepting
	}
	return nil
}

func (e *Engine) lockFaceoff(seat int, text string, now int64) {
	r := e.round
	sub := e.newSub(seat, text, now, false)
	r.Subs = append(r.Subs, sub)
	r.TypingUntil[seat] = 0
	r.FrozenAt = now // the first answer in stops the clock for everyone
	r.bot = [2]*botPlan{}
	e.emit("sfx", "lock")
	e.emit("haptic", "lock")
	e.startReveal(sub, false, now)
}

func (e *Engine) lockQueued(seat int, text string, now int64) {
	r := e.round
	sub := e.newSub(seat, text, now, false)
	r.Subs = append(r.Subs, sub)
	r.Queue = append(r.Queue, sub)
	r.TypingUntil[seat] = 0
}

func (e *Engine) lockSteal(seat int, text string, now int64) {
	r := e.round
	sub := e.newSub(seat, text, now, true)
	r.Subs = append(r.Subs, sub)
	r.TypingUntil[seat] = 0
	r.StealOpen = false
	r.FrozenAt = now
	r.bot = [2]*botPlan{}
	e.emit("sfx", "lock")
	e.emit("haptic", "lock")
	e.startReveal(sub, true, now)
}

func (e *Engine) startReveal(sub *Sub, steal bool, now int64) {
	r := e.round
	r.Current = sub
	r.IsSteal = steal
	sub.Revealed = true
	r.setPhase(PhaseReveal, now, now+e.tm.Reveal)
	event := "revealFirst"
	if steal {
		event = "revealSteal"
	}
	e.say(event, "thinking", map[string]any{"name": e.players[sub.Seat].Name, "answer": sub.Text})
	e.emit("sfx", "drumroll")
}

func (e *Engine) judge(at int64) {
	r := e.round
	sub := r.Current
	p := sub.Seat
	m := sub.Match

	if m >= 0 && m < len(r.Tiles) && r.Tiles[m].Kind == TileHidden {
		player := &e.players[p]
		streakMult := 1
		if player.Streak+1 >= 3 && r.Def.Kind != KindSudden {
			streakMult = 2
		}
		mult := max(r.Def.Multiplier, streakMult)
		points := r.Def.Answers[m].Points * mult
		kind := TileWon
		if r.IsSteal {
			kind = TileStolen
		}
		r.Tiles[m] = Tile{Kind: kind, By: p, Points: points}
		r.StreakBonus = streakMult > r.Def.Multiplier
		player.Score += points
		player.Streak++
		r.Winner = p
		r.Awarded = points
		e.delta = &Delta{Player: p, Points: points, Key: e.deltaKey() + 1}
		r.setPhase(PhaseCorrect, at, at+e.tm.Correct)
		event, mood := "correct", "happy"
		if r.IsSteal {
			event, mood = "stealSuccess", "excited"
		}
		e.say(event, mood, map[string]any{"name": player.Name, "answer": r.Def.Answers[m].Text, "points": points})
		e.emit("sfx", "correct")
		e.emit("haptic", "correct")
		e.emit("audience", "cheer")
		e.recordSub(sub, true)
		return
	}

	r.Struck = append(r.Struck, p)
	e.players[p].Streak = 0
	r.setPhase(PhaseWrong, at, at+e.tm.Wrong)
	e.say("wrong", "sad", map[string]any{"name": e.players[p].Name, "answer": sub.Text})
	e.emit("sfx", "buzzer")
	e.emit("haptic", "wrong")
	e.emit("audience", "ooh")
	e.recordSub(sub, false)
}

func (e *Engine) deltaKey() int {
	if e.delta == nil {
		return 0
	}
	return e.delta.Key
}

func (e *Engine) afterCorrect(at int64) {
	r := e.round
	if !r.IsSteal {
		for i, q := range r.Queue {
			if q.Seat == r.Winner {
				continue
			}
			r.Queue = append(r.Queue[:i], r.Queue[i+1:]...)
			r.Current = q
			q.Revealed = true
			event := "late"
			switch {
			case q.Match < 0:
				event = "lateWrong"
			case r.Tiles[q.Match].Kind != TileHidden:
				event = "lateSame"
			default:
				r.Tiles[q.Match] = Tile{Kind: TileLate, By: q.Seat, Points: r.Tiles[q.Match].Points}
				e.emit("sfx", "flip")
			}
			answer := q.Text
			if q.Match >= 0 {
				answer = r.Def.Answers[q.Match].Text
			}
			r.setPhase(PhaseLate, at, at+e.tm.Late)
			e.say(event, "smug", map[string]any{"name": e.players[q.Seat].Name, "answer": answer})
			e.recordSub(q, false)
			return
		}
	}
	e.toBoardReveal(at)
}

func (e *Engine) afterWrong(at int64) {
	r := e.round
	o := other(r.Current.Seat)
	if r.IsSteal || r.struck(o) {
		e.toBoardReveal(at)
		return
	}
	r.StealBy = o
	locked := false
	for _, q := range r.Queue {
		if q.Seat == o {
			locked = true
			break
		}
	}
	if locked {
		r.StealOpen = false
		r.setPhase(PhaseSteal, at, at+e.tm.StealLocked)
		e.say("stealChance", "excited", map[string]any{"name": e.players[o].Name})
	} else {
		r.StealOpen = true
		r.StartedAt = at
		r.Duration = e.tm.StealWindow
		r.Deadline = at + e.tm.StealWindow
		r.FrozenAt = 0
		r.setPhase(PhaseSteal, at, 0)
		e.planBots(true, at)
		e.say("stealOpen", "excited", map[string]any{"name": e.players[o].Name})
	}
	e.emit("sfx", "steal")
	e.emit("audience", "gasp")
}

func (e *Engine) toBoardReveal(at int64) {
	r := e.round
	hidden := 0
	for i := range r.Tiles {
		if r.Tiles[i].Kind == TileHidden {
			hidden++
			r.Tiles[i].Kind = TileBoard
		}
	}
	r.setPhase(PhaseBoardReveal, at, at+e.tm.BoardBase+int64(hidden)*e.tm.BoardPerTile)
	if r.Winner < 0 {
		e.say("nobody", "surprised", nil)
	} else {
		e.say("boardReveal", "neutral", nil)
	}
	if hidden > 0 {
		e.emit("sfx", "cascade")
	}
}

func (e *Engine) finishRound(at int64) {
	r := e.round
	r.setPhase(PhaseDone, at, at+e.tm.Outcome)
	for p := 0; p < 2; p++ {
		if p != r.Winner {
			e.players[p].Streak = 0
		}
	}
	answer := ""
	for i, t := range r.Tiles {
		if t.Kind == TileWon || t.Kind == TileStolen {
			answer = r.Def.Answers[i].Text
			break
		}
	}
	e.history = append(e.history, RoundRecord{
		Number: r.Number, Kind: r.Def.Kind, Winner: r.Winner, Points: r.Awarded,
		Answer: answer, Stolen: r.IsSteal && r.Winner >= 0,
	})
	for _, s := range r.Subs {
		e.recordSub(s, false)
	}
	rec := Record{
		Kind: RecRoundClosed, Round: e.roundOrdinal(), QuestionID: r.Def.QuestionID,
		Winner: r.Winner, Points: r.Awarded, Stolen: r.IsSteal && r.Winner >= 0,
		Scores: e.Scores(),
	}
	e.record(rec)
}

// roundOrdinal numbers rounds across the regular rounds and any tie-breakers,
// so each one has its own row in the match history.
func (e *Engine) roundOrdinal() int {
	if e.sudden > 0 {
		return len(e.deck.Rounds) + e.sudden
	}
	return e.roundIndex + 1
}

func (e *Engine) recordSub(s *Sub, scored bool) {
	if s.Recorded {
		return
	}
	s.Recorded = true
	r := e.round
	rec := Record{
		Kind: RecSubmission, Round: e.roundOrdinal(), QuestionID: r.Def.QuestionID, Seat: s.Seat,
		Raw: s.Text, Normalized: matching.Normalize(s.Text), Correct: scored, IsSteal: s.Steal,
		MsElapsed: int(s.At),
	}
	if s.Match >= 0 {
		rec.AnswerID = r.Def.Answers[s.Match].ID
	}
	e.record(rec)
}

// afterDone is what the "round results" tap used to do.
func (e *Engine) afterDone(at int64) {
	r := e.round
	if r.Def.Kind == KindSudden {
		switch {
		case r.Winner >= 0:
			e.finishGame(r.Winner, at)
		case e.sudden < len(e.deck.Sudden):
			e.sudden++
			e.round = nil
			e.toIntro(ScreenSuddenIntro, at, e.tm.SuddenIntro, "suddenIntro", "surprised", nil)
		default:
			e.finishGame(outcomeDraw, at)
		}
		return
	}
	e.roundWrap()
	e.screen = ScreenRoundResult
	e.nextAt = at + e.tm.RoundResult
}

func (e *Engine) toIntro(screen Screen, at, length int64, event, mood string, vars map[string]any) {
	e.screen = screen
	e.nextAt = at + length
	e.say(event, mood, vars)
	e.emit("sfx", "sting")
}

func (e *Engine) afterRoundResult(at int64) {
	a, b := e.players[0], e.players[1]
	if e.roundIndex >= len(e.deck.Rounds)-1 {
		if a.Score == b.Score {
			e.sudden = 1
			e.round = nil
			e.toIntro(ScreenSuddenIntro, at, e.tm.SuddenIntro, "suddenIntro", "surprised", nil)
		} else if a.Score > b.Score {
			e.finishGame(0, at)
		} else {
			e.finishGame(1, at)
		}
		return
	}
	e.screen = ScreenScoreboard
	e.round = nil
	e.nextAt = at + e.tm.Scoreboard
	e.say("scoreboard", "happy", map[string]any{"nextWord": numberWord(e.roundIndex + 2)})
}

func (e *Engine) afterScoreboard(at int64) {
	e.roundIndex = min(e.roundIndex+1, len(e.deck.Rounds)-1)
	if e.deck.Rounds[e.roundIndex].Kind == KindFinal {
		e.toIntro(ScreenFinalIntro, at, e.tm.FinalIntro, "finalIntro", "smug", nil)
		return
	}
	e.beginRound(at)
}

func (e *Engine) roundWrap() {
	r := e.round
	a, b := e.players[0], e.players[1]
	vars := map[string]any{"nWord": numberWord(r.Number)}
	switch {
	case r.Winner < 0:
		e.say("roundWrapNobody", "sad", vars)
	case a.Score == b.Score:
		e.say("roundWrapTie", "surprised", vars)
	default:
		leader, trailer := a, b
		if b.Score > a.Score {
			leader, trailer = b, a
		}
		vars["leader"], vars["trailer"] = leader.Name, trailer.Name
		if leader.Score-trailer.Score <= 8 {
			e.say("roundWrapClose", "excited", vars)
		} else {
			e.say("roundWrapLead", "happy", vars)
		}
	}
}

func (e *Engine) finishGame(outcome int, at int64) {
	e.outcome = outcome
	e.screen = ScreenResult
	e.round = nil
	e.nextAt = 0
	e.paused, e.pauseReason, e.decision = false, "", false
	e.rematch = [2]bool{}
	// A seat held by the computer never needs to ask for a rematch.
	for s := 0; s < 2; s++ {
		if !e.human[s] {
			e.rematch[s] = true
		}
	}

	if outcome == outcomeDraw {
		e.say("draw", "surprised", nil)
		e.emit("audience", "ooh")
	} else {
		w := outcome
		for s := 0; s < 2; s++ {
			if s == w {
				e.sayTo(s, "winner", "celebrate", map[string]any{"name": e.players[w].Name, "other": e.players[other(w)].Name})
			} else {
				e.sayTo(s, "loser", "happy", map[string]any{"name": e.players[s].Name, "other": e.players[w].Name})
			}
		}
		e.emit("sfx", "fanfare")
		e.emit("haptic", "win")
		e.emit("audience", "cheer")
	}
	e.record(Record{Kind: RecMatchFinished, Winner: outcome, Scores: e.Scores()})
}

// ------------------------------------------------------------ player actions

// Typing notes that a seat's player is typing, so the other phone can say so.
// It carries no text. It reports whether anything changed that is worth telling
// the other player.
func (e *Engine) Typing(seat int, now int64) bool {
	r := e.round
	if e.screen != ScreenRound || r == nil || e.paused || !r.answerOpen() || r.hasSub(seat) {
		return false
	}
	if r.Phase == PhaseSteal && r.StealBy != seat {
		return false
	}
	r.TypingUntil[seat] = now + e.tm.TypingTTL
	return true
}

// Freeze adds a few seconds to the clock, once per player per game.
func (e *Engine) Freeze(seat int, now int64) error {
	r := e.round
	if e.screen != ScreenRound || r == nil || !r.answerOpen() {
		return ErrNotAccepting
	}
	if e.paused {
		return ErrPaused
	}
	p := &e.players[seat]
	if p.FreezeUsed {
		return ErrFreezeUsed
	}
	r.Deadline += e.tm.Freeze
	r.Duration += e.tm.Freeze
	p.FreezeUsed = true
	e.emit("sfx", "freeze")
	return nil
}

// Rematch is one player agreeing to play again. It reports whether every
// person at the table has now agreed.
func (e *Engine) Rematch(seat int) (ready bool, err error) {
	if e.screen != ScreenResult {
		return false, ErrWrongScreen
	}
	e.rematch[seat] = true
	return e.rematch[0] && e.rematch[1], nil
}

// Restart begins a fresh match with a new deck, in the same seats.
func (e *Engine) Restart(deck Deck, now int64) {
	deck.prepare()
	e.deck = deck
	e.startMatch(now)
}

// -------------------------------------------------------------------- ticking

// NextDue is the moment the engine next needs attention, or 0 if it is waiting
// for a player. The room sleeps until then.
func (e *Engine) NextDue() int64 {
	if e.paused {
		if e.pauseReason == pauseDisconnect && !e.decision {
			return e.graceUntil
		}
		return 0
	}
	switch e.screen {
	case ScreenIntro, ScreenRoundResult, ScreenScoreboard, ScreenFinalIntro, ScreenSuddenIntro:
		return e.nextAt
	case ScreenRound:
		r := e.round
		if r == nil {
			return 0
		}
		if r.NextAt != 0 {
			return r.NextAt
		}
		due := int64(0)
		if r.FrozenAt == 0 && r.Deadline != 0 {
			due = r.Deadline
		}
		for seat, p := range r.bot {
			if p != nil && !r.hasSub(seat) && (due == 0 || p.At < due) {
				due = p.At
			}
		}
		return due
	}
	return 0
}

// Tick carries out everything that has come due by now.
func (e *Engine) Tick(now int64) {
	for i := 0; i < 64; i++ {
		due := e.NextDue()
		if due == 0 || due > now {
			return
		}
		e.fire(due)
	}
}

func (e *Engine) fire(at int64) {
	if e.paused {
		// The grace period for a dropped player has run out: the player who
		// stayed now decides what happens.
		e.decision = true
		return
	}
	if e.screen != ScreenRound {
		e.advanceScreen(at)
		return
	}
	r := e.round
	if r.NextAt != 0 {
		e.advance(at)
		return
	}
	// An answer window is open: the computer answers, or the clock runs out.
	for seat, p := range r.bot {
		if p != nil && !r.hasSub(seat) && at >= p.At {
			if r.Phase == PhaseFaceoff {
				e.lockFaceoff(seat, p.Text, at)
			} else {
				e.lockSteal(seat, p.Text, at)
			}
			return
		}
	}
	if r.Deadline != 0 && at >= r.Deadline {
		e.expire(at)
	}
}

func (e *Engine) expire(at int64) {
	r := e.round
	r.FrozenAt = at
	r.bot = [2]*botPlan{}
	if r.Phase == PhaseFaceoff {
		r.setPhase(PhaseTimeUp, at, at+e.tm.TimeUp)
		e.say("timeUp", "surprised", nil)
		e.emit("sfx", "timeup")
		e.emit("audience", "ooh")
		return
	}
	// A steal that was never locked does not count.
	r.StealOpen = false
	r.setPhase(PhaseTimeUp, at, at+e.tm.StealTimeUp)
	e.say("stealTimeUp", "sad", map[string]any{"name": e.players[r.StealBy].Name})
	e.emit("sfx", "timeup")
}

func (e *Engine) advance(at int64) {
	r := e.round
	switch r.Phase {
	case PhaseQuestion:
		r.setPhase(PhaseCountdown, at, at+e.tm.Countdown)
	case PhaseCountdown:
		e.startFaceoff(at)
	case PhaseReveal:
		e.judge(at)
	case PhaseCorrect:
		e.afterCorrect(at)
	case PhaseWrong:
		e.afterWrong(at)
	case PhaseSteal:
		for i, q := range r.Queue {
			if q.Seat == r.StealBy {
				r.Queue = append(r.Queue[:i], r.Queue[i+1:]...)
				e.startReveal(q, true, at)
				return
			}
		}
		e.toBoardReveal(at)
	case PhaseLate, PhaseTimeUp:
		e.toBoardReveal(at)
	case PhaseBoardReveal:
		e.finishRound(at)
	case PhaseDone:
		e.afterDone(at)
	default:
		r.NextAt = 0
	}
}

func (e *Engine) advanceScreen(at int64) {
	switch e.screen {
	case ScreenIntro, ScreenFinalIntro, ScreenSuddenIntro:
		e.beginRound(at)
	case ScreenRoundResult:
		e.afterRoundResult(at)
	case ScreenScoreboard:
		e.afterScoreboard(at)
	default:
		e.nextAt = 0
	}
}
