#!/usr/bin/env node
// Detects cross-environment port collisions by reading all four .env.* files.
// Environments that can run simultaneously: dev+test (both local), staging+prod.

import { readFileSync, existsSync } from "node:fs";
import process from "node:process";

function parseEnvPorts(path) {
  if (!existsSync(path)) return {};
  const map = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+_PORT)=(\d+)/);
    if (m) map[m[1]] = Number(m[2]);
  }
  return map;
}

const stages = ["dev", "test", "staging", "prod"];
const portMap = {}; // port -> [{ stage, key }]

for (const stage of stages) {
  const ports = parseEnvPorts(`.env.${stage}`);
  for (const [key, port] of Object.entries(ports)) {
    if (!portMap[port]) portMap[port] = [];
    portMap[port].push({ stage, key });
  }
}

let errors = 0;
// Environments that can run simultaneously
const CONCURRENT_PAIRS = [
  ["dev", "test"],
  ["staging", "prod"],
];

for (const [port, users] of Object.entries(portMap)) {
  if (users.length < 2) continue;
  for (const [a, b] of CONCURRENT_PAIRS) {
    const aUser = users.find((u) => u.stage === a);
    const bUser = users.find((u) => u.stage === b);
    if (aUser && bUser) {
      console.error(`✗ Port ${port} collision: ${a}/${aUser.key} and ${b}/${bUser.key}`);
      errors++;
    }
  }
}

if (errors > 0) {
  console.error(`\n✗ ${errors} port conflict(s) found`);
  process.exit(1);
}
console.log("✓ no cross-environment port conflicts");
