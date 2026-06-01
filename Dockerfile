FROM oven/bun:1.3.14 AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build && \
    cp dist/index.html dist/management.html

FROM nginx:1.29-alpine AS runner

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/index.html /usr/share/nginx/html/index.html
COPY --from=builder /app/dist/management.html /usr/share/nginx/html/management.html

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1
