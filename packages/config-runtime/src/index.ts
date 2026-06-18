export const packageName = "@platform/config-runtime";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

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

type ConfigFieldDef =
  | { key: string; type: "string"; default?: string }
  | { key: string; type: "number"; default?: number }
  | { key: string; type: "boolean"; default?: boolean };

type ConfigSchema = Record<string, ConfigFieldDef>;

type ConfigValue<F extends ConfigFieldDef> = F extends { type: "string" }
  ? string
  : F extends { type: "number" }
    ? number
    : boolean;

type ResolvedConfig<S extends ConfigSchema> = {
  [K in keyof S]: ConfigValue<S[K]>;
};

/** Resolve a single config field's value (or default), throwing on invalid input. */
function resolveConfigField(fieldName: string, def: ConfigFieldDef): unknown {
  const raw = process.env[def.key];
  if (raw === undefined || raw === "") {
    if ("default" in def && def.default !== undefined) {
      return def.default;
    }
    throw new ConfigError(`Required config "${fieldName}" (env: ${def.key}) is not set`);
  }
  if (def.type === "number") {
    const parsed = Number(raw);
    if (isNaN(parsed)) {
      throw new ConfigError(`Config "${fieldName}" must be a number, got "${raw}"`);
    }
    return parsed;
  }
  if (def.type === "boolean") {
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    throw new ConfigError(`Config "${fieldName}" must be true/false, got "${raw}"`);
  }
  return raw;
}

export function loadConfig<S extends ConfigSchema>(schema: S): ResolvedConfig<S> {
  const result: Record<string, unknown> = {};
  for (const [fieldName, def] of Object.entries(schema)) {
    result[fieldName] = resolveConfigField(fieldName, def);
  }
  return result as ResolvedConfig<S>;
}
