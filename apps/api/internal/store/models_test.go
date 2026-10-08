package store

import (
	"encoding/json"
	"strings"
	"testing"
)

// The board is secret until a slot is won. Aliases are the sharpest part of that
// secret — they spell out everything the board will accept — so the type that
// gameplay code might serialise must never emit them.
func TestAliasesNeverLeakFromTheGameplayTypes(t *testing.T) {
	q := Question{
		Prompt:  "Name something people forget.",
		Answers: []Answer{{Rank: 1, Text: "Keys", Points: 34, Aliases: []string{"car keys", "funguo"}}},
	}
	raw, err := json.Marshal(q)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"car keys", "funguo", "aliases"} {
		if strings.Contains(string(raw), secret) {
			t.Errorf("gameplay JSON contains %q:\n%s", secret, raw)
		}
	}
}

// The reverse: an editor approving a question has to be able to see what it
// will accept, which is the whole value of the panel-harvested aliases.
func TestReviewItemsShowAliasesToEditors(t *testing.T) {
	item := ReviewItem{
		Question: Question{Prompt: "Name something people forget."},
		Board: []ReviewAnswer{
			{Rank: 1, Text: "Keys", Points: 34, PanelCount: 20, Aliases: []string{"car keys", "funguo"}},
		},
	}
	raw, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}

	var decoded struct {
		Board []struct {
			Text    string   `json:"text"`
			Aliases []string `json:"aliases"`
		} `json:"board"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Board) != 1 || len(decoded.Board[0].Aliases) != 2 {
		t.Fatalf("editor view lost the aliases:\n%s", raw)
	}
	// And the embedded gameplay field must not appear alongside it.
	if strings.Contains(string(raw), `"answers"`) {
		t.Errorf("review JSON carries a second, gameplay-shaped answers list:\n%s", raw)
	}
}
