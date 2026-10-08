package live

import (
	"testing"
)

// ----------------------------------------------------------------- dropping

func TestADropMidRoundPausesTheShowForEveryone(t *testing.T) {
	e, c := faceoff(t)
	deadline := e.round.Deadline

	c.now += 4000
	e.SetConnected(0, false, c.now)
	if !e.Paused() {
		t.Fatalf("losing a player mid-round should pause the show")
	}

	// Ten seconds go by with the player gone. The clock must not run.
	away := c.now + 10_000
	e.Tick(away)
	if phase(e) != PhaseFaceoff {
		t.Fatalf("phase moved to %s while paused", phase(e))
	}
	if err := e.Lock(1, "keys", away); err != ErrPaused {
		t.Fatalf("an answer during the pause: got %v, want ErrPaused", err)
	}

	// They return after 10s. Nobody lost any clock.
	e.SetConnected(0, true, away)
	if e.Paused() {
		t.Fatalf("returning should resume the show")
	}
	if got := e.round.Deadline; got != deadline+10_000 {
		t.Fatalf("the clock should have been held: deadline moved by %d, want 10000", got-deadline)
	}
	mustLock(t, e, 1, "keys", away+100)
}

func TestAPlayerWhoStaysIsOfferedAChoiceOnlyAfterTheGracePeriod(t *testing.T) {
	e, c := faceoff(t)
	e.SetConnected(0, false, c.now)

	// Before the grace period ends, nobody is asked anything.
	e.Tick(c.now + e.tm.RejoinGrace - 1)
	if v := e.View(1, c.now); v.Pause == nil || v.Pause.Decision {
		t.Fatalf("no decision should be offered yet: %+v", v.Pause)
	}

	e.Tick(c.now + e.tm.RejoinGrace + 1)
	stayed := e.View(1, c.now)
	gone := e.View(0, c.now)
	if stayed.Pause == nil || !stayed.Pause.Decision {
		t.Fatalf("the player who stayed should now be asked what to do: %+v", stayed.Pause)
	}
	if gone.Pause == nil || gone.Pause.Decision {
		t.Fatalf("the player who left must not be offered the decision")
	}
	if stayed.Pause.Seat != 1 {
		t.Fatalf("in the waiting player's picture the missing player is player 1, got %d", stayed.Pause.Seat)
	}
	if err := e.Decide(0, "bot", c.now); err != ErrNothingToDecide {
		t.Fatalf("the player who left deciding: got %v", err)
	}
}

// Leaving on purpose is different from losing signal: there is nothing to wait
// for, so the player who stayed is asked what to do straight away.
func TestLeavingOnPurposeAsksTheOtherPlayerAtOnce(t *testing.T) {
	e, c := faceoff(t)
	e.Abandon(0, c.now)
	if !e.Paused() {
		t.Fatalf("the show should be held")
	}
	if v := e.View(1, c.now); v.Pause == nil || !v.Pause.Decision {
		t.Fatalf("the player who stayed should be offered the choice immediately: %+v", v.Pause)
	}
	if v := e.View(0, c.now); v.Pause != nil && v.Pause.Decision {
		t.Fatalf("the player who left must not be asked")
	}
	if err := e.Decide(1, "bot", c.now); err != nil {
		t.Fatal(err)
	}
	c.until(t, e, "the round to finish", func() bool { return e.screen == ScreenRoundResult })
}

func TestWaitingAgainGivesAnotherGracePeriod(t *testing.T) {
	e, c := faceoff(t)
	e.SetConnected(0, false, c.now)
	e.Tick(c.now + e.tm.RejoinGrace + 1)
	later := c.now + e.tm.RejoinGrace + 1
	if err := e.Decide(1, "wait", later); err != nil {
		t.Fatal(err)
	}
	if v := e.View(1, later); v.Pause.Decision {
		t.Fatalf("after choosing to wait there is nothing to decide")
	}
	e.Tick(later + e.tm.RejoinGrace + 1)
	if v := e.View(1, later); !v.Pause.Decision {
		t.Fatalf("the question should come back after another grace period")
	}
}

func TestFinishingAgainstTheComputerContinuesFromTheSameQuestion(t *testing.T) {
	e, c := faceoff(t)
	e.SetConnected(0, false, c.now)
	e.Tick(c.now + e.tm.RejoinGrace + 1)
	now := c.now + e.tm.RejoinGrace + 1
	if err := e.Decide(1, "bot", now); err != nil {
		t.Fatal(err)
	}
	if e.Paused() {
		t.Fatalf("choosing the computer should resume play")
	}
	if e.Human(0) {
		t.Fatalf("the seat that left should now be played by the computer")
	}
	if e.round.bot[0] == nil && e.round.Phase == PhaseFaceoff {
		// The computer may have decided to stay silent; that is allowed. What is
		// not allowed is the round hanging: it must still be able to end.
	}
	c.now = now
	c.until(t, e, "the round to finish", func() bool { return e.screen == ScreenRoundResult })
}

