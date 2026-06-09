import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectViolationsInFile, scanRepo, findRepoRoot } from "../src/index.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const TOOL = path.join(REPO_ROOT, "tools/architecture/validate-frontend-conventions/src/index.mjs");

const FEATURE = "apps/react-enterprise-app/src/features/widget/WidgetPage.tsx";

describe("detectViolationsInFile", () => {
  it("flags a <main id=main-content> in a feature page", () => {
    const v = detectViolationsInFile(FEATURE, `export const X = () => <main id="main-content" />;`);
    assert.deepEqual(
      v.map((x) => x.rule),
      ["no-feature-main"]
    );
  });

  it("flags an inline GraphQL operation string in a feature", () => {
    const v = detectViolationsInFile(
      "apps/react-enterprise-app/src/features/widget/widget.queries.ts",
      "const Q = `query WidgetList { widgets { id } }`;"
    );
    assert.ok(v.some((x) => x.rule === "no-inline-graphql"));
  });

  it("flags a raw /api/graphql fetch in app code", () => {
    const v = detectViolationsInFile(
      "apps/react-enterprise-app/src/features/widget/widget.queries.ts",
      `await fetch("/api/graphql", { method: "POST" });`
    );
    assert.ok(v.some((x) => x.rule === "no-raw-graphql-fetch"));
  });

  it("does not flag test files, the _template, or the msw layer", () => {
    assert.deepEqual(
      detectViolationsInFile(
        "apps/react-enterprise-app/src/features/widget/__tests__/WidgetPage.test.tsx",
        `await fetch("/api/graphql"); const q = \`query X { a }\`;`
      ),
      []
    );
    assert.deepEqual(
      detectViolationsInFile(
        "apps/react-enterprise-app/src/features/_template/feature.queries.ts",
        "const Q = `query WidgetList { widgets { id } }`;"
      ),
      []
    );
    assert.deepEqual(
      detectViolationsInFile(
        "apps/react-enterprise-app/src/msw/graphql/handlers.ts",
        `http.post("/api/graphql", () => {});`
      ),
      []
    );
  });

  it("does not flag a clean feature file", () => {
    const clean = `import { graphqlRequest } from "@platform/graphql-browser-client";
import { WidgetListDocument } from "@platform/contracts-graphql";
export const useX = () => graphqlRequest(WidgetListDocument);`;
    assert.deepEqual(
      detectViolationsInFile(
        "apps/react-enterprise-app/src/features/widget/widget.queries.ts",
        clean
      ),
      []
    );
  });
});

describe("scanRepo (live)", () => {
  it("reports no violations for the current repository", () => {
    assert.deepEqual(scanRepo(findRepoRoot(REPO_ROOT)), []);
  });

  it("CLI exits 0 on the clean repo", () => {
    const r = spawnSync(process.execPath, [TOOL], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  });
});
