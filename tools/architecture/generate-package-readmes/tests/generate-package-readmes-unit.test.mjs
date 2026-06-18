#!/usr/bin/env node
// Unit tests for the lifecycle-aware README renderer (ADR-0006 / ADR-ACT-0289).
import test from "node:test";
import assert from "node:assert/strict";

import { renderReadme } from "../src/index.mjs";

function pkg(overrides = {}) {
  const lifecycle = {
    stage: "active",
    role: "platform",
    class: "active.platform",
    catalogLifecycle: "production",
    visibility: "internal",
    supportLevel: "standard",
    reviewCadence: "quarterly",
    ...(overrides.lifecycle ?? {}),
  };
  return {
    name: "@platform/sample",
    version: "0.1.0",
    architecture: {
      component: {
        name: "sample",
        type: "library",
        system: "s",
        domain: "d",
        boundedContext: "bc",
        owner: "o",
      },
      lifecycle,
      governance: {
        decisionRefs: ["ADR-0001"],
        semverPolicy: "internal-traceable",
        changeControl: "owner-review",
        promotionEligible: true,
      },
      runtime: { production: false, testOnly: true, deploymentEnvironments: ["test"] },
      boundaries: {
        publicExportsOnly: true,
        deepImportsAllowed: false,
        allowedConsumers: [],
        forbiddenConsumers: [],
      },
      relations: { dependsOn: [], providesApis: [], consumesApis: [] },
      tags: {
        stage: lifecycle.stage,
        role: lifecycle.role,
        scope: "x",
        type: "library",
        layer: "platform",
      },
      readme: {
        generated: true,
        summary: "Sample package.",
        responsibilities: ["r"],
        nonResponsibilities: ["nr"],
        usage: overrides.usage ?? ["Imported by feature packages to do things"],
      },
    },
  };
}

// Affirmative import-advertising language (NOT "do not add new consumers", which is correct guidance).
const ACTIVE_USAGE_SMELLS =
  /Imported by|Import from|registered at application startup|Import the |add a new consumer/i;

test("active package: no deprecation banner, normal usage retained", () => {
  const md = renderReadme(pkg());
  assert.ok(!md.includes("DEPRECATED"), "active package must not show a deprecation banner");
  assert.match(md, /Imported by feature packages/);
});

test("deprecated package: renders an explicit deprecation warning", () => {
  const md = renderReadme(
    pkg({
      lifecycle: {
        stage: "deprecated",
        class: "deprecated.platform",
        catalogLifecycle: "deprecated",
        visibility: "deprecated",
        supportLevel: "deprecated",
      },
      usage: [
        "Do not add new consumers — deprecated (ADR-0006), retained only until removal review 2026-12-18.",
        "Existing migration exceptions: none.",
        "Canonical replacement: apps/platform-api usecases/search.ts.",
      ],
    })
  );
  assert.match(md, /DEPRECATED — do not add new consumers/);
  assert.match(md, /no-import-from-deprecated/);
});

test("deprecated package: usage guidance does not advertise imports or new consumers", () => {
  const md = renderReadme(
    pkg({
      lifecycle: {
        stage: "deprecated",
        class: "deprecated.platform",
        catalogLifecycle: "deprecated",
        visibility: "deprecated",
        supportLevel: "deprecated",
      },
      usage: [
        "Do not add new consumers — deprecated (ADR-0006), retained only until removal review 2026-12-18.",
        "Existing migration exceptions: none.",
        "Canonical replacement: apps/platform-api usecases/search.ts.",
      ],
    })
  );
  // Isolate the "Public exports and usage" section and assert no active-usage language.
  const usageSection = md.slice(md.indexOf("## Public exports and usage"));
  assert.ok(
    !ACTIVE_USAGE_SMELLS.test(usageSection),
    `deprecated usage section must not advertise imports/new consumers:\n${usageSection.slice(0, 400)}`
  );
  assert.match(usageSection, /Do not add new consumers/);
  assert.match(usageSection, /Canonical replacement|No replacement required/);
});
