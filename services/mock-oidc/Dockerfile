# mock-oidc — NON-PRODUCTION upstream OIDC identity-provider fixture.
# Brokered by Keycloak as mock-google / mock-azure / mock-apple in dev/test.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
# No committed lockfile for this isolated fixture; install from the manifest.
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
# Internal container port (Keycloak backchannel). Published to the host for the
# browser front channel via compose (see compose.yaml identity-mocks profile).
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --retries=10 --start-period=10s \
  CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "dist/server.js"]
