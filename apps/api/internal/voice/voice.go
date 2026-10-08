// Package voice gives the host a voice.
//
// Text goes in; speech comes out of ElevenLabs, and is kept. The key never
// leaves this process: browsers ask the API for a line and get audio back, so
// there is nothing in a page's source or network traffic worth stealing.
//
// Three things keep it cheap and safe:
//
//   - every line is cached by a hash of what shapes the audio, so a line is paid
//     for once however many players hear it;
//   - concurrent requests for the same line share one call to the provider;
//   - a daily character budget stops one session, or one bad actor, spending a
//     whole plan. When it is spent the caller gets ErrBudget and the app falls
//     back to the browser's own voice.
package voice

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/sync/singleflight"
)

var (
	// ErrDisabled means no key is configured, so the host stays silent here and
	// the browser's voice is used instead.
	ErrDisabled = errors.New("voice is not configured")
	// ErrBudget means today's allowance of characters is used up.
	ErrBudget = errors.New("today's voice budget is used up")
	// ErrUnavailable is any failure on the provider's side: bad plan, rate limit,
	// network. The detail is logged, never returned, as it may mention the key.
	ErrUnavailable = errors.New("the voice service is unavailable")
	// ErrBadText is a request that cannot be spoken.
	ErrBadText = errors.New("nothing to say")
)

// MaxChars bounds one line. The longest real line is a question plus the host's
// introduction, comfortably under this.
const MaxChars = 280

// Style says how a line should be delivered: "show" for the set pieces
// (welcome, the final, the winner), "quick" for everything said mid-round.
type Style string

const (
	Show  Style = "show"
	Quick Style = "quick"
)

type Config struct {
	APIKey     string
	VoiceID    string
	QuickModel string
	ShowModel  string
	// DailyChars is the most characters sent to the provider in a day.
	DailyChars int
	BaseURL    string
	Timeout    time.Duration
}

// DefaultVoiceID is "Adam", which every ElevenLabs plan can use. Other voices
// from the library need a paid plan.
const DefaultVoiceID = "pNInz6obpgDQGcFmaJgB"

func (c *Config) defaults() {
	if c.VoiceID == "" {
		c.VoiceID = DefaultVoiceID
	}
	if c.QuickModel == "" {
		c.QuickModel = "eleven_flash_v2_5"
	}
	// Turbo, not v3: v3 is more expressive but took about five seconds to speak a
	// single sentence when measured, which is too slow to land with the screen in a
	// live show, and it costs twice as much per character. Set ShowModel to
	// "eleven_v3" to trade speed for performance.
	if c.ShowModel == "" {
		c.ShowModel = "eleven_turbo_v2_5"
	}
	if c.DailyChars == 0 {
		c.DailyChars = 2500
	}
	if c.BaseURL == "" {
		c.BaseURL = "https://api.elevenlabs.io"
	}
	if c.Timeout == 0 {
		c.Timeout = 12 * time.Second
	}
}

// Entry is one cached line.
type Entry struct {
	Hash        string
	Voice       string
	Model       string
	Personality string
	Text        string
	Audio       []byte
}

// Cache is where finished lines and the day's spend are kept.
type Cache interface {
	Get(ctx context.Context, hash string) ([]byte, bool, error)
	Put(ctx context.Context, e Entry) error
	Spent(ctx context.Context) (int, error)
	Spend(ctx context.Context, chars int) error
}

type Service struct {
	cfg   Config
	cache Cache
	http  *http.Client
	log   *slog.Logger
	group singleflight.Group
	// The free plan allows two requests at once; asking for more just earns a
	// 429, so the service keeps itself inside that.
	slots chan struct{}
}

func New(cfg Config, cache Cache, log *slog.Logger) *Service {
	cfg.defaults()
	return &Service{
		cfg: cfg, cache: cache, log: log,
		http:  &http.Client{Timeout: cfg.Timeout},
		slots: make(chan struct{}, 2),
	}
}

// Enabled reports whether a key is configured.
func (s *Service) Enabled() bool { return s.cfg.APIKey != "" }

// Request is one line to say.
type Request struct {
	Text        string
	Style       Style
	Personality string
}

// Audio is a finished line.
type Audio struct {
	MP3    []byte
	Cached bool
}

// clean tidies text into what is sent: no stray whitespace, no control
// characters, a sane length. It returns "" for nothing worth saying.
func clean(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '\n' || r == '\t' || r == '\r':
			b.WriteByte(' ')
		case r < 0x20 || r == 0x7f:
		default:
			b.WriteRune(r)
		}
	}
	s = strings.Join(strings.Fields(b.String()), " ")
	if utf8.RuneCountInString(s) > MaxChars {
		s = string([]rune(s)[:MaxChars])
	}
	return s
}

func (s *Service) model(style Style) string {
	if style == Show {
		return s.cfg.ShowModel
	}
	return s.cfg.QuickModel
}

