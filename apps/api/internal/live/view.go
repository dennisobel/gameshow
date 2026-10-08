package live

// What a phone is told.
//
// The engine knows everything: the whole board, both locked answers, who is
// typing. A View is the part one player is allowed to know. Three rules shape it:
//
//  1. The viewer is always player 0. Each player sees themselves on the left, so
//     the view swaps the seats for whoever is at seat 1. Nothing in the browser
//     has to know which seat it holds.
//  2. A board slot's text is withheld until it is earned or the round closes.
//  3. The other player's locked answer is just "locked" until the reveal. They
//     can see you are typing, and that you locked in. Never what you wrote.
//
// Those rules are the whole point of running the match on a server, so they are
// tested directly (view_test.go) rather than assumed.

type PlayerView struct {
	Name       string `json:"name"`
	Avatar     int    `json:"avatar"`
	Score      int    `json:"score"`
	Streak     int    `json:"streak"`
	FreezeUsed bool   `json:"freezeUsed"`
}

type AnswerView struct {
	Text    string   `json:"text"`
	Points  int      `json:"points"`
	Aliases []string `json:"aliases"`
}

type QuestionView struct {
	ID      string       `json:"id"`
	Prompt  string       `json:"prompt"`
	Answers []AnswerView `json:"answers"`
	Decoys  []string     `json:"decoys"`
}

type DefView struct {
	Kind       string       `json:"kind"`
	Multiplier int          `json:"multiplier"`
	Seconds    int          `json:"seconds"`
	Question   QuestionView `json:"question"`
}

type SubView struct {
	Player int    `json:"player"`
	Text   string `json:"text"`
	At     int64  `json:"at"`
	Match  *int   `json:"match"`
	Steal  bool   `json:"steal"`
}

type TileView struct {
	Kind   TileKind `json:"kind"`
	By     *int     `json:"by"`
	Points int      `json:"points"`
}

type RoundView struct {
	Def         DefView    `json:"def"`
	Number      int        `json:"number"`
	Phase       Phase      `json:"phase"`
	PhaseStart  int64      `json:"phaseStart"`
	NextAt      *int64     `json:"nextAt"`
	StartedAt   int64      `json:"startedAt"`
	Deadline    *int64     `json:"deadline"`
	Duration    int64      `json:"duration"`
	FrozenAt    *int64     `json:"frozenAt"`
	Subs        []SubView  `json:"subs"`
	Current     *SubView   `json:"current"`
	IsSteal     bool       `json:"isSteal"`
	StealBy     *int       `json:"stealBy"`
	StealOpen   bool       `json:"stealOpen"`
	Tiles       []TileView `json:"tiles"`
	Struck      []int      `json:"struck"`
	Winner      *int       `json:"winner"`
	Awarded     int        `json:"awarded"`
	StreakBonus bool       `json:"streakBonus"`
	// When each player's "typing" signal runs out, and for the computer, when
	// it starts. Both are server times; zero means not typing.
	TypingUntil [2]int64 `json:"typingUntil"`
	TypingFrom  [2]int64 `json:"typingFrom"`
}

type RecordView struct {
	Number int    `json:"number"`
	Kind   string `json:"kind"`
	Winner *int   `json:"winner"`
	Points int    `json:"points"`
	Answer string `json:"answer"`
	Stolen bool   `json:"stolen"`
}

type HostView struct {
	Event string         `json:"event"`
	Vars  map[string]any `json:"vars"`
	Mood  string         `json:"mood"`
	Key   int            `json:"key"`
}

type FxView struct {
	ID   int    `json:"id"`
	Kind string `json:"kind"`
	Name string `json:"name"`
}

type DeltaView struct {
	Player int `json:"player"`
	Points int `json:"points"`
	Key    int `json:"key"`
}

type DeckView struct {
	Kind       string `json:"kind"`
	Multiplier int    `json:"multiplier"`
	Seconds    int    `json:"seconds"`
	Top        int    `json:"top"`
}

type PauseView struct {
	Reason string `json:"reason"` // manual | disconnect
	// Who is missing, as the viewer counts seats, for a disconnect.
	Seat     int   `json:"seat"`
	Until    int64 `json:"until"`
	Decision bool  `json:"decision"`
}

// View is the whole state of the show as one player sees it.
type View struct {
	Seq         int64         `json:"seq"`
	Now         int64         `json:"now"`
	Screen      Screen        `json:"screen"`
	Players     [2]PlayerView `json:"players"`
	Controllers [2]string     `json:"controllers"`
	Seated      [2]bool       `json:"seated"`
	Connected   [2]bool       `json:"connected"`
	RoundIndex  int           `json:"roundIndex"`
	Sudden      int           `json:"sudden"`
	Round       *RoundView    `json:"round"`
	History     []RecordView  `json:"history"`
	Host        HostView      `json:"host"`
	Fx          []FxView      `json:"fx"`
	FxSeq       int           `json:"fxSeq"`
	Deck        []DeckView    `json:"deck"`
	Delta       *DeltaView    `json:"delta"`
	Outcome     any           `json:"outcome"`
	Paused      bool          `json:"paused"`
	PausedAt    *int64        `json:"pausedAt"`
	Pause       *PauseView    `json:"pause"`
	Rematch     [2]bool       `json:"rematch"`
}

func ptr[T any](v T) *T { return &v }

func nullable(v int64) *int64 {
	if v == 0 {
		return nil
	}
	return ptr(v)
}

