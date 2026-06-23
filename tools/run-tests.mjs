#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_RE = /\.(?:test|spec)\.(?:mjs|js|ts)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", "e2e-results", "playwright-report"]);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: rootDir, stdio: "inherit" });
  return result.status ?? 1;
}

function collectTests(input) {
  if (!fs.existsSync(input)) return [input];
  const stat = fs.statSync(input);
  if (stat.isFile()) return [input];
  const out = [];
  for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(input, entry.name);
    if (entry.isDirectory()) out.push(...collectTests(full));
    else if (entry.isFile() && TEST_RE.test(entry.name)) out.push(full);
  }
  return out.sort();
}

const requested = process.argv.slice(2);
if (requested.length === 0) {
  const defaultCommands = [
    ["npm", ["run", "test:platform-api:unit-safe"]],
    ["npm", ["run", "test:frontend:run"]],
    [
      process.execPath,
      [
        path.join("tools", "run-tests.mjs"),
        path.join("tools", "v2-readiness"),
        path.join("tools", "security"),
      ],
    ],
  ];

  for (const [command, args] of defaultCommands) {
    const status = run(command, args);
    if (status !== 0) process.exit(status);
  }
  process.exit(0);
}

const tests = requested.length ? requested.flatMap(collectTests) : [];
if (requested.length && tests.length === 0) {
  console.error(`No test files found for: ${requested.join(" ")}`);
  process.exit(1);
}

const args = [];
if (tests.some((testFile) => testFile.endsWith(".ts"))) {
  args.push(
    "--loader",
    path.join(rootDir, "apps/platform-api/loader.mjs"),
    "--import",
    path.join(rootDir, "apps/platform-api/tests/lib/preload-unit-env.mjs")
  );
}
args.push("--test", ...tests);
process.exit(run(process.execPath, args));