func (s *Service) hash(model, personality, text string) string {
	sum := sha256.Sum256([]byte(s.cfg.VoiceID + "\x00" + model + "\x00" + personality + "\x00" + text))
	return hex.EncodeToString(sum[:])
}

// Speak returns the audio for a line, from the cache if it has been said before.
func (s *Service) Speak(ctx context.Context, req Request) (Audio, error) {
	if !s.Enabled() {
		return Audio{}, ErrDisabled
	}
	text := clean(req.Text)
	if text == "" {
		return Audio{}, ErrBadText
	}
	model := s.model(req.Style)
	hash := s.hash(model, req.Personality, text)

	if mp3, ok, err := s.cache.Get(ctx, hash); err == nil && ok {
		return Audio{MP3: mp3, Cached: true}, nil
	} else if err != nil {
		s.log.Warn("voice cache read failed", "err", err)
	}

	// Everyone asking for the same new line at once shares one paid request.
	v, err, _ := s.group.Do(hash, func() (any, error) {
		chars := utf8.RuneCountInString(text)
		spent, err := s.cache.Spent(ctx)
		if err != nil {
			s.log.Warn("voice usage read failed", "err", err)
		} else if spent+chars > s.cfg.DailyChars {
			return nil, ErrBudget
		}

		mp3, err := s.synthesise(ctx, model, req.Personality, text)
		if err != nil {
			return nil, err
		}
		// Keeping the line is what makes it free next time; failing to is not
		// worth failing the player's request over.
		if err := s.cache.Put(context.WithoutCancel(ctx), Entry{
			Hash: hash, Voice: s.cfg.VoiceID, Model: model, Personality: req.Personality, Text: text, Audio: mp3,
		}); err != nil {
			s.log.Warn("voice cache write failed", "err", err)
		}
		if err := s.cache.Spend(context.WithoutCancel(ctx), chars); err != nil {
			s.log.Warn("voice usage write failed", "err", err)
		}
		return mp3, nil
	})
	if err != nil {
		return Audio{}, err
	}
	return Audio{MP3: v.([]byte)}, nil
}

// settings shapes the delivery for a personality. Lower stability and higher
// style make a performance; these are the livelier ends for the host who is
// meant to be having more fun than anyone.
func settings(model, personality string) map[string]any {
	// Version 3 takes stability in coarse steps and ignores the rest.
	if strings.Contains(model, "v3") {
		return map[string]any{"stability": 0.5}
	}
	stability, style := 0.4, 0.45
	switch personality {
	case "dramatic":
		stability, style = 0.3, 0.7
	case "sarcastic":
		stability, style = 0.5, 0.4
	case "friendly":
		stability, style = 0.5, 0.3
	case "funny":
		stability, style = 0.35, 0.55
	}
	return map[string]any{
		"stability":         stability,
		"similarity_boost":  0.8,
		"style":             style,
		"use_speaker_boost": true,
	}
}

func (s *Service) synthesise(ctx context.Context, model, personality, text string) ([]byte, error) {
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-ctx.Done():
		return nil, ErrUnavailable
	}

	body, _ := json.Marshal(map[string]any{
		"text":           text,
		"model_id":       model,
		"voice_settings": settings(model, personality),
	})
	url := fmt.Sprintf("%s/v1/text-to-speech/%s?output_format=mp3_44100_64", strings.TrimRight(s.cfg.BaseURL, "/"), s.cfg.VoiceID)
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, ErrUnavailable
	}
	r.Header.Set("xi-api-key", s.cfg.APIKey)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept", "audio/mpeg")

	resp, err := s.http.Do(r)
	if err != nil {
		// The error text can include the request URL but never the key, which
		// travels in a header; it is still kept out of the response.
		s.log.Warn("voice request failed", "err", err)
		return nil, ErrUnavailable
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode != http.StatusOK {
		s.log.Warn("voice provider refused", "status", resp.StatusCode, "body", snippet(data))
		return nil, ErrUnavailable
	}
	if len(data) < 256 {
		s.log.Warn("voice provider returned too little audio", "bytes", len(data))
		return nil, ErrUnavailable
	}
	return data, nil
}

// snippet is a short, key-safe excerpt of a provider's error body for the log.
func snippet(b []byte) string {
	s := strings.Join(strings.Fields(string(b)), " ")
	if len(s) > 200 {
		s = s[:200]
	}
	return redact(s)
}

// redact removes anything shaped like a secret key from text bound for a log.
func redact(s string) string {
	for _, prefix := range []string{"sk_", "sk-"} {
		for {
			i := strings.Index(s, prefix)
			if i < 0 {
				break
			}
			j := i + len(prefix)
			for j < len(s) && (s[j] == '_' || s[j] == '-' || (s[j] >= '0' && s[j] <= '9') || (s[j] >= 'a' && s[j] <= 'z') || (s[j] >= 'A' && s[j] <= 'Z')) {
				j++
			}
			s = s[:i] + "[redacted]" + s[j:]
		}
	}
	return s
}
