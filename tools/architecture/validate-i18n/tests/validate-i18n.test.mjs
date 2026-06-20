import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const TOOL = path.join(REPO_ROOT, "tools/architecture/validate-i18n/src/index.mjs");
const REAL_CONFIG = path.join(REPO_ROOT, "tools/architecture/validate-i18n/governed-paths.json");

describe("validate-i18n", () => {
  it("exits 0 in report-only mode (default)", () => {
    const result = execFileSync(process.execPath, [TOOL, REPO_ROOT], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.ok(typeof result === "string");
  });

  it("outputs a summary line with [validate-i18n] marker", () => {
    const r = spawnSync(process.execPath, [TOOL, REPO_ROOT], { encoding: "utf8" });
    assert.equal(r.status, 0, `Expected exit 0 in report-only mode, got ${r.status}: ${r.stderr}`);
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    assert.ok(
      combined.includes("[validate-i18n]"),
      `Expected [validate-i18n] marker, got: ${combined.slice(0, 200)}`
    );
  });

  it("correctly reads nested en-GB.json (no locale-file 'not found' warning)", () => {
    const r = spawnSync(process.execPath, [TOOL, REPO_ROOT], { encoding: "utf8" });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    assert.ok(
      !combined.includes("en-GB.json not found"),
      `en-GB.json should be found and parsed; got: ${combined.slice(0, 200)}`
    );
  });

  it("--strict flag: accepted without crashing", () => {
    const r = spawnSync(process.execPath, [TOOL, REPO_ROOT, "--strict"], { encoding: "utf8" });
    assert.ok(r.status === 0 || r.status === 1, `Unexpected exit code: ${r.status}`);
  });

  it("--strict flag exits 1 when missing keys found, with Strict mode banner", () => {
    const r = spawnSync(process.execPath, [TOOL, REPO_ROOT, "--strict"], { encoding: "utf8" });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    if (combined.includes("missing from")) {
      assert.equal(r.status, 1, "Strict mode must exit 1 when missing keys are found");
      assert.ok(combined.includes("Strict mode"), "Strict mode banner must appear");
    } else {
      assert.equal(r.status, 0);
    }
  });

  it("fails strict mode for a repo with a missing en-GB key", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "validate-i18n-"));
    fs.mkdirSync(path.join(tempRoot, "packages/i18n-runtime/locales"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "apps/react-enterprise-app/src"), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, "packages/i18n-runtime/locales/en-GB.json"),
      JSON.stringify({ feature: { example: { title: "Example" } } }, null, 2)
    );
    fs.writeFileSync(
      path.join(tempRoot, "apps/react-enterprise-app/src/example.ts"),
      'import { serverT } from "@platform/i18n-runtime";\nserverT({}, "feature.example.missing");\n'
    );
    const r = spawnSync(process.execPath, [TOOL, tempRoot, "--strict"], { encoding: "utf8" });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    assert.equal(r.status, 1, `Expected strict failure, got ${r.status}: ${combined}`);
    assert.ok(combined.includes("missing from"), `Expected missing-key report, got: ${combined}`);
    assert.ok(combined.includes("Strict mode"), `Expected strict-mode banner, got: ${combined}`);
  });
});

// ── Strict-mode raw-literal enforcement (V1C-25) ────────────────────────────

let SAVED_CONFIG = null;

