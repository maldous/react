#!/usr/bin/env node
/**
 * Checks the SonarQube quality gate for the project and exits non-zero on failure.
 *
 * Required env vars:
 *   SONAR_HOST_URL     ? SonarQube server URL (default: http://localhost:9003)
 *   SONAR_TOKEN        ? SonarQube user token
 *   SONAR_PROJECT_KEY  ? Project key (default: maldous-react)
 *
 * Coverage policy (ADR-0016 / ADR-ACT-0093):
 *   Coverage must be non-zero before slicing (lcov.info must exist).
 *   Coverage percentage threshold is advisory until first vertical slice.
 */
import https from "node:https";
import http from "node:http";
import process from "node:process";
import fs from "node:fs";

const HOST = process.env.SONAR_HOST_URL ?? "http://localhost:9064/sonar";
const TOKEN = process.env.SONAR_TOKEN ?? "";
const PROJECT = process.env.SONAR_PROJECT_KEY ?? "maldous-react";
const LCOV_PATH = "coverage/lcov.info";

if (!TOKEN) {
  console.error("SONAR_TOKEN is not set. Export it before running sonar:quality-gate.");
  process.exit(1);
}

function sonarGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(HOST.replace(/\/$/, "") + path);
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

function fmt(v) {
  return v === null || v === undefined ? "N/A" : String(v);
}

async function main() {
  // Verify LCOV file exists before scanning
  if (!fs.existsSync(LCOV_PATH)) {
    console.error(`LCOV file missing: ${LCOV_PATH}`);
    console.error("Run: npm run test:coverage");
    process.exit(1);
  }

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

  // Core + coverage metrics
  const metricsResp = await sonarGet(
    `/api/measures/component?component=${encodeURIComponent(PROJECT)}` +
      `&metricKeys=bugs,vulnerabilities,code_smells,security_hotspots,` +
      `coverage,line_coverage,branch_coverage,lines_to_cover,uncovered_lines`
  );
  const m = Object.fromEntries(
    (metricsResp.component?.measures ?? []).map((x) => [x.metric, x.value])
  );

  const bugs = Number(m.bugs ?? 0);
  const vulnerabilities = Number(m.vulnerabilities ?? 0);
  const hotspotCount = hotspots.paging?.total ?? 0;
  const codeSmells = Number(m.code_smells ?? 0);
  const totalIssues = issues.total ?? 0;
  const coverage = m.coverage != null ? Number(m.coverage) : null;
  const lineCoverage = m.line_coverage != null ? Number(m.line_coverage) : null;
  const branchCoverage = m.branch_coverage != null ? Number(m.branch_coverage) : null;
  const linesToCover = m.lines_to_cover != null ? Number(m.lines_to_cover) : null;
  const uncoveredLines = m.uncovered_lines != null ? Number(m.uncovered_lines) : null;

  console.log(`Sonar quality gate: ${status}`);
  console.log(`  Project: ${PROJECT}`);
  console.log(`  Host:    ${HOST}`);
  console.log("");
  console.log("Security & reliability:");
  console.log(`  Bugs:                  ${bugs}`);
  console.log(`  Vulnerabilities:       ${vulnerabilities}`);
  console.log(`  Security hotspots:     ${hotspotCount}`);
  console.log(`  Code smells:           ${codeSmells}`);
  console.log(`  Total open issues:     ${totalIssues}`);
  console.log("");
  console.log("Coverage (advisory ? threshold hard after ADR-ACT-0008):");
  console.log(`  Overall coverage:      ${coverage != null ? coverage.toFixed(2) + "%" : "N/A"}`);
  console.log(
    `  Line coverage:         ${lineCoverage != null ? lineCoverage.toFixed(2) + "%" : "N/A"}`
  );
  console.log(
    `  Branch coverage:       ${branchCoverage != null ? branchCoverage.toFixed(2) + "%" : "N/A"}`
  );
  console.log(`  Lines to cover:        ${fmt(linesToCover)}`);
  console.log(`  Uncovered lines:       ${fmt(uncoveredLines)}`);
  console.log("");
  console.log("Gate conditions:");
  for (const c of conditions) {
    const mark = c.status === "OK" ? "?" : "?";
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

  // Coverage must be present and non-zero (advisory threshold ? see ADR-0016)
  if (coverage === null) {
    failures.push("Coverage data absent from Sonar ? run test:coverage before sonar:scan");
  } else if (coverage === 0 && linesToCover !== null && linesToCover > 0) {
    failures.push(
      `Coverage is 0% with ${linesToCover} lines to cover ? LCOV may not have been ingested`
    );
  }

  if (failures.length > 0) {
    console.error("\nGATE FAILED:");
    for (const f of failures) console.error(`  ? ${f}`);
    process.exit(1);
  }

  console.log("\n? Sonar baseline is clean. Coverage is present. ADR-ACT-0008 may proceed.");
}

main().catch((err) => {
  console.error(`sonar:quality-gate error: ${err.message}`);
  process.exit(1);
});
