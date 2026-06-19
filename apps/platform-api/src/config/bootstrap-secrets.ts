// ---------------------------------------------------------------------------
// Two-tier secret model (V1C-CONF-04; ADR-0069 + ADR-0076).
//
// TIER 0 — bootstrap root of trust: the minimum material needed to OPEN the
// SecretStorePort. It CANNOT be resolved from the store it opens, so it is
// loaded only here, at the composition boundary, from an authorised deployment
// source (mounted secret files preferred; a narrow, governed env fallback at this
// boundary only). Provider selection is EXPLICIT — there is no implicit
// OpenBao⇄Postgres fallback. Tier-0 values never appear in the catalogue, logs,
// audit data, readiness payloads, or the browser bundle.
//
// TIER 1 — managed runtime secrets: held in typed configuration as opaque
// `SecretRef` values and resolved through SecretStorePort AFTER bootstrap. No
// Tier-1 plaintext belongs in the normal application config object.
// ---------------------------------------------------------------------------
import fs from "node:fs";
import type { SecretStore, SecretProvider } from "../ports/secret-store.ts";

// --- Tier-1: opaque secret references ---

export type SecretRef = `secret:${string}`;
const SECRET_REF_RE = /^secret:[A-Za-z0-9._:/-]+$/;

export function isSecretRef(value: unknown): value is SecretRef {
  return typeof value === "string" && SECRET_REF_RE.test(value);
}

/** Selected Tier-1 references carried in typed config. Optional: unset ⇒ the owning
 *  capability/provider must be explicitly disabled (or, transitionally until V1C-CONF-06,
 *  the legacy direct env value is used by the consumer). NEVER a plaintext value. */
export interface ManagedSecretReferences {
  readonly keycloakClientSecret?: SecretRef;
  readonly objectStorageAccessKey?: SecretRef;
  readonly objectStorageSecretKey?: SecretRef;
  readonly provisionerClientSecret?: SecretRef;
}

// --- Tier-0: bootstrap root of trust ---

/** A Tier-0 value: either a direct (env) value or a mounted-file path. Never serialised. */
export interface BootstrapSecretValue {
  readonly present: boolean;
  /** Reveal the material — ONLY the bootstrap loader/adapter factory calls this. */
  readonly reveal: () => string;
}

export interface OpenBaoBootstrap {
  readonly address: string;
  readonly token: BootstrapSecretValue;
  readonly mount: string;
  readonly kvBasePath: string;
}

export interface PostgresSecretStoreBootstrap {
  /** The runtime app pool connection is the Tier-0 substrate (POSTGRES_APP_URL). */
  readonly encryptionKeyPresent: boolean;
}

export interface BootstrapSecretConfig {
  readonly provider: SecretProvider; // "builtin" | "openbao" — explicit, no fallback
  readonly openBao?: OpenBaoBootstrap;
  readonly postgresSecretStore?: PostgresSecretStoreBootstrap;
}

export class BootstrapSecretError extends Error {}

type Source = Record<string, string | undefined>;
type ReadFile = (path: string) => string;

// Tier-0 value: prefer a mounted file (`<KEY>_FILE`), else a narrow governed env value.
function bootstrapValue(source: Source, key: string, readFile: ReadFile): BootstrapSecretValue {
  const filePath = source[`${key}_FILE`];
  if (filePath) {
    return { present: true, reveal: () => readFile(filePath).trim() };
  }
  const raw = source[key];
  if (raw !== undefined && raw !== "") {
    return { present: true, reveal: () => raw };
  }
  return {
    present: false,
    reveal: () => {
      throw new BootstrapSecretError(`bootstrap secret "${key}" is not set (env or ${key}_FILE)`);
    },
  };
}

/**
 * Load the Tier-0 bootstrap root of trust at the composition boundary. Provider selection is
 * EXPLICIT (SECRET_STORE_PROVIDER); there is NO implicit OpenBao⇄Postgres fallback. Required
 * material is validated here and fails closed. The result is immutable and never catalogued.
 */
export function loadBootstrapSecretConfig(
  source: Source = process.env,
  readFile: ReadFile = (p) => fs.readFileSync(p, "utf8")
): BootstrapSecretConfig {
  const provider = (source["SECRET_STORE_PROVIDER"] ?? "builtin").toLowerCase();
  if (provider !== "builtin" && provider !== "openbao") {
    throw new BootstrapSecretError(
      `SECRET_STORE_PROVIDER must be "builtin" or "openbao", got "${provider}"`
    );
  }

  if (provider === "openbao") {
    const address = source["OPENBAO_ADDR"];
    const token = bootstrapValue(source, "OPENBAO_TOKEN", readFile);
    // EXPLICIT: openbao selected but its root-of-trust is absent ⇒ fail closed (no builtin fallback).
    if (!address)
      throw new BootstrapSecretError(
        "SECRET_STORE_PROVIDER=openbao requires OPENBAO_ADDR (no implicit fallback)"
      );
    if (!token.present)
      throw new BootstrapSecretError(
        "SECRET_STORE_PROVIDER=openbao requires OPENBAO_TOKEN or OPENBAO_TOKEN_FILE (no implicit fallback)"
      );
    return Object.freeze({
      provider: "openbao",
      openBao: Object.freeze({
        address,
        token,
        mount: source["OPENBAO_KV_MOUNT"] ?? "secret",
        kvBasePath: source["OPENBAO_KV_BASE_PATH"] ?? "platform",
      }),
    });
  }

  // builtin (Postgres-backed): the app pool is the substrate; the encryption root must be present
  // for at-rest encryption (TENANT_SECRET_ENCRYPTION_KEY, 32-byte hex). Read here, not from the store.
  const encKey = bootstrapValue(source, "TENANT_SECRET_ENCRYPTION_KEY", readFile);
  return Object.freeze({
    provider: "builtin",
    postgresSecretStore: Object.freeze({ encryptionKeyPresent: encKey.present }),
  });
}

