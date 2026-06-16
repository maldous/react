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

// Collect every $ref string anywhere in the OpenAPI document.
export function collectRefs(node, acc = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, acc);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") acc.push(value);
      else collectRefs(value, acc);
    }
  }
  return acc;
}

// Resolve a local JSON-pointer ref (e.g. "#/components/schemas/Foo") within the
// document. Returns true only for in-document pointers that resolve to a node.
// External refs (no leading "#") are treated as unresolved by this local check.
export function refResolves(doc, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return false;
  const segments = ref
    .slice(2)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cursor = doc;
  for (const segment of segments) {
    if (cursor && typeof cursor === "object" && segment in cursor) cursor = cursor[segment];
    else return false;
  }
  return cursor !== undefined;
}

export function findUnresolvedRefs(openapi) {
  const unresolved = [];
  const seen = new Set();
  for (const ref of collectRefs(openapi)) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    if (!refResolves(openapi, ref)) unresolved.push(ref);
  }
  return unresolved;
}

// Status codes whose responses legitimately carry no body.
const BODYLESS_STATUS = new Set(["204", "301", "302", "303", "304", "307", "308"]);
const PATH_META_KEYS = new Set(["parameters", "summary", "description", "servers", "$ref"]);

function jsonSchemaPresent(carrier) {
  const schema = carrier?.content?.["application/json"]?.schema;
  return Boolean(
    schema &&
    (schema.$ref ||
      schema.type ||
      schema.allOf ||
      schema.oneOf ||
      schema.anyOf ||
      schema.properties ||
      schema.items)
  );
}

function isOperation(method, op) {
  return !PATH_META_KEYS.has(method) && Boolean(op) && typeof op === "object";
}

function responseNeedsSchema(code, resp) {
  return !resp?.$ref && !BODYLESS_STATUS.has(code);
}

function schemalessInOperation(label, op) {
  const offenders = [];
  if (op.requestBody?.content && !jsonSchemaPresent(op.requestBody)) {
    offenders.push(`${label} [requestBody]`);
  }
  for (const [code, resp] of Object.entries(op.responses ?? {})) {
    if (responseNeedsSchema(code, resp) && !jsonSchemaPresent(resp)) {
      offenders.push(`${label} [${code}]`);
    }
  }
  return offenders;
}

// Every documented JSON request body and non-bodyless response must declare a
// schema. A reusable `$ref` response is accepted as-is (resolved separately by
// findUnresolvedRefs). This is the schema-presence half of ADR-ACT-0250.
export function findSchemalessSchemas(openapi) {
  const offenders = [];
  for (const [routePath, item] of Object.entries(openapi.paths ?? {})) {
    for (const [method, op] of Object.entries(item)) {
      if (!isOperation(method, op)) continue;
      offenders.push(...schemalessInOperation(`${method.toUpperCase()} ${routePath}`, op));
    }
  }
  return offenders;
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
    unresolvedRefs: findUnresolvedRefs(openapi),
    schemaless: findSchemalessSchemas(openapi),
  };
}

function hasDrift(result) {
  return (
    result.missing.length > 0 ||
    result.extra.length > 0 ||
    (result.unresolvedRefs?.length ?? 0) > 0 ||
    (result.schemaless?.length ?? 0) > 0
  );
}

// Drift covers path+method presence and local $ref integrity. Full schema-level
// drift (request/response bodies, parameters, status codes) remains a Proposed
// sub-decision of ADR-0065 tracked by ADR-ACT-0250.
export function decideExit(result, strict) {
  if (!hasDrift(result)) return 0;
  return strict ? 1 : 0;
}

function reportDrift(result) {
  if (!hasDrift(result)) {
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

  if ((result.unresolvedRefs?.length ?? 0) > 0) {
    console.warn("[validate-openapi-drift] unresolvable $ref pointers in docs/api/openapi.json:");
    for (const ref of result.unresolvedRefs) {
      console.warn(`  - ${ref}`);
    }
  }

  if ((result.schemaless?.length ?? 0) > 0) {
    console.warn(
      "[validate-openapi-drift] request/response bodies without a schema in docs/api/openapi.json:"
    );
    for (const offender of result.schemaless) {
      console.warn(`  - ${offender}`);
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
