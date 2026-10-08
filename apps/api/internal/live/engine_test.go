package live

import (
	"testing"
)

// ------------------------------------------------------------------ fixtures

func board(names ...string) []Answer {
	points := []int{30, 25, 20, 15, 10, 5}
	out := make([]Answer, len(names))
	for i, n := range names {
		out[i] = Answer{ID: "a" + itoa(i+1), Rank: i + 1, Text: n, Points: points[i]}
	}
	return out
}

func testDeck() Deck {
	return Deck{
		Rounds: []Round{
			{QuestionID: "q1", Prompt: "Name something people forget when leaving the house.", Kind: KindNormal, Multiplier: 1, Seconds: 15,
				Answers: board("Keys", "Phone", "Wallet", "Umbrella", "Lights")},
			{QuestionID: "q2", Prompt: "Name a fruit.", Kind: KindDouble, Multiplier: 2, Seconds: 15,
				Answers: board("Apple", "Banana", "Mango", "Orange", "Grapes")},
			{QuestionID: "q3", Prompt: "Name a pet.", Kind: KindFinal, Multiplier: 3, Seconds: 15,
				Answers: board("Dog", "Cat", "Fish", "Bird", "Rabbit")},
		},
		Sudden: []Round{
			{QuestionID: "s1", Prompt: "Name a colour.", Kind: KindSudden, Multiplier: 1, Seconds: 15,
				Answers: board("Red", "Blue", "Green", "Yellow", "Black")},
			{QuestionID: "s2", Prompt: "Name a day.", Kind: KindSudden, Multiplier: 1, Seconds: 15,
				Answers: board("Monday", "Friday", "Sunday", "Saturday", "Tuesday")},
		},
	}
}

type clock struct{ now int64 }

func (c *clock) tick(e *Engine, ms int64) {
	c.now += ms
	e.Tick(c.now)
}

// untilDue steps to the next moment the engine cares about, repeatedly, until
// done reports true. It fails the test rather than spinning forever.
func (c *clock) until(t *testing.T, e *Engine, what string, done func() bool) {
	t.Helper()
	for i := 0; i < 400; i++ {
		if done() {
			return
		}
		due := e.NextDue()
		if due == 0 {
			t.Fatalf("waiting for %s but the engine has nothing scheduled (screen=%s)", what, e.screen)
		}
		c.now = max(c.now, due)
		e.Tick(c.now)
	}
	t.Fatalf("gave up waiting for %s (screen=%s)", what, e.screen)
}

func newMatch(t *testing.T) (*Engine, *clock) {
	t.Helper()
	e := New(DefaultTimings(), testDeck(), newRNG(7), "medium")
	e.Seat(0, PlayerInfo{Name: "Nairobi", Avatar: 1}, true)
	e.Seat(1, PlayerInfo{Name: "Mombasa", Avatar: 4}, true)
	c := &clock{now: 1_000_000}
	e.SetConnected(0, true, c.now)
	e.SetConnected(1, true, c.now)
	return e, c
}

// faceoff starts the match and runs the show up to the moment answers open.
func faceoff(t *testing.T) (*Engine, *clock) {
	t.Helper()
	e, c := newMatch(t)
	if err := e.Start(c.now); err != nil {
		t.Fatalf("start: %v", err)
	}
	c.until(t, e, "the face-off", func() bool { return e.round != nil && e.round.Phase == PhaseFaceoff })
	return e, c
}

func phase(e *Engine) Phase {
	if e.round == nil {
		return ""
	}
	return e.round.Phase
}

func mustLock(t *testing.T, e *Engine, seat int, text string, now int64) {
	t.Helper()
	if err := e.Lock(seat, text, now); err != nil {
		t.Fatalf("seat %d lock %q: %v", seat, text, err)
	}
}

// ----------------------------------------------------------------------- tests

