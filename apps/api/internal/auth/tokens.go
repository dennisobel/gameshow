package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var ErrInvalidToken = errors.New("invalid token")

type Claims struct {
	UserID  string `json:"sub"`
	Role    string `json:"role"`
	IsGuest bool   `json:"guest"`
	jwt.RegisteredClaims
}

type Issuer struct {
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
}

func NewIssuer(secret []byte, accessTTL, refreshTTL time.Duration) *Issuer {
	return &Issuer{secret: secret, accessTTL: accessTTL, refreshTTL: refreshTTL}
}

func (i *Issuer) AccessTTL() time.Duration  { return i.accessTTL }
func (i *Issuer) RefreshTTL() time.Duration { return i.refreshTTL }

func (i *Issuer) IssueAccess(userID, role string, isGuest bool) (string, time.Time, error) {
	expires := time.Now().Add(i.accessTTL)
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{
		UserID:  userID,
		Role:    role,
		IsGuest: isGuest,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(expires),
			Issuer:    "ontheboard",
		},
	})
	signed, err := tok.SignedString(i.secret)
	return signed, expires, err
}

func (i *Issuer) ParseAccess(token string) (*Claims, error) {
	var claims Claims
	_, err := jwt.ParseWithClaims(token, &claims, func(t *jwt.Token) (any, error) {
		// Pin the algorithm. Without this check a token signed with "none", or
		// with the public key as an HMAC secret, would be accepted.
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return i.secret, nil
	}, jwt.WithIssuer("ontheboard"), jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		return nil, ErrInvalidToken
	}
	if claims.UserID == "" {
		return nil, ErrInvalidToken
	}
	return &claims, nil
}

// NewRefreshToken returns the opaque token handed to the client and the hash to
// store. Only the hash is persisted: a database leak must not yield live
// sessions.
func NewRefreshToken() (token string, hash []byte, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, err
	}
	token = base64.RawURLEncoding.EncodeToString(raw)
	return token, HashRefresh(token), nil
}

func HashRefresh(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
