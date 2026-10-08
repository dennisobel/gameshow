package live

import (
	"encoding/json"
	"strings"
	"testing"
)

// The browser must never be able to learn what it has not earned. These tests
// look at the exact JSON a phone would receive, because that is what an
// attacker with DevTools open would read.

var boardWords = []string{"Keys", "Phone", "Wallet", "Umbrella", "Lights"}

func asJSON(t *testing.T, v View) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal view: %v", err)
	}
	return string(b)
}

func TestNoAnswerTextLeavesTheServerBeforeItIsEarned(t *testing.T) {
	e, c := faceoff(t)
	c.now += 1000
	e.Typing(0, c.now)
	for viewer := 0; viewer < 2; viewer++ {
		body := asJSON(t, e.View(viewer, c.now))
		for _, w := range boardWords {
			if strings.Contains(strings.ToLower(body), strings.ToLower(w)) {
				t.Fatalf("viewer %d was sent %q while the face-off was open", viewer, w)
			}
		}
	}
}

func TestOnlyTheClaimedAnswerIsRevealed(t *testing.T) {
	e, c := faceoff(t)
	mustLock(t, e, 0, "phone", c.now+500)
	c.until(t, e, "judging", func() bool { return phase(e) == PhaseCorrect })

	for viewer := 0; viewer < 2; viewer++ {
		v := e.View(viewer, c.now)
		got := map[string]bool{}
		for _, a := range v.Round.Def.Question.Answers {
			if a.Text != "" {
				got[a.Text] = true
			}
		}
		if len(got) != 1 || !got["Phone"] {
			t.Fatalf("viewer %d sees %v; only the claimed answer 'Phone' should be known", viewer, got)
		}
	}
	// Once the board is turned over, everything is shown, and not before.
	c.until(t, e, "the board reveal", func() bool { return phase(e) == PhaseBoardReveal })
	v := e.View(1, c.now)
	for i, a := range v.Round.Def.Question.Answers {
		if a.Text == "" {
			t.Fatalf("answer %d still hidden after the board was revealed", i+1)
		}
	}
}

func TestTheOtherPlayersQueuedAnswerStaysSecretUntilItIsShown(t *testing.T) {
	e, c := faceoff(t)
	mustLock(t, e, 0, "keys", c.now+500)
	mustLock(t, e, 1, "umbrella", c.now+530) // second: queued behind the reveal

	// Seat 0 may see that seat 1 locked in, but not what they wrote.
	v0 := e.View(0, c.now+600)
	if len(v0.Round.Subs) != 2 {
		t.Fatalf("seat 0 should see that two players have locked, got %d", len(v0.Round.Subs))
	}
	for _, s := range v0.Round.Subs {
		if s.Player == 1 && s.Text != "" {
			t.Fatalf("seat 0 was sent seat 1's answer %q before it was revealed", s.Text)
		}
		if s.Player == 1 && s.Match != nil {
			t.Fatalf("seat 0 was told which board slot seat 1 reached")
		}
	}
	// Seat 1 sees their own answer.
	v1 := e.View(1, c.now+600)
	var own SubView
	for _, s := range v1.Round.Subs {
		if s.Player == 0 { // seat 1 is player 0 in their own picture
			own = s
		}
	}
	if own.Text != "umbrella" {
		t.Fatalf("a player should always see their own locked answer, got %q", own.Text)
	}

	// After the winner is decided, the slower answer is shown to both.
	c.until(t, e, "the late answer", func() bool { return phase(e) == PhaseLate })
	for viewer := 0; viewer < 2; viewer++ {
		v := e.View(viewer, c.now)
		if v.Round.Current == nil || v.Round.Current.Text != "umbrella" {
			t.Fatalf("viewer %d should now see the slower answer", viewer)
		}
	}
}

// The clock is one clock. When the first answer lands it stops on both screens at
// the same instant, which is what makes the race feel fair from either city.
func TestTheFirstLockFreezesTheClockOnBothScreens(t *testing.T) {
	e, c := faceoff(t)
	c.now += 3210
	mustLock(t, e, 1, "keys", c.now)
	for viewer := 0; viewer < 2; viewer++ {
		v := e.View(viewer, c.now+500)
		if v.Round.FrozenAt == nil || *v.Round.FrozenAt != c.now {
			t.Fatalf("viewer %d: the clock should read frozen at the moment of the lock (%d), got %v", viewer, c.now, v.Round.FrozenAt)
		}
	}
}

