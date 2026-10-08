package aiclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestWakeSendsTheTokenAndNothingElse(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.Method != http.MethodPost || r.URL.Path != "/internal/wake" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer secret-token" {
			t.Errorf("Authorization = %q, want the internal bearer token", got)
		}
		if r.ContentLength > 0 {
			t.Errorf("wake carried a body of %d bytes: it must not describe work", r.ContentLength)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	if err := New(srv.URL, "secret-token").Wake(context.Background()); err != nil {
		t.Fatalf("Wake: %v", err)
	}
	if hits.Load() != 1 {
		t.Errorf("made %d requests, want exactly 1", hits.Load())
	}
}

// A wake that fails must be reported, because the caller logs it; but it must be
// an ordinary error, never a panic, since the job it concerns already exists.
func TestWakeReportsFailures(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	if err := New(srv.URL, "wrong").Wake(context.Background()); err == nil {
		t.Error("a 401 from the AI service was swallowed")
	}

	unreachable := New("http://127.0.0.1:1", "t")
	if err := unreachable.Wake(context.Background()); err == nil {
		t.Error("an unreachable AI service was reported as success")
	}
}

func TestHealthDoesNotSendTheToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("the health probe leaked the internal token")
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	if err := New(srv.URL, "secret-token").Health(context.Background()); err != nil {
		t.Fatalf("Health: %v", err)
	}
}
