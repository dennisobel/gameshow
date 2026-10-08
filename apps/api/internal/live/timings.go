package live

import (
	"os"
	"strconv"
	"unicode/utf8"
)

// Timings is the show's pacing, in milliseconds.
//
// Every pause that used to wait for a tap now has a length, because with two
// people on two phones nobody can be the one who has to press "next". The
// numbers are the ones the single-player build used, so the show feels the same.
type Timings struct {
	Intro        int64 // the host's welcome, before round one
	Question     int64 // the host reads the question: the least time it is given
	QuestionLead int64 // plus this, for the host to introduce the round
	QuestionChar int64 // plus this for every character of the question
	Countdown    int64 // 3, 2, 1, go
	Reveal       int64 // the drumroll before an answer is judged
	Correct      int64
	Wrong        int64
	Late         int64 // the slower answer, shown after the round was decided
	StealLocked  int64 // the steal when the other player had already locked
	TimeUp       int64
	StealTimeUp  int64
	BoardBase    int64 // the remaining answers flip: base + per hidden tile
	BoardPerTile int64
	Outcome      int64 // the finished board stays up before the results card
	RoundResult  int64
	Scoreboard   int64
	FinalIntro   int64
	SuddenIntro  int64
	StealWindow  int64 // how long the other player has to steal
	Freeze       int64 // what the freeze power-up adds
	RejoinGrace  int64 // how long a dropped player is waited for
	TypingTTL    int64 // a "typing" signal lasts this long without another
}

func DefaultTimings() Timings {
	return Timings{
		Intro:        8500,
		Question:     4800,
		QuestionLead: 3000,
		QuestionChar: 55,
		Countdown:    3300,
		Reveal:       2300,
		Correct:      3000,
		Wrong:        2400,
		Late:         2800,
		StealLocked:  2300,
		TimeUp:       2600,
		StealTimeUp:  2400,
		BoardBase:    1100,
		BoardPerTile: 280,
		Outcome:      2200,
		RoundResult:  6000,
		Scoreboard:   5000,
		FinalIntro:   6500,
		SuddenIntro:  6000,
		StealWindow:  10000,
		Freeze:       3000,
		RejoinGrace:  30000,
		TypingTTL:    2500,
	}
}

// QuestionTime is how long the host is given to read a question. A short one
// gets the minimum; a long one gets enough that the countdown never starts over
// the top of the host still speaking.
func (t Timings) QuestionTime(prompt string) int64 {
	return max(t.Question, t.QuestionLead+int64(utf8.RuneCountInString(prompt))*t.QuestionChar)
}

// Scaled shortens or stretches every pause. It exists so an end-to-end test of a
// whole match can run in seconds rather than minutes; production uses 1.
func (t Timings) Scaled(f float64) Timings {
	if f <= 0 || f == 1 {
		return t
	}
	s := func(v int64) int64 { return max(1, int64(float64(v)*f)) }
	return Timings{
		Intro: s(t.Intro), Question: s(t.Question), QuestionLead: s(t.QuestionLead), QuestionChar: s(t.QuestionChar), Countdown: s(t.Countdown), Reveal: s(t.Reveal),
		Correct: s(t.Correct), Wrong: s(t.Wrong), Late: s(t.Late), StealLocked: s(t.StealLocked),
		TimeUp: s(t.TimeUp), StealTimeUp: s(t.StealTimeUp), BoardBase: s(t.BoardBase),
		BoardPerTile: s(t.BoardPerTile), Outcome: s(t.Outcome), RoundResult: s(t.RoundResult),
		Scoreboard: s(t.Scoreboard), FinalIntro: s(t.FinalIntro), SuddenIntro: s(t.SuddenIntro),
		StealWindow: s(t.StealWindow), Freeze: s(t.Freeze), RejoinGrace: s(t.RejoinGrace),
		TypingTTL: t.TypingTTL,
	}
}

// TimingsFromEnv reads LIVE_SPEED, a testing knob. 2 means twice as fast.
func TimingsFromEnv() (Timings, float64) {
	t := DefaultTimings()
	raw := os.Getenv("LIVE_SPEED")
	if raw == "" {
		return t, 1
	}
	speed, err := strconv.ParseFloat(raw, 64)
	if err != nil || speed <= 0 {
		return t, 1
	}
	return t.Scaled(1 / speed), speed
}
