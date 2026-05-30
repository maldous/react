#!/usr/bin/env bash
# .devcontainer/post-create.sh
# Runs after devcontainer is created. Sets up the repo for development.
# Idempotent ? safe to re-run.
set -euo pipefail

echo "Installing npm dependencies..."
npm ci

echo "Installing architecture tool dependencies..."
(cd tools/architecture/validate-package-metadata && npm ci)
(cd tools/architecture/validate-source-imports && npm ci)
(cd tools/architecture/validate-lifecycle-evidence && npm ci)

echo "Installing Playwright browsers..."
npx playwright install chromium --with-deps

echo "Installing Tilt (local feedback loop ? ADR-0027)..."
# Pinned version with checksum verification (no pipe-to-bash from master).
# Update TILT_VERSION and TILT_SHA256 together when upgrading.
# Obtain updated SHA256: curl -fsSL <release_url>.sha256sum
TILT_VERSION="0.33.21"
TILT_SHA256="da9f5f36196c748c6aa5a93bbb6f9b3c1efb9e7aba5a2f413a9d3ea94bb04f2b"
TILT_URL="https://github.com/tilt-dev/tilt/releases/download/v${TILT_VERSION}/tilt.${TILT_VERSION}.linux.x86_64.tar.gz"

if ! command -v tilt &>/dev/null; then
  echo "  Downloading tilt v${TILT_VERSION}..."
  curl -fsSL -o /tmp/tilt.tgz "${TILT_URL}"
  echo "${TILT_SHA256}  /tmp/tilt.tgz" | sha256sum -c - || {
    echo "ERROR: Tilt checksum verification failed. Update TILT_SHA256 in post-create.sh." >&2
    rm -f /tmp/tilt.tgz
    exit 1
  }
  tar -xzf /tmp/tilt.tgz -C /usr/local/bin tilt
  rm -f /tmp/tilt.tgz
  echo "  Tilt installed: $(tilt version 2>/dev/null)"
else
  echo "  Tilt already installed: $(tilt version 2>/dev/null)"
fi

echo ""
echo "Dev container ready."
echo "  npm run test:platform-api       ? platform-api tests (requires Postgres)"
echo "  npm run test:frontend:run       ? React unit tests"
echo "  npm run test:e2e                ? E2E dev tests (requires services + Vite)"
echo "  make check                      ? fast quality gate"
echo "  make compose-up-default         ? start Compose default services"
echo "  tilt up                         ? full feedback loop (requires Compose)"
echo "  make compose-up-external-mocks  ? start WireMock on :8089"
