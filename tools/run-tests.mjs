#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TEST_RE = /\.(?:test|spec)\.(?:mjs|js)$/;

function collectTests(input) {
  if (!fs.existsSync(input)) return [input];
  const stat = fs.statSync(input);
  if (stat.isFile()) return [input];
  const out = [];
  for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
    const full = path.join(input, entry.name);
    if (entry.isDirectory()) out.push(...collectTests(full));
    else if (entry.isFile() && TEST_RE.test(entry.name)) out.push(full);
  }
  return out.sort();
}

const requested = process.argv.slice(2);
const tests = requested.length ? requested.flatMap(collectTests) : [];
if (requested.length && tests.length === 0) {
  console.error(`No test files found for: ${requested.join(" ")}`);
  process.exit(1);
}

const args = ["--test", ...tests];
const result = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
