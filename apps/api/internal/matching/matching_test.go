package matching

import "testing"

func board() []Answer {
	return []Answer{
		{ID: "a1", Rank: 1, Text: "Keys", Points: 34, Aliases: []string{"key", "car keys", "house keys", "funguo"}},
		{ID: "a2", Rank: 2, Text: "Phone", Points: 26, Aliases: []string{"cell", "cellphone", "mobile", "smartphone", "simu"}},
		{ID: "a3", Rank: 3, Text: "Wallet", Points: 15, Aliases: []string{"purse", "money", "handbag"}},
		{ID: "a4", Rank: 4, Text: "To turn the lights off", Points: 8, Aliases: []string{"lights", "turn off lights"}},
		{ID: "a5", Rank: 5, Text: "ID", Points: 6, Aliases: []string{"id card", "passport", "kitambulisho"}},
	}
}

func TestNormalize(t *testing.T) {
	cases := map[string]string{
		"  Phone  ":       "phone",
		"The Remote":      "remote",
		"my car keys!":    "car keys",
		"Won't":           "wont",
		"ICE-CREAM":       "ice cream",
		"a":               "a",
		"the":             "the",
		"I'd grab my dog": "id grab my dog",
		"multiple   gaps": "multiple gaps",
		"...!!!":          "",
	}
	for in, want := range cases {
		if got := Normalize(in); got != want {
			t.Errorf("Normalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMatch(t *testing.T) {
	cases := []struct {
		in       string
		wantRank int // 0 means "not on the board"
		why      string
	}{
		{"keys", 1, "exact"},
		{"Keys", 1, "case folds"},
		{"KEY", 1, "alias, singular"},
		{"my car keys", 1, "alias with filler"},
		{"funguo", 1, "swahili alias"},
		{"kies", 0, "4-letter typo is a different word, not a near miss"},
		{"phone", 2, "exact"},
		{"phones", 2, "plural folds"},
		{"my phone", 2, "filler stripped"},
		{"smartphone", 2, "alias"},
		{"smartphne", 2, "typo inside a long alias"},
		{"cell phone", 2, "phrase contains alias"},
		{"I always forget my wallet", 3, "narrated answer still counts"},
		{"turn off lights", 4, "alias of a long answer"},
		{"the lights", 4, "alias with filler"},
		{"id", 5, "two-letter answer, exact only"},
		{"passport", 5, "alias"},
		{"idea", 0, "must not match ID by substring"},
		{"umbrella", 0, "plausible but not on the board"},
		{"", 0, "empty"},
		{"   ", 0, "whitespace only"},
		{"!!!", 0, "punctuation only"},
	}

	for _, c := range cases {
		got := Match(board(), c.in)
		gotRank := 0
		if got.Answer != nil {
			gotRank = got.Answer.Rank
		}
		if gotRank != c.wantRank {
			t.Errorf("Match(%q) = rank %d (%s), want rank %d — %s", c.in, gotRank, got.How, c.wantRank, c.why)
		}
	}
}

// The longest matching phrase should win, so a board holding both a compound
// answer and one of its words resolves to the compound.
func TestMatchPrefersLongestPhrase(t *testing.T) {
	b := []Answer{
		{ID: "a1", Rank: 1, Text: "Cream", Points: 20},
		{ID: "a2", Rank: 2, Text: "Ice cream", Points: 30},
	}
	got := Match(b, "a tub of ice cream")
	if got.Answer == nil || got.Answer.Rank != 2 {
		t.Fatalf("got %+v, want rank 2 (Ice cream)", got.Answer)
	}
}

func TestDistanceEarlyExit(t *testing.T) {
	if d := distance("abcdefghij", "zzzz", 2); d <= 2 {
		t.Errorf("distance should exceed the limit, got %d", d)
	}
	if d := distance("phone", "phone", 1); d != 0 {
		t.Errorf("identical strings: got %d, want 0", d)
	}
	if d := distance("phonr", "phone", 1); d != 1 {
		t.Errorf("one substitution: got %d, want 1", d)
	}
}

func TestSingular(t *testing.T) {
	cases := map[string]string{
		"keys": "key", "phones": "phone", "glasses": "glass",
		"stories": "story", "boxes": "box", "dishes": "dish",
		// Not plurals: these must survive untouched or they match nothing.
		"bus": "bus", "glass": "glass", "is": "is", "status": "status",
	}
	for in, want := range cases {
		if got := singular(in); got != want {
			t.Errorf("singular(%q) = %q, want %q", in, got, want)
		}
	}
}

func BenchmarkMatch(b *testing.B) {
	bd := board()
	for i := 0; i < b.N; i++ {
		Match(bd, "I usually forget my car keys")
	}
}
