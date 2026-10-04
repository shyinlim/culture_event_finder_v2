.PHONY: run-dev stop-dev install-host test test-backend test-frontend build-prod run-prod stop-prod prune

# All compose commands use this variable because docker-compose.yml is not in root.
# HOST_UID/HOST_GID map host permissions for bind mounts.
# Do not name them UID/GID: macOS /bin/sh marks UID read-only and unexported.
COMPOSE = HOST_UID=$$(id -u) HOST_GID=$$(id -g) docker compose -f deployment/dev/docker-compose.yml

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

# Install node_modules on host for editor TS server, ESLint, and import resolution.
install-host:
	cd frontend && npm ci

test-backend:
	cd backend && DEBUG=True uv run pytest .

test-frontend:
	cd frontend && npm test

test: test-backend test-frontend

# Production Dockerfile is created in Task 12; failure before Task 12 is expected.
build-prod:
	docker build -f deployment/prod/Dockerfile -t culture-event-finder-prod .
	docker image prune -f

run-prod: build-prod
	docker rm -f culture-event-prod 2>/dev/null || true
	docker run -d --rm --name culture-event-prod -p 8791:8791 -e SECRET_KEY=local-prod-test-key -e ALLOWED_HOSTS=localhost,127.0.0.1,0.0.0.0 culture-event-finder-prod
	@echo ""
	@echo "▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ ▻ Service (Prod) ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅ ◅"
	@echo "  ▶ Service: http://localhost:8791 (running in background)"
	@echo ""
	@echo ""
	@echo "make stop-prod"
	@echo ""

stop-prod:
	docker stop culture-event-prod

# Remove dangling images to free disk space.
prune:
	docker image prune -f
