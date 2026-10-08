// Package live runs a match between two players.
//
// The match is decided here, on the server, and nowhere else. A browser sends
// what its player did (pressed start, typed, locked an answer) and receives the
// state of the show to draw. It never runs a clock, never judges an answer and
// never sees a board slot it has not earned. That is what makes "whoever
// answers first, answers first" true: there is exactly one clock, and it is
// not on either player's phone.
//
// The Engine in this package is a pure state machine. It does no I/O, starts no
// goroutines and reads no wall clock; every call is handed the time. That keeps
// the rules testable with a fake clock, including awkward cases like two
// answers arriving a few milliseconds apart.
package live

import (
	"errors"
	"math/rand/v2"
	"strings"
	"unicode/utf8"

	"github.com/dennisobel/gameshow/apps/api/internal/matching"
)

// Phase is a step within a round.
type Phase string

const (
	PhaseQuestion    Phase = "question"    // the host reads the question
	PhaseCountdown   Phase = "countdown"   // 3, 2, 1, go
	PhaseFaceoff     Phase = "faceoff"     // both players race to lock an answer
	PhaseReveal      Phase = "reveal"      // the first locked answer is shown
	PhaseCorrect     Phase = "correct"     // it was on the board
	PhaseWrong       Phase = "wrong"       // it was not: a strike
	PhaseLate        Phase = "late"        // the slower answer, shown after the round was decided
	PhaseSteal       Phase = "steal"       // the other player gets a chance
	PhaseTimeUp      Phase = "timeUp"      // nobody answered in time
	PhaseBoardReveal Phase = "boardReveal" // the remaining answers flip
	PhaseDone        Phase = "done"
)

// Screen is what both players are looking at. Server-driven: the two phones
// change screen together because the server changes it for both.
type Screen string

const (
	ScreenLobby       Screen = "lobby"
	ScreenIntro       Screen = "intro"
	ScreenRound       Screen = "round"
	ScreenRoundResult Screen = "roundResult"
	ScreenScoreboard  Screen = "scoreboard"
	ScreenFinalIntro  Screen = "finalIntro"
	ScreenSuddenIntro Screen = "suddenIntro"
	ScreenResult      Screen = "result"
)

// Round kinds, as the spin names them plus the tie-breaker.
const (
	KindNormal = "normal"
	KindDouble = "double"
	KindFinal  = "final"
	KindSudden = "sudden"
)

// Answer is one board slot, secret until it is earned or the round closes.
type Answer struct {
	ID         string
	Rank       int
	Text       string
	Points     int // base points; the round's multiplier is applied on scoring
	PanelCount int
	Aliases    []string
}

// Round is one question with its board.
type Round struct {
	QuestionID string
	Prompt     string
	Kind       string
	Multiplier int
	Seconds    int
	Answers    []Answer

	matchable []matching.Answer
}

// Deck is everything a match will ask: the regular rounds, then tie-breakers
// that are only used if the scores are level.
type Deck struct {
	Rounds []Round
	Sudden []Round
}

func (d *Deck) prepare() {
	for _, list := range []*[]Round{&d.Rounds, &d.Sudden} {
		for i := range *list {
			r := &(*list)[i]
			if r.Multiplier < 1 {
				r.Multiplier = 1
			}
			if r.Seconds < 1 {
				r.Seconds = 15
			}
			r.matchable = make([]matching.Answer, len(r.Answers))
			for j, a := range r.Answers {
				r.matchable[j] = matching.Answer{ID: a.ID, Rank: a.Rank, Text: a.Text, Points: a.Points, Aliases: a.Aliases}
			}
		}
	}
}

// PlayerInfo is what a seat brings to the table.
type PlayerInfo struct {
	Name   string `json:"name"`
	Avatar int    `json:"avatar"`
}

type Player struct {
	PlayerInfo
	Score      int
	Streak     int
	FreezeUsed bool
}

type TileKind string

const (
	TileHidden TileKind = "hidden"
	TileWon    TileKind = "won"
	TileStolen TileKind = "stolen"
	TileLate   TileKind = "late"
	TileBoard  TileKind = "board"
)

