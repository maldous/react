// ---------------------------------------------------------------------------
// WebPublicConfig — the browser/web application's PUBLIC configuration contract
// (V1C-CONF-05). The browser bundle must never carry server-only secrets, so
// this is a standalone, secret-free contract (it deliberately does NOT import
// the server-side @platform/config-runtime kernel, which reads process.env).
//
// Values come from Vite's import.meta.env (build/runtime-injected). The loader
// validates that no field is secret/server-only and returns a frozen object.
// ---------------------------------------------------------------------------

export type WebReloadClassification = "restart-required" | "reloadable";

export interface WebConfigFieldDef {
  /** import.meta.env key. */
  key: string;
  type: "string" | "boolean";
  default?: string | boolean;
  /** Must be true for every web field — a secret/server-only field is rejected at load. */
  public: true;
  restartOrReload?: WebReloadClassification;
  description?: string;
}

export const WEB_PUBLIC_CONFIG_SCHEMA = {
  dev: {
    key: "DEV",
    type: "boolean",
    default: false,
    public: true,
    restartOrReload: "restart-required",
    description: "Vite dev-mode flag.",
  },
  appVersion: {
    key: "VITE_APP_VERSION",
    type: "string",
    default: "0.0.0",
    public: true,
    restartOrReload: "restart-required",
    description: "Build version shown in the UI.",
  },
  faroCollectorUrl: {
    key: "VITE_FARO_COLLECTOR_URL",
    type: "string",
    default: "",
    public: true,
    restartOrReload: "restart-required",
    description: "Grafana Faro RUM collector URL (public endpoint).",
  },
} as const satisfies Record<string, WebConfigFieldDef>;

type WebValue<F extends WebConfigFieldDef> = F extends { type: "boolean" } ? boolean : string;
export type WebPublicConfig = {
  readonly [K in keyof typeof WEB_PUBLIC_CONFIG_SCHEMA]: WebValue<
    (typeof WEB_PUBLIC_CONFIG_SCHEMA)[K]
  >;
};

export class WebConfigError extends Error {}

function freeze<T>(v: T): Readonly<T> {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as Record<string, unknown>)) freeze(x);
  }
  return v;
}

/**
 * Build the immutable public web config from a source map (import.meta.env). Rejects any field that
 * is not classified `public` (a server-only/secret key must never reach the browser bundle).
 */
export function loadWebPublicConfig(source: Record<string, unknown> = {}): WebPublicConfig {
  const errors: string[] = [];
  const result: Record<string, unknown> = {};
  for (const [field, def] of Object.entries(WEB_PUBLIC_CONFIG_SCHEMA) as [
    string,
    WebConfigFieldDef,
  ][]) {
    if (def.public !== true) {
      errors.push(
        `Web config field "${field}" is not public — secret/server-only keys must not enter the browser bundle`
      );
      continue;
    }
    const raw = source[def.key];
    if (raw === undefined || raw === "") {
      if (def.default !== undefined) result[field] = def.default;
      else errors.push(`Required public web config "${field}" (${def.key}) is not set`);
      continue;
    }
    result[field] =
      def.type === "boolean" ? raw === true || raw === "true" || raw === "1" : String(raw);
  }
  if (errors.length > 0)
    throw new WebConfigError(
      `Invalid web config (${errors.length}):\n  - ${errors.join("\n  - ")}`
    );
  return freeze(result) as WebPublicConfig;
}

/** A field marked non-public (used by tests to prove secret keys are rejected). */
export function assertNoSecretFields(schema: Record<string, WebConfigFieldDef>): void {
  for (const [field, def] of Object.entries(schema))
    if (def.public !== true) throw new WebConfigError(`field "${field}" is not public`);
}
