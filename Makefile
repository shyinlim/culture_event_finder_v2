.PHONY: dev dev-reset test test-backend test-frontend build-prod run-prod

# All compose commands use this variable because docker-compose.yml is not in root.
# HOST_UID/HOST_GID map host permissions for bind mounts.
# Do not name them UID/GID: macOS /bin/sh marks UID read-only and unexported.
COMPOSE = HOST_UID=$$(id -u) HOST_GID=$$(id -g) docker compose -f deployment/dev/docker-compose.yml

dev:
	$(COMPOSE) up --build

# Run after adding dependencies to rebuild and reset named volumes.
dev-reset:
	$(COMPOSE) down -v
	$(COMPOSE) up --build

test-backend:
	cd backend && DEBUG=True uv run pytest .

test-frontend:
	@echo "Frontend test target - will be wired in Task 4"

test: test-backend test-frontend

# Production Dockerfile is created in Task 12; failure before Task 12 is expected.
build-prod:
	docker build -f deployment/prod/Dockerfile -t culture-event-finder-prod .

run-prod: build-prod
	docker run --rm -p 8080:8080 -e SECRET_KEY=local-prod-test-key -e ALLOWED_HOSTS=localhost,127.0.0.1 culture-event-finder-prod
