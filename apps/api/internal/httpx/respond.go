// Package httpx is the HTTP surface: routing, middleware and handlers.
package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/dennisobel/gameshow/apps/api/internal/store"
)

type errorBody struct {
	Error   string `json:"error"`
	Message string `json:"message"`
	Field   string `json:"field,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v != nil {
		if err := json.NewEncoder(w).Encode(v); err != nil {
			slog.Error("write response", "err", err)
		}
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorBody{Error: code, Message: message})
}

func writeFieldError(w http.ResponseWriter, code, message, field string) {
	writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: code, Message: message, Field: field})
}

// writeStoreError maps data-layer sentinels onto status codes so handlers do
// not each invent their own mapping.
func writeStoreError(w http.ResponseWriter, err error, notFoundMsg string) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", notFoundMsg)
	case errors.Is(err, store.ErrConflict):
		writeError(w, http.StatusConflict, "conflict", "That already exists.")
	default:
		slog.Error("store", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "Something went wrong on our side.")
	}
}

// decodeJSON reads a request body with a size cap and rejects unknown fields,
// so a typo in a client payload surfaces as an error instead of being silently
// ignored.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	if ct := r.Header.Get("Content-Type"); ct != "" && !strings.HasPrefix(ct, "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Send JSON.")
		return false
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "The request body could not be read as JSON.")
		return false
	}
	return true
}

func clampLimit(raw string, def, max int) int {
	n := def
	if raw != "" {
		if v, err := parseInt(raw); err == nil {
			n = v
		}
	}
	if n < 1 {
		n = def
	}
	if n > max {
		n = max
	}
	return n
}

func parseInt(s string) (int, error) {
	var n int
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, errors.New("not a number")
		}
		n = n*10 + int(c-'0')
		if n > 1_000_000 {
			break
		}
	}
	return n, nil
}