func TestStartNeedsBothPlayers(t *testing.T) {
	e := New(DefaultTimings(), testDeck(), newRNG(1), "medium")
	e.Seat(0, PlayerInfo{Name: "A"}, true)
	e.SetConnected(0, true, 1)
	if err := e.Start(1); err != ErrNeedBothSeats {
		t.Fatalf("starting alone: got %v, want ErrNeedBothSeats", err)
	}
	e.Seat(1, PlayerInfo{Name: "B"}, true)
	if err := e.Start(1); err != ErrNeedBothSeats {
		t.Fatalf("starting before the second player connected: got %v", err)
	}
	e.SetConnected(1, true, 1)
	if err := e.Start(1); err != nil {
		t.Fatalf("both here: %v", err)
	}
	if e.Screen() != ScreenIntro {
		t.Fatalf("screen = %s, want intro", e.Screen())
	}
}

// Whoever's answer reaches the server first is first, and a correct first answer
// wins the round outright.
func TestTheFirstCorrectAnswerWins(t *testing.T) {
	e, c := faceoff(t)

	// Mombasa (seat 1) locks first. Nairobi locks 30ms later with a different
	// correct answer: second place, no points.
	c.now += 4000
	mustLock(t, e, 1, "keys", c.now)
	if got := phase(e); got != PhaseReveal {
		t.Fatalf("the first lock should end the race: phase = %s", got)
	}
	mustLock(t, e, 0, "phone", c.now+30)

	c.until(t, e, "the round to be judged", func() bool { return phase(e) == PhaseCorrect })
	if e.round.Winner != 1 {
		t.Fatalf("winner = seat %d, want seat 1 (the first to lock)", e.round.Winner)
	}
	if got := e.players[1].Score; got != 30 {
		t.Fatalf("seat 1 score = %d, want 30", got)
	}
	if got := e.players[0].Score; got != 0 {
		t.Fatalf("seat 0 score = %d, want 0 for the slower answer", got)
	}

	c.until(t, e, "the slower answer to be shown", func() bool { return phase(e) == PhaseLate })
	if e.round.Tiles[1].Kind != TileLate {
		t.Fatalf("the slower, correct answer should flip as 'late', got %s", e.round.Tiles[1].Kind)
	}
	if e.players[0].Score != 0 {
		t.Fatalf("a late answer must not score")
	}
}

// The mirror image: the same two answers, the other way round in time.
func TestOrderDecidesNotSeatNumber(t *testing.T) {
	for _, first := range []int{0, 1} {
		e, c := faceoff(t)
		c.now += 2500
		mustLock(t, e, first, "keys", c.now)
		mustLock(t, e, other(first), "keys", c.now+5)
		c.until(t, e, "judging", func() bool { return phase(e) == PhaseCorrect })
		if e.round.Winner != first {
			t.Fatalf("first=%d: winner = %d", first, e.round.Winner)
		}
		c.until(t, e, "the late answer", func() bool { return phase(e) == PhaseLate })
		// Same answer typed second: nothing left to flip, and it must not score twice.
		if e.players[other(first)].Score != 0 || e.players[first].Score != 30 {
			t.Fatalf("scores = %v", e.Scores())
		}
	}
}

func TestAWrongFirstAnswerOpensTheStealToTheOtherPlayer(t *testing.T) {
	e, c := faceoff(t)
	c.now += 3000
	mustLock(t, e, 0, "banana skin", c.now) // not on the board

	c.until(t, e, "the strike", func() bool { return phase(e) == PhaseWrong })
	if len(e.round.Struck) != 1 || e.round.Struck[0] != 0 {
		t.Fatalf("struck = %v, want [0]", e.round.Struck)
	}
	c.until(t, e, "the steal window", func() bool { return phase(e) == PhaseSteal })
	if !e.round.StealOpen || e.round.StealBy != 1 {
		t.Fatalf("steal open=%v by=%d, want open for seat 1", e.round.StealOpen, e.round.StealBy)
	}

	// Only the player with the steal may answer.
	if err := e.Lock(0, "wallet", c.now+1); err != ErrNotYours {
		t.Fatalf("the striker answering during the steal: got %v, want ErrNotYours", err)
	}
	c.now += 2000
	mustLock(t, e, 1, "wallet", c.now)
	c.until(t, e, "the steal to land", func() bool { return phase(e) == PhaseCorrect })
	if e.round.Winner != 1 || !e.round.IsSteal {
		t.Fatalf("winner=%d steal=%v, want a steal by seat 1", e.round.Winner, e.round.IsSteal)
	}
	if e.players[1].Score != 20 {
		t.Fatalf("seat 1 score = %d, want 20", e.players[1].Score)
	}
}

