const EN_GB: Record<string, string> = {
  "api.error.unauthenticated": "You need to sign in to continue",
  "api.error.forbidden": "You do not have permission to perform this action",
  "api.error.emailUnverified": "Your email address has not been verified",
  "api.error.authStateMismatch": "Authentication flow error — please try again",
  "api.error.keycloakError": "Keycloak error: {error}",
  "api.error.missingCodeOrState": "Missing code or state parameter",
  "api.error.missingPreAuthCookie": "Missing pre-auth cookie",
  "api.error.invalidOrExpiredState": "Invalid or expired state parameter",
  "api.error.authFlowBindingMismatch": "Auth flow binding mismatch",
  "api.error.tokenExchangeFailed": "Token exchange failed",
  "api.error.unverifiedOrMissingEmail": "Unverified or missing email — login refused",
  "api.error.missingOrganisationId": "Missing organisationId in session context",
  "api.error.organisationNotFound": "Organisation not found",
  "api.error.invalidRequestBody": "Invalid request body",
  "api.error.malformedJsonBody": "Malformed JSON body",
  "api.error.unauthenticatedSession": "No session",
  "api.error.pathNotFound": "{path} not found",
  "api.error.methodNotAllowed": "Method {method} not allowed for {path}",
  "api.error.authenticationRequired": "Authentication required",
  "api.error.permissionRequired": "Permission required: {permission}",
  "feature.organisation.profile.form.displayName.validation.required": "Display name is required",
  "feature.organisation.profile.form.displayName.validation.tooShort":
    "Display name must be at least 2 characters",
  "feature.organisation.profile.form.displayName.validation.tooLong":
    "Display name must be 120 characters or fewer",
  "feature.organisation.profile.form.displayName.validation.invalid":
    "Display name must not contain control characters",
};

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = params[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

export function serverT(key: string, params?: Record<string, string | number>): string {
  return interpolate(EN_GB[key] ?? key, params);
}
