package httpx

import (
	"bufio"
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dennisobel/gameshow/apps/api/internal/aiclient"
	"github.com/dennisobel/gameshow/apps/api/internal/auth"
	"github.com/dennisobel/gameshow/apps/api/internal/config"
	"github.com/dennisobel/gameshow/apps/api/internal/live"
	"github.com/dennisobel/gameshow/apps/api/internal/store"
	"github.com/dennisobel/gameshow/apps/api/internal/voice"
)

type Server struct {
	cfg    config.Config
	store  *store.Store
	issuer *auth.Issuer
	ai     *aiclient.Client
	log    *slog.Logger
	mux    *http.ServeMux
	hub    *live.Hub
	voice  *voice.Service
}

func New(cfg config.Config, st *store.Store, log *slog.Logger) *Server {
	s := &Server{
		cfg:    cfg,
		store:  st,
		issuer: auth.NewIssuer(cfg.JWTSecret, cfg.AccessTokenTTL, cfg.RefreshTokenTTL),
		ai:     aiclient.New(cfg.AIServiceURL, cfg.AIServiceToken),
		log:    log,
		mux:    http.NewServeMux(),
	}
	timings, speed := live.TimingsFromEnv()
	if speed != 1 {
		log.Warn("LIVE_SPEED is set: the show runs at a different pace. Testing only.", "speed", speed)
	}
	s.hub = live.NewHub(livePersister{st: st}, timings, log)
	s.voice = voice.New(voice.Config{
		APIKey:     cfg.ElevenLabsKey,
		VoiceID:    cfg.ElevenLabsVoice,
		QuickModel: cfg.VoiceQuickModel,
		ShowModel:  cfg.VoiceShowModel,
		DailyChars: cfg.VoiceDailyChars,
	}, voiceCache{st: st}, log)
	if !s.voice.Enabled() {
		log.Info("no ElevenLabs key set: the host will use the browser's voice")
	}
	s.routes()
	return s
}

// Run does the server's background work (sweeping away abandoned rooms) until ctx
// ends, then closes every open room.
func (s *Server) Run(ctx context.Context) { s.hub.Run(ctx) }

func (s *Server) routes() {
	m := s.mux

	m.HandleFunc("GET /healthz", s.handleHealth)
	m.HandleFunc("GET /readyz", s.handleReady)

	// Auth. Rate limited: these are the endpoints worth attacking.
	m.Handle("POST /v1/auth/guest", s.rateLimit(20, time.Minute)(http.HandlerFunc(s.handleGuest)))
	m.Handle("POST /v1/auth/register", s.rateLimit(10, time.Minute)(http.HandlerFunc(s.handleRegister)))
	m.Handle("POST /v1/auth/login", s.rateLimit(10, time.Minute)(http.HandlerFunc(s.handleLogin)))
	m.Handle("POST /v1/auth/refresh", s.rateLimit(60, time.Minute)(http.HandlerFunc(s.handleRefresh)))
	m.HandleFunc("POST /v1/auth/logout", s.handleLogout)

	m.Handle("GET /v1/me", s.authed(http.HandlerFunc(s.handleMe)))
	m.Handle("PATCH /v1/me", s.authed(http.HandlerFunc(s.handleUpdateMe)))
	m.Handle("GET /v1/me/games", s.authed(http.HandlerFunc(s.handleMyGames)))

	m.HandleFunc("GET /v1/categories", s.handleCategories)

	// Spin and play.
	m.Handle("POST /v1/games", s.authed(http.HandlerFunc(s.handleSpin)))
	m.HandleFunc("GET /v1/games/{code}", s.handleGameByCode)

	// Live rooms. The match itself runs on the server and is played over a
	// WebSocket; these endpoints only open a room and seat players in it.
	m.Handle("POST /v1/rooms", s.rateLimit(20, time.Minute)(s.authed(http.HandlerFunc(s.handleCreateRoom))))
	m.Handle("GET /v1/rooms/{code}", s.rateLimit(60, time.Minute)(http.HandlerFunc(s.handleRoomPeek)))
	m.Handle("POST /v1/rooms/{code}/join", s.rateLimit(30, time.Minute)(s.authed(http.HandlerFunc(s.handleRoomJoin))))
	m.HandleFunc("GET /v1/rooms/{code}/ws", s.handleRoomSocket)

	// The host's voice. Authenticated and rate limited: every miss is paid for.
	m.HandleFunc("GET /v1/voice/status", s.handleVoiceStatus)
	m.Handle("GET /v1/voice", s.rateLimit(90, time.Minute)(s.authed(http.HandlerFunc(s.handleVoice))))

	m.HandleFunc("GET /v1/leaderboard", s.handleLeaderboard)
	m.Handle("POST /v1/feedback", s.authed(http.HandlerFunc(s.handleFeedback)))

	// Editors and admins only.
	m.Handle("GET /v1/admin/review", s.requireRole("editor", "admin")(http.HandlerFunc(s.handleReviewQueue)))
	m.Handle("POST /v1/admin/review/{id}", s.requireRole("editor", "admin")(http.HandlerFunc(s.handleReviewDecision)))
	m.Handle("POST /v1/admin/generate", s.requireRole("editor", "admin")(http.HandlerFunc(s.handleGenerate)))
	m.Handle("GET /v1/admin/generations", s.requireRole("editor", "admin")(http.HandlerFunc(s.handleGenerations)))
}