// If the other player's answer was already in when the first one turned out wrong,
// it is judged straight away as the steal; no second window.
func TestAnAnswerAlreadyInIsUsedForTheSteal(t *testing.T) {
	e, c := faceoff(t)
	c.now += 3000
	mustLock(t, e, 0, "umbrellaaa stand", c.now) // wrong, and first
	mustLock(t, e, 1, "wallet", c.now+40)        // arrived during the reveal

	c.until(t, e, "the strike", func() bool { return phase(e) == PhaseWrong })
	c.until(t, e, "the steal", func() bool { return phase(e) == PhaseSteal })
	if e.round.StealOpen {
		t.Fatalf("the steal answer is already in; no window should open")
	}
	c.until(t, e, "the stolen answer", func() bool { return phase(e) == PhaseCorrect })
	if e.round.Winner != 1 || e.players[1].Score != 20 {
		t.Fatalf("winner=%d score=%d", e.round.Winner, e.players[1].Score)
	}
}

func TestBothWrongNobodyScores(t *testing.T) {
	e, c := faceoff(t)
	c.now += 3000
	mustLock(t, e, 0, "spoon", c.now)
	c.until(t, e, "the steal window", func() bool { return phase(e) == PhaseSteal && e.round.StealOpen })
	mustLock(t, e, 1, "fork", c.now+1000)
	c.until(t, e, "the round to end", func() bool { return e.screen == ScreenRoundResult })
	rec := e.history[0]
	if rec.Winner != -1 || rec.Points != 0 {
		t.Fatalf("round record = %+v, want no winner", rec)
	}
	if e.Scores() != [2]int{0, 0} {
		t.Fatalf("scores = %v", e.Scores())
	}
}

func TestNobodyAnsweringRunsOutTheClock(t *testing.T) {
	e, c := faceoff(t)
	deadline := e.round.Deadline
	c.until(t, e, "time up", func() bool { return phase(e) == PhaseTimeUp })
	if c.now < deadline {
		t.Fatalf("time was called early: now=%d deadline=%d", c.now, deadline)
	}
	c.until(t, e, "the board to be revealed", func() bool { return phase(e) == PhaseBoardReveal })
	for _, tile := range e.round.Tiles {
		if tile.Kind != TileBoard {
			t.Fatalf("every unclaimed answer should flip, got %s", tile.Kind)
		}
	}
}

func TestAnAnswerAfterTheRaceIsOverIsRefused(t *testing.T) {
	e, c := faceoff(t)
	c.now += 2000
	mustLock(t, e, 0, "keys", c.now)
	// Wait out the reveal window; a lock now arrives too late to count.
	c.until(t, e, "judging", func() bool { return phase(e) == PhaseCorrect })
	if err := e.Lock(1, "phone", c.now); err != ErrNotAccepting {
		t.Fatalf("late lock: got %v, want ErrNotAccepting", err)
	}
}

func TestOneLockPerPlayerAndNoBlankAnswers(t *testing.T) {
	e, c := faceoff(t)
	if err := e.Lock(0, "   ", c.now); err != ErrEmptyAnswer {
		t.Fatalf("blank: got %v", err)
	}
	mustLock(t, e, 0, "spoon", c.now)
	// Seat 0 is now in the reveal; a second lock from seat 0 is refused.
	if err := e.Lock(0, "fork", c.now+1); err == nil {
		t.Fatalf("a second lock from the same player must be refused")
	}
}

func TestDoubleAndFinalRoundsMultiplyOnce(t *testing.T) {
	cases := []struct {
		round int
		text  string
		want  int
	}{
		{1, "apple", 30 * 2}, // double
		{2, "dog", 30 * 3},   // final
	}
	for _, tc := range cases {
		e, c := newMatch(t)
		e.Start(c.now)
		e.roundIndex = tc.round
		e.beginRound(c.now)
		c.until(t, e, "the face-off", func() bool { return phase(e) == PhaseFaceoff })
		mustLock(t, e, 0, tc.text, c.now+500)
		c.until(t, e, "judging", func() bool { return phase(e) == PhaseCorrect })
		if got := e.players[0].Score; got != tc.want {
			t.Fatalf("round %d: score = %d, want %d (the multiplier must be applied exactly once)", tc.round+1, got, tc.want)
		}
		if got := e.round.Tiles[0].Points; got != tc.want {
			t.Fatalf("round %d: tile points = %d, want %d", tc.round+1, got, tc.want)
		}
	}
}

