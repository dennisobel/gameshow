#!/usr/bin/env bash
# Deploys On The Board on a server, next to whatever else that server hosts.
#
#   ./scripts/deploy.sh --check   only look: is Docker usable, is the port free, what
#                                 would .env gain? Changes nothing.
#   ./scripts/deploy.sh           check, make sure .env has real secrets, build, start,
#                                 and wait until the game answers.
#
# It uses docker-compose.yml on its own, which publishes ONE host port: the web app
# (WEB_PORT, default 8088). Postgres, Qdrant, the API and the AI service are only
# reachable on the stack's private network, so there is one number to keep free on a
# shared machine, and no database listening on the internet.
#
# To update a running server:   git pull && ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

CHECK_ONLY=0
case "${1:-}" in
  --check) CHECK_ONLY=1 ;;
  "") ;;
  *) echo "usage: $0 [--check]" >&2; exit 2 ;;
esac

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "docker compose (v2) is not available"

PROJECT="$(sed -n 's/^name: *//p' docker-compose.yml | head -1)"
PROJECT="${PROJECT:-ontheboard}"

# A value from .env, or nothing. Never prints a secret on its own: callers decide.
envval() {
  [ -f .env ] || return 0
  grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true
}

# The shell wins over .env, which wins over the default: the order Compose uses.
WEB_PORT="${WEB_PORT:-$(envval WEB_PORT)}"
WEB_PORT="${WEB_PORT:-8088}"

# ---- is anything else on the port? ------------------------------------------------
listening() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH "sport = :$1" 2>/dev/null | grep -q .
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"
  else
    return 1 # cannot tell; Docker will still refuse to bind a port that is taken
  fi
}

# Is whatever holds the port this stack's own web container (a redeploy)?
ours() {
  docker ps --filter "label=com.docker.compose.project=$PROJECT" --filter "publish=$1" -q | grep -q .
}

next_free() {
  local p=$(( $1 + 1 ))
  while [ "$p" -lt $(( $1 + 300 )) ]; do
    listening "$p" || { echo "$p"; return; }
    p=$(( p + 1 ))
  done
}

say "Checking port $WEB_PORT ..."
if listening "$WEB_PORT" && ! ours "$WEB_PORT"; then
  holder="$(ss -ltnpH "sport = :$WEB_PORT" 2>/dev/null | head -1 | sed -nE 's/.*users:\(\("([^"]+)".*/\1/p')"
  die "port $WEB_PORT is already in use${holder:+ by $holder}. Nothing was changed.
       Port $(next_free "$WEB_PORT") is free right now: put WEB_PORT=$(next_free "$WEB_PORT") in .env and run this again."
fi
if ours "$WEB_PORT"; then
  say "  port $WEB_PORT is held by this stack's own web container (a redeploy): fine"
else
  say "  port $WEB_PORT is free"
fi
say "  this deploy publishes: $WEB_PORT (the web app) and nothing else"

# ---- .env: real secrets, and never a change to one that already exists -------------
rand() { openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

ensure() {
  local key="$1" value="$2"
  [ -z "$(envval "$key")" ] || return 0
  if [ "$CHECK_ONLY" = 1 ]; then
    say "  would add $key"
  else
    (umask 077; printf '%s=%s\n' "$key" "$value" >> .env)
    say "  added $key"
  fi
}

say "Checking .env ..."
[ -f .env ] || { [ "$CHECK_ONLY" = 1 ] && say "  there is no .env yet; it would be created" || (umask 077; : > .env); }
ensure APP_ENV production
ensure WEB_PORT "$WEB_PORT"
ensure JWT_SECRET "$(rand)"
ensure AI_SERVICE_TOKEN "$(rand)"

# Postgres sets its password when the data volume is first created, so a password
# generated after the fact would lock the API out of an existing database.
if [ -z "$(envval POSTGRES_PASSWORD)" ]; then
  if docker volume inspect "${PROJECT}_postgres-data" >/dev/null 2>&1; then
    say "  note: the database already exists, so POSTGRES_PASSWORD was left as it is"
  else
    ensure POSTGRES_PASSWORD "$(rand)"
  fi
fi

[ -n "$(envval OPENAI_API_KEY)" ] || say "  note: no OPENAI_API_KEY: question generation runs on the offline fake provider"
[ -n "$(envval ELEVENLABS_API_KEY)" ] || say "  note: no ELEVENLABS_API_KEY: the host speaks with the browser's own voice"

if [ "$CHECK_ONLY" = 1 ]; then
  say "Check complete. Nothing was changed."
  exit 0
fi

# ---- build and start ------------------------------------------------------------
# One image at a time: this machine is shared, and three builds at once can starve it.
export COMPOSE_PARALLEL_LIMIT=1
say "Building and starting (the first run downloads base images and takes several minutes) ..."
docker compose up -d --build

say "Waiting for the game to answer ..."
ready=0
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:$WEB_PORT/readyz" >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done

docker compose ps
if [ "$ready" = 1 ]; then
  say ""
  say "Up. The game is on port $WEB_PORT of this server: http://<this server's address>:$WEB_PORT"
else
  say ""
  say "The stack started but /readyz did not answer within 3 minutes. Look with: docker compose logs --tail=50 api" >&2
  exit 1
fi
