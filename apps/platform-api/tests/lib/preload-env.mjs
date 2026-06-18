// Test env preload (node --test --import). Loads the managed runtime env
// (ADR-0072 generated .env/<stage>.env + .env/secrets/<stage>.env) into
// process.env for any keys NOT already set, so tests source DB/service
// credentials from the managed secrets pipeline (OpenBao-backed, ADR-0069)
// instead of a hardcoded default. NEVER overrides an explicit process.env value
// (so `POSTGRES_URL=… npm run test:*` and make-all stage-test still win), never
// reads the .env/ directory as a file, never prints values.
import fs from "node:fs";
import path from "node:path";

const stage = process.env["ENV"] ?? "test";
const root = process.cwd();

for (const rel of [
  path.join(".env", `${stage}.env`),
  path.join(".env", "secrets", `${stage}.env`),
]) {
  const p = path.join(root, rel);
  let isFile = false;
  try {
    isFile = fs.statSync(p).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) continue;
  for (const raw of fs.readFileSync(p, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
