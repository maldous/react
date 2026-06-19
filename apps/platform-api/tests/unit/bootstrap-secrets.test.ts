import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSecretRef,
  loadBootstrapSecretConfig,
  createSecretStoreFromBootstrap,
  resolveManagedSecret,
  bootstrapMetadata,
  BootstrapSecretError,
  type SecretRef,
} from "../../src/config/bootstrap-secrets.ts";
import type { SecretStore } from "../../src/ports/secret-store.ts";

// A typed fake SecretStore (no DB) — proves resolution + serialization without revealing values.
function fakeStore(values: Record<string, string>): SecretStore {
  return {
    async resolve(_org, ref) {
      return values[ref] ?? null;
    },
    async put() {
      throw new Error("not used");
    },
    async getMetadata() {
      return null;
    },
    async list() {
      return [];
    },
    async revoke() {
      return true;
    },
    async delete() {
      return true;
    },
    async readiness() {
      return { provider: "builtin", status: "ready", detail: "fake" };
    },
  };
}

test("SecretRef validation is strict", () => {
  assert.ok(isSecretRef("secret:abc-123"));
  assert.ok(isSecretRef("secret:platform:keycloak/client"));
  assert.ok(!isSecretRef("abc"));
  assert.ok(!isSecretRef("secret:")); // empty body
  assert.ok(!isSecretRef("plain:value"));
  assert.ok(!isSecretRef(123));
});

test("provider selection is explicit — builtin default", () => {
  const b = loadBootstrapSecretConfig({ TENANT_SECRET_ENCRYPTION_KEY: "a".repeat(64) });
  assert.equal(b.provider, "builtin");
  assert.equal(b.postgresSecretStore?.encryptionKeyPresent, true);
  assert.ok(Object.isFrozen(b));
});

test("openbao selected WITHOUT address/token fails closed — NO implicit fallback", () => {
  assert.throws(
    () => loadBootstrapSecretConfig({ SECRET_STORE_PROVIDER: "openbao" }),
    /no implicit fallback/
  );
  assert.throws(
    () =>
      loadBootstrapSecretConfig({
        SECRET_STORE_PROVIDER: "openbao",
        OPENBAO_ADDR: "http://bao:8200",
      }),
    /OPENBAO_TOKEN/
  );
});

test("openbao bootstrap loads from explicit address + token", () => {
  const b = loadBootstrapSecretConfig({
    SECRET_STORE_PROVIDER: "openbao",
    OPENBAO_ADDR: "http://bao:8200",
    OPENBAO_TOKEN: "t0ken",
  });
  assert.equal(b.provider, "openbao");
  assert.equal(b.openBao?.token.reveal(), "t0ken");
});

test("Tier-0 supports mounted secret files (<KEY>_FILE)", () => {
  const b = loadBootstrapSecretConfig(
    {
      SECRET_STORE_PROVIDER: "openbao",
      OPENBAO_ADDR: "http://bao:8200",
      OPENBAO_TOKEN_FILE: "/run/secrets/bao",
    },
    (p) => (p === "/run/secrets/bao" ? "file-token\n" : "")
  );
  assert.equal(b.openBao?.token.reveal(), "file-token");
});

test("invalid provider fails", () => {
  assert.throws(() => loadBootstrapSecretConfig({ SECRET_STORE_PROVIDER: "vault" }), /must be/);
});

test("bootstrapMetadata exposes presence + provider only — NEVER values", () => {
  const b = loadBootstrapSecretConfig({
    SECRET_STORE_PROVIDER: "openbao",
    OPENBAO_ADDR: "http://bao:8200",
    OPENBAO_TOKEN: "supersecret",
  });
  const meta = bootstrapMetadata(b);
  const json = JSON.stringify(meta);
  assert.ok(!json.includes("supersecret"), "metadata must not contain the token value");
  assert.ok(meta.every((m) => m.secretTier === "bootstrap"));
  assert.ok(meta.find((m) => m.key === "OPENBAO_TOKEN")?.present);
});

test("resolveManagedSecret: required+unknown fails; optional+unset → null; valid → value", async () => {
  const store = fakeStore({ "secret:kc": "kc-value" });
  assert.equal(
    await resolveManagedSecret(store, "platform", "secret:kc" as SecretRef, {
      required: true,
      field: "keycloakClientSecret",
    }),
    "kc-value"
  );
  assert.equal(
    await resolveManagedSecret(store, "platform", undefined, { required: false, field: "stripe" }),
    null
  );
  await assert.rejects(
    resolveManagedSecret(store, "platform", undefined, {
      required: true,
      field: "keycloakClientSecret",
    }),
    BootstrapSecretError
  );
  await assert.rejects(
    resolveManagedSecret(store, "platform", "secret:missing" as SecretRef, {
      required: true,
      field: "x",
    }),
    /did not resolve/
  );
  await assert.rejects(
    resolveManagedSecret(store, "platform", "not-a-ref" as SecretRef, {
      required: true,
      field: "x",
    }),
    /valid SecretRef/
  );
});

test("bootstrap-cycle prevention: Tier-0 is loaded from env/file, then the store is created (never the reverse)", async () => {
  // loadBootstrapSecretConfig takes (source, readFile) — it has NO SecretStore parameter, so it
  // cannot resolve its own root of trust from the store it opens. createSecretStoreFromBootstrap
  // consumes the already-loaded Tier-0 config. The order is structurally enforced.
  // loadBootstrapSecretConfig resolves Tier-0 from an injected source/readFile ONLY — it accepts no
  // SecretStore, so it cannot resolve its own root of trust from the store it opens.
  const b = loadBootstrapSecretConfig({ TENANT_SECRET_ENCRYPTION_KEY: "a".repeat(64) }, () => {
    throw new Error("readFile must not be needed for an env-provided root of trust");
  });
  assert.equal(b.provider, "builtin");
  // createSecretStoreFromBootstrap CONSUMES the already-loaded Tier-0 config (store is built FROM
  // bootstrap, never the reverse). Calling it requires a bootstrap config argument.
  await assert.rejects(
    // @ts-expect-error — deliberately missing the bootstrap arg to prove it is required
    createSecretStoreFromBootstrap({}),
    /provider|bootstrap|Cannot/
  );
});
