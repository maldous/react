# apps/react-enterprise-app/Dockerfile
#
# Multi-stage build for the React SPA.
#   Stage 1 (builder): Vite build — produces static assets in dist/
#   Stage 2 (caddy):   Caddy serves the SPA + proxies BFF/API routes
#
# ADR-0019: TanStack Router uses client-side routing — Caddy serves index.html
#           as the fallback for all unmatched paths.
# ADR-0017: every Compose service must have a healthcheck

# ---------------------------------------------------------------------------
# Stage 1 — Build the Vite SPA
# ---------------------------------------------------------------------------
FROM node:25 AS builder

WORKDIR /app

# Install all dependencies (devDeps required for Vite build toolchain)
COPY package.json package-lock.json ./
RUN npm ci --silent

# Copy source required for the build
# Vite resolve.alias maps @platform/* to local packages — all must be present
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/react-enterprise-app/ ./apps/react-enterprise-app/

# Build the SPA — run from the app directory so Vite resolves index.html and
# the config root correctly. node_modules is resolved up to /app/node_modules.
# Output: apps/react-enterprise-app/dist/
RUN cd apps/react-enterprise-app && ../../node_modules/.bin/vite build

# ---------------------------------------------------------------------------
# Stage 2 — Caddy serving static files + API proxy
# ---------------------------------------------------------------------------
FROM caddy:2-alpine

# Copy Caddyfile
COPY docker/caddy/Caddyfile /etc/caddy/Caddyfile

# Copy the built SPA assets into Caddy's serving root
COPY --from=builder /app/apps/react-enterprise-app/dist /srv

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=15s \
  CMD wget -qO- http://localhost/ || exit 1
