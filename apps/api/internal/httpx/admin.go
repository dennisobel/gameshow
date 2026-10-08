package httpx

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
)

func (s *Server) handleReviewQueue(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ReviewQueue(r.Context(), clampLimit(r.URL.Query().Get("limit"), 25, 200))
	if err != nil {
		writeStoreError(w, err, "")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"questions": items})
}

type reviewDecision struct {
	Decision string `json:"decision"` // approve | reject | retire
	Note     string `json:"note"`
}

func (s *Server) handleReviewDecision(w http.ResponseWriter, r *http.Request) {
	var req reviewDecision
	if !decodeJSON(w, r, &req) {
		return
	}
	var status string
	switch req.Decision {
	case "approve":
		status = "approved"
	case "reject":
		status = "draft"
	case "retire":
		status = "retired"
	default:
		writeFieldError(w, "bad_decision", "Decision must be approve, reject or retire.", "decision")
		return
	}
	if err := s.store.SetQuestionStatus(r.Context(), r.PathValue("id"), status, trimTo(req.Note, 500)); err != nil {
		writeStoreError(w, err, "No such question.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": status})
}

type generateRequest struct {
	Category  string `json:"category"`
	Count     int    `json:"count"`
	Subtopic  string `json:"subtopic"`
	PanelSize int    `json:"panelSize"`
}

// Panel size bounds. The panel is one model call per respondent, so this number
// is a direct multiplier on what a request costs.
const (
	minPanelSize = 5
	maxPanelSize = 200
)

// handleGenerate queues a batch.
//
// The job is the row written here, and only that row: the worker finds it by
// polling, so it survives an AI-service restart. The call that follows merely
// wakes the worker so the job starts now rather than within a few seconds. It
// must never enqueue anything itself — an earlier version did, and ran every
// batch twice.
func (s *Server) handleGenerate(w http.ResponseWriter, r *http.Request) {
	var req generateRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Count <= 0 {
		req.Count = 5
	}
	if req.Count > 50 {
		req.Count = 50
	}
	// Zero means "use the service default"; anything else must be sensible,
	// because every respondent is a billed model call.
	if req.PanelSize != 0 && (req.PanelSize < minPanelSize || req.PanelSize > maxPanelSize) {
		writeFieldError(w, "bad_panel_size",
			fmt.Sprintf("Panel size must be between %d and %d.", minPanelSize, maxPanelSize), "panelSize")
		return
	}
	cat, err := s.store.CategoryBySlug(r.Context(), strings.TrimSpace(req.Category))
	if err != nil {
		writeStoreError(w, err, "No such category.")
		return
	}

	uid := claimsFrom(r.Context()).UserID
	genID, err := s.store.EnqueueGeneration(r.Context(), cat.ID, &uid, map[string]any{
		"category":   cat.Slug,
		"count":      req.Count,
		"subtopic":   req.Subtopic,
		"panel_size": req.PanelSize,
	})
	if err != nil {
		writeStoreError(w, err, "")
		return
	}

	wakeCtx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	woken := s.ai.Wake(wakeCtx) == nil
	if !woken {
		// Not an error for the caller: the job exists and will be picked up.
		s.log.Warn("could not wake the worker; the job will start on its next poll",
			"generation", genID)
	}

	writeJSON(w, http.StatusAccepted, map[string]any{
		"generationId": genID,
		"status":       "queued",
		"startedNow":   woken,
	})
}

func (s *Server) handleGenerations(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.Generations(r.Context(), clampLimit(r.URL.Query().Get("limit"), 25, 200))
	if err != nil {
		writeStoreError(w, err, "")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"generations": rows})
}
