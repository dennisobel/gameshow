package live

// A seat held by the computer plays through exactly the same Lock path as a
// person: it is judged by the same matcher, scored by the same rules and is
// bound by the same clock. It is labelled as the computer everywhere a player
// can see it; nothing pretends it is somebody else.

type botLevel struct {
	accuracy float64 // chance of reaching for a real board answer
	minMS    int64
	maxMS    int64
	giveUp   float64 // chance of not answering at all
}

var botLevels = map[string]botLevel{
	"easy":   {accuracy: 0.45, minMS: 6500, maxMS: 13000, giveUp: 0.12},
	"medium": {accuracy: 0.60, minMS: 4500, maxMS: 11000, giveUp: 0.08},
	"hard":   {accuracy: 0.74, minMS: 3500, maxMS: 9000, giveUp: 0.05},
	"insane": {accuracy: 0.88, minMS: 2200, maxMS: 6500, giveUp: 0.02},
}

// Plausible answers that are almost never on a board. A wrong answer should
// still look like an attempt.
var nearMisses = []string{
	"umbrella", "shoes", "glasses", "jacket", "lunch", "charger", "headphones",
	"a hat", "sunglasses", "the dog", "my bag", "a book", "an umbrella",
	"a towel", "the washing", "my watch", "a pen", "keys to the office",
}

type botPlan struct {
	At         int64
	Text       string
	TypingFrom int64
}

// planBots decides what each computer-held seat will say in the window that
// just opened, and when. Called when a face-off or a steal window starts.
func (e *Engine) planBots(steal bool, now int64) {
	r := e.round
	for seat := 0; seat < 2; seat++ {
		r.bot[seat] = nil
		if e.human[seat] || !e.seated[seat] || r.hasSub(seat) {
			continue
		}
		if steal && seat != r.StealBy {
			continue
		}
		r.bot[seat] = e.planBot(seat, steal, now)
	}
}

func (e *Engine) planBot(seat int, steal bool, now int64) *botPlan {
	level, ok := botLevels[e.difficulty]
	if !ok {
		level = botLevels["medium"]
	}
	r := e.round
	if e.rng.Float64() < level.giveUp {
		return nil
	}

	text := nearMisses[e.rng.IntN(len(nearMisses))]
	if e.rng.Float64() < level.accuracy {
		if pick := e.weightedPick(r); pick != "" {
			text = pick
		}
	}

	hi := min(level.maxMS, max(level.minMS+500, r.Duration-1200))
	delay := level.minMS + e.rng.Int64N(max(1, hi-level.minMS))
	if steal {
		// A steal is a short window; never schedule past the end of it.
		delay = min(delay, max(800, r.Duration-1500))
	}
	lead := min(2200, delay*6/10)
	return &botPlan{At: now + delay, Text: text, TypingFrom: now + delay - lead}
}

// weightedPick chooses an unclaimed board answer, favouring the popular ones: a
// real opponent reaches for the obvious answer first.
func (e *Engine) weightedPick(r *RoundState) string {
	total := 0
	for i, t := range r.Tiles {
		if t.Kind == TileHidden {
			total += r.Def.Answers[i].Points
		}
	}
	if total <= 0 {
		return ""
	}
	roll := e.rng.IntN(total)
	for i, t := range r.Tiles {
		if t.Kind != TileHidden {
			continue
		}
		a := r.Def.Answers[i]
		roll -= a.Points
		if roll < 0 {
			// Answer in a player's words, not the board's: a bot that always
			// types the exact board label is obviously a bot.
			if len(a.Aliases) > 0 && e.rng.Float64() < 0.4 {
				return a.Aliases[e.rng.IntN(len(a.Aliases))]
			}
			return a.Text
		}
	}
	return ""
}
