package spin

import (
	"fmt"
	"strings"
	"testing"
)

func pool(n int) ([]string, []string) {
	ids := make([]string, n)
	diffs := make([]string, n)
	order := []string{"easy", "medium", "hard", "insane"}
	for i := range ids {
		ids[i] = fmt.Sprintf("q%03d", i)
		diffs[i] = order[i%len(order)]
	}
	return ids, diffs
}

// The property the share feature depends on: same seed, same game.
func TestPlanIsDeterministic(t *testing.T) {
	ids, diffs := pool(40)
	for _, seed := range []int64{0, 1, 42, 999999, 1 << 40} {
		a := Plan(ids, diffs, 5, seed)
		b := Plan(ids, diffs, 5, seed)
		if len(a) != 5 {
			t.Fatalf("seed %d: got %d rounds, want 5", seed, len(a))
		}
		for i := range a {
			if a[i] != b[i] {
				t.Fatalf("seed %d round %d: %+v != %+v", seed, i, a[i], b[i])
			}
		}
	}
}

func TestPlanVariesBySeed(t *testing.T) {
	ids, diffs := pool(40)
	seen := map[string]bool{}
	for seed := int64(0); seed < 50; seed++ {
		var key strings.Builder
		for _, r := range Plan(ids, diffs, 5, seed) {
			key.WriteString(r.QuestionID)
		}
		seen[key.String()] = true
	}
	// 50 seeds over a 40-question pool should produce almost all-distinct sets.
	if len(seen) < 45 {
		t.Errorf("only %d distinct games from 50 seeds — spins are not varied enough", len(seen))
	}
}

func TestPlanNeverRepeatsAQuestion(t *testing.T) {
	ids, diffs := pool(12)
	for seed := int64(0); seed < 200; seed++ {
		seen := map[string]bool{}
		for _, r := range Plan(ids, diffs, 5, seed) {
			if seen[r.QuestionID] {
				t.Fatalf("seed %d repeated question %s", seed, r.QuestionID)
			}
			seen[r.QuestionID] = true
		}
	}
}

func TestPlanRampsDifficultyAndEndsOnTheFinal(t *testing.T) {
	ids, diffs := pool(40)
	for seed := int64(0); seed < 50; seed++ {
		rounds := Plan(ids, diffs, 5, seed)

		prev := -1
		for _, r := range rounds {
			n := difficultyRank[diffs[indexOf(ids, r.QuestionID)]]
			if n < prev {
				t.Fatalf("seed %d: difficulty went backwards", seed)
			}
			prev = n
		}
		last := rounds[len(rounds)-1]
		if last.Kind != Final || last.Multiplier != 3 {
			t.Fatalf("seed %d: last round is %+v, want a x3 final", seed, last)
		}
		doubles := 0
		for _, r := range rounds {
			if r.Kind == Double {
				doubles++
			}
		}
		if doubles != 1 {
			t.Fatalf("seed %d: %d double rounds, want exactly 1", seed, doubles)
		}
	}
}

func TestPlanHandlesSmallPools(t *testing.T) {
	ids, diffs := pool(3)
	got := Plan(ids, diffs, 5, 7)
	if len(got) != 3 {
		t.Fatalf("got %d rounds from a 3-question pool, want 3", len(got))
	}
	if Plan(nil, nil, 5, 1) != nil {
		t.Error("an empty pool should produce no rounds")
	}
	if Plan(ids, diffs, 0, 1) != nil {
		t.Error("zero rounds should produce no rounds")
	}
}

func TestShareCodeAlphabet(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 2000; i++ {
		c := NewShareCode(6)
		if len(c) != 6 {
			t.Fatalf("length %d, want 6", len(c))
		}
		if strings.ContainsAny(c, "01OIL") {
			t.Fatalf("code %q contains an ambiguous character", c)
		}
		seen[c] = true
	}
	if len(seen) < 1990 {
		t.Errorf("%d distinct codes out of 2000 — too many collisions", len(seen))
	}
}

func indexOf(ids []string, id string) int {
	for i, v := range ids {
		if v == id {
			return i
		}
	}
	return -1
}
