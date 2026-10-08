package httpx

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The refresh cookie's Secure flag must follow how the browser got here. A Secure
// cookie sent over plain http is thrown away by the browser, which is exactly how
// a first deployment on a bare IP is served; a non-Secure one over https is the
// weaker choice. Both mistakes are quiet, so both directions are pinned.

func TestSecureRequestFollowsTheConnection(t *testing.T) {
	cases := []struct {
		name   string
		header string
		tls    bool
		want   bool
	}{
		{"plain http", "", false, false},
		{"a proxy said it ended TLS", "https", false, true},
		{"the header in any case", "HTTPS", false, true},
		{"a proxy said http", "http", false, false},
		{"TLS straight to us", "", true, true},
	}
	for _, c := range cases {
		r := httptest.NewRequest(http.MethodGet, "/v1/auth/guest", nil)
		if c.header != "" {
			r.Header.Set("X-Forwarded-Proto", c.header)
		}
		if c.tls {
			r.TLS = &tls.ConnectionState{}
		}
		if got := secureRequest(r); got != c.want {
			t.Errorf("%s: secureRequest = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestClearingTheCookieMatchesHowItWasSet(t *testing.T) {
	s := &Server{}
	for _, secure := range []bool{false, true} {
		r := httptest.NewRequest(http.MethodPost, "/v1/auth/logout", nil)
		if secure {
			r.Header.Set("X-Forwarded-Proto", "https")
		}
		w := httptest.NewRecorder()
		s.clearRefreshCookie(w, r)
		set := w.Header().Get("Set-Cookie")
		if !strings.Contains(set, "otb_refresh=") && !strings.Contains(set, refreshCookie+"=") {
			t.Fatalf("no cookie was cleared: %q", set)
		}
		if has := strings.Contains(set, "Secure"); has != secure {
			t.Errorf("secure=%v: Set-Cookie %q has Secure=%v", secure, set, has)
		}
		if !strings.Contains(set, "HttpOnly") {
			t.Errorf("the cookie must stay HttpOnly: %q", set)
		}
	}
}
