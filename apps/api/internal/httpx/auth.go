package httpx

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/dennisobel/gameshow/apps/api/internal/auth"
	"github.com/dennisobel/gameshow/apps/api/internal/store"
	"github.com/google/uuid"
)

type ctxKey int

const claimsKey ctxKey = iota

const refreshCookie = "otb_refresh"

func claimsFrom(ctx context.Context) *auth.Claims {
	c, _ := ctx.Value(claimsKey).(*auth.Claims)
	return c
}

// authed rejects anything without a valid access token.
func (s *Server) authed(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := bearer(r)
		if raw == "" {
			writeError(w, http.StatusUnauthorized, "unauthenticated", "Sign in to continue.")
			return
		}
		claims, err := s.issuer.ParseAccess(raw)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthenticated", "Your session has expired.")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), claimsKey, claims)))
	})
}

func (s *Server) requireRole(roles ...string) func(http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, r := range roles {
		allowed[r] = true
	}
	return func(next http.Handler) http.Handler {
		return s.authed(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if c := claimsFrom(r.Context()); c == nil || !allowed[c.Role] {
				writeError(w, http.StatusForbidden, "forbidden", "You do not have access to this.")
				return
			}
			next.ServeHTTP(w, r)
		}))
	}
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) > 7 && strings.EqualFold(h[:7], "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

// ------------------------------------------------------------- responses

type sessionResponse struct {
	User         store.User `json:"user"`
	AccessToken  string     `json:"accessToken"`
	ExpiresAt    time.Time  `json:"expiresAt"`
	RefreshToken string     `json:"refreshToken"`
}

// issueSession mints both tokens and sets the refresh cookie.
//
// The refresh token is returned in the body as well as set as an HttpOnly
// cookie. Deployed behind the bundled nginx the app is same-origin and the
// cookie is the one that matters; a cross-origin dev server cannot use it
// without HTTPS, so the body copy keeps `npm run dev` working. See README.
func (s *Server) issueSession(w http.ResponseWriter, r *http.Request, u store.User, familyID string) (sessionResponse, error) {
	access, expires, err := s.issuer.IssueAccess(u.ID, u.Role, u.IsGuest)
	if err != nil {
		return sessionResponse{}, err
	}
	refresh, hash, err := auth.NewRefreshToken()
	if err != nil {
		return sessionResponse{}, err
	}
	if familyID == "" {
		familyID = uuid.NewString()
	}
	if _, err := s.store.StoreRefreshToken(r.Context(), u.ID, familyID, hash,
		time.Now().Add(s.issuer.RefreshTTL()), r.UserAgent()); err != nil {
		return sessionResponse{}, err
	}

	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookie,
		Value:    refresh,
		Path:     "/v1/auth",
		HttpOnly: true,
		Secure:   secureRequest(r),
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Now().Add(s.issuer.RefreshTTL()),
	})
	return sessionResponse{User: u, AccessToken: access, ExpiresAt: expires, RefreshToken: refresh}, nil
}

// ------------------------------------------------------------- handlers

type guestRequest struct {
	DisplayName string `json:"displayName"`
	Avatar      int    `json:"avatar"`
}

func (s *Server) handleGuest(w http.ResponseWriter, r *http.Request) {
	var req guestRequest
	if r.ContentLength > 0 && !decodeJSON(w, r, &req) {
		return
	}
	name := cleanName(req.DisplayName)
	if name == "" {
		name = "Player"
	}
	u, err := s.store.CreateGuest(r.Context(), name, clampAvatar(req.Avatar))
	if err != nil {
		writeStoreError(w, err, "")
		return
	}
	session, err := s.issueSession(w, r, u, "")
	if err != nil {
		writeStoreError(w, err, "")
		return
	}
	writeJSON(w, http.StatusCreated, session)
}

type registerRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
	Avatar      int    `json:"avatar"`
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if _, err := mail.ParseAddress(email); err != nil {
		writeFieldError(w, "invalid_email", "That does not look like an email address.", "email")
		return
	}
	if len(req.Password) < 8 {
		writeFieldError(w, "weak_password", "Use at least 8 characters.", "password")
		return
	}
	if len(req.Password) > 200 {
		writeFieldError(w, "weak_password", "That password is too long.", "password")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeStoreError(w, err, "")
		return
	}
	name := cleanName(req.DisplayName)
	if name == "" {
		name, _, _ = strings.Cut(email, "@")
	}

	// A signed-in guest keeps their id, and with it their game history.
	var u store.User
	if c := claimsFrom(r.Context()); c != nil && c.IsGuest {
		u, err = s.store.UpgradeGuest(r.Context(), c.UserID, email, hash, name)
	} else if raw := bearer(r); raw != "" {
		if c, perr := s.issuer.ParseAccess(raw); perr == nil && c.IsGuest {
			u, err = s.store.UpgradeGuest(r.Context(), c.UserID, email, hash, name)
		} else {
			u, err = s.store.CreateUser(r.Context(), email, hash, name, clampAvatar(req.Avatar))
		}
	} else {
		u, err = s.store.CreateUser(r.Context(), email, hash, name, clampAvatar(req.Avatar))
	}
	if errors.Is(err, store.ErrConflict) {
		writeFieldError(w, "email_taken", "That email is already registered.", "email")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		// The guest row was gone or already upgraded: fall back to a new account.
		u, err = s.store.CreateUser(r.Context(), email, hash, name, clampAvatar(req.Avatar))
		if errors.Is(err, store.ErrConflict) {
			writeFieldError(w, "email_taken", "That email is already registered.", "email")
			return
		}
	}
	if err != nil {
		writeStoreError(w, err, "")
		return
	}

	session, err := s.issueSession(w, r, u, "")
	if err != nil {
		writeStoreError(w, err, "")
		return
	}
	writeJSON(w, http.StatusCreated, session)
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	u, hash, err := s.store.UserByEmail(r.Context(), email)
	if err != nil {
		// Same response and roughly the same cost as a wrong password, so this
		// endpoint cannot be used to discover which emails are registered.
		_ = auth.VerifyPassword(req.Password, "$argon2id$v=19$m=65536,t=2,p=2$"+
			"AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "That email and password do not match.")
		return
	}
	if err := auth.VerifyPassword(req.Password, hash); err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "That email and password do not match.")
		return
	}
	s.store.TouchUser(r.Context(), u.ID)

	session, err := s.issueSession(w, r, u, "")
	if err != nil {
		writeStoreError(w, err, "")
		return
	}
	writeJSON(w, http.StatusOK, session)
}

type refreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if r.ContentLength > 0 && !decodeJSON(w, r, &req) {
		return
	}
	token := req.RefreshToken
	if token == "" {
		if c, err := r.Cookie(refreshCookie); err == nil {
			token = c.Value
		}
	}
	if token == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "No refresh token.")
		return
	}

	rec, err := s.store.RefreshTokenByHash(r.Context(), auth.HashRefresh(token))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "That session is no longer valid.")
		return
	}
	switch {
	case rec.Revoked != nil, time.Now().After(rec.Expires):
		writeError(w, http.StatusUnauthorized, "unauthenticated", "That session has expired.")
		return
	case rec.Used != nil:
		// A token being presented twice means a copy is in circulation. Kill the
		// whole family rather than guessing which holder is the legitimate one.
		s.log.Warn("refresh token reuse detected", "family", rec.FamilyID, "user", rec.UserID)
		_ = s.store.RevokeFamily(r.Context(), rec.FamilyID)
		s.clearRefreshCookie(w, r)
		writeError(w, http.StatusUnauthorized, "token_reused", "Please sign in again.")
		return
	}

	if err := s.store.MarkRefreshUsed(r.Context(), rec.ID); err != nil {
		writeStoreError(w, err, "")
		return
	}
	u, err := s.store.UserByID(r.Context(), rec.UserID)
	if err != nil {
		writeStoreError(w, err, "That account no longer exists.")
		return
	}
	session, err := s.issueSession(w, r, u, rec.FamilyID)
	if err != nil {
		writeStoreError(w, err, "")
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if r.ContentLength > 0 {
		_ = decodeJSON(w, r, &req)
	}
	token := req.RefreshToken
	if token == "" {
		if c, err := r.Cookie(refreshCookie); err == nil {
			token = c.Value
		}
	}
	if token != "" {
		if rec, err := s.store.RefreshTokenByHash(r.Context(), auth.HashRefresh(token)); err == nil {
			_ = s.store.RevokeFamily(r.Context(), rec.FamilyID)
		}
	}
	s.clearRefreshCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

// secureRequest reports whether the browser reached us over HTTPS, directly or
// through a proxy that ended the TLS and said so in X-Forwarded-Proto.
//
// A cookie's Secure flag has to follow the connection, not the environment: a
// browser silently drops a Secure cookie it receives over plain http, which is how
// a first deployment on a bare IP is served. A visitor who sends this header
// themselves only changes the cookie they are themselves given.
func secureRequest(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

func (s *Server) clearRefreshCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: refreshCookie, Value: "", Path: "/v1/auth",
		HttpOnly: true, Secure: secureRequest(r),
		SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u, err := s.store.UserByID(r.Context(), claimsFrom(r.Context()).UserID)
	if err != nil {
		writeStoreError(w, err, "That account no longer exists.")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

type updateMeRequest struct {
	DisplayName string `json:"displayName"`
	Avatar      int    `json:"avatar"`
}

func (s *Server) handleUpdateMe(w http.ResponseWriter, r *http.Request) {
	var req updateMeRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	u, err := s.store.UpdateProfile(r.Context(), claimsFrom(r.Context()).UserID,
		cleanName(req.DisplayName), clampAvatar(req.Avatar))
	if err != nil {
		writeStoreError(w, err, "That account no longer exists.")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func cleanName(s string) string {
	s = strings.TrimSpace(strings.Join(strings.Fields(s), " "))
	if len([]rune(s)) > 16 {
		s = string([]rune(s)[:16])
	}
	return s
}

func clampAvatar(n int) int {
	if n < 0 || n > 5 {
		return 0
	}
	return n
}
