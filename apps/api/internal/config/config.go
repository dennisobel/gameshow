// Package config loads service configuration from the environment.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const devJWTSecret = "dev-only-secret-change-me-0123456789abcdef"

type Config struct {
	Env             string
	HTTPAddr        string
	DatabaseURL     string
	JWTSecret       []byte
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
	CORSOrigins     []string
	AIServiceURL    string
	AIServiceToken  string
	RunMigrations   bool
	// UsingDevSecret is true when JWT_SECRET is the development default, which is
	// public (it is in this repository) and so lets anyone forge a token.
	UsingDevSecret bool
	SeedOnStart    bool
	LogLevel       string

	// The host's voice. Empty key means the host is silent on the server and the
	// browser's own speech is used instead.
	ElevenLabsKey   string
	ElevenLabsVoice string
	VoiceQuickModel string
	VoiceShowModel  string
	VoiceDailyChars int
}

func (c Config) IsProduction() bool { return c.Env == "production" }

func Load() (Config, error) {
	c := Config{
		Env:             env("APP_ENV", "development"),
		HTTPAddr:        env("HTTP_ADDR", ":8080"),
		DatabaseURL:     env("DATABASE_URL", "postgres://ontheboard:ontheboard@localhost:55432/ontheboard?sslmode=disable"),
		AIServiceURL:    env("AI_SERVICE_URL", "http://localhost:8000"),
		AIServiceToken:  env("AI_SERVICE_TOKEN", "dev-internal-token"),
		RunMigrations:   boolEnv("RUN_MIGRATIONS", true),
		SeedOnStart:     boolEnv("SEED_ON_START", true),
		LogLevel:        env("LOG_LEVEL", "info"),
		AccessTokenTTL:  durEnv("ACCESS_TOKEN_TTL", 15*time.Minute),
		RefreshTokenTTL: durEnv("REFRESH_TOKEN_TTL", 30*24*time.Hour),

		// Either name is accepted, so the key can be pasted as it was issued.
		ElevenLabsKey:   env("ELEVENLABS_API_KEY", env("ELEVEN_LABS_SECRET_KEY", "")),
		ElevenLabsVoice: env("ELEVENLABS_VOICE_ID", ""),
		VoiceQuickModel: env("ELEVENLABS_MODEL_QUICK", ""),
		VoiceShowModel:  env("ELEVENLABS_MODEL_SHOW", ""),
		VoiceDailyChars: intEnv("VOICE_DAILY_CHARS", 2500),
	}

	secret := env("JWT_SECRET", devJWTSecret)
	// A shipped default secret is a forged-token factory. Refuse to start with it
	// anywhere that is not a developer's machine.
	if c.IsProduction() && (secret == devJWTSecret || len(secret) < 32) {
		return Config{}, fmt.Errorf("JWT_SECRET must be set to a unique value of at least 32 bytes in production")
	}
	c.JWTSecret = []byte(secret)
	c.UsingDevSecret = secret == devJWTSecret

	for _, o := range strings.Split(env("CORS_ORIGINS", "http://localhost:5174"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.CORSOrigins = append(c.CORSOrigins, o)
		}
	}
	return c, nil
}

func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func boolEnv(key string, fallback bool) bool {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}

func intEnv(key string, fallback int) int {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			return n
		}
	}
	return fallback
}

func durEnv(key string, fallback time.Duration) time.Duration {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
