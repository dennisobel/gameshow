#!/usr/bin/env sh
# Prints an access token for a throwaway editor, for the review endpoints:
#
#   TOKEN=$(make -s editor-token)
#   curl -H "Authorization: Bearer $TOKEN" http://localhost:8088/v1/admin/review
#
# A role lives inside the token, so this creates a guest, promotes it in the
# database, and refreshes the session to pick up the new role.
set -eu
API="${API:-http://localhost:${WEB_PORT:-8088}}"

guest=$(curl -fsS -X POST "$API/v1/auth/guest" -H 'Content-Type: application/json' -d '{"displayName":"Editor"}')
id=$(printf '%s' "$guest" | sed -n 's/.*"user":{"id":"\([^"]*\)".*/\1/p')
refresh=$(printf '%s' "$guest" | sed -n 's/.*"refreshToken":"\([^"]*\)".*/\1/p')
[ -n "$id" ] && [ -n "$refresh" ] || { echo "could not create a guest: $guest" >&2; exit 1; }

docker compose exec -T postgres psql -U "${POSTGRES_USER:-ontheboard}" -d "${POSTGRES_DB:-ontheboard}" \
  -v ON_ERROR_STOP=1 -tAc "UPDATE users SET role='editor' WHERE id='$id'" >/dev/null

curl -fsS -X POST "$API/v1/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$refresh\"}" |
  sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p'
