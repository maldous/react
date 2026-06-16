#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROUTES_FILE = "apps/platform-api/src/server/routes.ts";
const OPENAPI_FILE = "docs/api/openapi.json";

export function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function extractRoutes(source) {
  const routes = [];
  const routeBlockPattern = /\{\s*method:\s*"([A-Z]+)"\s*,\s*path:\s*"([^"]+)"/g;
  for (const match of source.matchAll(routeBlockPattern)) {
    routes.push({ method: match[1].toLowerCase(), path: match[2] });
  }
  return routes;
}

const OPENAPI_META_KEYS = new Set(["parameters", "summary", "description", "servers"]);

export function findMissing(routes, definedPaths) {
  return routes.filter((route) => {
    const pathSpec = definedPaths.get(route.path);
    return !pathSpec || !pathSpec[route.method];
  });
}

export function findExtra(routes, definedPaths) {
  const extra = [];
  for (const [openapiPathKey, pathSpec] of definedPaths) {
    for (const method of Object.keys(pathSpec)) {
      if (OPENAPI_META_KEYS.has(method)) continue;
      if (!routes.some((r) => r.path === openapiPathKey && r.method === method)) {
        extra.push({ path: openapiPathKey, method });
      }
    }
  }
  return extra;
}

export function checkDrift(repoRoot) {
  const routesPath = path.join(repoRoot, ROUTES_FILE);
  const openapiPath = path.join(repoRoot, OPENAPI_FILE);

  if (!fs.existsSync(routesPath)) throw new Error(`Missing routes file: ${ROUTES_FILE}`);
  if (!fs.existsSync(openapiPath)) throw new Error(`Missing OpenAPI file: ${OPENAPI_FILE}`);

  const source = fs.readFileSync(routesPath, "utf8");
  const openapi = loadJson(openapiPath);
  const routes = extractRoutes(source);
  const definedPaths = new Map(Object.entries(openapi.paths ?? {}));

  return {
    routes,
    missing: findMissing(routes, definedPaths),
    extra: findExtra(routes, definedPaths),
  };
}

// Drift covers path+method presence only. Schema-level drift (request/response
// bodies, parameters, status codes) remains a Proposed sub-decision of ADR-0065
// tracked by ADR-ACT-0250.
export function decideExit(result, strict) {
  if (result.missing.length === 0 && result.extra.length === 0) return 0;
  return strict ? 1 : 0;
}

function reportDrift(result) {
  if (result.missing.length === 0 && result.extra.length === 0) {
    console.log(
      `[validate-openapi-drift] OK - ${result.routes.length} route(s) match docs/api/openapi.json`
    );
    return;
  }

  if (result.missing.length > 0) {
    console.warn("[validate-openapi-drift] routes missing from docs/api/openapi.json:");
    for (const route of result.missing) {
      console.warn(`  - ${route.method.toUpperCase()} ${route.path}`);
    }
  }

  if (result.extra.length > 0) {
    console.warn("[validate-openapi-drift] OpenAPI paths not present in routes.ts:");
    for (const route of result.extra) {
      console.warn(`  - ${route.method.toUpperCase()} ${route.path}`);
    }
  }
}

function main() {
  const strict = process.argv.includes("--strict");
  const repoRoot = findRepoRoot(process.cwd());
  const result = checkDrift(repoRoot);
  reportDrift(result);

  const code = decideExit(result, strict);
  if (code !== 0) {
    console.error(
      "[validate-openapi-drift] FAILED (--strict): docs/api/openapi.json is out of sync with routes.ts"
    );
  }
  process.exit(code);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main();
}
