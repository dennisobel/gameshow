// Package aiclient talks to the internal Python generation service.
//
// The browser never reaches that service; everything goes through this client,
// which is why the shared token lives here and nowhere near a handler.
//
// The client deliberately cannot enqueue work. A generation job is a row in
// Postgres, written by the API, and the worker finds it by polling. An earlier
// version also had an Enqueue call that asked the AI service to queue the same
// job, which ran every batch twice; the only operations left are the ones that
// cannot create work.
package aiclient

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

func New(baseURL, token string) *Client {
	return &Client{
		baseURL: baseURL,
		token:   token,
		http:    &http.Client{Timeout: 5 * time.Second},
	}
}

// Health reports whether the AI service is reachable. Not fatal to anything:
// the game plays fine without it.
func (c *Client) Health(ctx context.Context) error {
	return c.do(ctx, http.MethodGet, "/healthz", false)
}

// Wake tells the worker to look at the queue now instead of at its next poll.
//
// It is a hint, not a request for work: the job row already exists, so a failure
// here costs a few seconds of latency and nothing else. Callers should log it
// and carry on.
func (c *Client) Wake(ctx context.Context) error {
	return c.do(ctx, http.MethodPost, "/internal/wake", true)
}

func (c *Client) do(ctx context.Context, method, path string, authed bool) error {
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	if authed {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("ai service returned %s", resp.Status)
	}
	return nil
}
