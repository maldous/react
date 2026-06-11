#!/usr/bin/env node
// Governance validator: the ADR Action Register and the ADR codemap must not drift
// from the actual ADR files on disk (ADR-0007). Fails if:
//   - any ADR-NNNN referenced in docs/adr/ACTION-REGISTER.md has no docs/adr/NNNN-*.md file;
//   - docs/CODEMAPS/adrs.md's "Next ADR" or count line disagree with the ADR files present.
// Exit 0 on success, 1 on any problem. Output is human-readable; the orchestrator keys on
// the exit code only.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");

/** ADR file numbers present on disk, e.g. Set {1,2,...,37}. */
export function adrNumbersOnDisk(adrDir) {
  const nums = new Set();
  for (const f of fs.readdirSync(adrDir)) {
    const m = /^(\d{4})-.*\.md$/.exec(f);
    if (m) nums.add(Number(m[1]));
  }
  return nums;
}

/** All distinct ADR-NNNN numbers referenced in text (ignores ADR-ACT-NNNN). */
export function referencedAdrNumbers(text) {
  const nums = new Set();
  // Match ADR-NNNN but NOT ADR-ACT-NNNN: require a digit immediately after "ADR-".
  for (const m of text.matchAll(/\bADR-(\d{4})\b/g)) nums.add(Number(m[1]));
  return nums;
}

/** ADR-NNNN references that have no file on disk. */
export function findUnresolvedAdrRefs(text, onDisk) {
  return [...referencedAdrNumbers(text)].filter((n) => !onDisk.has(n)).sort((a, b) => a - b);
}

export function validate(repoRoot = REPO_ROOT) {
  const problems = [];
  const adrDir = path.join(repoRoot, "docs", "adr");
  const onDisk = adrNumbersOnDisk(adrDir);
  const maxAdr = Math.max(...onDisk);

  // 1. ACTION-REGISTER references must all resolve to ADR files.
  const registerPath = path.join(adrDir, "ACTION-REGISTER.md");
  const registerText = fs.readFileSync(registerPath, "utf8");
  for (const n of findUnresolvedAdrRefs(registerText, onDisk)) {
    problems.push(
      `ACTION-REGISTER.md references ADR-${String(n).padStart(4, "0")} but docs/adr/ has no matching file`
    );
  }

  // 2. Codemap must agree with disk (count line + "Next ADR").
  const codemapPath = path.join(repoRoot, "docs", "CODEMAPS", "adrs.md");
  if (fs.existsSync(codemapPath)) {
    const codemap = fs.readFileSync(codemapPath, "utf8");
    // Convention: the headline number is the highest ADR number (range end
    // "ADR-0001 through ADR-NNNN"); gaps like the intentionally-absent ADR-0018
    // are noted separately, not subtracted from the headline.
    const countMatch = /^(\d+)\s+Architecture Decision Records/m.exec(codemap);
    if (countMatch && Number(countMatch[1]) !== maxAdr) {
      problems.push(
        `adrs.md headline count is ${countMatch[1]} but the highest ADR on disk is ADR-${maxAdr}`
      );
    }
    const rangeMatch = /ADR-0001 through ADR-(\d{4})/.exec(codemap);
    if (rangeMatch && Number(rangeMatch[1]) !== maxAdr) {
      problems.push(
        `adrs.md range ends at ADR-${rangeMatch[1]} but the highest ADR on disk is ADR-${maxAdr}`
      );
    }
    const nextMatch = /Next ADR:\s*\*\*ADR-(\d{4})\*\*/.exec(codemap);
    if (nextMatch && Number(nextMatch[1]) <= maxAdr) {
      problems.push(
        `adrs.md "Next ADR: ADR-${nextMatch[1]}" must be greater than the highest ADR on disk (ADR-${maxAdr})`
      );
    }
  }

  return { ok: problems.length === 0, problems, maxAdr, adrCount: onDisk.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = validate();
  if (result.ok) {
    console.log(
      `[validate-action-register] OK — ${result.adrCount} ADR files, all ACTION-REGISTER references resolve; codemap consistent.`
    );
    process.exit(0);
  }
  console.error("[validate-action-register] governance drift:");
  for (const p of result.problems) console.error(`  - ${p}`);
  process.exit(1);
}
