#!/usr/bin/env node
// scripts/env/bootstrap.mjs <subcommand> <stage> [opts]
//
// Make-driven environment bootstrap helpers (ADR-0072). Plain node (no app imports);
// reads the tracked manifests + the generated runtime artifact .env/<stage>.env.
//
// Subcommands:
//   seed-secrets <stage>   Ensure runtime env; push secret keys to OpenBao when reachable
//                          (honest skip otherwise). Never prints a secret value.
//   seed-admin <stage>     Generate the per-environment global system administrator
//                          handoff: username from the manifest, one-time password from
//                          the generated artifact, an opaque secretRef. Writes a
//                          gitignored marker WITHOUT the plaintext password; best-effort
//                          OpenBao store; prints the handoff block.
//   print-admin <stage>    Re-print the handoff (explicit authorised local command).
//   rotate-secret <stage> <KEY>
//                          Rotate one LOCAL-BOOTSTRAP secret in the seeded material file
//                          (writes .env/secrets/<stage>.env) and regenerate. Real
//                          environments rotate via OpenBao + the operations port.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import {
  STAGES,
  loadManifest,
  generatedEnvPath,
  generatedSecretsPath,
  parseEnvFile,
  GENERATED_SECRETS_DIR,
  SECRET_ENV_KEYS,
} from "./lib/manifests.mjs";

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
function requireStage(stage) {
  if (!STAGES.includes(stage)) die(`unknown stage "${stage}" (expected ${STAGES.join(", ")})`);
}
function ensureGenerated(stage) {
  const path = generatedEnvPath(stage);
  if (!existsSync(path)) {
    die(`generated runtime env missing — run: make env-generate-runtime ENV=${stage}`);
  }
  return parseEnvFile(path);
}
function deterministicUuid(...parts) {
  const h = createHash("sha256").update(parts.join(":")).digest("hex");
  // RFC-4122-shaped (version nibble not strictly enforced — opaque ref only).
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
function adminMarkerPath(stage) {
  return generatedSecretsPath(stage).replace(/\.env$/, ".admin.json");
}

async function openbaoReachable() {
  const addr = process.env["OPENBAO_ADDR"];
  if (!addr) return null;
  try {
    const r = await fetch(`${addr.replace(/\/$/, "")}/v1/sys/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return r.ok || r.status === 429 || r.status === 472 || r.status === 473 ? addr : null;
  } catch {
    return null;
  }
}
async function openbaoPut(addr, kvPath, data) {
  const token = process.env["OPENBAO_TOKEN"] ?? "";
  const mount = process.env["OPENBAO_KV_MOUNT"] ?? "secret";
  const base = process.env["OPENBAO_KV_BASE_PATH"] ?? "platform";
  const url = `${addr.replace(/\/$/, "")}/v1/${mount}/data/${base}/${kvPath}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "X-Vault-Token": token, "content-type": "application/json" },
    body: JSON.stringify({ data }),
    signal: AbortSignal.timeout(3000),
  });
  if (!r.ok) throw new Error(`OpenBao PUT ${kvPath} -> ${r.status}`);
}

async function seedSecrets(stage) {
  const env = ensureGenerated(stage);
  const keys = SECRET_ENV_KEYS.filter((k) => env[k] !== undefined && env[k] !== "");
  console.log(
    `env-seed-secrets ${stage}: ${keys.length} secret key(s) managed (values not shown).`
  );
  const addr = await openbaoReachable();
  if (!addr) {
    console.log(
      `  ⚠ OpenBao not reachable (set OPENBAO_ADDR/OPENBAO_TOKEN; \`make compose-up\` profile secrets).`
    );
    console.log(
      `  ↳ LOCAL-BOOTSTRAP secrets live in .env/${stage}.env (gitignored). Re-run when OpenBao is up to seed.`
    );
    return;
  }
  let seeded = 0;
  for (const k of keys) {
    try {
      await openbaoPut(addr, `env/${stage}/${k}`, { value: env[k] });
      seeded++;
    } catch (e) {
      console.log(`  ✗ ${k}: ${e.message}`);
    }
  }
  console.log(`  ✓ seeded ${seeded}/${keys.length} secret(s) into OpenBao (env/${stage}/*).`);
}

