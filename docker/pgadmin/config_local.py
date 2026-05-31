"""
pgAdmin local configuration — Keycloak SSO via OAuth2/OIDC.

Mounted at /pgadmin4/config_local.py inside the container.
All values are read from environment variables so they work across
dev, staging, and prod environments without rebuilding the image.

ADR-0030: forward_auth gates /pgadmin/* (sysadmin only).
This OAuth2 config adds a second Keycloak auth layer: after passing
forward_auth, pgAdmin redirects to Keycloak which recognises the existing
session and auto-authenticates — no manual password entry needed (SSO).
"""

import os

# ---------------------------------------------------------------------------
# Keycloak connection details (read from compose.yaml environment)
# ---------------------------------------------------------------------------

_kc_internal = os.environ.get("KEYCLOAK_URL", "http://keycloak:8080/kc")
_kc_public = os.environ.get("KC_HOSTNAME", "http://localhost/kc")
_realm = os.environ.get("KEYCLOAK_REALM", "platform")

# ---------------------------------------------------------------------------
# Server mode is required for OAuth2. Master password not required because
# the pgAdmin admin account is auto-created from the Keycloak email claim.
# ---------------------------------------------------------------------------

SERVER_MODE = True
MASTER_PASSWORD_REQUIRED = False

# ---------------------------------------------------------------------------
# OAuth2 — Keycloak as the primary authentication source.
# 'internal' is kept as fallback for local break-glass access.
# ---------------------------------------------------------------------------

AUTHENTICATION_SOURCES = ["oauth2", "internal"]
OAUTH2_AUTO_CREATE_USER = True

OAUTH2_CONFIG = [
    {
        "OAUTH2_NAME": "keycloak",
        "OAUTH2_DISPLAY_NAME": "Sign in with platform account",
        "OAUTH2_CLIENT_ID": os.environ.get("PGADMIN_OAUTH2_CLIENT_ID", "pgadmin"),
        "OAUTH2_CLIENT_SECRET": "",  # public PKCE client — no secret
        # Internal URL for server-to-server token exchange
        "OAUTH2_TOKEN_URL": f"{_kc_internal}/realms/{_realm}/protocol/openid-connect/token",
        # Public URL for browser redirect (must be accessible from user's browser)
        "OAUTH2_AUTHORIZATION_URL": f"{_kc_public}/realms/{_realm}/protocol/openid-connect/auth",
        "OAUTH2_API_BASE_URL": f"{_kc_internal}/realms/{_realm}/",
        "OAUTH2_USERINFO_ENDPOINT": f"{_kc_internal}/realms/{_realm}/protocol/openid-connect/userinfo",
        "OAUTH2_SCOPE": "openid email profile",
        "OAUTH2_USERNAME_CLAIM": "email",
        "OAUTH2_AUTO_CREATE_USER": True,
        "OAUTH2_ICON": "fa-key",
        "OAUTH2_BUTTON_COLOR": "#4DB3DB",
        "OAUTH2_ADDITIONAL_CLAIMS": {},
    }
]
