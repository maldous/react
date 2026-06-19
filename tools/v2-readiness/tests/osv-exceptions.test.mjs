import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const toml = fs.readFileSync(path.join(repoRoot, "osv-scanner.toml"), "utf8");

// Minimal parser for the [[IgnoredVulns]] blocks (id / optional ignoreUntil / reason).
function parseIgnored(text) {
  return text
    .split("[[IgnoredVulns]]")
    .slice(1)
    .map((block) => ({
      id: (/id\s*=\s*"([^"]+)"/.exec(block) || [])[1],
      ignoreUntil: (/ignoreUntil\s*=\s*(\S+)/.exec(block) || [])[1],
      reason: (/reason\s*=\s*"([^"]*)"/.exec(block) || [])[1] || "",
    }))
    .filter((e) => e.id);
}

// Expiry-enforcement logic: a time-bounded exception is active only until ignoreUntil.
const isActive = (ignoreUntil, nowISO) => !ignoreUntil || new Date(nowISO) <= new Date(ignoreUntil);

const TIME_BOUNDED = ["GHSA-p6gq-j5cr-w38f", "GHSA-pr7r-676h-xcf6", "GHSA-vmh5-mc38-953g"];

test("the 3 dev-only advisories are recorded as time-bounded governed exceptions", () => {
  const entries = parseIgnored(toml);
  const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
  for (const id of TIME_BOUNDED) {
    const e = byId[id];
    assert.ok(e, `${id} must be in osv-scanner.toml`);
    assert.ok(e.ignoreUntil, `${id} must carry ignoreUntil (time-bounded)`);
    assert.ok(
      /^\d{4}-\d{2}-\d{2}/.test(e.ignoreUntil),
      `${id} ignoreUntil must be an RFC3339 date`
    );
    assert.match(e.reason, /dev/, `${id} reason must establish dev-only exposure`);
    assert.match(e.reason, /V1C-18/, `${id} must link the remediation action V1C-18`);
  }
});

test("expiry enforcement: exception is active before ignoreUntil and re-fails after", () => {
  const e = parseIgnored(toml).find((x) => x.id === "GHSA-p6gq-j5cr-w38f");
  assert.equal(isActive(e.ignoreUntil, "2026-06-19T00:00:00Z"), true, "active today");
  assert.equal(isActive(e.ignoreUntil, "2027-01-01T00:00:00Z"), false, "must re-fail after expiry");
});

test("no time-bounded exception carries a far-future (effectively permanent) expiry", () => {
  for (const e of parseIgnored(toml)) {
    if (!e.ignoreUntil) continue;
    const days = (new Date(e.ignoreUntil) - new Date("2026-06-19T00:00:00Z")) / 86400000;
    assert.ok(
      days > 0 && days <= 200,
      `${e.id} expiry must be a real near-term bound (got ${Math.round(days)} days)`
    );
  }
});
