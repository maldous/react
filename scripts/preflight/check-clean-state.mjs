#!/usr/bin/env node
// Checks for stale containers from a previous run that would cause port conflicts.

import { spawnSync } from "node:child_process";
import process from "node:process";

const PROJECTS = ["react-dev", "react-test", "react-staging", "react-prod", "react"];

let warnings = 0;

for (const project of PROJECTS) {
  const result = spawnSync(
    "docker",
    ["ps", "-q", "--filter", `label=com.docker.compose.project=${project}`],
    { encoding: "utf8" }
  );

  if (result.error) {
    // docker not running — check-docker.sh will catch this
    continue;
  }

  const running = (result.stdout ?? "").trim().split("\n").filter(Boolean);
  if (running.length > 0) {
    console.warn(`⚠ ${running.length} stale container(s) found for project "${project}"`);
    // "react" is the Tilt default project (no env suffix); "react-dev" → "dev" etc.
    const env = project === "react" ? "dev" : project.replace("react-", "") || "dev";
    console.warn(`  Run: make clean ENV=${env} or make clean-all`);
    warnings++;
  } else {
    console.log(`✓ no stale containers for "${project}"`);
  }
}

if (warnings > 0) {
  console.error(`\n⚠ ${warnings} project(s) have stale containers from a previous run`);
  console.error("  If this is unexpected, run 'make env-down-all' to stop all environments.");
  console.error(
    "  If you intentionally left environments running, use 'make promote' to re-validate."
  );
  process.exit(1);
}
console.log("✓ no stale containers");
