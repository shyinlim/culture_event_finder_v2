# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

# All compose commands use this variable because docker-compose.yml is not in root.
# HOST_UID/HOST_GID map host permissions for bind mounts.
# Do not name them UID/GID: macOS /bin/sh marks UID read-only and unexported.
COMPOSE = HOST_UID=$$(id -u) HOST_GID=$$(id -g) docker compose -f deployment/dev/docker-compose.yml

# -----------------------------------------------------------------------------
# Development
# -----------------------------------------------------------------------------

.PHONY: run-dev stop-dev

# Default target when running bare `make`.
run-dev:
	$(COMPOSE) down -v
	$(COMPOSE) build
	docker image prune -f
	$(COMPOSE) up -d
	@echo ""
	@echo "▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ Service (Dev) ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅"
	@echo "  ▶ Frontend: http://localhost:8790  (or http://0.0.0.0:8790)"
	@echo "  ▶ Backend:  http://localhost:8789  (or http://0.0.0.0:8789)"
	@echo ""
	@echo ""
	@echo "make stop-dev"
	@echo ""

stop-dev:
	$(COMPOSE) down

# -----------------------------------------------------------------------------
# Testing
# -----------------------------------------------------------------------------

.PHONY: test test-backend test-frontend

test: test-backend test-frontend

test-backend:
	cd backend && DEBUG=True uv run --frozen pytest .

test-frontend:
	cd frontend && npm test

# -----------------------------------------------------------------------------
# Production & Smoke Test
# -----------------------------------------------------------------------------

.PHONY: build-prod run-prod smoke-prod logs-prod stop-prod

build-prod:
	docker build -f deployment/prod/Dockerfile -t culture-event-finder-prod .
	docker image prune -f

run-prod: build-prod
	docker rm -f culture-event-prod 2>/dev/null || true
	docker run -d --rm --name culture-event-prod -p 8791:8791 -e ALLOWED_HOSTS=localhost,127.0.0.1,0.0.0.0 culture-event-finder-prod
	@echo ""
	@echo "▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ Service (Prod) ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅"
	@echo "  ▶ Service: http://localhost:8791 (running in background)"
	@echo ""
	@echo ""
	@echo "make stop-prod"
	@echo ""

# Wait up to 30s for /health, then check 4 endpoints. Any failed curl fails make.
smoke-prod:
	@for i in $$(seq 30); do curl -sf http://127.0.0.1:8791/health > /dev/null && break; sleep 1; done
	curl -sf http://127.0.0.1:8791/health
	curl -sf http://127.0.0.1:8791/health/
	curl -sf http://127.0.0.1:8791/ | grep -q "root"
	curl -sf http://127.0.0.1:8791/api/v1/countries | grep -q "Taiwan"
	@echo ""
	@echo "Smoke tests passed."

logs-prod:
	docker logs culture-event-prod

stop-prod:
	docker stop culture-event-prod

# -----------------------------------------------------------------------------
# Tools & Maintenance
# -----------------------------------------------------------------------------

.PHONY: install-host watch-ci prune

# Install node_modules on host for editor TS server, ESLint, and import resolution.
install-host:
	cd frontend && npm ci

# Wait for the run of the current commit, then watch it. Non-zero exit if it fails.
# gh needs a run ID when not interactive, and the run may not exist right after push.
WORKFLOW ?= ci.yml
watch-ci:
	@for i in $$(seq 30); do \
		id=$$(gh run list --workflow $(WORKFLOW) --commit $$(git rev-parse HEAD) -L1 --json databaseId -q '.[0].databaseId'); \
		[ -n "$$id" ] && break; sleep 2; \
	done; \
	gh run watch "$$id" --exit-status

# Remove dangling images to free disk space.
prune:
	docker image prune -f
