# E2E persona coverage — test

Generated for git evidence (ADR-0075 / ADR-ACT-0285). DO NOT EDIT — regenerate via `npm run e2e:ui:contract:validate`.

- Result: **PASSED**
- Failures (block make all): 0
- Reported gaps (honest, non-blocking this phase): 18

## Reported gaps (tracked, not yet blocking)

- ⚠️ permission 'tenant.members.read' (route /admin/members) has no persona with negative (denied) coverage
- ⚠️ permission 'tenant.auth.settings.read' (route /admin/auth) has no persona with negative (denied) coverage
- ⚠️ permission 'tenant.features.read' (route /admin/features) has no persona with negative (denied) coverage
- ⚠️ permission 'tenant.config.read' (route /admin/config) has no persona with negative (denied) coverage
- ⚠️ permission 'tenant.email.settings.read' (route /admin/email) has no persona with positive coverage
- ⚠️ permission 'tenant.email.settings.read' (route /admin/email) has no persona with negative (denied) coverage
- ⚠️ permission 'tenant.domains.read' (route /admin/domains) has no persona with negative (denied) coverage
- ⚠️ permission 'tenant.storage.read' (route /admin/storage) has no persona with negative (denied) coverage
- ⚠️ permission 'tenant.observability.read' (route /admin/observability) has no persona with negative (denied) coverage
- ⚠️ permission 'tenant.webhooks.read' (route /admin/webhooks) has no persona with negative (denied) coverage
- ⚠️ permission 'tenant.platform.read' (route /admin/platform) has no persona with positive coverage
- ⚠️ permission 'tenant.platform.read' (route /admin/platform) has no persona with negative (denied) coverage
- ⚠️ permission 'tenant.entitlements.read' (route /admin/entitlements) has no persona with negative (denied) coverage
- ⚠️ permission 'tenant.metering.read' (route /admin/usage) has no persona with negative (denied) coverage
- ⚠️ permission 'tenant.developer.read' (route /admin/developer) has no persona with negative (denied) coverage
- ⚠️ permission 'tenant.search.read' (route /admin/search) has no persona with negative (denied) coverage
- ⚠️ permission 'profile.read_self' (route /admin/account) has no persona with negative (denied) coverage
- ⚠️ permission 'platform.observability.read' (route /admin/monitoring) has no persona with negative (denied) coverage

## Summary

- personas: 21
- roles: 2
- rolesCovered: 2
- accessibilityProfiles: 5
- a11yProfilesCovered: 5
