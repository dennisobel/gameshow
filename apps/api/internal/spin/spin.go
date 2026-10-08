// Package spin turns a category and a seed into a playable round list.
//
// A spin must be deterministic: the same seed over the same pool always yields
// the same questions in the same order. That is what makes a share code
// meaningful — whoever opens the link plays the game that was spun, not a
// similar one.
package spin

import (
	"crypto/rand"
	"encoding/binary"
	mrand "math/rand/v2"
)

// Kind labels a round so the client can dress it: double points, the final, or
// an ordinary round.
type Kind string

const (
	Normal Kind = "normal"
	Double Kind = "double"
	Final  Kind = "final"
)

type Round struct {
	Round      int    `json:"round"`
	QuestionID string `json:"questionId"`
	Kind       Kind   `json:"kind"`
	Multiplier int    `json:"multiplier"`
	Seconds    int    `json:"seconds"`
}

var difficultyRank = map[string]int{"easy": 0, "medium": 1, "hard": 2, "insane": 3}

// NewSeed returns a cryptographically random seed for a fresh spin.
func NewSeed() int64 {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		// math/rand's global source is seeded randomly in Go 1.20+, so this
		// fallback is still unpredictable enough for picking questions.
		return int64(mrand.Uint64())
	}
	return int64(binary.LittleEndian.Uint64(b[:]) >> 1) // keep it positive
}

// Plan selects `rounds` questions from the pool and arranges them into a show.
//
// ids and difficulties are parallel slices in a stable order (the caller sorts
// by id). The selection is a partial Fisher-Yates shuffle driven by the seed,
// then the chosen questions are ordered easiest-first so the game ramps and the
// final round lands on the hardest question in the set.
func Plan(ids, difficulties []string, rounds int, seed int64) []Round {
	if len(ids) == 0 || rounds <= 0 {
		return nil
	}
	if rounds > len(ids) {
		rounds = len(ids)
	}

	idx := make([]int, len(ids))
	for i := range idx {
		idx[i] = i
	}

	// ChaCha8 with an explicit seed: reproducible across processes and
	// architectures, unlike a hash-order or map-iteration based shuffle.
	var key [32]byte
	binary.LittleEndian.PutUint64(key[:8], uint64(seed))
	binary.LittleEndian.PutUint64(key[8:16], uint64(seed)*0x9E3779B97F4A7C15)
	rng := mrand.New(mrand.NewChaCha8(key))

	for i := 0; i < rounds; i++ {
		j := i + rng.IntN(len(idx)-i)
		idx[i], idx[j] = idx[j], idx[i]
	}
	chosen := idx[:rounds]

	// Easiest first. Ties keep shuffle order, so two spins that pick the same
	// questions in a different order still differ.
	for i := 1; i < len(chosen); i++ {
		for j := i; j > 0; j-- {
			a, b := chosen[j-1], chosen[j]
			if difficultyRank[difficulties[a]] <= difficultyRank[difficulties[b]] {
				break
			}
			chosen[j-1], chosen[j] = chosen[j], chosen[j-1]
		}
	}

	out := make([]Round, rounds)
	for i, c := range chosen {
		r := Round{Round: i + 1, QuestionID: ids[c], Kind: Normal, Multiplier: 1, Seconds: 15}
		switch {
		case i == rounds-1 && rounds > 1:
			// The final round is worth triple and is the climax of the show.
			r.Kind, r.Multiplier = Final, 3
		case rounds >= 4 && i == rounds-3:
			// One double-points round, placed so it lifts the middle of the game.
			r.Kind, r.Multiplier = Double, 2
		}
		out[i] = r
	}
	return out
}

// shareAlphabet omits 0/O/1/I/L so a code read aloud or typed from a photo is
// unambiguous.
const shareAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// NewShareCode returns a short, URL-safe, unambiguous code.
func NewShareCode(n int) string {
	b := make([]byte, n)
	raw := make([]byte, n)
	if _, err := rand.Read(raw); err != nil {
		for i := range b {
			b[i] = shareAlphabet[mrand.IntN(len(shareAlphabet))]
		}
		return string(b)
	}
	for i, v := range raw {
		b[i] = shareAlphabet[int(v)%len(shareAlphabet)]
	}
	return string(b)
}
