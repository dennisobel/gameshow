package voice

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// A pretend ElevenLabs, so these tests spend nothing and run anywhere.

const secretKey = "sk_test_THIS_MUST_NEVER_APPEAR_ANYWHERE_0123456789"

type fakeProvider struct {
	calls   atomic.Int32
	status  int
	delay   time.Duration
	lastReq atomic.Value // fakeRequest
	srv     *httptest.Server
}

type fakeRequest struct {
	Path   string
	Key    string
	Model  string
	Text   string
	Voice  map[string]any
	Accept string
}

func newProvider(t *testing.T) *fakeProvider {
	t.Helper()
	p := &fakeProvider{status: http.StatusOK}
	p.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.calls.Add(1)
		var body struct {
			Text     string         `json:"text"`
			ModelID  string         `json:"model_id"`
			Settings map[string]any `json:"voice_settings"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		p.lastReq.Store(fakeRequest{Path: r.URL.Path, Key: r.Header.Get("xi-api-key"), Model: body.ModelID, Text: body.Text, Voice: body.Settings, Accept: r.Header.Get("Accept")})
		time.Sleep(p.delay)
		if p.status != http.StatusOK {
			w.WriteHeader(p.status)
			// A provider error can quote the key back; the service must not repeat it.
			_, _ = io.WriteString(w, `{"detail":{"message":"invalid api key `+secretKey+`"}}`)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte(strings.Repeat("ID3audio-bytes-", 40)))
	}))
	t.Cleanup(p.srv.Close)
	return p
}

type memCache struct {
	mu      sync.Mutex
	lines   map[string][]byte
	spent   int
	puts    int
	failGet bool
}

func newMemCache() *memCache { return &memCache{lines: map[string][]byte{}} }

func (c *memCache) Get(_ context.Context, h string) ([]byte, bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	b, ok := c.lines[h]
	return b, ok, nil
}
func (c *memCache) Put(_ context.Context, e Entry) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lines[e.Hash] = e.Audio
	c.puts++
	return nil
}
func (c *memCache) Spent(context.Context) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.spent, nil
}
func (c *memCache) Spend(_ context.Context, n int) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.spent += n
	return nil
}

type logSink struct {
	mu  sync.Mutex
	buf strings.Builder
}

func (l *logSink) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.Write(p)
}
func (l *logSink) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.String()
}

func service(t *testing.T, p *fakeProvider, c *memCache, budget int) (*Service, *logSink) {
	t.Helper()
	sink := &logSink{}
	s := New(Config{APIKey: secretKey, BaseURL: p.srv.URL, DailyChars: budget}, c, slog.New(slog.NewTextHandler(sink, nil)))
	return s, sink
}

func TestALineIsPaidForOnceAndThenFree(t *testing.T) {
	p, c := newProvider(t), newMemCache()
	s, _ := service(t, p, c, 1000)
	req := Request{Text: "Welcome to On The Board!", Style: Quick, Personality: "funny"}

	first, err := s.Speak(context.Background(), req)
	if err != nil || first.Cached {
		t.Fatalf("first: cached=%v err=%v", first.Cached, err)
	}
	second, err := s.Speak(context.Background(), req)
	if err != nil || !second.Cached {
		t.Fatalf("second: cached=%v err=%v", second.Cached, err)
	}
	if p.calls.Load() != 1 {
		t.Fatalf("the provider was called %d times for one line", p.calls.Load())
	}
	if c.spent != len(req.Text) {
		t.Fatalf("spent %d characters, want %d", c.spent, len(req.Text))
	}
}

func TestTheSameWordsInADifferentDeliveryAreADifferentLine(t *testing.T) {
	p, c := newProvider(t), newMemCache()
	s, _ := service(t, p, c, 1000)
	for _, req := range []Request{
		{Text: "Round one.", Style: Quick, Personality: "funny"},
		{Text: "Round one.", Style: Quick, Personality: "dramatic"},
		{Text: "Round one.", Style: Show, Personality: "funny"},
	} {
		if _, err := s.Speak(context.Background(), req); err != nil {
			t.Fatal(err)
		}
	}
	if p.calls.Load() != 3 {
		t.Fatalf("three deliveries should be three lines, provider called %d times", p.calls.Load())
	}
}

func TestPlayersAskingForTheSameNewLineTogetherShareOneRequest(t *testing.T) {
	p, c := newProvider(t), newMemCache()
	p.delay = 150 * time.Millisecond
	s, _ := service(t, p, c, 1000)

	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Speak(context.Background(), Request{Text: "Final round. Triple points.", Style: Show}); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if p.calls.Load() != 1 {
		t.Fatalf("12 simultaneous requests made %d provider calls, want 1", p.calls.Load())
	}
}

func TestTheDailyBudgetStopsTheSpending(t *testing.T) {
	p, c := newProvider(t), newMemCache()
	s, _ := service(t, p, c, 30)

	if _, err := s.Speak(context.Background(), Request{Text: "twenty characters!!"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Speak(context.Background(), Request{Text: "this one would go over the limit"}); err != ErrBudget {
		t.Fatalf("over budget: got %v, want ErrBudget", err)
	}
	if p.calls.Load() != 1 {
		t.Fatalf("an over-budget line must not reach the provider; calls=%d", p.calls.Load())
	}
	// A line already paid for is still free after the budget is gone.
	if a, err := s.Speak(context.Background(), Request{Text: "twenty characters!!"}); err != nil || !a.Cached {
		t.Fatalf("cached line after budget spent: cached=%v err=%v", a.Cached, err)
	}
}

func TestProviderFailuresAreContainedAndNeverLeakTheKey(t *testing.T) {
	for _, status := range []int{401, 402, 422, 429, 500} {
		p, c := newProvider(t), newMemCache()
		p.status = status
		s, sink := service(t, p, c, 1000)

		_, err := s.Speak(context.Background(), Request{Text: "Anything at all"})
		if err != ErrUnavailable {
			t.Fatalf("status %d: got %v, want ErrUnavailable", status, err)
		}
		if strings.Contains(err.Error(), secretKey) {
			t.Fatalf("status %d: the error text contains the key", status)
		}
		if strings.Contains(sink.String(), secretKey) {
			t.Fatalf("status %d: the key reached the log: %s", status, sink.String())
		}
		if c.puts != 0 || c.spent != 0 {
			t.Fatalf("status %d: a failed line must cost nothing and be kept nowhere (puts=%d spent=%d)", status, c.puts, c.spent)
		}
	}
}

func TestNoKeyMeansSilentNotBroken(t *testing.T) {
	p, c := newProvider(t), newMemCache()
	s := New(Config{BaseURL: p.srv.URL}, c, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if s.Enabled() {
		t.Fatalf("enabled with no key")
	}
	if _, err := s.Speak(context.Background(), Request{Text: "Hello"}); err != ErrDisabled {
		t.Fatalf("got %v, want ErrDisabled", err)
	}
	if p.calls.Load() != 0 {
		t.Fatalf("a request was made with no key configured")
	}
}

func TestWhatIsSentToTheProvider(t *testing.T) {
	p, c := newProvider(t), newMemCache()
	s, _ := service(t, p, c, 1000)

	_, _ = s.Speak(context.Background(), Request{Text: "  Hello\n\tthere\x00  world  ", Style: Quick, Personality: "dramatic"})
	got := p.lastReq.Load().(fakeRequest)
	if got.Key != secretKey {
		t.Fatalf("the key must be sent as xi-api-key")
	}
	if got.Text != "Hello there world" {
		t.Fatalf("text = %q, want it tidied", got.Text)
	}
	if got.Model != "eleven_flash_v2_5" {
		t.Fatalf("a quick line should use the fast model, got %s", got.Model)
	}
	if !strings.HasSuffix(got.Path, "/"+DefaultVoiceID) {
		t.Fatalf("path = %s, want the default voice", got.Path)
	}
	if got.Voice["style"] != 0.7 {
		t.Fatalf("the dramatic host should perform harder: %v", got.Voice)
	}

	_, _ = s.Speak(context.Background(), Request{Text: "The final!", Style: Show})
	got = p.lastReq.Load().(fakeRequest)
	if got.Model != "eleven_turbo_v2_5" {
		t.Fatalf("a set-piece should use the fast model by default, got %s", got.Model)
	}
}

func TestTheExpressiveModelCanBeChosen(t *testing.T) {
	p, c := newProvider(t), newMemCache()
	s := New(Config{APIKey: secretKey, BaseURL: p.srv.URL, ShowModel: "eleven_v3", DailyChars: 1000}, c, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if _, err := s.Speak(context.Background(), Request{Text: "The final!", Style: Show, Personality: "dramatic"}); err != nil {
		t.Fatal(err)
	}
	got := p.lastReq.Load().(fakeRequest)
	if got.Model != "eleven_v3" {
		t.Fatalf("model = %s, want the one configured", got.Model)
	}
	if _, ok := got.Voice["style"]; ok {
		t.Fatalf("v3 does not take the v2 style controls: %v", got.Voice)
	}
}

func TestLongTextIsCutNotRejected(t *testing.T) {
	p, c := newProvider(t), newMemCache()
	s, _ := service(t, p, c, 100000)
	_, err := s.Speak(context.Background(), Request{Text: strings.Repeat("blah ", 200)})
	if err != nil {
		t.Fatal(err)
	}
	if n := len([]rune(p.lastReq.Load().(fakeRequest).Text)); n > MaxChars {
		t.Fatalf("sent %d characters, limit is %d", n, MaxChars)
	}
	if _, err := s.Speak(context.Background(), Request{Text: " \n\t "}); err != ErrBadText {
		t.Fatalf("blank text: got %v, want ErrBadText", err)
	}
}

func TestRedactHidesAnythingKeyShaped(t *testing.T) {
	in := `bad key sk_0231883ad21f21e4b3cbde and also sk-proj-AbC_123-xyz here`
	out := redact(in)
	if strings.Contains(out, "0231883") || strings.Contains(out, "AbC_123") {
		t.Fatalf("redact left a secret: %s", out)
	}
	if !strings.Contains(out, "[redacted]") {
		t.Fatalf("redact should say it removed something: %s", out)
	}
}
