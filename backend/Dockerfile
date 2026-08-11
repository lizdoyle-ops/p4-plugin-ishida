# Build context is the p4-plugin/ repo root, because the seed CSV lives in data/.
#   docker build -f backend/Dockerfile -t p4-backend .
FROM node:20-bookworm-slim

WORKDIR /app

# better-sqlite3 ships prebuilds for this platform, but keep the toolchain
# available so a fallback source build succeeds rather than failing the deploy.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./backend/
RUN cd backend && npm ci

COPY backend/ ./backend/
COPY data/ ./data/

RUN cd backend && npm run build

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

WORKDIR /app/backend
CMD ["node", "dist/index.js"]
