# apps/platform-api/Dockerfile
#
# Node.js 25 BFF/API container for the enterprise React platform.
# Uses Node 25 native TypeScript execution ? no compilation step required.
#
# ADR-0001: hexagonal architecture ? adapters own external integrations
# ADR-0017: every Compose service must have a healthcheck
# ADR-0022: BFF owns session creation, token exchange, and HTTP-only cookies

FROM node:25

WORKDIR /app

# Install dependencies from root package.json
# All deps are in devDependencies in this monorepo (no separate prod/dev split)
COPY package.json package-lock.json ./
RUN npm ci --silent

# Copy source required for platform-api runtime
COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/platform-api/ ./apps/platform-api/

# Copy entrypoint (migrate ? seed ? serve)
COPY docker/entrypoint-api.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --retries=10 --start-period=30s \
  CMD wget -qO- http://localhost:3001/healthz | grep -q '"status"' || exit 1

ENTRYPOINT ["/entrypoint.sh"]
