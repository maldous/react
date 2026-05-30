#!/bin/sh
# docker/entrypoint-api.sh ? platform-api container entrypoint
# Runs migrations and seed before starting the HTTP server.
# ADR-0017: application schema owned by migrations; fixture data by seed scripts.
set -e

echo "[platform-api] Running migrations..."
node ./apps/platform-api/src/db/migrate.ts

echo "[platform-api] Seeding fixture data (idempotent)..."
node ./apps/platform-api/src/db/seed.ts

echo "[platform-api] Starting HTTP server on port ${PLATFORM_API_PORT:-3001}..."
exec node --loader ./apps/platform-api/loader.mjs ./apps/platform-api/src/server/http.ts
