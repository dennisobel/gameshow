package httpx

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"unicode/utf8"

	"github.com/dennisobel/gameshow/apps/api/internal/store"
	"github.com/dennisobel/gameshow/apps/api/internal/voice"
)

// voiceCache adapts the store to what the voice service keeps its lines in.
type voiceCache struct{ st *store.Store }

func (c voiceCache) Get(ctx context.Context, hash string) ([]byte, bool, error) {
	return c.st.VoiceGet(ctx, hash)
}

func (c voiceCache) Put(ctx context.Context, e voice.Entry) error {
	return c.st.VoicePut(ctx, e.Hash, e.Voice, e.Model, e.Personality, e.Text, e.Audio, utf8.RuneCountInString(e.Text))
}

func (c voiceCache) Spent(ctx context.Context) (int, error) { return c.st.VoiceSpent(ctx) }
func (c voiceCache) Spend(ctx context.Context, n int) error { return c.st.VoiceSpend(ctx, n) }

var personalities = map[string]bool{"funny": true, "dramatic": true, "sarcastic": true, "friendly": true}

// handleVoice says a line in the host's voice and returns it as audio.
//
// A failure here is never fatal to the game: the browser falls back to its own
// speech, so every error is a plain status the app already knows how to take.
func (s *Server) handleVoice(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	style := voice.Quick
	if q.Get("style") == "show" {
		style = voice.Show
	}
	p := q.Get("p")
	if !personalities[p] {
		p = ""
	}

	audio, err := s.voice.Speak(r.Context(), voice.Request{Text: q.Get("text"), Style: style, Personality: p})
	switch {
	case err == nil:
	case errors.Is(err, voice.ErrDisabled):
		writeError(w, http.StatusServiceUnavailable, "voice_disabled", "The host's voice is not set up.")
		return
	case errors.Is(err, voice.ErrBudget):
		writeError(w, http.StatusTooManyRequests, "voice_budget", "The host has used today's voice allowance.")
		return
	case errors.Is(err, voice.ErrBadText):
		writeError(w, http.StatusBadRequest, "bad_text", "Nothing to say.")
		return
	case errors.Is(err, voice.ErrUnavailable):
		writeError(w, http.StatusBadGateway, "voice_unavailable", "The host's voice is unavailable right now.")
		return
	default:
		s.log.Error("voice", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "Something went wrong on our side.")
		return
	}

	h := w.Header()
	h.Set("Content-Type", "audio/mpeg")
	h.Set("Content-Length", strconv.Itoa(len(audio.MP3)))
	h.Set("Cache-Control", "private, max-age=86400")
	if audio.Cached {
		h.Set("X-Voice-Cache", "hit")
	} else {
		h.Set("X-Voice-Cache", "miss")
	}
	_, _ = w.Write(audio.MP3)
}

// handleVoiceStatus lets the app skip asking when the voice is switched off.
func (s *Server) handleVoiceStatus(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"enabled": s.voice.Enabled()}
	if s.voice.Enabled() {
		if spent, err := s.store.VoiceSpent(r.Context()); err == nil {
			out["remaining"] = max(0, s.cfg.VoiceDailyChars-spent)
		}
	}
	writeJSON(w, http.StatusOK, out)
}
