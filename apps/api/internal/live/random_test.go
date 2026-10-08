package live

import (
	"fmt"
	"testing"
)

// Plays many whole matches with random behaviour from both seats, random
// disconnects and random delays, and checks that the rules still hold at every
// step. Hand-written scenarios only find the bugs their author imagined; this
// finds the ones nobody did.

var typedWords = []string{
	"keys", "phone", "wallet", "umbrella", "lights", "apple", "banana", "mango", "dog", "cat",
	"red", "blue", "monday", "spoon", "sofa", "", "   ", "keys keys", "KEYS", "a phone",
}

func TestRandomMatchesKeepTheirInvariants(t *testing.T) {
	for seed := uint64(1); seed <= 250; seed++ {
		runRandomMatch(t, seed)
	}
}

func runRandomMatch(t *testing.T, seed uint64) {
	t.Helper()
	rng := newRNG(seed * 7919)
	e := New(DefaultTimings(), testDeck(), newRNG(seed), []string{"easy", "medium", "hard", "insane"}[seed%4])
	e.Seat(0, PlayerInfo{Name: "A"}, true)
	vsComputer := seed%3 == 0
	e.Seat(1, PlayerInfo{Name: "B"}, !vsComputer)

	now := int64(10_000_000)
	e.SetConnected(0, true, now)
	if !vsComputer {
		e.SetConnected(1, true, now)
	}
	if err := e.Start(now); err != nil {
		t.Fatalf("seed %d: start: %v", seed, err)
	}

	const maxSteps = 6000
	for step := 0; e.Screen() != ScreenResult; step++ {
		if step >= maxSteps {
			t.Fatalf("seed %d: the match was still going after %d steps (screen=%s paused=%v)", seed, step, e.Screen(), e.Paused())
		}

		seat := rng.IntN(2)
		switch roll := rng.IntN(20); {
		case roll < 5:
			_ = e.Lock(seat, typedWords[rng.IntN(len(typedWords))], now)
		case roll == 5:
			e.Typing(seat, now)
		case roll == 6:
			_ = e.Freeze(seat, now)
		case roll == 7 && !vsComputer:
			e.SetConnected(seat, rng.IntN(3) == 0, now)
		case roll == 8:
			if e.Paused() {
				if rng.IntN(2) == 0 {
					_ = e.Decide(seat, []string{"wait", "bot"}[rng.IntN(2)], now)
				} else {
					e.SetConnected(seat, true, now)
				}
			}
		default:
			if due := e.NextDue(); due != 0 && rng.IntN(3) != 0 {
				now = max(now, due)
			} else {
				now += int64(rng.IntN(3000))
			}
			e.Tick(now)
		}
		// A match in which everybody has left for good would never end; bring
		// people back now and then so the run can complete.
		if e.Paused() && rng.IntN(6) == 0 {
			e.SetConnected(0, true, now)
			e.SetConnected(1, true, now)
		}

		checkInvariants(t, e, now, fmt.Sprintf("seed %d step %d", seed, step))
	}

	// At the end, the books must balance: every point on the scoreboard was
	// awarded by a recorded round.
	var byPlayer [2]int
	for _, h := range e.history {
		if h.Winner >= 0 {
			byPlayer[h.Winner] += h.Points
		}
	}
	if byPlayer != e.Scores() {
		t.Fatalf("seed %d: scores %v do not match the sum of rounds %v", seed, e.Scores(), byPlayer)
	}
	if w, ok := e.Outcome(); ok && w >= 0 {
		if e.players[w].Score < e.players[other(w)].Score {
			t.Fatalf("seed %d: seat %d was declared the winner with a lower score %v", seed, w, e.Scores())
		}
	}
}

func checkInvariants(t *testing.T, e *Engine, now int64, where string) {
	t.Helper()

	for s := 0; s < 2; s++ {
		if e.players[s].Score < 0 {
			t.Fatalf("%s: negative score", where)
		}
		if e.players[s].Streak < 0 {
			t.Fatalf("%s: negative streak", where)
		}
	}

	if r := e.round; r != nil && e.screen == ScreenRound {
		claimed := 0
		for _, tile := range r.Tiles {
			if tile.Kind == TileWon || tile.Kind == TileStolen {
				claimed++
			}
		}
		if claimed > 1 {
			t.Fatalf("%s: %d tiles scored in one round; a round has at most one winner", where, claimed)
		}
		if r.Winner >= 0 && claimed != 1 {
			t.Fatalf("%s: round has winner %d but %d scoring tiles", where, r.Winner, claimed)
		}
		seen := map[int]bool{}
		for _, s := range r.Subs {
			key := s.Seat*10 + btoi(s.Steal)
			if seen[key] {
				t.Fatalf("%s: seat %d locked twice in the same window", where, s.Seat)
			}
			seen[key] = true
		}
		if r.answerOpen() && r.Deadline == 0 {
			t.Fatalf("%s: answers are open with no clock", where)
		}
	}

	// Nothing a phone should not know may be in its view.
	for viewer := 0; viewer < 2; viewer++ {
		v := e.View(viewer, now)
		if v.Round == nil {
			continue
		}
		for i, tile := range v.Round.Tiles {
			if tile.Kind == TileHidden && v.Round.Def.Question.Answers[i].Text != "" {
				t.Fatalf("%s: viewer %d was told the text of an unclaimed answer", where, viewer)
			}
		}
		for i, s := range e.round.Subs {
			if !s.Revealed && s.Seat != viewer && v.Round.Subs[i].Text != "" {
				t.Fatalf("%s: viewer %d was told another player's unrevealed answer", where, viewer)
			}
		}
	}
}

func btoi(b bool) int {
	if b {
		return 1
	}
	return 0
}
