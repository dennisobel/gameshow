package store

import "time"

type User struct {
	ID          string    `json:"id"`
	Email       *string   `json:"email,omitempty"`
	DisplayName string    `json:"displayName"`
	Avatar      int       `json:"avatar"`
	IsGuest     bool      `json:"isGuest"`
	Role        string    `json:"role"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Category struct {
	ID        string `json:"-"`
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	Tagline   string `json:"tagline"`
	Icon      string `json:"icon"`
	Accent    string `json:"accent"`
	Locale    string `json:"locale"`
	SortOrder int    `json:"-"`
	// Questions currently approved and playable in this category. Drives the
	// "ready to spin" state in the picker.
	QuestionCount int `json:"questionCount"`
}

type Answer struct {
	ID         string   `json:"id"`
	Rank       int      `json:"rank"`
	Text       string   `json:"text"`
	Points     int      `json:"points"`
	PanelCount int      `json:"panelCount"`
	Aliases    []string `json:"-"`
}

type Question struct {
	ID            string   `json:"id"`
	CategoryID    string   `json:"-"`
	CategorySlug  string   `json:"category,omitempty"`
	Prompt        string   `json:"prompt"`
	Difficulty    string   `json:"difficulty"`
	Status        string   `json:"status,omitempty"`
	Source        string   `json:"source,omitempty"`
	PanelSize     int      `json:"panelSize,omitempty"`
	PanelCoverage float64  `json:"panelCoverage,omitempty"`
	QualityScore  float64  `json:"qualityScore,omitempty"`
	Answers       []Answer `json:"answers,omitempty"`
}

type Game struct {
	ID          string    `json:"id"`
	ShareCode   string    `json:"code"`
	OwnerID     *string   `json:"-"`
	CategoryID  string    `json:"-"`
	Title       string    `json:"title"`
	Rounds      int       `json:"rounds"`
	Difficulty  string    `json:"difficulty"`
	Seed        int64     `json:"-"`
	QuestionIDs []string  `json:"-"`
	Plays       int       `json:"plays"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Match struct {
	ID        string     `json:"id"`
	GameID    string     `json:"gameId"`
	Status    string     `json:"status"`
	P1Name    string     `json:"p1Name"`
	P1Avatar  int        `json:"p1Avatar"`
	P1Score   int        `json:"p1Score"`
	P2Name    string     `json:"p2Name"`
	P2Avatar  int        `json:"p2Avatar"`
	P2Score   int        `json:"p2Score"`
	P2IsBot   bool       `json:"p2IsBot"`
	Winner    *int       `json:"winner"`
	StartedAt time.Time  `json:"startedAt"`
	Finished  *time.Time `json:"finishedAt"`
}

// ReviewAnswer is a board slot as an editor sees it, aliases included.
//
// Answer deliberately hides its aliases from JSON so that no gameplay response
// can leak what the board will accept. An editor deciding whether to approve a
// question has to see exactly that, so the review queue has its own type.
type ReviewAnswer struct {
	Rank       int      `json:"rank"`
	Text       string   `json:"text"`
	Points     int      `json:"points"`
	PanelCount int      `json:"panelCount"`
	Aliases    []string `json:"aliases"`
}

// ReviewItem is a generated question awaiting a human decision.
type ReviewItem struct {
	Question
	Board        []ReviewAnswer `json:"board"`
	JudgeScores  map[string]any `json:"judgeScores"`
	ReviewNote   string         `json:"reviewNote"`
	GenerationID *string        `json:"generationId"`
	CreatedAt    time.Time      `json:"createdAt"`
}
