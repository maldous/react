#!/usr/bin/env node
/**
 * Checks the SonarQube quality gate for the project and exits non-zero on failure.
 *
 * Required env vars:
 *   SONAR_HOST_URL     — SonarQube server URL (default: http://localhost:9003)
 *   SONAR_TOKEN        — SonarQube user token
 *   SONAR_PROJECT_KEY  — Project key (default: maldous-react)
 */
import https from "node:https";
import http from "node:http";
import process from "node:process";

const HOST = process.env.SONAR_HOST_URL ?? "http://localhost:9003";
const TOKEN = process.env.SONAR_TOKEN ?? "";
const PROJECT = process.env.SONAR_PROJECT_KEY ?? "maldous-react";

if (!TOKEN) {
  console.error("SONAR_TOKEN is not set. Export it before running sonar:quality-gate.");
  process.exit(1);
}

function sonarGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, HOST);
    const auth = Buffer.from(`${TOKEN}:`).toString("base64");
    const options = { headers: { Authorization: `Basic ${auth}` } };
    const lib = url.protocol === "https:" ? https : http;
    lib
      .get(url.toString(), options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        });
      })
      .on("error", reject);
  });
}

async function main() {
  // Quality gate status
  const qg = await sonarGet(
    `/api/qualitygates/project_status?projectKey=${encodeURIComponent(PROJECT)}`
  );
  const status = qg.projectStatus.status;
  const conditions = qg.projectStatus.conditions ?? [];

  // Issue counts
  const issues = await sonarGet(
    `/api/issues/search?componentKeys=${encodeURIComponent(PROJECT)}&ps=1&resolved=false`
  );

  // Hotspots
  const hotspots = await sonarGet(
    `/api/hotspots/search?projectKey=${encodeURIComponent(PROJECT)}&status=TO_REVIEW`
  );

  // Metrics
  const metrics = await sonarGet(
    `/api/measures/component?component=${encodeURIComponent(PROJECT)}&metricKeys=bugs,vulnerabilities,code_smells,security_hotspots`
  );
  const m = Object.fromEntries(
    (metrics.component?.measures ?? []).map((x) => [x.metric, Number(x.value ?? 0)])
  );

  const bugs = m.bugs ?? 0;
  const vulnerabilities = m.vulnerabilities ?? 0;
  const hotspotCount = hotspots.paging?.total ?? 0;
  const codeSmells = m.code_smells ?? 0;
  const totalIssues = issues.total ?? 0;

  console.log(`Sonar quality gate: ${status}`);
  console.log(`  Project: ${PROJECT}`);
  console.log(`  Host:    ${HOST}`);
  console.log(`  Bugs:                  ${bugs}`);
  console.log(`  Vulnerabilities:       ${vulnerabilities}`);
  console.log(`  Security hotspots:     ${hotspotCount}`);
  console.log(`  Code smells:           ${codeSmells}`);
  console.log(`  Total open issues:     ${totalIssues}`);
  console.log(`\nGate conditions:`);
  for (const c of conditions) {
    const mark = c.status === "OK" ? "✓" : "✗";
    console.log(
      `  ${mark} ${c.metricKey} = ${c.actualValue ?? "?"} (threshold ${c.errorThreshold ?? "?"})`
    );
  }

  const failures = [];
  if (status !== "OK") failures.push(`Quality gate status: ${status}`);
  if (bugs > 0) failures.push(`Bugs: ${bugs} (must be 0)`);
  if (vulnerabilities > 0) failures.push(`Vulnerabilities: ${vulnerabilities} (must be 0)`);
  if (hotspotCount > 0) failures.push(`Unreviewed security hotspots: ${hotspotCount} (must be 0)`);
  if (codeSmells > 0) failures.push(`Code smells: ${codeSmells} (must be 0)`);

  if (failures.length > 0) {
    console.error("\nSOLID GATE FAILED:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }

  console.log("\n✓ Sonar baseline is clean. ADR-ACT-0008 may proceed.");
}

main().catch((err) => {
  console.error(`sonar:quality-gate error: ${err.message}`);
  process.exit(1);
});
