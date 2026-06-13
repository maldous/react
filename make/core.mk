# ── Environment selector ────────────────────────────────────────────────────
# Scopes all Compose operations to an isolated stack.
# Default: dev (backward compatible). Override: ENV=test|staging|prod
ENV ?= dev
STAGE ?= $(ENV)
COMPOSE_PROJECT_NAME := react-$(ENV)
# Runtime env file. ADR-0072: the generated artifact .env/$(ENV).env (produced
# from config/environments/$(ENV).json) is the preferred source; a legacy
# hand-maintained .env.$(ENV) is only used if no manifest exists. Lazy ('=') so
# it resolves at recipe time, never at parse time, and only when referenced.
ENV_FILE = $(shell bash scripts/env/resolve-env-file.sh $(ENV) 2>/dev/null || echo .env.$(ENV))
STAGE_POLICY := env/stage-policy.yaml

# PRESERVE_JVM_VOLUMES — preserve Keycloak data on reset (slow to re-initialise).
# SonarQube lives in the shared react-sonar project and is unaffected by per-env reset.
# Default true. Override: PRESERVE_JVM_VOLUMES=false make stage-dev
PRESERVE_JVM_VOLUMES ?= true

# Compose command helper — always scoped to the selected environment.
COMPOSE_CMD = docker/compose-wrapper.sh $(ENV)

# Orchestrator shorthand
ORCHESTRATOR = node tools/architecture/orchestrator/src/index.mjs

# ── Terminal colours ─────────────────────────────────────────────────────────
BOLD   := $(shell tput bold   2>/dev/null || true)
GREEN  := $(shell tput setaf 2 2>/dev/null || true)
BLUE   := $(shell tput setaf 4 2>/dev/null || true)
YELLOW := $(shell tput setaf 3 2>/dev/null || true)
RED    := $(shell tput setaf 1 2>/dev/null || true)
RESET  := $(shell tput sgr0   2>/dev/null || true)

STEP  = @printf '\n$(BOLD)$(BLUE)▶ %-48s ◀$(RESET)\n' "$(1)"
OK    = @printf '$(GREEN)✓ %s$(RESET)\n' "$(1)"
WARN  = @printf '$(YELLOW)⚠ %s$(RESET)\n' "$(1)"
SKIP  = @printf '$(YELLOW)↷ %s$(RESET)\n' "$(1)"

# ── Port helpers ─────────────────────────────────────────────────────────────
# JVM_PORTS_EXCLUDE — shell fragment: sets _jvm_ports="port1|port2".
# Reads KEYCLOAK_PORT from .env.$(ENV) to spare the per-env Keycloak.
# (SonarQube lives in the shared react-sonar project, port from .env.sonar.)
JVM_PORTS_EXCLUDE = _jvm_ports="$$(grep -oP 'KEYCLOAK_PORT=\K\d+' $(ENV_FILE) 2>/dev/null | tr '\n' '|' | sed 's/|$$//')"

# CONN_URLS(envfile) — sets _pg_port, _rd_port, _pg_url, _pg_app_url, _rd_url
define CONN_URLS
_pg_port="$$(grep -oP 'POSTGRES_PORT=\K\d+' $(1) 2>/dev/null | head -1)"; _pg_port=$${_pg_port:-5433}; \
_rd_port="$$(grep -oP 'REDIS_PORT=\K\d+' $(1) 2>/dev/null | head -1)"; _rd_port=$${_rd_port:-6379}; \
_pg_url="postgresql://platform:platformpassword@localhost:$${_pg_port}/platform"; \
_pg_app_url="postgresql://platform_app:platformapppassword@localhost:$${_pg_port}/platform"; \
_rd_url="redis://localhost:$${_rd_port}"
endef

# ── Confirmation helpers ─────────────────────────────────────────────────────
define CONFIRM_DOWN
timeout 60 bash -c 'while docker ps -q --filter "label=com.docker.compose.project=$(1)" 2>/dev/null | grep -q .; do sleep 1; done' \
    || { printf '$(RED)✗ containers still running for project $(1) after down$(RESET)\n'; \
         docker ps --filter "label=com.docker.compose.project=$(1)"; exit 1; }
endef

define CONFIRM_PORT_FREE
timeout 30 bash -c 'while ss -tlnp "sport = :$(1)" 2>/dev/null | grep -q LISTEN; do sleep 1; done' \
    || { printf '$(RED)✗ port $(1) still in use after cleanup$(RESET)\n'; \
         ss -tlnp "sport = :$(1)"; exit 1; }
endef

define CONFIRM_VOLUME_GONE
docker volume inspect $(1) >/dev/null 2>&1 \
    && { printf '$(RED)✗ volume $(1) still exists after removal$(RESET)\n'; exit 1; } || true
endef
