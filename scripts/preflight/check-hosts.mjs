#!/usr/bin/env node
// Checks that required hostnames resolve. Warn-only — never blocks the pipeline.

import { spawnSync } from "node:child_process";

const HOSTS = [
  {
    host: "dev.localhost",
    note: "auto-resolves via RFC 6761",
  },
  {
    host: "test.localhost",
    note: "auto-resolves via RFC 6761",
  },
  {
    host: "aldous.info",
    note: "staging/prod — needs /etc/hosts or real DNS",
  },
  {
    host: "staging.aldous.info",
    note: "staging — needs /etc/hosts or real DNS",
  },
];

function resolves(host) {
  // Try `host` first, fall back to `ping`
  const r = spawnSync("host", [host], { stdio: "ignore" });
  if (r.status === 0) return true;
  const p = spawnSync("ping", ["-c1", "-W1", host], { stdio: "ignore" });
  return p.status === 0;
}

for (const { host, note } of HOSTS) {
  if (resolves(host)) {
    console.log(`✓ ${host} resolves`);
  } else {
    console.warn(`⚠ ${host} does not resolve (${note})`);
    console.warn(`  Add to /etc/hosts: 127.0.0.1 ${host}`);
  }
}

console.log("✓ host check complete (warn-only)");