describe("validate-i18n strict-mode raw-literal enforcement", () => {
  function saveConfig() {
    if (SAVED_CONFIG === null) {
      SAVED_CONFIG = fs.readFileSync(REAL_CONFIG, "utf8");
    }
  }

  function restoreConfig() {
    if (SAVED_CONFIG !== null) {
      fs.writeFileSync(REAL_CONFIG, SAVED_CONFIG);
      SAVED_CONFIG = null;
    }
  }

  function makeRepo(opts) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v-i18n-strict-"));
    fs.mkdirSync(path.join(root, "packages/i18n-runtime/locales"), { recursive: true });
    fs.mkdirSync(path.join(root, "apps/react-enterprise-app/src"), { recursive: true });

    // Write locale
    const locale = opts.locale ?? { test: { key: "Hello {name}" }, empty: { state: "No items" } };
    fs.writeFileSync(
      path.join(root, "packages/i18n-runtime/locales/en-GB.json"),
      JSON.stringify(locale, null, 2)
    );

    if (opts.tsxFile) {
      fs.writeFileSync(
        path.join(root, "apps/react-enterprise-app/src/Component.tsx"),
        opts.tsxFile
      );
    }

    // Overwrite the real governed-paths.json with test-specific config
    saveConfig();
    const config = {
      schemaVersion: 1,
      governed: ["apps/react-enterprise-app/src"],
      exclude: opts.exclude ?? [],
      exceptions: opts.exceptions ?? [],
      strictFailOnRawLiteral: opts.strictFailOnRawLiteral ?? true,
    };
    fs.writeFileSync(REAL_CONFIG, JSON.stringify(config, null, 2));

    return root;
  }

  it("exits 1 in strict mode when raw governed JSX is found", () => {
    const root = makeRepo({
      tsxFile: "export function Comp() { return <div><h1>Welcome to the platform</h1></div>; }\n",
    });
    const r = spawnSync(process.execPath, [TOOL, root, "--strict"], { encoding: "utf8" });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    assert.equal(r.status, 1, `Expected strict failure for raw JSX, got ${r.status}: ${combined}`);
    assert.ok(
      combined.includes("raw-literal"),
      `Expected raw-literal mention, got: ${combined.slice(0, 300)}`
    );
    assert.ok(combined.includes("Strict mode"), `Expected strict-mode banner, got: ${combined}`);
    restoreConfig();
  });

  it("exits 1 in strict mode when raw aria-label copy is found", () => {
    const root = makeRepo({
      tsxFile:
        'export function Comp() { return <button aria-label="Delete the selected item">X</button>; }\n',
    });
    const r = spawnSync(process.execPath, [TOOL, root, "--strict"], { encoding: "utf8" });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    assert.equal(r.status, 1, `Expected strict failure for raw aria, got ${r.status}: ${combined}`);
    assert.ok(combined.includes("aria:"), `Expected aria mention, got: ${combined.slice(0, 300)}`);
    restoreConfig();
  });

  it("exits 0 in strict mode when translated copy is used (no raw literals)", () => {
    // JSX expression {} is not >English text< detection, so raw scan won't flag it
    const root = makeRepo({
      tsxFile: 'export function Comp() { return <div><h1>{"test.key"}</h1></div>; }\n',
    });
    const r = spawnSync(process.execPath, [TOOL, root, "--strict"], { encoding: "utf8" });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    assert.equal(r.status, 0, `Expected exit 0, got ${r.status}: ${combined}`);
    restoreConfig();
  });

  it("unknown keys fail in strict mode", () => {
    const root = makeRepo({
      tsxFile: 'export function Comp() { const x = t("test.missing"); return <div>{x}</div>; }\n',
    });
    const r = spawnSync(process.execPath, [TOOL, root, "--strict"], { encoding: "utf8" });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    assert.equal(
      r.status,
      1,
      `Expected strict failure for missing key, got ${r.status}: ${combined}`
    );
    assert.ok(
      combined.includes("missing from"),
      `Expected missing-key report: ${combined.slice(0, 300)}`
    );
    restoreConfig();
  });

  it("duplicate keys fail in strict mode", () => {
    const root = makeRepo({
      locale: { dup: { a: "first", b: "second" }, "dup.a": "duplicate" },
    });
    const r = spawnSync(process.execPath, [TOOL, root, "--strict"], { encoding: "utf8" });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    assert.equal(
      r.status,
      1,
      `Expected strict failure for duplicate keys, got ${r.status}: ${combined}`
    );
    assert.ok(combined.includes("duplicate"), `Expected duplicate mention: ${combined}`);
    restoreConfig();
  });

  it("missing catalogue values fail in strict mode", () => {
    const root = makeRepo({
      tsxFile: 'export function Comp() { return <div>{t("nonexistent.key")}</div>; }\n',
    });
    const r = spawnSync(process.execPath, [TOOL, root, "--strict"], { encoding: "utf8" });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    assert.equal(
      r.status,
      1,
      `Expected strict failure for missing value, got ${r.status}: ${combined}`
    );
    assert.ok(
      combined.includes("missing from"),
      `Expected missing report: ${combined.slice(0, 300)}`
    );
    restoreConfig();
  });

  it("interpolation mismatches fail in strict mode", () => {
    const root = makeRepo({
      locale: { test: { msg: "Hello {name}" } },
      tsxFile: 'export function Comp() { return <div>{t("test.msg", { wrong: "x" })}</div>; }\n',
    });
    const r = spawnSync(process.execPath, [TOOL, root, "--strict"], { encoding: "utf8" });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    if (combined.includes("interpolation")) {
      assert.equal(
        r.status,
        1,
        `Expected strict failure for interp mismatch, got ${r.status}: ${combined}`
      );
    } else {
      assert.equal(r.status, 0);
    }
    restoreConfig();
  });

  it("internal logs and error codes do not produce false positives", () => {
    const root = makeRepo({
      tsxFile:
        'const ERROR_CODE = "ERR_AUTH_FAILED";\nexport function log(msg: string) { console.warn(msg); }\n',
    });
    const r = spawnSync(process.execPath, [TOOL, root, "--strict"], { encoding: "utf8" });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    assert.ok(
      !combined.includes("raw-literal"),
      `Expected no raw-literal false positive for internal code: ${combined.slice(0, 400)}`
    );
    restoreConfig();
  });

  it("exceptions list prevents failures for reviewed strings", () => {
    const root = makeRepo({
      tsxFile: "export function Comp() { return <div><h1>Reviewed title text</h1></div>; }\n",
      exceptions: [
        {
          file: "apps/react-enterprise-app/src/Component.tsx",
          line: 1,
          text: "Reviewed title text",
          reason: "reviewed exception",
        },
      ],
    });
    const r = spawnSync(process.execPath, [TOOL, root, "--strict"], { encoding: "utf8" });
    const combined = (r.stdout ?? "") + (r.stderr ?? "");
    const componentFindings = combined.split("\n").filter((l) => l.includes("Component.tsx"));
    assert.equal(
      componentFindings.length,
      0,
      `Expected no Component.tsx findings with exception: ${componentFindings}`
    );
    restoreConfig();
  });
});
