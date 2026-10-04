.PHONY: dev dev-reset test test-backend test-frontend build-prod run-prod

# 所有 compose 指令都走這個變數，因為 compose 檔不在 root。
# HOST_UID/HOST_GID 讓 backend container 用 host 的使用者身分寫 bind mount。
# 不可以叫 UID/GID：它們沒有 export 給子程序，而且 macOS 的 /bin/sh 把 UID 設成唯讀。
COMPOSE = HOST_UID=$$(id -u) HOST_GID=$$(id -g) docker compose -f deployment/dev/docker-compose.yml

dev:
	$(COMPOSE) up --build

# 裝了新套件後跑這個：named volume 只在第一次建立時複製 image 內容，之後不會自己更新
dev-reset:
	$(COMPOSE) down -v
	$(COMPOSE) up --build

test-backend:
	cd backend && DEBUG=True uv run pytest .

test-frontend:
	@echo "Frontend test target - will be wired in Task 4"

test: test-backend test-frontend

# deployment/prod/Dockerfile 在 Task 12 才建立，在那之前這兩個 target 會失敗，屬預期
build-prod:
	docker build -f deployment/prod/Dockerfile -t culture-event-finder-prod .

run-prod: build-prod
	docker run --rm -p 8080:8080 -e SECRET_KEY=local-prod-test-key -e ALLOWED_HOSTS=localhost,127.0.0.1 culture-event-finder-prod
