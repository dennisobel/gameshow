// Command api is the On The Board HTTP service.
//
// Flags let the same binary run one-off tasks, so compose and the Makefile do
// not need a second image:
//
//	api              serve
//	api -migrate     apply migrations and exit
//	api -seed        load the seed bank and exit
//	api -healthcheck probe the local server and exit (used by the container healthcheck)
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/dennisobel/gameshow/apps/api/internal/config"
	"github.com/dennisobel/gameshow/apps/api/internal/httpx"
	"github.com/dennisobel/gameshow/apps/api/internal/seed"
	"github.com/dennisobel/gameshow/apps/api/internal/store"
)

func main() {
	var (
		doMigrate = flag.Bool("migrate", false, "apply database migrations and exit")
		doSeed    = flag.Bool("seed", false, "load the seed question bank and exit")
		doHealth  = flag.Bool("healthcheck", false, "probe the local server and exit")
	)
	flag.Parse()

	if *doHealth {
		os.Exit(healthcheck())
	}

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "config:", err)
		os.Exit(1)
	}
	log := newLogger(cfg.LogLevel)
	if cfg.UsingDevSecret {
		log.Warn("JWT_SECRET is the public development default, so anyone can forge a login token (including an editor's). Set your own before this is reachable from the internet: openssl rand -hex 32")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := openStoreWithRetry(ctx, cfg.DatabaseURL, log)
	if err != nil {
		log.Error("database unavailable", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	if *doMigrate || cfg.RunMigrations {
		if err := st.Migrate(ctx, log); err != nil {
			log.Error("migrate", "err", err)
			os.Exit(1)
		}
		if *doMigrate {
			log.Info("migrations applied")
			return
		}
	}

	// Games live in memory, so none can still be in progress at start-up.
	if n, err := st.AbandonStaleMatches(ctx); err != nil {
		log.Warn("could not close stale matches", "err", err)
	} else if n > 0 {
		log.Info("marked matches from before the restart as abandoned", "count", n)
	}

	if *doSeed || cfg.SeedOnStart {
		if _, err := seed.Load(ctx, st.Pool(), log); err != nil {
			// A bad seed file should not keep the service down: an existing bank
			// is still playable.
			log.Error("seed", "err", err)
			if *doSeed {
				os.Exit(1)
			}
		}
		if *doSeed {
			return
		}
	}

	api := httpx.New(cfg, st, log)
	runCtx, stopRun := context.WithCancel(context.WithoutCancel(ctx))
	runDone := make(chan struct{})
	go func() {
		defer close(runDone)
		api.Run(runCtx)
	}()

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           api.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       90 * time.Second,
	}

	go func() {
		log.Info("listening", "addr", cfg.HTTPAddr, "env", cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("serve", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("shutdown", "err", err)
	}
	// Tell everyone in an open game the server is going away, rather than
	// letting their sockets simply stop answering.
	stopRun()
	<-runDone
}

// openStoreWithRetry waits for Postgres. Compose orders startup by healthcheck,
// but a database that is still replaying WAL can accept and then drop the first
// connections, and a restart loop is a worse answer than waiting.
func openStoreWithRetry(ctx context.Context, url string, log *slog.Logger) (*store.Store, error) {
	var lastErr error
	for attempt := 1; attempt <= 30; attempt++ {
		st, err := store.Open(ctx, url)
		if err == nil {
			if err = st.Ping(ctx); err == nil {
				return st, nil
			}
			st.Close()
		}
		lastErr = err
		if attempt == 1 || attempt%5 == 0 {
			log.Info("waiting for database", "attempt", attempt, "err", err)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return nil, lastErr
}

func healthcheck() int {
	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	if strings.HasPrefix(addr, ":") {
		addr = "localhost" + addr
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://" + net.JoinHostPort(hostOf(addr), portOf(addr)) + "/healthz")
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck:", err)
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "healthcheck: status", resp.Status)
		return 1
	}
	return 0
}

func hostOf(addr string) string {
	if h, _, err := net.SplitHostPort(addr); err == nil && h != "" {
		return h
	}
	return "localhost"
}

func portOf(addr string) string {
	if _, p, err := net.SplitHostPort(addr); err == nil && p != "" {
		return p
	}
	return "8080"
}

func newLogger(level string) *slog.Logger {
	var l slog.Level
	switch strings.ToLower(level) {
	case "debug":
		l = slog.LevelDebug
	case "warn":
		l = slog.LevelWarn
	case "error":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: l}))
}