function adminHandoff(stage, { rotate = false } = {}) {
  const manifest = loadManifest(stage);
  const env = ensureGenerated(stage);
  const username = (
    manifest.adminIdentity?.usernameTemplate ?? `sysadmin@${manifest.domain}`
  ).trim();
  const password = env["SYSADMIN_BOOTSTRAP_PASSWORD"];
  if (!password) die(`SYSADMIN_BOOTSTRAP_PASSWORD missing from .env/${stage}.env`);
  const secretRef = `secret:${deterministicUuid("sysadmin", stage, username)}`;
  const mode = manifest.adminIdentity?.mode ?? "local-bootstrap";
  const url = manifest.baseUrl ?? `http://${manifest.domain}`;

  // Marker carries NO plaintext password — only username + opaque ref + metadata.
  mkdirSync(GENERATED_SECRETS_DIR, { recursive: true });
  const marker = {
    environmentId: stage,
    username,
    secretRef,
    mode,
    rotateBeforeProduction: manifest.adminIdentity?.rotateBeforeProduction ?? false,
    seededAt: new Date().toISOString(),
  };
  writeFileSync(adminMarkerPath(stage), JSON.stringify(marker, null, 2) + "\n", { mode: 0o600 });
  return { username, password, secretRef, mode, url, rotate, marker };
}

function printHandoff(h, { regenerated = false } = {}) {
  const banner = h.mode.startsWith("local")
    ? " (LOCAL/BOOTSTRAP MODE — ROTATE BEFORE REAL EXPOSURE)"
    : "";
  console.log("");
  console.log(`Environment: ${h.marker.environmentId}${banner}`);
  console.log(`URL:         ${h.url}`);
  console.log(`Username:    ${h.username}`);
  console.log(`Password:    ${h.password}`);
  console.log(`Secret ref:  ${h.secretRef}`);
  if (regenerated)
    console.log(`(handoff re-printed from .env/secrets/${h.marker.environmentId}.admin.json)`);
  console.log("");
}

async function seedAdmin(stage) {
  const h = adminHandoff(stage);
  console.log(`env-seed-admin ${stage}: global system administrator handoff generated.`);
  const addr = await openbaoReachable();
  if (addr) {
    try {
      await openbaoPut(addr, `sysadmin/${stage}`, { username: h.username, password: h.password });
      console.log(`  ✓ admin password stored in OpenBao (sysadmin/${stage}); ref ${h.secretRef}.`);
    } catch (e) {
      console.log(`  ⚠ OpenBao store failed (${e.message}); password remains local-bootstrap.`);
    }
  } else {
    console.log(
      `  ⚠ OpenBao not reachable — password is local-bootstrap (from .env/${stage}.env).`
    );
  }
  printHandoff(h);
}

function printAdmin(stage) {
  const path = adminMarkerPath(stage);
  if (!existsSync(path))
    die(`no admin handoff for ${stage} — run: make env-seed-admin ENV=${stage}`);
  const marker = JSON.parse(readFileSync(path, "utf8"));
  const env = ensureGenerated(stage);
  const manifest = loadManifest(stage);
  printHandoff(
    {
      marker,
      username: marker.username,
      password: env["SYSADMIN_BOOTSTRAP_PASSWORD"],
      secretRef: marker.secretRef,
      mode: marker.mode,
      url: manifest.baseUrl ?? `http://${manifest.domain}`,
    },
    { regenerated: true }
  );
}

function rotateSecret(stage, key) {
  if (!key || !/^[A-Z][A-Z0-9_]*$/.test(key))
    die(`rotate-secret requires a valid KEY (^[A-Z][A-Z0-9_]*$)`);
  if (!SECRET_ENV_KEYS.includes(key)) die(`KEY "${key}" is not a managed secret key`);
  const path = generatedSecretsPath(stage);
  const seeded = parseEnvFile(path);
  seeded[key] = randomBytes(32).toString("hex");
  mkdirSync(GENERATED_SECRETS_DIR, { recursive: true });
  const body =
    `# .env/secrets/${stage}.env — SEEDED secret material (gitignored). Overrides local-bootstrap.\n` +
    Object.entries(seeded)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") +
    "\n";
  writeFileSync(path, body, { mode: 0o600 });
  console.log(
    `env-rotate-secret ${stage}: rotated ${key} in seeded material (.env/secrets/${stage}.env).`
  );
  console.log(`  ↳ run: make env-generate-runtime ENV=${stage} && (restart dependent services)`);
}

async function main() {
  const [sub, stage, arg3] = process.argv.slice(2);
  if (!sub) die("usage: bootstrap.mjs <seed-secrets|seed-admin|print-admin|rotate-secret> <stage>");
  requireStage(stage);
  switch (sub) {
    case "seed-secrets":
      return seedSecrets(stage);
    case "seed-admin":
      return seedAdmin(stage);
    case "print-admin":
      return printAdmin(stage);
    case "rotate-secret":
      return rotateSecret(stage, arg3);
    default:
      die(`unknown subcommand: ${sub}`);
  }
}

await main();
