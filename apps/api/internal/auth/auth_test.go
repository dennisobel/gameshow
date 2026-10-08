package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestPasswordRoundTrip(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyPassword("correct horse battery staple", hash); err != nil {
		t.Errorf("correct password rejected: %v", err)
	}
	if err := VerifyPassword("wrong password", hash); err == nil {
		t.Error("wrong password accepted")
	}
}

func TestHashesAreSalted(t *testing.T) {
	a, _ := HashPassword("same")
	b, _ := HashPassword("same")
	if a == b {
		t.Error("two hashes of the same password are identical — salt is missing")
	}
}

func TestVerifyRejectsMalformedHashes(t *testing.T) {
	for _, bad := range []string{
		"", "nonsense", "$argon2id$", "$bcrypt$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA",
		"$argon2id$v=99$m=65536,t=2,p=2$c2FsdA$aGFzaA",
	} {
		if err := VerifyPassword("x", bad); err == nil {
			t.Errorf("malformed hash %q was accepted", bad)
		}
	}
}

func TestAccessTokenRoundTrip(t *testing.T) {
	iss := NewIssuer([]byte("test-secret-at-least-32-bytes-long!!"), time.Minute, time.Hour)
	tok, expires, err := iss.IssueAccess("user-1", "player", true)
	if err != nil {
		t.Fatal(err)
	}
	if time.Until(expires) > time.Minute+time.Second {
		t.Error("expiry is further out than the configured TTL")
	}
	claims, err := iss.ParseAccess(tok)
	if err != nil {
		t.Fatal(err)
	}
	if claims.UserID != "user-1" || claims.Role != "player" || !claims.IsGuest {
		t.Errorf("claims round-tripped wrong: %+v", claims)
	}
}

func TestAccessTokenRejectsOtherSecrets(t *testing.T) {
	a := NewIssuer([]byte("secret-a-at-least-32-bytes-long-ok!!"), time.Minute, time.Hour)
	b := NewIssuer([]byte("secret-b-at-least-32-bytes-long-ok!!"), time.Minute, time.Hour)
	tok, _, _ := a.IssueAccess("user-1", "player", false)
	if _, err := b.ParseAccess(tok); err == nil {
		t.Error("a token signed with another secret was accepted")
	}
}

func TestAccessTokenRejectsExpired(t *testing.T) {
	iss := NewIssuer([]byte("test-secret-at-least-32-bytes-long!!"), -time.Minute, time.Hour)
	tok, _, _ := iss.IssueAccess("user-1", "player", false)
	if _, err := iss.ParseAccess(tok); err == nil {
		t.Error("an expired token was accepted")
	}
}

// The classic JWT attack: re-sign the payload with alg "none".
func TestAccessTokenRejectsAlgNone(t *testing.T) {
	iss := NewIssuer([]byte("test-secret-at-least-32-bytes-long!!"), time.Minute, time.Hour)
	unsigned := jwt.NewWithClaims(jwt.SigningMethodNone, Claims{
		UserID: "attacker", Role: "admin",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "attacker",
			Issuer:    "ontheboard",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	})
	tok, err := unsigned.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := iss.ParseAccess(tok); err == nil {
		t.Error("an alg=none token was accepted")
	}
}

func TestRefreshTokenHashing(t *testing.T) {
	tok, hash, err := NewRefreshToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(tok) < 40 {
		t.Errorf("refresh token is only %d chars — too little entropy", len(tok))
	}
	if strings.Contains(tok, "=") {
		t.Error("token should be raw URL-safe base64 with no padding")
	}
	if len(hash) != 32 {
		t.Errorf("hash is %d bytes, want 32", len(hash))
	}
	if string(HashRefresh(tok)) != string(hash) {
		t.Error("HashRefresh disagrees with the hash returned at creation")
	}

	other, _, _ := NewRefreshToken()
	if other == tok {
		t.Error("two refresh tokens collided")
	}
}
