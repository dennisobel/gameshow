.DEFAULT_GOAL := help
# Local development publishes each service's port on localhost (the .dev.yml layer).
# A server uses docker-compose.yml alone, which publishes only the web app: that is
# what ./scripts/deploy.sh runs, and why it cannot collide with anything else.
COMPOSE := docker compose -f docker-compose.yml -f docker-compose.dev.yml

CLOUDFLARED ?= cloudflared

.PHONY: help install up db deploy deploy-check down logs ps rebuild clean migrate seed generate review editor-token reset-players tunnel test test-api test-ai test-web fmt

help: ## List targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install every app's dependencies (npm workspaces, Go modules, uv)
	npm install
	cd apps/api && go mod download
	cd apps/ai && uv sync --extra dev

up: ## Build and start the whole stack
	$(COMPOSE) up -d --build
	@echo "web  http://localhost:$${WEB_PORT:-8088}"
	@echo "api  http://localhost:$${API_PORT:-8080}/healthz"
	@echo "ai   http://localhost:$${AI_PORT:-8000}/healthz"

db: ## Start only Postgres and Qdrant (to run the Go and Python services outside Docker)
	$(COMPOSE) up -d postgres qdrant

deploy-check: ## On a server: is the port free, what would .env gain? Changes nothing
	./scripts/deploy.sh --check

deploy: ## On a server: check the port, fill in secrets, build, start (git pull first to update)
	./scripts/deploy.sh

down: ## Stop the stack (keeps volumes)
	$(COMPOSE) down

clean: ## Stop the stack and delete all data
	$(COMPOSE) down -v

ps: ## Show service status
	$(COMPOSE) ps

logs: ## Tail logs (make logs S=api)
	$(COMPOSE) logs -f $(S)

rebuild: ## Rebuild one service (make rebuild S=api)
	$(COMPOSE) up -d --build $(S)

migrate: ## Apply database migrations
	$(COMPOSE) run --rm api /app/api -migrate

seed: ## Load categories and the seed question bank
	$(COMPOSE) run --rm api /app/api -seed

generate: ## Queue a generation batch (make generate C=food N=5)
	$(COMPOSE) exec ai python -m app.cli generate --category $(or $(C),general-knowledge) --count $(or $(N),5)

review: ## Show questions waiting for human review
	$(COMPOSE) exec ai python -m app.cli review

tunnel: ## Temporary public address for the game, so a friend in another city can join (Ctrl+C closes it)
	@echo "Open the address it prints in YOUR browser too, and create the game from there."
	$(CLOUDFLARED) tunnel --no-autoupdate --url http://localhost:$${WEB_PORT:-8088}

editor-token: ## Print an access token for a throwaway editor (for /v1/admin/review)
	@sh scripts/editor-token.sh

reset-players: ## Delete every player, game and match, keep the questions (make reset-players CONFIRM=yes)
	@test "$(CONFIRM)" = "yes" || { echo "This deletes all players, games, matches and typed answers. Re-run with CONFIRM=yes"; exit 1; }
	$(COMPOSE) exec -T postgres psql -U $${POSTGRES_USER:-ontheboard} -d $${POSTGRES_DB:-ontheboard} -v ON_ERROR_STOP=1 -f - < apps/api/scripts/reset_players.sql

test: test-api test-ai test-web ## Run every test suite

test-api: ## Go tests (unit + integration against compose Postgres)
	cd apps/api && go vet ./... && go test ./...

test-ai: ## Python tests (full graph on the fake provider)
	cd apps/ai && uv run --extra dev pytest -q

test-web: ## Typecheck and production build
	npm run build

fmt: ## Format Go and Python
	cd apps/api && go fmt ./...
	cd apps/ai && uv run --extra dev ruff format . && uv run --extra dev ruff check --fix .