// View renders the state for the player at `viewer`.
func (e *Engine) View(viewer int, now int64) View {
	// seat -> position in this viewer's picture: the viewer is always first.
	m := func(seat int) int {
		if viewer == 1 {
			return 1 - seat
		}
		return seat
	}
	mp := func(seat int) *int {
		if seat < 0 {
			return nil
		}
		return ptr(m(seat))
	}

	v := View{
		Now:        now,
		Screen:     e.screen,
		RoundIndex: e.roundIndex,
		Sudden:     e.sudden,
		FxSeq:      e.fxSeq,
		Paused:     e.paused,
		Host: HostView{
			Event: e.host[viewer].Event, Vars: e.host[viewer].Vars,
			Mood: e.host[viewer].Mood, Key: e.host[viewer].Key,
		},
		History: []RecordView{},
		Fx:      []FxView{},
		Deck:    []DeckView{},
	}
	if v.Host.Vars == nil {
		v.Host.Vars = map[string]any{}
	}

	for seat := 0; seat < 2; seat++ {
		p := e.players[seat]
		i := m(seat)
		v.Players[i] = PlayerView{Name: p.Name, Avatar: p.Avatar, Score: p.Score, Streak: p.Streak, FreezeUsed: p.FreezeUsed}
		v.Controllers[i] = "bot"
		if e.human[seat] || !e.seated[seat] {
			v.Controllers[i] = "human"
		}
		v.Seated[i] = e.seated[seat]
		v.Connected[i] = e.connected[seat]
		v.Rematch[i] = e.rematch[seat]
	}

	for _, f := range e.fx {
		v.Fx = append(v.Fx, FxView{ID: f.ID, Kind: f.Kind, Name: f.Name})
	}
	for _, h := range e.history {
		v.History = append(v.History, RecordView{
			Number: h.Number, Kind: h.Kind, Winner: mp(h.Winner), Points: h.Points, Answer: h.Answer, Stolen: h.Stolen,
		})
	}
	for _, r := range e.deck.Rounds {
		top := 0
		if len(r.Answers) > 0 {
			top = r.Answers[0].Points * r.Multiplier
		}
		v.Deck = append(v.Deck, DeckView{Kind: r.Kind, Multiplier: r.Multiplier, Seconds: r.Seconds, Top: top})
	}
	if e.delta != nil {
		v.Delta = &DeltaView{Player: m(e.delta.Player), Points: e.delta.Points, Key: e.delta.Key}
	}
	switch e.outcome {
	case outcomeNone:
	case outcomeDraw:
		v.Outcome = "draw"
	default:
		v.Outcome = m(e.outcome)
	}
	if e.paused {
		v.PausedAt = ptr(e.pausedAt)
		pv := &PauseView{Reason: e.pauseReason}
		if e.pauseReason == pauseDisconnect {
			pv.Seat = m(e.pausedBy)
			pv.Until = e.graceUntil
			// Only the player who stayed is asked to decide.
			pv.Decision = e.decision && viewer != e.pausedBy
		}
		v.Pause = pv
	}

	if e.screen == ScreenRound && e.round != nil {
		v.Round = e.roundView(viewer, m, mp)
	}
	return v
}

func (e *Engine) roundView(viewer int, m func(int) int, mp func(int) *int) *RoundView {
	r := e.round

	subView := func(s *Sub) SubView {
		// The other player's text stays hidden until it is revealed.
		text := ""
		if s.Seat == viewer || s.Revealed {
			text = s.Text
		}
		var match *int
		if s.Revealed && s.Match >= 0 {
			match = ptr(s.Match)
		}
		return SubView{Player: m(s.Seat), Text: text, At: s.At, Match: match, Steal: s.Steal}
	}

	rv := &RoundView{
		Number:      r.Number,
		Phase:       r.Phase,
		PhaseStart:  r.PhaseStart,
		NextAt:      nullable(r.NextAt),
		StartedAt:   r.StartedAt,
		Deadline:    nullable(r.Deadline),
		Duration:    r.Duration,
		FrozenAt:    nullable(r.FrozenAt),
		IsSteal:     r.IsSteal,
		StealBy:     mp(r.StealBy),
		StealOpen:   r.StealOpen,
		Winner:      mp(r.Winner),
		Awarded:     r.Awarded,
		StreakBonus: r.StreakBonus,
		Subs:        []SubView{},
		Tiles:       make([]TileView, len(r.Tiles)),
		Struck:      []int{},
	}
	for _, s := range r.Subs {
		rv.Subs = append(rv.Subs, subView(s))
	}
	if r.Current != nil {
		cv := subView(r.Current)
		rv.Current = &cv
	}
	for _, s := range r.Struck {
		rv.Struck = append(rv.Struck, m(s))
	}
	for seat := 0; seat < 2; seat++ {
		rv.TypingUntil[m(seat)] = r.TypingUntil[seat]
		if p := r.bot[seat]; p != nil && !r.hasSub(seat) {
			rv.TypingFrom[m(seat)] = p.TypingFrom
			rv.TypingUntil[m(seat)] = p.At
		}
	}

	answers := make([]AnswerView, len(r.Def.Answers))
	for i, a := range r.Def.Answers {
		t := r.Tiles[i]
		text := ""
		if t.Kind != TileHidden {
			text = a.Text
		}
		answers[i] = AnswerView{Text: text, Points: a.Points, Aliases: []string{}}
		rv.Tiles[i] = TileView{Kind: t.Kind, By: mp(t.By), Points: t.Points}
	}
	rv.Def = DefView{
		Kind: r.Def.Kind, Multiplier: r.Def.Multiplier, Seconds: r.Def.Seconds,
		Question: QuestionView{ID: r.Def.QuestionID, Prompt: r.Def.Prompt, Answers: answers, Decoys: []string{}},
	}
	return rv
}
