.PHONY: dev dev-reset install-host test test-backend test-frontend build-prod run-prod prune

# All compose commands use this variable because docker-compose.yml is not in root.
# HOST_UID/HOST_GID map host permissions for bind mounts.
# Do not name them UID/GID: macOS /bin/sh marks UID read-only and unexported.
COMPOSE = HOST_UID=$$(id -u) HOST_GID=$$(id -g) docker compose -f deployment/dev/docker-compose.yml

dev:
	$(COMPOSE) build
	docker image prune -f
	$(COMPOSE) up

# Run after adding dependencies to rebuild and reset named volumes.
dev-reset:
	$(COMPOSE) down -v
	$(COMPOSE) build
	docker image prune -f
	$(COMPOSE) up

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
	docker run --rm -p 8080:8080 -e SECRET_KEY=local-prod-test-key -e ALLOWED_HOSTS=localhost,127.0.0.1 culture-event-finder-prod

# Remove dangling images to free disk space.
prune:
	docker image prune -f
