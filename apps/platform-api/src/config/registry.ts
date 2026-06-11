import { AuditAction } from "@platform/audit-events";
import type {
  ConfigCategory,
  ConfigDefinitionDto,
  ConfigValueType,
} from "@platform/contracts-admin";
import { ALLOWED_FEATURE_KEYS } from "../usecases/features.ts";

// ---------------------------------------------------------------------------
// Platform Configuration Registry (ADR-0039).
//
// The single source of truth for tenant-configurable settings. Each definition
// declares its type, default, permissions, audit action, and lifecycle. Values
// are stored in tenant_settings under `storageKey`; the optional storageRead/Write
// transforms bridge legacy storage shapes (feature flags keep `feature.<key>` =
// {"enabled": bool} for backwards compatibility with /api/org/features).
//
// This module is pure (contracts + audit string constants only). The SPA never
// imports it — it consumes the serialised ConfigDefinitionDto via the BFF.
// ---------------------------------------------------------------------------

export interface PlatformConfigDefinition {
  key: string;
  category: ConfigCategory;
  labelKey: string;
  descriptionKey: string;
  valueType: ConfigValueType;
  defaultValue: unknown;
  allowedValues: string[] | null;
  tenantOverridable: boolean;
  requiredPermissionRead: string;
  requiredPermissionWrite: string;
  auditAction: string;
  lifecycle: "active" | "deprecated" | "internal";
  /** tenant_settings key the value is stored under. */
  storageKey: string;
  /** tenant_settings value → config value (default: identity). */
  storageRead?: (stored: unknown) => unknown;
  /** config value → tenant_settings value (default: identity). */
  storageWrite?: (value: unknown) => unknown;
}

const featureDefinition = (key: string): PlatformConfigDefinition => ({
  key: `features.${key}`,
  category: "features",
  labelKey: `feature.admin.features.key.${key}`,
  descriptionKey: `feature.admin.features.keyDescription.${key}`,
  valueType: "boolean",
  defaultValue: false,
  allowedValues: null,
  tenantOverridable: true,
  requiredPermissionRead: "tenant.features.read",
  requiredPermissionWrite: "tenant.features.update",
  auditAction: AuditAction.FeatureToggled,
  lifecycle: "active",
  // Backwards compat: shares the legacy `feature.<key>` storage with /api/org/features.
  storageKey: `feature.${key}`,
  storageRead: (s) => Boolean((s as { enabled?: boolean } | null)?.enabled),
  storageWrite: (v) => ({ enabled: Boolean(v) }),
});

export const PLATFORM_CONFIG_DEFINITIONS: PlatformConfigDefinition[] = [
  ...ALLOWED_FEATURE_KEYS.map(featureDefinition),
  {
    key: "branding.app_name",
    category: "branding",
    labelKey: "feature.admin.config.def.branding.appName.label",
    descriptionKey: "feature.admin.config.def.branding.appName.description",
    valueType: "string",
    defaultValue: "Enterprise Platform",
    allowedValues: null,
    tenantOverridable: true,
    requiredPermissionRead: "tenant.config.read",
    requiredPermissionWrite: "tenant.config.write",
    auditAction: AuditAction.ConfigValueChanged,
    lifecycle: "active",
    storageKey: "config.branding.app_name",
  },
  {
    key: "branding.theme",
    category: "branding",
    labelKey: "feature.admin.config.def.branding.theme.label",
    descriptionKey: "feature.admin.config.def.branding.theme.description",
    valueType: "enum",
    defaultValue: "system",
    allowedValues: ["system", "light", "dark"],
    tenantOverridable: true,
    requiredPermissionRead: "tenant.config.read",
    requiredPermissionWrite: "tenant.config.write",
    auditAction: AuditAction.ConfigValueChanged,
    lifecycle: "active",
    storageKey: "config.branding.theme",
  },
  {
    key: "security.session_warning_banner",
    category: "security",
    labelKey: "feature.admin.config.def.security.sessionWarning.label",
    descriptionKey: "feature.admin.config.def.security.sessionWarning.description",
    valueType: "boolean",
    defaultValue: false,
    allowedValues: null,
    tenantOverridable: true,
    requiredPermissionRead: "tenant.config.read",
    requiredPermissionWrite: "tenant.config.write",
    auditAction: AuditAction.ConfigValueChanged,
    lifecycle: "active",
    storageKey: "config.security.session_warning_banner",
  },
  {
    key: "integrations.webhook_headers",
    category: "integrations",
    labelKey: "feature.admin.config.def.integrations.webhookHeaders.label",
    descriptionKey: "feature.admin.config.def.integrations.webhookHeaders.description",
    valueType: "json",
    defaultValue: {},
    allowedValues: null,
    tenantOverridable: true,
    requiredPermissionRead: "tenant.config.read",
    requiredPermissionWrite: "tenant.config.write",
    auditAction: AuditAction.ConfigValueChanged,
    lifecycle: "active",
    storageKey: "config.integrations.webhook_headers",
  },
];

export function findConfigDefinition(key: string): PlatformConfigDefinition | undefined {
  return PLATFORM_CONFIG_DEFINITIONS.find((d) => d.key === key);
}

/** Serialise a definition to the dependency-free DTO the SPA renders (drops storage + audit). */
export function toConfigDefinitionDto(d: PlatformConfigDefinition): ConfigDefinitionDto {
  return {
    key: d.key,
    category: d.category,
    labelKey: d.labelKey,
    descriptionKey: d.descriptionKey,
    valueType: d.valueType,
    defaultValue: d.defaultValue,
    allowedValues: d.allowedValues,
    tenantOverridable: d.tenantOverridable,
    requiredPermissionRead: d.requiredPermissionRead,
    requiredPermissionWrite: d.requiredPermissionWrite,
    lifecycle: d.lifecycle,
  };
}

export function readStoredValue(d: PlatformConfigDefinition, stored: unknown): unknown {
  return d.storageRead ? d.storageRead(stored) : stored;
}

export function toStoredValue(d: PlatformConfigDefinition, value: unknown): unknown {
  return d.storageWrite ? d.storageWrite(value) : value;
}