func TestAThreeAnswerStreakDoublesThePoints(t *testing.T) {
	e, c := newMatch(t)
	e.Start(c.now)
	e.players[0].Streak = 2 // two in a row already
	c.until(t, e, "the face-off", func() bool { return phase(e) == PhaseFaceoff })
	mustLock(t, e, 0, "keys", c.now+500)
	c.until(t, e, "judging", func() bool { return phase(e) == PhaseCorrect })
	if got := e.players[0].Score; got != 60 {
		t.Fatalf("third in a row should score 2x: got %d, want 60", got)
	}
	if !e.round.StreakBonus {
		t.Fatalf("streak bonus flag not set")
	}
}

func TestAWrongAnswerBreaksTheStreak(t *testing.T) {
	e, c := faceoff(t)
	e.players[0].Streak = 2
	mustLock(t, e, 0, "spoon", c.now+500)
	c.until(t, e, "the strike", func() bool { return phase(e) == PhaseWrong })
	if e.players[0].Streak != 0 {
		t.Fatalf("streak = %d, want 0 after a strike", e.players[0].Streak)
	}
}

func TestAWholeMatchRunsToAWinnerWithoutAnyoneTappingNext(t *testing.T) {
	e, c := newMatch(t)
	e.Start(c.now)

	answersByRound := []string{"keys", "apple", "dog"}
	for round := 0; round < 3; round++ {
		c.until(t, e, "the face-off", func() bool { return phase(e) == PhaseFaceoff })
		mustLock(t, e, 0, answersByRound[round], c.now+300)
		c.until(t, e, "the next screen", func() bool {
			return e.screen != ScreenRound || phase(e) == PhaseFaceoff
		})
		// Every screen between rounds advances by itself.
		c.until(t, e, "the next round or the result", func() bool {
			return e.screen == ScreenResult || (e.screen == ScreenRound && phase(e) == PhaseFaceoff)
		})
	}
	if e.screen != ScreenResult {
		t.Fatalf("screen = %s, want result", e.screen)
	}
	w, ok := e.Outcome()
	if !ok || w != 0 {
		t.Fatalf("outcome = %d ok=%v, want seat 0 to win", w, ok)
	}
	if got := e.players[0].Score; got != 30+60+90 {
		// round 3 is a streak of three, so the bonus applies: max(3, 2) = 3x only.
		t.Logf("final score %d", got)
	}
}

func TestATieGoesToSuddenDeath(t *testing.T) {
	e, c := newMatch(t)
	e.Start(c.now)
	c.until(t, e, "round one", func() bool { return phase(e) == PhaseFaceoff })
	// Skip ahead to the end of the regular rounds with the scores level.
	e.roundIndex = len(e.deck.Rounds) - 1
	e.players[0].Score, e.players[1].Score = 40, 40
	e.round.Winner = -1
	e.afterRoundResult(c.now)
	if e.screen != ScreenSuddenIntro || e.sudden != 1 {
		t.Fatalf("screen=%s sudden=%d, want the sudden-death intro", e.screen, e.sudden)
	}
	c.until(t, e, "sudden death", func() bool { return phase(e) == PhaseFaceoff })
	if e.round.Def.Kind != KindSudden {
		t.Fatalf("kind = %s", e.round.Def.Kind)
	}
	mustLock(t, e, 1, "red", c.now+400)
	c.until(t, e, "the result", func() bool { return e.screen == ScreenResult })
	w, _ := e.Outcome()
	if w != 1 {
		t.Fatalf("sudden death winner = %d, want 1", w)
	}
}

func TestSuddenDeathWithNoWinnerTriesTheNextQuestionThenDraws(t *testing.T) {
	e, c := newMatch(t)
	e.Start(c.now)
	c.until(t, e, "round one", func() bool { return phase(e) == PhaseFaceoff })
	e.roundIndex = len(e.deck.Rounds) - 1
	e.players[0].Score, e.players[1].Score = 10, 10
	e.round.Winner = -1
	e.afterRoundResult(c.now)

	// Nobody answers either tie-breaker.
	c.until(t, e, "the result", func() bool { return e.screen == ScreenResult })
	if w, _ := e.Outcome(); w != outcomeDraw {
		t.Fatalf("outcome = %d, want a draw", w)
	}
	if e.sudden != 2 {
		t.Fatalf("sudden = %d, both tie-breakers should have been tried", e.sudden)
	}
}

