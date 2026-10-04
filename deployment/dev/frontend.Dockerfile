FROM node:22-slim

WORKDIR /app/frontend

# Grant folder ownership to node user before switching so Vite can write cache without permission denied.
RUN chown node:node /app/frontend
USER node

# Copy package manifests first to leverage Docker layer caching.
COPY --chown=node:node frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Source code is mounted at runtime via docker compose.
EXPOSE 8790

CMD ["npm", "run", "dev"]