/**
 * Reveal the Tier-0 at-rest encryption root (TENANT_SECRET_ENCRYPTION_KEY) for the crypto modules
 * that PERFORM at-rest encryption/decryption (token-crypto, tenant-secret-crypto, the credential
 * store). Unlike managed (Tier-1) secrets, this root cannot be stored in the store it unlocks, so it
 * is read at the Tier-0 boundary only. Returns the raw value (env or `<KEY>_FILE`) or undefined when
 * absent — matching the prior direct `process.env` read (empty ⇒ undefined). Never catalogued.
 */
export function loadTenantEncryptionKeyHex(
  source: Source = process.env,
  readFile: ReadFile = (p) => fs.readFileSync(p, "utf8")
): string | undefined {
  const v = bootstrapValue(source, "TENANT_SECRET_ENCRYPTION_KEY", readFile);
  return v.present ? v.reveal() : undefined;
}

/**
 * Construct the SecretStorePort from the Tier-0 bootstrap config. EXPLICIT provider — never an
 * implicit fallback. The Postgres store uses the supplied pool (POSTGRES_APP_URL substrate); the
 * OpenBao store uses the Tier-0 address/token. The encryption key / token are read ONLY here.
 */
export async function createSecretStoreFromBootstrap(
  pool: import("pg").Pool,
  bootstrap: BootstrapSecretConfig,
  warn: (message: string, meta: Record<string, unknown>) => void = () => {}
): Promise<SecretStore> {
  if (bootstrap.provider === "openbao") {
    if (!bootstrap.openBao)
      throw new BootstrapSecretError("openbao provider selected without bootstrap material");
    const { OpenBaoSecretStore } = await import("../adapters/openbao-secret-store.ts");
    return new OpenBaoSecretStore(pool, {
      address: bootstrap.openBao.address,
      token: bootstrap.openBao.token.reveal(),
      mount: bootstrap.openBao.mount,
      kvBasePath: bootstrap.openBao.kvBasePath,
      warn,
    });
  }
  const { PostgresSecretStore } = await import("../adapters/postgres-secret-store.ts");
  return new PostgresSecretStore(pool);
}

/**
 * Resolve a Tier-1 managed secret reference through the store. `required` references that cannot be
 * resolved fail closed; optional references (disabled capability) return null.
 */
export async function resolveManagedSecret(
  store: SecretStore,
  scope: string,
  ref: SecretRef | undefined,
  opts: { required: boolean; field: string }
): Promise<string | null> {
  if (!ref) {
    if (opts.required)
      throw new BootstrapSecretError(`required managed secret "${opts.field}" has no SecretRef`);
    return null;
  }
  if (!isSecretRef(ref))
    throw new BootstrapSecretError(`managed secret "${opts.field}" is not a valid SecretRef`);
  const value = await store.resolve(scope, ref);
  if (value === null && opts.required)
    throw new BootstrapSecretError(
      `required managed secret "${opts.field}" (${ref}) did not resolve (unknown/revoked)`
    );
  return value;
}

/** Catalogue-safe Tier-0 description — presence + provider only, NEVER values. */
export function bootstrapMetadata(bootstrap: BootstrapSecretConfig): Array<{
  key: string;
  secretTier: "bootstrap";
  provider: SecretProvider;
  present: boolean;
  restartOrReload: "restart-required";
}> {
  const rows: Array<{
    key: string;
    secretTier: "bootstrap";
    provider: SecretProvider;
    present: boolean;
    restartOrReload: "restart-required";
  }> = [
    {
      key: "SECRET_STORE_PROVIDER",
      secretTier: "bootstrap",
      provider: bootstrap.provider,
      present: true,
      restartOrReload: "restart-required",
    },
  ];
  if (bootstrap.provider === "openbao" && bootstrap.openBao) {
    rows.push({
      key: "OPENBAO_ADDR",
      secretTier: "bootstrap",
      provider: "openbao",
      present: true,
      restartOrReload: "restart-required",
    });
    rows.push({
      key: "OPENBAO_TOKEN",
      secretTier: "bootstrap",
      provider: "openbao",
      present: bootstrap.openBao.token.present,
      restartOrReload: "restart-required",
    });
  } else {
    rows.push({
      key: "TENANT_SECRET_ENCRYPTION_KEY",
      secretTier: "bootstrap",
      provider: "builtin",
      present: bootstrap.postgresSecretStore?.encryptionKeyPresent ?? false,
      restartOrReload: "restart-required",
    });
  }
  return rows;
}
