#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROUTES_FILE = "apps/platform-api/src/server/routes.ts";
const OPENAPI_FILE = "docs/api/openapi.json";

function findRepoRoot(startDir) {
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

function extractRoutes(source) {
  const routes = [];
  const routeBlockPattern = /\{\s*method:\s*"([A-Z]+)"\s*,\s*path:\s*"([^"]+)"/g;
  for (const match of source.matchAll(routeBlockPattern)) {
    routes.push({ method: match[1].toLowerCase(), path: match[2] });
  }
  return routes;
}

const OPENAPI_META_KEYS = new Set(["parameters", "summary", "description", "servers"]);

function findMissing(routes, definedPaths) {
  return routes.filter((route) => {
    const pathSpec = definedPaths.get(route.path);
    return !pathSpec || !pathSpec[route.method];
  });
}

function findExtra(routes, definedPaths) {
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

function checkDrift(repoRoot) {
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

const repoRoot = findRepoRoot(process.cwd());
const result = checkDrift(repoRoot);

if (result.missing.length === 0 && result.extra.length === 0) {
  console.log(
    `[validate-openapi-drift] OK — ${result.routes.length} route(s) match docs/api/openapi.json`
  );
  process.exit(0);
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

process.exit(0);
