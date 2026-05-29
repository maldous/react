#!/usr/bin/env bash
# .devcontainer/post-create.sh
# Runs after devcontainer is created. Sets up the repo for development.
set -euo pipefail

echo "Installing npm dependencies..."
npm ci

echo "Installing tool dependencies..."
(cd tools/architecture/validate-package-metadata && npm ci)
(cd tools/architecture/validate-source-imports && npm ci)
(cd tools/architecture/validate-lifecycle-evidence && npm ci)

echo "Installing Playwright browsers..."
npx playwright install chromium --with-deps

echo ""
echo "Dev container ready."
echo "  npm run test:platform-api   — platform-api tests (requires Postgres)"
echo "  npm run test:frontend:run   — React unit tests"
echo "  npm run test:e2e            — E2E dev tests"
echo "  make check                  — fast quality gate"
echo "  make compose-up-default     — start Compose default services"
