#!/usr/bin/env bash
# .devcontainer/post-create.sh
# Runs after devcontainer is created. Sets up the repo for development.
# Idempotent — safe to re-run.
set -euo pipefail

echo "Installing npm dependencies..."
npm ci

echo "Installing architecture tool dependencies..."
(cd tools/architecture/validate-package-metadata && npm ci)
(cd tools/architecture/validate-source-imports && npm ci)
(cd tools/architecture/validate-lifecycle-evidence && npm ci)

echo "Installing Playwright browsers..."
npx playwright install chromium --with-deps

echo "Installing Tilt (local feedback loop — ADR-0027)..."
if ! command -v tilt &>/dev/null; then
  curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh | bash
  echo "Tilt installed: $(tilt version 2>/dev/null || echo 'version check pending new shell')"
else
  echo "Tilt already installed: $(tilt version 2>/dev/null)"
fi

echo ""
echo "Dev container ready."
echo "  npm run test:platform-api       — platform-api tests (requires Postgres)"
echo "  npm run test:frontend:run       — React unit tests"
echo "  npm run test:e2e                — E2E dev tests (requires services + Vite)"
echo "  make check                      — fast quality gate"
echo "  make compose-up-default         — start Compose default services"
echo "  tilt up                         — full feedback loop (requires Compose)"
echo "  make compose-up-external-mocks  — start WireMock on :8089"
