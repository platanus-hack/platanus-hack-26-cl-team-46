# Contexto de build: raíz del monorepo (docker build -f frontend/Dockerfile .)
FROM node:24-slim
RUN npm install -g pnpm@11.20.0
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile --filter frontend...
COPY frontend frontend
# Render pasa las env vars del servicio como build args. NEXT_PUBLIC_* se incrusta en el bundle al buildear.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter frontend build
WORKDIR /repo/frontend
ENV NODE_ENV=production
CMD ["sh", "-c", "exec node_modules/.bin/next start -p ${PORT:-3000}"]