// Handler wraps the router in the middleware every request needs.
func (s *Server) Handler() http.Handler {
	return s.recoverPanics(s.requestLog(s.cors(s.mux)))
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.store.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded", "database": "unreachable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "database": "ok"})
}

// ------------------------------------------------------------- middleware

func (s *Server) cors(next http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, o := range s.cfg.CORSOrigins {
		allowed[o] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && allowed[origin] {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			h.Set("Access-Control-Max-Age", "600")
			h.Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

// Unwrap, Hijack and Flush let a WebSocket upgrade or a stream pass through the
// logging wrapper; without them the wrapper would make both impossible.
func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("hijacking is not supported")
	}
	return h.Hijack()
}

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytes += n
	return n, err
}

func (s *Server) requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		if sw.status == 0 {
			sw.status = http.StatusOK
		}
		level := slog.LevelInfo
		if sw.status >= 500 {
			level = slog.LevelError
		}
		s.log.Log(r.Context(), level, "request",
			"method", r.Method, "path", r.URL.Path, "status", sw.status,
			"ms", time.Since(start).Milliseconds(), "bytes", sw.bytes)
	})
}

func (s *Server) recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				s.log.Error("panic", "err", rec, "path", r.URL.Path, "stack", string(debug.Stack()))
				writeError(w, http.StatusInternalServerError, "internal", "Something went wrong on our side.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// rateLimit is a per-IP fixed window. In-memory and per-process: enough to blunt
// credential stuffing from one host, not a substitute for an edge limiter.
func (s *Server) rateLimit(limit int, window time.Duration) func(http.Handler) http.Handler {
	type bucket struct {
		count int
		reset time.Time
	}
	var mu sync.Mutex
	buckets := map[string]*bucket{}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := clientIP(r)
			now := time.Now()

			mu.Lock()
			b, ok := buckets[ip]
			if !ok || now.After(b.reset) {
				b = &bucket{reset: now.Add(window)}
				buckets[ip] = b
			}
			b.count++
			count, reset := b.count, b.reset
			if len(buckets) > 10_000 { // bound memory: drop everything expired
				for k, v := range buckets {
					if now.After(v.reset) {
						delete(buckets, k)
					}
				}
			}
			mu.Unlock()

			if count > limit {
				w.Header().Set("Retry-After", strconv.Itoa(int(time.Until(reset).Seconds())+1))
				writeError(w, http.StatusTooManyRequests, "rate_limited", "Too many attempts. Try again shortly.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func clientIP(r *http.Request) string {
	// Trust X-Forwarded-For only for its first entry, and only because this
	// service is expected to sit behind the nginx in web.Dockerfile.
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i > 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	host := r.RemoteAddr
	if i := strings.LastIndexByte(host, ':'); i > 0 {
		host = host[:i]
	}
	return host
}