// The host's line must never name a seat that nobody is sitting in.
func TestTheLobbyLineNeverNamesAnEmptySeat(t *testing.T) {
	e := New(DefaultTimings(), testDeck(), newRNG(5), "medium")
	e.Seat(0, PlayerInfo{Name: "Nairobi"}, true)
	alone := e.View(0, 1).Host
	if alone.Event != "create" {
		t.Fatalf("with one person in the lobby the host should talk about the room, got %q", alone.Event)
	}

	e.Seat(1, PlayerInfo{Name: "Mombasa"}, true)
	both := e.View(0, 1).Host
	if both.Event != "lobby" || both.Vars["p1"] != "Nairobi" || both.Vars["p2"] != "Mombasa" {
		t.Fatalf("with two people the host should name both, got %q %v", both.Event, both.Vars)
	}

	e.Unseat(1)
	if again := e.View(0, 1).Host; again.Event != "create" {
		t.Fatalf("when the guest leaves the host should go back to the room, got %q", again.Event)
	}
}

func TestDroppingInTheLobbyDoesNotPause(t *testing.T) {
	e, c := newMatch(t)
	e.SetConnected(1, false, c.now)
	if e.Paused() {
		t.Fatalf("nothing has started, so there is nothing to pause")
	}
	if err := e.Start(c.now); err != ErrNeedBothSeats {
		t.Fatalf("starting without the other player connected: got %v", err)
	}
	e.SetConnected(1, true, c.now)
	if err := e.Start(c.now); err != nil {
		t.Fatal(err)
	}
}

func TestBothPlayersDroppingNeedsBothToComeBack(t *testing.T) {
	e, c := faceoff(t)
	e.SetConnected(0, false, c.now)
	e.SetConnected(1, false, c.now+10)
	e.SetConnected(0, true, c.now+20)
	if !e.Paused() {
		t.Fatalf("one player back is not enough")
	}
	e.SetConnected(1, true, c.now+30)
	if e.Paused() {
		t.Fatalf("both back, so play should resume")
	}
}

// --------------------------------------------------------------- the computer

func botMatch(t *testing.T, difficulty string, seed uint64) (*Engine, *clock) {
	t.Helper()
	e := New(DefaultTimings(), testDeck(), newRNG(seed), difficulty)
	e.Seat(0, PlayerInfo{Name: "You"}, true)
	e.Seat(1, PlayerInfo{Name: "Computer"}, false)
	c := &clock{now: 2_000_000}
	e.SetConnected(0, true, c.now)
	return e, c
}

func TestAMatchAgainstTheComputerRunsToTheEndOnItsOwn(t *testing.T) {
	// A person who never answers still gets a finished match: the computer plays
	// and the clock does the rest. This is the guard against a stuck room.
	for seed := uint64(1); seed <= 20; seed++ {
		e, c := botMatch(t, "hard", seed)
		if err := e.Start(c.now); err != nil {
			t.Fatal(err)
		}
		c.until(t, e, "the result", func() bool { return e.screen == ScreenResult })
		if _, ok := e.Outcome(); !ok {
			t.Fatalf("seed %d: finished with no outcome", seed)
		}
	}
}

func TestTheComputerIsJudgedByTheSameRules(t *testing.T) {
	scored := false
	for seed := uint64(1); seed <= 40 && !scored; seed++ {
		e, c := botMatch(t, "insane", seed)
		e.Start(c.now)
		c.until(t, e, "the result", func() bool { return e.screen == ScreenResult })
		for _, r := range e.DrainRecords() {
			if r.Kind == RecSubmission && r.Seat == 1 {
				if r.Correct && r.AnswerID == "" {
					t.Fatalf("a correct computer answer must name the board slot it reached")
				}
				scored = scored || r.Correct
			}
		}
	}
	if !scored {
		t.Fatalf("an insane computer never scored in 40 matches; it is not playing")
	}
}

func TestTheComputerAnswersOnlyWhenItsWindowIsOpen(t *testing.T) {
	e, c := botMatch(t, "insane", 11)
	e.Start(c.now)
	c.until(t, e, "the question", func() bool { return phase(e) == PhaseQuestion })
	if e.round.bot[1] != nil {
		t.Fatalf("the computer should not have a plan before the face-off opens")
	}
	c.until(t, e, "the face-off", func() bool { return phase(e) == PhaseFaceoff })
	if e.round.bot[1] != nil && e.round.bot[1].At < c.now {
		t.Fatalf("the computer's answer is scheduled in the past")
	}
}

func TestOnlyAGameAgainstTheComputerCanBePaused(t *testing.T) {
	e, c := faceoff(t) // two people
	if err := e.Pause(c.now); err != ErrBotRoomOnly {
		t.Fatalf("pausing a game between two people: got %v, want ErrBotRoomOnly", err)
	}

	b, bc := botMatch(t, "medium", 5)
	b.Start(bc.now)
	bc.until(t, b, "the face-off", func() bool { return phase(b) == PhaseFaceoff })
	deadline := b.round.Deadline
	if err := b.Pause(bc.now); err != nil {
		t.Fatal(err)
	}
	b.Tick(bc.now + 60_000)
	if phase(b) != PhaseFaceoff {
		t.Fatalf("a paused game must not move on")
	}
	b.Resume(bc.now + 60_000)
	if got := b.round.Deadline; got != deadline+60_000 {
		t.Fatalf("a minute's pause cost %d ms of clock", 60_000-(got-deadline))
	}
}