type Tile struct {
	Kind   TileKind
	By     int // seat, or -1
	Points int // already multiplied
}

// Sub is one locked answer.
type Sub struct {
	Seat int
	Text string
	At   int64 // ms after the answer window opened
	// Match is the board index this answer reached, or -1. It is set even when
	// that slot has already been taken, so "same answer" can be told apart from
	// "not on the board".
	Match    int
	Steal    bool
	Revealed bool // the other player may see the text
	Recorded bool
}

// RoundState is a round in progress.
type RoundState struct {
	Def         *Round
	Number      int
	Phase       Phase
	PhaseStart  int64
	NextAt      int64 // 0 = nothing scheduled
	StartedAt   int64
	Deadline    int64 // 0 = no clock
	Duration    int64
	FrozenAt    int64 // 0 = the clock is running
	Subs        []*Sub
	Queue       []*Sub
	Current     *Sub
	IsSteal     bool
	StealBy     int // seat, or -1
	StealOpen   bool
	Tiles       []Tile
	Struck      []int
	Winner      int // seat, or -1
	Awarded     int
	StreakBonus bool
	TypingUntil [2]int64
	TypingFrom  [2]int64

	bot [2]*botPlan
}

func (r *RoundState) hasSub(seat int) bool {
	for _, s := range r.Subs {
		if s.Seat == seat {
			return true
		}
	}
	return false
}

func (r *RoundState) struck(seat int) bool {
	for _, s := range r.Struck {
		if s == seat {
			return true
		}
	}
	return false
}

// answerOpen reports whether a player may lock an answer right now.
func (r *RoundState) answerOpen() bool {
	return r.FrozenAt == 0 && (r.Phase == PhaseFaceoff || (r.Phase == PhaseSteal && r.StealOpen))
}

// Record is something worth keeping once it has happened. The engine collects
// them; the room writes them to the database off the hot path, so a slow
// query can never delay a round.
type RecordKind int

const (
	RecMatchStarted RecordKind = iota
	RecSubmission
	RecRoundClosed
	RecMatchFinished
	// RecMatchAbandoned says the room closed while a match was still being played.
	RecMatchAbandoned
)

type Record struct {
	Kind RecordKind

	Round      int
	QuestionID string
	Seat       int
	Raw        string
	Normalized string
	AnswerID   string
	Correct    bool
	IsSteal    bool
	MsElapsed  int

	Winner int // seat, or -1
	Points int
	Stolen bool
	Scores [2]int
}

type HostState struct {
	Event string
	Vars  map[string]any
	Mood  string
	Key   int
}

type Fx struct {
	ID   int
	Kind string // sfx | haptic | audience
	Name string
}

type RoundRecord struct {
	Number int
	Kind   string
	Winner int
	Points int
	Answer string
	Stolen bool
}

type Delta struct {
	Player int
	Points int
	Key    int
}

// Errors a player's action can meet. They are shown to the player, so each one
// reads as a sentence.
var (
	ErrNotAccepting    = errors.New("answers are not open right now")
	ErrAlreadyLocked   = errors.New("you already locked an answer")
	ErrEmptyAnswer     = errors.New("type an answer first")
	ErrPaused          = errors.New("the game is paused")
	ErrWrongScreen     = errors.New("that is not possible right now")
	ErrNeedBothSeats   = errors.New("waiting for the other player")
	ErrFreezeUsed      = errors.New("you already used your freeze")
	ErrNotYours        = errors.New("it is not your turn to answer")
	ErrBotRoomOnly     = errors.New("only a game against the computer can be paused")
	ErrNothingToDecide = errors.New("there is nothing to decide")
)

func tidy(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) > 32 {
		s = string([]rune(s)[:32])
	}
	return s
}

func other(seat int) int { return 1 - seat }

var numberWords = []string{"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"}

func numberWord(n int) string {
	if n >= 0 && n < len(numberWords) {
		return numberWords[n]
	}
	return itoa(n)
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

// newRNG returns a seeded generator; tests pass a fixed seed.
func newRNG(seed uint64) *rand.Rand { return rand.New(rand.NewPCG(seed, seed^0x9E3779B97F4A7C15)) }
