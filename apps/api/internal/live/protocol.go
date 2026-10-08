package live

import "encoding/json"

// The wire protocol is JSON over a WebSocket. A phone sends small intentions
// ("I pressed start", "I locked this answer") and receives the whole state of
// the show each time it changes. Sending the whole state rather than a stream of
// changes is deliberate: a phone that drops for a few seconds, or misses a
// message on a bad network, is fully caught up by the next one.

// clientMsg is anything a phone can say.
type clientMsg struct {
	T string `json:"t"`

	Token  string `json:"token,omitempty"`  // hello
	Text   string `json:"text,omitempty"`   // lock
	C      int64  `json:"c,omitempty"`      // ping: the phone's clock, echoed back
	E      string `json:"e,omitempty"`      // react
	Choice string `json:"choice,omitempty"` // decide
	Level  string `json:"level,omitempty"`  // difficulty, against the computer
}

// RoomInfo is the part of the picture that belongs to the room, not the match.
type RoomInfo struct {
	Code       string       `json:"code"`
	Mode       string       `json:"mode"` // live | bot
	Me         int          `json:"me"`   // which seat this phone holds: 0 created the room
	Category   CategoryInfo `json:"category"`
	ShareCode  string       `json:"shareCode"`
	Rounds     int          `json:"rounds"`
	Difficulty string       `json:"difficulty"`
}

type CategoryInfo struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type stateMsg struct {
	T    string   `json:"t"`
	View View     `json:"v"`
	Room RoomInfo `json:"room"`
}

type pongMsg struct {
	T string `json:"t"`
	C int64  `json:"c"`
	S int64  `json:"s"`
}

type typingMsg struct {
	T     string `json:"t"`
	Until int64  `json:"until"`
}

type reactionMsg struct {
	T string `json:"t"`
	E string `json:"e"`
}

type errorMsg struct {
	T       string `json:"t"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type closedMsg struct {
	T      string `json:"t"`
	Reason string `json:"reason"`
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		// Every message type here is plain data; a failure is a programming error.
		panic("live: marshal: " + err.Error())
	}
	return b
}

func errMsg(code, message string) []byte {
	return mustJSON(errorMsg{T: "error", Code: code, Message: message})
}
