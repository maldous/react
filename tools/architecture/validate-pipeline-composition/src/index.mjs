#!/usr/bin/env node
/**
 * validate-pipeline-composition — Meta test: E2E progression hierarchy (ADR-0034)
 *
 * Parses the Makefile's stage targets (stage-dev, stage-test, stage-staging,
 * stage-prod) and validates that each runs the correct E2E test composition
 * per ADR-0034:
 *
 *   Dev:       internal E2E only
 *   Test:      internal E2E + external smoke (run-stage-e2e)
 *   Staging:   full external E2E only
 *   Prod:      full external E2E + exhaustive (test:e2e:prod)
 *
 * Usage:
 *   node tools/architecture/validate-pipeline-composition/src/index.mjs
 *   node tools/architecture/validate-pipeline-composition/src/index.mjs --root /path/to/repo
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// ADR-0034 composition rules per stage
const RULES = {
  "stage-dev": {
    mustContain: ["e2e-internal"],
    mustNotContain: ["e2e-external", "test:e2e:prod", "run-stage-e2e"],
    label: "Dev - internal E2E only",
    description:
      "Dev runs internal fixture tests. External tests require Keycloak (not provisioned by Tilt).",
  },
  "stage-test": {
    mustContain: ["e2e-internal", "run-stage-tests"],
    mustNotContain: ["$(MAKE) e2e-external", "test:e2e:prod", "run-stage-e2e"],
    label: "Test - internal E2E only",
    description:
      "Test runs unit/API tests (run-stage-tests) and internal E2E with fixture sessions. External E2E starts from staging.",
  },
  "stage-staging": {
    mustContain: ["e2e-external"],
    mustNotContain: ["e2e-internal", "test:e2e:prod", "run-stage-e2e"],
    label: "Staging - full external E2E only",
    description: "Staging validates the deployed stack through Cloudflare. No fixture-based tests.",
  },
  "stage-prod": {
    mustContain: ["e2e-external", "test:e2e:prod"],
    mustNotContain: ["e2e-internal", "run-stage-e2e"],
    label: "Prod - full external + exhaustive",
    description:
      "Prod runs full external suite followed by exhaustive prod tests (security, performance, contracts).",
  },
};

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, "Makefile"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.resolve(startDir);
    }
    dir = parent;
  }
}

function parseArgs(argv) {
  let root = process.cwd();
  let format = "text";
  let noReports = false;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--root") {
      root = argv[i + 1];
      i += 2;
    } else if (arg === "--format") {
      format = argv[i + 1] ?? "text";
      i += 2;
    } else if (arg === "--no-reports") {
      noReports = true;
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { root, format, noReports };
}

function extractStageRecipes(makefileContent) {
  const recipes = {};
  const targets = Object.keys(RULES);
  const lines = makefileContent.split("\n");

  for (const target of targets) {
    // Find the line index where this target starts
    let startIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimRight();
      if (trimmed === `${target}:`) {
        startIdx = i;
        break;
      }
    }

    if (startIdx === -1) {
      recipes[target] = { found: false, content: "", errors: ["Target not found in Makefile"] };
      continue;
    }

    // Find the next top-level Makefile target (non-tab-indented line ending with `:`)
    // Recipe lines are tab-indented; comments start with #
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (
        line.length > 0 &&
        !line.startsWith("\t") &&
        !line.startsWith("#") &&
        !line.startsWith(" ") &&
        /^[a-zA-Z0-9_-]+:/.test(line)
      ) {
        endIdx = i;
        break;
      }
    }

    // Extract recipe lines (tab-indented lines + blank lines within the recipe block)
    // Remove trailing backslash continuations and tab indentation
    const recipeLines = lines.slice(startIdx + 1, endIdx);
    const content = recipeLines
      .filter((l) => l.startsWith("\t") || l.trim() === "")
      .map((l) => l.replace(/\\$/, "").replace(/\t/g, " ").trim())
      .join("\n");

    recipes[target] = {
      found: true,
      content,
      errors: [],
    };
  }

  return recipes;
}

function checkMustContain(recipe, target, mustContain, errors) {
  for (const pattern of mustContain) {
    const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "m");
    if (!re.test(recipe.content)) {
      errors.push(
        `MISSING: expected pattern "${pattern}" not found in ${target} (${RULES[target].label})`
      );
    }
  }
}

function checkMustNotContain(recipe, target, mustNotContain, errors) {
  for (const pattern of mustNotContain) {
    const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "m");
    if (re.test(recipe.content)) {
      errors.push(
        `FORBIDDEN: unexpected pattern "${pattern}" found in ${target} (${RULES[target].label})`
      );
    }
  }
}

function countTestBreadth(recipe) {
  let count = 0;
  if (/e2e-internal/.test(recipe.content)) count++;
  if (/run-stage-e2e|e2e-external/.test(recipe.content)) count++;
  if (/test:e2e:prod/.test(recipe.content)) count++;
  return count;
}

function checkHierarchyProgression(recipes, warnings) {
  const scopeOrder = ["stage-dev", "stage-test", "stage-staging", "stage-prod"];
  for (let i = 0; i < scopeOrder.length - 1; i++) {
    const current = scopeOrder[i];
    const next = scopeOrder[i + 1];
    if (!recipes[current].found || !recipes[next].found) continue;
    const currentCount = countTestBreadth(recipes[current]);
    const nextCount = countTestBreadth(recipes[next]);
    if (currentCount > nextCount) {
      warnings.push(
        `HIERARCHY: ${current} (breadth=${currentCount}) has more test types than ${next} (breadth=${nextCount}). Expected non-decreasing breadth per ADR-0034.`
      );
    }
  }
}

function validatePipeline(recipes) {
  const allErrors = [];
  const allWarnings = [];

  for (const [target, recipe] of Object.entries(recipes)) {
    if (!recipe.found) {
      allErrors.push(...recipe.errors);
      continue;
    }
    const rule = RULES[target];
    checkMustContain(recipe, target, rule.mustContain, allErrors);
    checkMustNotContain(recipe, target, rule.mustNotContain, allErrors);
  }

  checkHierarchyProgression(recipes, allWarnings);

  return { errors: allErrors, warnings: allWarnings };
}

function printTextResults(recipes, errors, warnings, exitCode) {
  console.log(`\nPipeline composition validation (ADR-0034):\n`);
  for (const target of Object.keys(RULES)) {
    const recipe = recipes[target];
    if (!recipe?.found) {
      console.log(`  ? ${target}: TARGET NOT FOUND`);
      continue;
    }
    const hasErrors = errors.some((e) => e.includes(target));
    const icon = hasErrors ? "\u2717" : "\u2713";
    console.log(`  ${icon} ${target}: ${RULES[target].label}`);
    if (!hasErrors) {
      console.log(`      (${RULES[target].description})`);
    }
  }
  console.log("");
  if (errors.length > 0) {
    console.log("Errors:");
    for (const err of errors) console.log(`  \u2717 ${err}`);
    console.log("");
  }
  if (warnings.length > 0) {
    console.log("Warnings:");
    for (const warn of warnings) console.log(`  \u26a0 ${warn}`);
    console.log("");
  }
  if (errors.length === 0 && warnings.length === 0) {
    console.log("  All pipeline composition checks passed.");
  }
  console.log(`  Exit code: ${exitCode}\n`);
}

function printJsonResults(toolName, recipes, errors, warnings, exitCode) {
  console.log(
    JSON.stringify(
      {
        tool: toolName,
        targets: Object.keys(RULES).map((name) => ({
          name,
          label: RULES[name].label,
          found: recipes[name]?.found ?? false,
        })),
        errors,
        warnings,
        passed: errors.length === 0,
        exitCode,
      },
      null,
      2
    )
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = findRepoRoot(path.resolve(options.root));
  const makefilePath = path.join(repoRoot, "Makefile");
  const toolName = "validate-pipeline-composition";

  if (!fs.existsSync(makefilePath)) {
    const msg = `Makefile not found at ${makefilePath}`;
    if (options.format === "json") {
      console.log(
        JSON.stringify({
          tool: toolName,
          status: "failed",
          errors: [msg],
          warnings: [],
          exitCode: 1,
        })
      );
    } else {
      console.error(msg);
    }
    process.exit(1);
  }

  // Concatenate root Makefile with all make/*.mk included files so that
  // targets defined in make/stages.mk are visible to the parser.
  const makeDir = path.join(repoRoot, "make");
  const mkFiles = fs.existsSync(makeDir)
    ? fs
        .readdirSync(makeDir)
        .filter((f) => f.endsWith(".mk"))
        .sort()
        .map((f) => path.join(makeDir, f))
    : [];
  const makefileContent = [makefilePath, ...mkFiles]
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");
  const recipes = extractStageRecipes(makefileContent);
  const { errors, warnings } = validatePipeline(recipes);
  const exitCode = errors.length > 0 ? 1 : 0;

  if (options.format === "json") {
    printJsonResults(toolName, recipes, errors, warnings, exitCode);
  } else {
    printTextResults(recipes, errors, warnings, exitCode);
  }

  process.exit(exitCode);
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    const jsonFormat =
      process.argv.includes("--format") &&
      process.argv[process.argv.indexOf("--format") + 1] === "json";
    if (jsonFormat) {
      console.log(
        JSON.stringify({
          tool: "validate-pipeline-composition",
          status: "error",
          error: error.message,
          exitCode: 1,
        })
      );
    } else {
      console.error(error.message);
    }
    process.exit(1);
  }
}
