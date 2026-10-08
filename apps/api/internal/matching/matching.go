// Package matching decides whether what a player typed is on the board.
//
// This runs on the server, not the client, for three reasons (ARCHITECTURE §7):
// the board stays secret, the rules live in one place, and every check leaves a
// row behind that tells us which answers players give that we do not yet accept.
//
// The bar is deliberately generous. In this genre almost all player frustration
// comes from knowing the answer and being told you are wrong because you typed
// "cell" instead of "phone". A false accept costs a point; a false reject costs
// the player's trust in the game.
package matching

import (
	"strings"
	"unicode"
)

// Answer is one board slot, as stored.
type Answer struct {
	ID      string
	Rank    int
	Text    string
	Points  int
	Aliases []string
}

// Result reports what a submission matched.
type Result struct {
	Answer *Answer // nil when nothing on the board matched
	How    string  // exact | alias | fuzzy | phrase
}

// leading filler words that carry no meaning for matching
var fillers = map[string]bool{
	"a": true, "an": true, "the": true, "my": true, "your": true,
	"their": true, "his": true, "her": true, "its": true, "our": true,
	"some": true, "someone's": true, "somebody's": true,
}

// Normalize reduces free text to a comparable form: lowercase, no punctuation,
// single spaces, no leading filler words. Stored on every submission so the
// alias-gap query can group by it.
func Normalize(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	prevSpace := true
	for _, r := range strings.ToLower(strings.TrimSpace(s)) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			prevSpace = false
		case r == '\'':
			// Keep apostrophes out entirely so "won't" and "wont" agree.
		default:
			if !prevSpace {
				b.WriteByte(' ')
				prevSpace = true
			}
		}
	}
	out := strings.TrimSpace(b.String())

	// Drop leading filler words ("the remote" -> "remote"), but never reduce the
	// input to nothing: "the" on its own stays "the".
	words := strings.Fields(out)
	for len(words) > 1 && fillers[words[0]] {
		words = words[1:]
	}
	return strings.Join(words, " ")
}

// singular folds the common English plural endings. Crude on purpose: it only
// needs to make "keys" and "key" agree, and it must never merge two distinct
// board answers.
func singular(w string) string {
	switch {
	case len(w) > 4 && strings.HasSuffix(w, "ies"):
		return w[:len(w)-3] + "y" // stories -> story
	// "-es" is only a plural ending after a sibilant: glasses, boxes, dishes.
	// Stripping it unconditionally would turn "phones" into "phon".
	case len(w) > 4 && (strings.HasSuffix(w, "ses") || strings.HasSuffix(w, "xes") ||
		strings.HasSuffix(w, "zes") || strings.HasSuffix(w, "ches") || strings.HasSuffix(w, "shes")):
		return w[:len(w)-2]
	// Bare "-s", but not on short words or non-plural endings, or "bus" would
	// fold to "bu" and match nothing.
	case len(w) > 3 && strings.HasSuffix(w, "s") &&
		!strings.HasSuffix(w, "ss") && !strings.HasSuffix(w, "us") && !strings.HasSuffix(w, "is"):
		return w[:len(w)-1]
	}
	return w
}

func singularPhrase(s string) string {
	words := strings.Fields(s)
	for i, w := range words {
		words[i] = singular(w)
	}
	return strings.Join(words, " ")
}

// distance is Levenshtein edit distance with early exit once the best possible
// result already exceeds the caller's tolerance.
func distance(a, b string, limit int) int {
	if a == b {
		return 0
	}
	if diff := len(a) - len(b); diff > limit || -diff > limit {
		return limit + 1
	}
	prev := make([]int, len(b)+1)
	cur := make([]int, len(b)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(a); i++ {
		cur[0] = i
		best := cur[0]
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			cur[j] = min(min(cur[j-1]+1, prev[j]+1), prev[j-1]+cost)
			best = min(best, cur[j])
		}
		if best > limit {
			return limit + 1
		}
		prev, cur = cur, prev
	}
	return prev[len(b)]
}

// tolerance scales allowed typos with the length of the target. Short words get
// none: at three characters, one edit is a different word.
func tolerance(target string) int {
	switch n := len(target); {
	case n >= 9:
		return 2
	case n >= 5:
		return 1
	default:
		return 0
	}
}

func closeEnough(input, target string) bool {
	if input == target {
		return true
	}
	if singularPhrase(input) == singularPhrase(target) {
		return true
	}
	if t := tolerance(target); t > 0 {
		return distance(input, target, t) <= t
	}
	return false
}

// Match reports which board answer the input corresponds to, if any.
//
// Two passes, in order of confidence:
//
//  1. whole-input match against the answer text and each alias, with typo tolerance;
//  2. phrase containment, so "my car keys" and "I'd grab the pets" still land —
//     players narrate, and that should not cost them the point.
//
// Pass 2 prefers the longest matched phrase, so an answer like "ice cream" wins
// over "cream" when both are on the board.
func Match(answers []Answer, raw string) Result {
	input := Normalize(raw)
	if input == "" {
		return Result{}
	}

	for i := range answers {
		a := &answers[i]
		if closeEnough(input, Normalize(a.Text)) {
			return Result{Answer: a, How: "exact"}
		}
		for _, alias := range a.Aliases {
			if closeEnough(input, Normalize(alias)) {
				return Result{Answer: a, How: "alias"}
			}
		}
	}

	padded := " " + singularPhrase(input) + " "
	var best *Answer
	bestLen := 0
	for i := range answers {
		a := &answers[i]
		forms := make([]string, 0, len(a.Aliases)+1)
		forms = append(forms, a.Text)
		forms = append(forms, a.Aliases...)
		for _, f := range forms {
			n := Normalize(f)
			// Three characters is too short to be a safe substring: "id" would
			// match inside "idea".
			if len(n) < 4 {
				continue
			}
			if strings.Contains(padded, " "+singularPhrase(n)+" ") && len(n) > bestLen {
				best, bestLen = a, len(n)
			}
		}
	}
	if best != nil {
		return Result{Answer: best, How: "phrase"}
	}
	return Result{}
}