func TestEachPlayerSeesThemselvesOnTheLeft(t *testing.T) {
	e, c := faceoff(t)
	mustLock(t, e, 1, "keys", c.now+400) // Mombasa, seat 1
	c.until(t, e, "judging", func() bool { return phase(e) == PhaseCorrect })

	mombasa := e.View(1, c.now)
	nairobi := e.View(0, c.now)

	if mombasa.Players[0].Name != "Mombasa" || mombasa.Players[1].Name != "Nairobi" {
		t.Fatalf("seat 1's picture should put them first: %v / %v", mombasa.Players[0].Name, mombasa.Players[1].Name)
	}
	if nairobi.Players[0].Name != "Nairobi" {
		t.Fatalf("seat 0's picture should put them first")
	}
	if w := mombasa.Round.Winner; w == nil || *w != 0 {
		t.Fatalf("Mombasa won, so in their own picture the winner is player 0, got %v", w)
	}
	if w := nairobi.Round.Winner; w == nil || *w != 1 {
		t.Fatalf("in Nairobi's picture the winner is player 1, got %v", w)
	}
	if mombasa.Players[0].Score != 30 || nairobi.Players[1].Score != 30 {
		t.Fatalf("scores must follow the player, not the position")
	}
	if tile := mombasa.Round.Tiles[0]; tile.By == nil || *tile.By != 0 {
		t.Fatalf("the claimed tile should belong to player 0 in Mombasa's picture")
	}
	if tile := nairobi.Round.Tiles[0]; tile.By == nil || *tile.By != 1 {
		t.Fatalf("the claimed tile should belong to player 1 in Nairobi's picture")
	}
}

func TestTheFinalResultIsAddressedToEachPlayer(t *testing.T) {
	e, c := newMatch(t)
	e.Start(c.now)
	e.players[0].Score, e.players[1].Score = 50, 90
	e.finishGame(1, c.now)

	winner := e.View(1, c.now)
	loser := e.View(0, c.now)
	if winner.Host.Event != "winner" || loser.Host.Event != "loser" {
		t.Fatalf("host lines: winner got %q, loser got %q", winner.Host.Event, loser.Host.Event)
	}
	if o, _ := winner.Outcome.(int); o != 0 {
		t.Fatalf("the winner's own picture should name player 0 as the winner, got %v", winner.Outcome)
	}
	if o, _ := loser.Outcome.(int); o != 1 {
		t.Fatalf("the loser's picture should name player 1 as the winner, got %v", loser.Outcome)
	}
}

func TestAliasesNeverReachAPhone(t *testing.T) {
	d := testDeck()
	d.Rounds[0].Answers[0].Aliases = []string{"carkeyzzz", "fobsecret"}
	e := New(DefaultTimings(), d, newRNG(3), "medium")
	e.Seat(0, PlayerInfo{Name: "A"}, true)
	e.Seat(1, PlayerInfo{Name: "B"}, true)
	c := &clock{now: 5_000_000}
	e.SetConnected(0, true, c.now)
	e.SetConnected(1, true, c.now)
	e.Start(c.now)
	c.until(t, e, "the face-off", func() bool { return phase(e) == PhaseFaceoff })
	for viewer := 0; viewer < 2; viewer++ {
		body := asJSON(t, e.View(viewer, c.now))
		if strings.Contains(body, "carkeyzzz") || strings.Contains(body, "fobsecret") {
			t.Fatalf("viewer %d was sent an alias", viewer)
		}
	}
}

func TestTheDeckPreviewDoesNotNameUpcomingQuestions(t *testing.T) {
	e, c := newMatch(t)
	body := asJSON(t, e.View(0, c.now))
	for _, r := range testDeck().Rounds {
		if strings.Contains(body, r.Prompt) {
			t.Fatalf("the lobby view leaked a question prompt: %q", r.Prompt)
		}
	}
}
