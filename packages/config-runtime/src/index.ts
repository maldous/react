export const packageName = "@platform/config-runtime";

// ---------------------------------------------------------------------------
// @platform/config-runtime — canonical typed configuration kernel (ADR-0076).
//
// V1C-CONF-01/02/03/05/07/08: applications assemble ONE typed, validated, immutable
// configuration object at their composition root using `loadConfig(schema)`. Schema fields
// carry metadata (secret / public / restart-or-reload / description) so a machine-readable
// catalogue can be generated without leaking secret VALUES. Tests pass a typed `overrides`
// seam (unknown overrides fail). Missing/invalid REQUIRED values fail at load (no production
// fallback). The legacy `getEnv*` helpers remain for not-yet-migrated consumers (V1C-CONF-06).
// ---------------------------------------------------------------------------

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// --- legacy direct-access helpers (retained until V1C-CONF-06 migrates all consumers) ---
export function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}
export function getEnvRequired(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") {
    throw new ConfigError(`Required environment variable "${key}" is not set`);
  }
  return value;
}
export function getEnvInt(key: string, defaultValue?: number): number | undefined {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new ConfigError(`Environment variable "${key}" must be an integer, got "${raw}"`);
  }
  return parsed;
}
export function getEnvBool(key: string, defaultValue?: boolean): boolean | undefined {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new ConfigError(`Environment variable "${key}" must be "true" or "false", got "${raw}"`);
}

// --- typed config kernel ---

export type ReloadClassification = "restart-required" | "reloadable";

interface ConfigFieldBase {
  /** Environment variable name the value is read from. */
  key: string;
  /** Holds a credential; never emitted as a value into metadata or public config. */
  secret?: boolean;
  /** Safe to expose to the browser/public bundle. */
  public?: boolean;
  /** Whether changing this value requires a restart or can be hot-reloaded. */
  restartOrReload?: ReloadClassification;
  description?: string;
}
export type ConfigFieldDef =
  | (ConfigFieldBase & { type: "string"; default?: string; optional?: boolean })
  | (ConfigFieldBase & { type: "number"; default?: number; optional?: boolean })
  | (ConfigFieldBase & { type: "boolean"; default?: boolean; optional?: boolean });

export type ConfigSchema = Record<string, ConfigFieldDef>;

type BaseValue<F extends ConfigFieldDef> = F extends { type: "string" }
  ? string
  : F extends { type: "number" }
    ? number
    : boolean;

// An `optional` field with no value resolves to `undefined` (no default, no error).
type ConfigValue<F extends ConfigFieldDef> = F extends { optional: true }
  ? BaseValue<F> | undefined
  : BaseValue<F>;

export type ResolvedConfig<S extends ConfigSchema> = {
  readonly [K in keyof S]: ConfigValue<S[K]>;
};

export interface ConfigPropertyMetadata {
  field: string;
  key: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  secret: boolean;
  public: boolean;
  default: string | number | boolean | null;
  restartOrReload: ReloadClassification;
  description: string | null;
}

export interface LoadConfigOptions<S extends ConfigSchema> {
  /** Source map of raw values (defaults to process.env). */
  source?: Record<string, string | undefined>;
  /** Typed, hermetic test/override seam keyed by FIELD name. Unknown fields fail. */
  overrides?: Partial<{ [K in keyof S]: ConfigValue<S[K]> }>;
}

const isRequired = (def: ConfigFieldDef): boolean =>
  !def.optional && !("default" in def && def.default !== undefined);

function coerce(fieldName: string, def: ConfigFieldDef, raw: string): string | number | boolean {
  if (def.type === "number") {
    const n = Number(raw);
    if (Number.isNaN(n))
      throw new ConfigError(
        `Config "${fieldName}" (env ${def.key}) must be a number, got "${raw}"`
      );
    return n;
  }
  if (def.type === "boolean") {
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    throw new ConfigError(
      `Config "${fieldName}" (env ${def.key}) must be true/false, got "${raw}"`
    );
  }
  return raw;
}

/** Recursively freeze a structure so projections are immutable (V1C-CONF-03). */
export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/**
 * Build a validated, deeply-immutable typed config object from a schema (V1C-CONF-01/02/03).
 * ALL missing-required / invalid fields are collected and reported together (fail-closed boot).
 * Unknown `overrides` keys fail (V1C-CONF-07). No production fallback is introduced.
 */
// Resolve a single field into `result`, pushing any error onto `errors`. Extracted from loadConfig
// to keep its cognitive complexity low (override → default/optional/required → coerce).
function resolveField(
  fieldName: string,
  def: ConfigFieldDef,
  source: Record<string, string | undefined>,
  overrides: Record<string, unknown>,
  result: Record<string, unknown>,
  errors: string[]
): void {
  if (fieldName in overrides) {
    result[fieldName] = overrides[fieldName];
    return;
  }
  const raw = source[def.key];
  if (raw === undefined || raw === "") {
    if ("default" in def && def.default !== undefined) result[fieldName] = def.default;
    else if (def.optional)
      result[fieldName] = undefined; // optional + unset ⇒ undefined (no fallback, no error)
    else errors.push(`Required config "${fieldName}" (env ${def.key}) is not set`);
    return;
  }
  try {
    result[fieldName] = coerce(fieldName, def, raw);
  } catch (e) {
    errors.push((e as Error).message);
  }
}

export function loadConfig<S extends ConfigSchema>(
  schema: S,
  opts: LoadConfigOptions<S> = {}
): ResolvedConfig<S> {
  const source = opts.source ?? process.env;
  const overrides = (opts.overrides ?? {}) as Record<string, unknown>;
  const errors: string[] = [];

  for (const k of Object.keys(overrides)) {
    if (!(k in schema)) errors.push(`Unknown config override "${k}" (not in schema)`);
  }

  const result: Record<string, unknown> = {};
  for (const [fieldName, def] of Object.entries(schema)) {
    resolveField(fieldName, def, source, overrides, result, errors);
  }

  if (errors.length > 0)
    throw new ConfigError(
      `Invalid configuration (${errors.length}):\n  - ${errors.join("\n  - ")}`
    );
  return deepFreeze(result) as ResolvedConfig<S>;
}

/** Metadata default — never reveals a secret's default; non-secret defaults pass through. */
function metadataDefault(def: ConfigFieldDef): string | number | boolean | null {
  if (def.secret) return null;
  return "default" in def && def.default !== undefined ? def.default : null;
}

/** Machine-readable property metadata — NEVER includes secret values. */
export function configMetadata(schema: ConfigSchema): ConfigPropertyMetadata[] {
  return Object.entries(schema).map(([field, def]) => ({
    field,
    key: def.key,
    type: def.type,
    required: isRequired(def),
    secret: !!def.secret,
    public: !!def.public,
    default: metadataDefault(def),
    restartOrReload: def.restartOrReload ?? "restart-required",
    description: def.description ?? null,
  }));
}