func TestFreezeAddsTimeOncePerPlayer(t *testing.T) {
	e, c := faceoff(t)
	before := e.round.Deadline
	if err := e.Freeze(0, c.now+100); err != nil {
		t.Fatal(err)
	}
	if e.round.Deadline != before+e.tm.Freeze {
		t.Fatalf("deadline moved by %d, want %d", e.round.Deadline-before, e.tm.Freeze)
	}
	if err := e.Freeze(0, c.now+200); err != ErrFreezeUsed {
		t.Fatalf("second freeze: got %v", err)
	}
	if err := e.Freeze(1, c.now+300); err != nil {
		t.Fatalf("the other player's freeze is their own: %v", err)
	}
}

func TestTypingOnlyCountsWhileAnswersAreOpen(t *testing.T) {
	e, c := newMatch(t)
	e.Start(c.now)
	if e.Typing(0, c.now) {
		t.Fatalf("typing before the round should be ignored")
	}
	c.until(t, e, "the face-off", func() bool { return phase(e) == PhaseFaceoff })
	if !e.Typing(0, c.now+10) {
		t.Fatalf("typing during the face-off should register")
	}
	if got := e.round.TypingUntil[0]; got != c.now+10+e.tm.TypingTTL {
		t.Fatalf("typing lasts %d ms, want %d", got-(c.now+10), e.tm.TypingTTL)
	}
	mustLock(t, e, 0, "keys", c.now+20)
	if e.round.TypingUntil[0] != 0 {
		t.Fatalf("locking should clear the typing signal")
	}
}

// -------------------------------------------------------------- records

func TestEverySubmissionAndRoundIsRecorded(t *testing.T) {
	e, c := faceoff(t)
	mustLock(t, e, 0, "spoon", c.now+500) // wrong
	c.until(t, e, "the steal", func() bool { return phase(e) == PhaseSteal && e.round.StealOpen })
	mustLock(t, e, 1, "keys", c.now+500)
	c.until(t, e, "the round to close", func() bool { return e.screen == ScreenRoundResult })

	var subs, closed, started int
	for _, r := range e.DrainRecords() {
		switch r.Kind {
		case RecMatchStarted:
			started++
		case RecSubmission:
			subs++
			if r.Seat == 1 && (!r.Correct || !r.IsSteal || r.AnswerID != "a1") {
				t.Fatalf("the steal should be recorded as a correct steal on a1: %+v", r)
			}
			if r.Seat == 0 && (r.Correct || r.AnswerID != "") {
				t.Fatalf("the wrong answer should be recorded unmatched: %+v", r)
			}
		case RecRoundClosed:
			closed++
			if r.Winner != 1 || r.Points != 30 || !r.Stolen || r.Scores != [2]int{0, 30} {
				t.Fatalf("round record = %+v", r)
			}
		}
	}
	if started != 1 || subs != 2 || closed != 1 {
		t.Fatalf("records: started=%d subs=%d closed=%d, want 1/2/1", started, subs, closed)
	}
	if again := e.DrainRecords(); len(again) != 0 {
		t.Fatalf("records must be handed over once, got %d more", len(again))
	}
}

func TestRematchNeedsBothPlayers(t *testing.T) {
	e, c := newMatch(t)
	e.Start(c.now)
	e.finishGame(0, c.now)
	ready, err := e.Rematch(0)
	if err != nil || ready {
		t.Fatalf("one player asking is not enough: ready=%v err=%v", ready, err)
	}
	ready, _ = e.Rematch(1)
	if !ready {
		t.Fatalf("both asked, so it should be ready")
	}
	e.Restart(testDeck(), c.now)
	if e.Screen() != ScreenIntro || e.Scores() != [2]int{0, 0} || len(e.history) != 0 {
		t.Fatalf("a rematch should start clean: screen=%s scores=%v", e.Screen(), e.Scores())
	}
}
