# Contexto de build: raíz del monorepo (docker build -f backend/Dockerfile .)
FROM node:24-slim
# git: el backend clona repos y empuja mirrors a GitHub.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@11.20.0
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json backend/
RUN pnpm install --frozen-lockfile --filter backend...
COPY backend backend
RUN pnpm --filter backend build
WORKDIR /repo/backend
ENV NODE_ENV=production
CMD ["node", "dist/main.js"]
