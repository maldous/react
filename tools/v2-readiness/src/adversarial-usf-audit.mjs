import fs from "node:fs";
import path from "node:path";
import { stableId } from "./formal-assurance.mjs";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PUBLIC_ROUTE_PREFIXES = ["/healthz", "/readyz", "/version", "/metrics", "/auth/"];

const present = (value) =>
  Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";

const readText = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
const readJsonSafe = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

function walkFiles(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, predicate));
    else if (entry.isFile() && predicate(full)) out.push(full);
  }
  return out;
}

function rel(repoRoot, file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, "/");
}

function lineForOffset(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function extractRouteBlocks(text) {
  const blocks = [];
  const routeStart = text.indexOf("export const routes");
  if (routeStart < 0) return blocks;
  const routeObject =
    /\{\s*method\s*:\s*["'](?:GET|POST|PUT|PATCH|DELETE)["']\s*,\s*path\s*:\s*["'][^"']+["']/g;
  for (const match of text.slice(routeStart).matchAll(routeObject)) {
    const start = routeStart + match.index;
    const end = findMatchingBrace(text, start);
    if (end > start) blocks.push({ text: text.slice(start, end + 1), offset: start });
  }
  return blocks;
}

function findMatchingBrace(text, start) {
  let depth = 0;
  let inString = null;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function literalField(block, name) {
  const match = new RegExp(`${name}\\s*:\\s*["']([^"']+)["']`).exec(block);
  return match?.[1] ?? "";
}

function handlerSymbol(block) {
  if (/handler\s*:\s*async\s*\(/.test(block)) return "inline async handler";
  if (/handler\s*:\s*\(/.test(block)) return "inline handler";
  const direct = /handler\s*:\s*([A-Za-z0-9_$]+)/.exec(block);
  if (direct) return direct[1];
  return "unknown";
}

function routeCapability(pathValue, capabilityRows) {
  const exact = capabilityRows.find((capability) =>
    String(capability.contract || "").includes(pathValue)
  );
  if (exact) return capabilityName(exact);
  const parts = pathValue.split("/").filter(Boolean);
  for (let i = parts.length; i > 1; i--) {
    const prefix = `/${parts.slice(0, i).join("/")}`;
    const hit = capabilityRows.find((capability) =>
      String(capability.contract || "").includes(prefix)
    );
    if (hit) return capabilityName(hit);
  }
  return "unknown";
}

function capabilityName(capability) {
  return capability.capability ?? capability.name ?? capability.id ?? "unknown";
}

function proofRefsForRoute(route, capabilityRows, proofScripts) {
  const capability = capabilityRows.find((row) => capabilityName(row) === route.capability);
  const semanticProofs = String(capability?.proof ?? "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const pathNeedles = [
    route.path,
    route.path.replace(/:([A-Za-z0-9_]+)/g, ""),
    route.path.split("/").filter(Boolean).slice(0, 3).join("-"),
  ].filter(Boolean);
  const scripts = proofScripts.filter((script) => {
    const haystack = `${script.file}\n${script.text}`;
    return pathNeedles.some((needle) => haystack.includes(needle));
  });
  return {
    semanticProofs,
    runtimeProofs: scripts.map((script) => script.file),
  };
}

function isPublicRoute(route) {
  return PUBLIC_ROUTE_PREFIXES.some(
    (prefix) => route.path === prefix || route.path.startsWith(prefix)
  );
}

function openApiRoutes(repoRoot) {
  const doc = readJsonSafe(path.join(repoRoot, "docs/api/openapi.json"));
  const methods = new Set(["get", "post", "put", "patch", "delete"]);
  return Object.entries(doc?.paths || {}).flatMap(([pathValue, operations]) =>
    Object.entries(operations)
      .filter(([method]) => methods.has(method))
      .map(([method, operation]) => ({
        method: method.toUpperCase(),
        path: pathValue.replace(/\{([A-Za-z0-9_]+)\}/g, ":$1"),
        operationId: operation?.operationId ?? "unknown",
        tags: operation?.tags ?? [],
        security: operation?.security ?? [],
      }))
  );
}

function frontendRoutes(repoRoot, capabilityRows) {
  const routesDir = path.join(repoRoot, "apps/react-enterprise-app/src/routes");
  const files = walkFiles(
    routesDir,
    (file) => file.endsWith(".tsx") && !file.includes("__tests__")
  );
  return files.flatMap((file) => {
    const text = readText(file);
    if (!text.includes("createRoute(")) return [];
    const pathLiteral =
      /path\s*:\s*["']([^"']+)["']/.exec(text)?.[1] ??
      (/id\s*:\s*["']([^"']+)["']/.exec(text)?.[1] ? "" : "");
    if (!pathLiteral) return [];
    const relative = rel(repoRoot, file);
    const pathValue = normalizeFrontendPath(relative, pathLiteral);
    const permission = /RequirePermission[\s\S]*?permission=["']([^"']+)["']/.exec(text)?.[1];
    const route = {
      routeId: stableId("route", `GET ${pathValue}`),
      method: "GET",
      path: pathValue,
      handlerFile: relative,
      handlerSymbol:
        /component\s*:\s*([A-Za-z0-9_$]+)/.exec(text)?.[1] ?? "TanStack Route component",
      capability: routeCapability(pathValue, capabilityRows),
      isMutation: false,
      authRequired:
        relative.includes("/admin/") || relative.includes("/organisation/")
          ? true
          : pathValue === "/" || pathValue === "/login"
            ? false
            : "unknown",
      permissionRequired: permission ?? "unknown",
      policyRequired: permission ? true : "unknown",
      auditRequired: false,
      auditEvent: "unknown",
      traceRequired: true,
      traceSpan: "unknown",
      logRequired: true,
      logEvent: "unknown",
      metricRequired: true,
      metricName: "unknown",
      alertRequired: relative.includes("/admin/"),
      proofRequired: true,
      proofRef: "unknown",
      sourceType: "frontend-router",
      sourceFileRefs: [relative],
      evidence: {
        routeObject: relative,
        pipelineTrace: "",
        pipelineLogs: "",
        pipelineMetrics: "",
        pipelineCorrelation: "",
      },
    };
    return [route];
  });
}

function normalizeFrontendPath(relative, routePath) {
  if (routePath === "/") return "/";
  if (routePath.startsWith("/")) return routePath;
  const filePath = relative.replace(/^apps\/react-enterprise-app\/src\/routes\//, "");
  if (filePath.startsWith("admin/")) return `/admin/${routePath}`.replace(/\/+/g, "/");
  if (filePath.startsWith("organisation/"))
    return `/organisation/${routePath}`.replace(/\/+/g, "/");
  return `/${routePath}`.replace(/\/+/g, "/");
}

function buildRouteInventory(ctx, sources) {
  const repoRoot = ctx.repoRoot;
  const routesFile = path.join(repoRoot, "apps/platform-api/src/server/routes.ts");
  const pipelineFile = path.join(repoRoot, "apps/platform-api/src/server/pipeline.ts");
  const routesText = readText(routesFile);
  const pipelineText = readText(pipelineFile);
  const capabilityRows = ctx.capabilities || [];
  const pipelineEvidence = {
    trace: pipelineText.includes("withServerSpan("),
    completionLog: pipelineText.includes("http.request.complete"),
    errorLog: pipelineText.includes("http.request.failed"),
    metrics:
      pipelineText.includes("httpRequestsTotal.inc") &&
      pipelineText.includes("httpRequestDurationSeconds.observe"),
    correlation: pipelineText.includes("requestId") && pipelineText.includes("X-Request-Id"),
  };
  const serverRoutes = extractRouteBlocks(routesText)
    .map(({ text, offset }) => {
      const method = literalField(text, "method") || "unknown";
      const pathValue = literalField(text, "path") || "unknown";
      const route = {
        routeId: stableId("route", `${method} ${pathValue}`),
        method,
        path: pathValue,
        handlerFile: rel(repoRoot, routesFile),
        handlerSymbol: handlerSymbol(text),
        capability: "unknown",
        isMutation: MUTATING.has(method),
        authRequired: text.includes("requiresAuth: true")
          ? true
          : isPublicRoute({ path: pathValue })
            ? false
            : "unknown",
        permissionRequired: literalField(text, "requiredPermission") || "unknown",
        policyRequired:
          literalField(text, "resource") && literalField(text, "umaScope") ? true : "unknown",
        auditRequired: MUTATING.has(method),
        auditEvent:
          text.includes("AuditAction.") || text.includes("createAuditEvent(")
            ? "route handler audit evidence"
            : "unknown",
        traceRequired: true,
        traceSpan: pipelineEvidence.trace ? "pipeline withServerSpan" : "unknown",
        logRequired: true,
        logEvent:
          pipelineEvidence.completionLog && pipelineEvidence.errorLog
            ? "http.request.complete/http.request.failed"
            : "unknown",
        metricRequired: true,
        metricName: pipelineEvidence.metrics
          ? "http_requests_total/http_request_duration_seconds"
          : "unknown",
        alertRequired: pathValue.startsWith("/api/") || pathValue.startsWith("/internal/"),
        proofRequired: pathValue.startsWith("/api/"),
        proofRef: "unknown",
        sourceFileRefs: [`${rel(repoRoot, routesFile)}:${lineForOffset(routesText, offset)}`],
        evidence: {
          routeObject: `${rel(repoRoot, routesFile)}:${lineForOffset(routesText, offset)}`,
          pipelineTrace: pipelineEvidence.trace ? rel(repoRoot, pipelineFile) : "",
          pipelineLogs:
            pipelineEvidence.completionLog && pipelineEvidence.errorLog
              ? rel(repoRoot, pipelineFile)
              : "",
          pipelineMetrics: pipelineEvidence.metrics ? rel(repoRoot, pipelineFile) : "",
          pipelineCorrelation: pipelineEvidence.correlation ? rel(repoRoot, pipelineFile) : "",
        },
      };
      route.capability = routeCapability(route.path, capabilityRows);
      const proofs = proofRefsForRoute(route, capabilityRows, sources.proofScripts);
      if (proofs.runtimeProofs.length > 0) route.proofRef = proofs.runtimeProofs.join("; ");
      else if (proofs.semanticProofs.length > 0) route.proofRef = proofs.semanticProofs.join("; ");
      return route;
    })
    .sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
  const byKey = new Map(serverRoutes.map((route) => [`${route.method} ${route.path}`, route]));
  for (const contractRoute of openApiRoutes(repoRoot)) {
    const key = `${contractRoute.method} ${contractRoute.path}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.generatedContract = true;
      existing.operationId = contractRoute.operationId;
      existing.sourceFileRefs.push("docs/api/openapi.json");
      continue;
    }
    byKey.set(key, {
      routeId: stableId("route", key),
      method: contractRoute.method,
      path: contractRoute.path,
      handlerFile: "unknown",
      handlerSymbol: contractRoute.operationId,
      capability: routeCapability(contractRoute.path, capabilityRows),
      isMutation: MUTATING.has(contractRoute.method),
      authRequired: isPublicRoute(contractRoute) ? false : "unknown",
      permissionRequired: "unknown",
      policyRequired: "unknown",
      auditRequired: MUTATING.has(contractRoute.method),
      auditEvent: "unknown",
      traceRequired: true,
      traceSpan: "unknown",
      logRequired: true,
      logEvent: "unknown",
      metricRequired: true,
      metricName: "unknown",
      alertRequired:
        contractRoute.path.startsWith("/api/") || contractRoute.path.startsWith("/internal/"),
      proofRequired: contractRoute.path.startsWith("/api/"),
      proofRef: "unknown",
      sourceType: "generated-contract",
      generatedContract: true,
      operationId: contractRoute.operationId,
      sourceFileRefs: ["docs/api/openapi.json"],
      evidence: {
        routeObject: "docs/api/openapi.json",
        pipelineTrace: "",
        pipelineLogs: "",
        pipelineMetrics: "",
        pipelineCorrelation: "",
      },
    });
  }
  for (const uiRoute of frontendRoutes(repoRoot, capabilityRows)) {
    const key = `${uiRoute.method} ${uiRoute.path}`;
    if (!byKey.has(key)) byKey.set(key, uiRoute);
  }
  return [...byKey.values()].sort((a, b) =>
    `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`)
  );
}

function buildCommandInventory(ctx) {
  return Object.entries(ctx.packageJsonScripts || {})
    .map(([name, command]) => ({
      commandId: stableId("npm-script", name),
      name: `npm run ${name}`,
      command,
      sourceFileRefs: ["package.json"],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildWorkerInventory(repoRoot) {
  const files = walkFiles(path.join(repoRoot, "apps/platform-api/src"), (file) =>
    /worker.*\.ts$/.test(file)
  );
  return files.map((file) => {
    const text = readText(file);
    const key =
      /export const ([A-Z0-9_]+WORKER_KEY)\s*=\s*["']([^"']+)["']/.exec(text)?.[2] ??
      path.basename(file, ".ts");
    return {
      workerId: stableId("worker", key),
      key,
      file: rel(repoRoot, file),
      startsFromServer:
        text.includes("start") &&
        readText(path.join(repoRoot, "apps/platform-api/src/server/index.ts")).includes(
          path.basename(file, ".ts")
        ),
      retryEvidence: /retry|backoff|attempt/i.test(text),
      dlqEvidence: /dead.?letter|dlq/i.test(text),
      auditEvidence: /audit/i.test(text),
      traceEvidence: /withSpan|withServerSpan|trace/i.test(text),
      metricEvidence: /metric|counter|histogram/i.test(text),
      sourceFileRefs: [rel(repoRoot, file)],
    };
  });
}

function buildEventInventory(ctx, sources) {
  const semanticEvents = ctx.foundation?.["event-semantics.json"]?.events || [];
  const runtimeNames = new Set(ctx.platformEventNames || []);
  for (const script of sources.proofScripts) {
    for (const match of script.text.matchAll(/event(Name|Type)?:\s*["']([^"']+)["']/g)) {
      runtimeNames.add(match[2]);
    }
  }
  return [...runtimeNames].sort().map((eventName) => {
    const semantic = semanticEvents.find((event) => event.eventName === eventName);
    const proofScripts = sources.proofScripts.filter((script) => {
      const lower = script.text.toLowerCase();
      return (
        script.text.includes(eventName) &&
        /publish|emit|produce|send/.test(lower) &&
        /consume|consumer|handle|deliver|worker|redrive|read/.test(lower)
      );
    });
    return {
      eventId: stableId("event", eventName),
      eventName,
      semanticDefinition: !!semantic,
      typedPayload: present(semantic?.schema),
      version: semantic?.version ?? semantic?.schemaVersion ?? "unknown",
      producer: semantic?.producer ?? "unknown",
      consumer: present(semantic?.consumers) ? semantic.consumers : "unknown",
      idempotencyKey: semantic?.idempotencyKey ?? "unknown",
      correlation: semantic?.traceCorrelation ?? semantic?.auditRelationship ?? "unknown",
      retryPolicy: semantic?.retryPolicy ?? "unknown",
      dlqPolicy: semantic?.dlqPolicy ?? "unknown",
      retention: semantic?.retention ?? "unknown",
      privacyClassification: semantic?.privacyClassification ?? "unknown",
      auditRelationship: semantic?.auditRelationship ?? "unknown",
      proofRef: semantic?.proof ?? "unknown",
      proofExercisesPublishConsume: proofScripts.length > 0,
      proofSourceFileRefs: proofScripts.map((script) => script.file),
      sourceFileRefs: semantic?.sourceFileRefs ?? [],
    };
  });
}

function buildProviderInventory(ctx, repoRoot) {
  const envRows = ctx.foundation?.["environment-capability-matrix.json"]?.capabilities || [];
  const providerFiles = walkFiles(path.join(repoRoot, "apps/platform-api/src/adapters"), (file) =>
    /\.ts$/.test(file)
  );
  const providerNames = new Set();
  for (const row of envRows) {
    for (const env of ["dev", "test", "staging", "prod"]) {
      if (row[env]?.provider) providerNames.add(row[env].provider);
    }
  }
  for (const file of providerFiles) providerNames.add(path.basename(file, ".ts"));
  return [...providerNames].sort().map((provider) => {
    const file = providerFiles.find((candidate) => path.basename(candidate, ".ts") === provider);
    const text = file ? readText(file) : "";
    return {
      providerId: stableId("provider", provider),
      provider,
      adapterFile: file ? rel(repoRoot, file) : "unknown",
      configSource: /load[A-Za-z0-9]+Config|getProvisioningConfig|process\.env/.test(text)
        ? "source evidence"
        : "unknown",
      secretSource: /secret|credential|token|apiKey/i.test(text) ? "source evidence" : "unknown",
      timeout: /timeout|AbortSignal/.test(text) ? "source evidence" : "unknown",
      retry: /retry|attempt|backoff/i.test(text) ? "source evidence" : "unknown",
      degradedMode: /degraded|fallback|unavailable|fail.?closed/i.test(text)
        ? "source evidence"
        : "unknown",
      failClosed: /fail.?closed|deny|disabled|unavailable|throw new Error/i.test(text)
        ? "source evidence"
        : "unknown",
      fallbackRationale: /fallback|no fallback|degraded|unavailable/i.test(text)
        ? "source evidence"
        : "unknown",
      healthCheck: /health|readiness|probe/i.test(text) ? "source evidence" : "unknown",
      operatorRecovery: /repair|recover|operator|rotate|retry|redrive/i.test(text)
        ? "source evidence"
        : "unknown",
      unavailableProof: proofExistsFor(repoRoot, provider) ? "source evidence" : "unknown",
      misconfiguredProof: proofExistsFor(repoRoot, provider) ? "source evidence" : "unknown",
      sourceFileRefs: file ? [rel(repoRoot, file)] : [],
    };
  });
}

function buildStorageInventory(repoRoot) {
  const files = [
    ...walkFiles(path.join(repoRoot, "apps/platform-api/src/usecases"), (file) =>
      /storage|legal-hold|quota/i.test(file)
    ),
    ...walkFiles(path.join(repoRoot, "apps/platform-api/src/adapters"), (file) =>
      /storage|legal-hold|quota|antivirus|clamav/i.test(file)
    ),
    ...walkFiles(path.join(repoRoot, "packages"), (file) => /storage.*\.ts$/.test(file)),
  ];
  return files.map((file) => {
    const text = readText(file);
    const operation = path.basename(file, ".ts");
    return {
      operationId: stableId("storage-operation", rel(repoRoot, file)),
      operation,
      file: rel(repoRoot, file),
      tenantPrefixIsolation: /tenantPrefix|organisationId|tenant/i.test(text),
      quotaBeforeWrite: /quota/i.test(text) && /before|enforce|check/i.test(text),
      uploadStateTransition: /pending|uploaded|clean|rejected|quarantine/i.test(text),
      cleanRejectedLifecycle:
        /clean/i.test(text) && /reject|rejected|quarantine|infected|failed/i.test(text),
      quarantine: /quarantine/i.test(text),
      avScan: /antivirus|clamav|scan/i.test(text),
      downloadBlockedUntilClean:
        /download|getObject|signedUrl|presign/i.test(text) && /clean|scan|quarantine/i.test(text),
      signedUrlPolicy: /signedUrl|presign|expiresIn|expiry|ttl/i.test(text),
      errorMapping: /map.*error|error.*map|StorageError|throw new/i.test(text),
      backupExportRetentionRelationship: /backup|export|retention|lifecycle/i.test(text),
      legalHoldDeletionBlock: /legal.?hold/i.test(text),
      auditEvent: /audit/i.test(text),
      traceSpan: /withSpan|trace/i.test(text),
      structuredLog: /createLogger|log\./i.test(text),
      metric: /metric|counter|histogram/i.test(text),
      proofCoverage: proofExistsFor(repoRoot, "storage"),
      sourceFileRefs: [rel(repoRoot, file)],
    };
  });
}

function buildWorkflowInventory(repoRoot) {
  const files = [
    ...walkFiles(path.join(repoRoot, "apps/platform-api/src/usecases"), (file) =>
      /workflow|support|scheduled|retention/i.test(file)
    ),
    ...walkFiles(path.join(repoRoot, "apps/platform-api/src/adapters"), (file) =>
      /workflow|automation|temporal|windmill/i.test(file)
    ),
  ];
  return files.map((file) => {
    const text = readText(file);
    return {
      workflowId: stableId("workflow", rel(repoRoot, file)),
      workflow: path.basename(file, ".ts"),
      file: rel(repoRoot, file),
      stateMachineDefinition: /state|status|transition/i.test(text),
      allowedTransitions: /allowed|transition/i.test(text),
      forbiddenTransitions: /forbidden|invalid|reject/i.test(text),
      idempotency: /idempot/i.test(text),
      retry: /retry|attempt|backoff/i.test(text),
      timeout: /timeout|AbortSignal/i.test(text),
      compensation: /compensat|rollback|cancel/i.test(text),
      failureHoldingState: /failed|dead.?letter|dlq|error/i.test(text),
      audit: /audit/i.test(text),
      trace: /withSpan|trace/i.test(text),
      metric: /metric|counter|histogram/i.test(text),
      operatorRecovery: /operator|redrive|repair|recovery/i.test(text),
      proofCoverage: proofExistsFor(repoRoot, path.basename(file, ".ts")),
      sourceFileRefs: [rel(repoRoot, file)],
    };
  });
}

function proofExistsFor(repoRoot, needle) {
  const scriptDir = path.join(repoRoot, "apps/platform-api/scripts");
  return walkFiles(scriptDir, (file) => file.endsWith(".ts")).some((file) =>
    path.basename(file).includes(needle)
  );
}

function buildSecurityBoundaryInventory(routes) {
  return routes.map((route) => ({
    boundaryId: stableId("security-boundary", route.routeId),
    routeId: route.routeId,
    method: route.method,
    path: route.path,
    authBoundary:
      route.authRequired === true || route.authRequired === false ? route.authRequired : "unknown",
    permissionBoundary: route.permissionRequired,
    tenantBoundary:
      route.path.startsWith("/api/org/") || route.path.startsWith("/api/me/")
        ? "tenant route namespace"
        : route.path.startsWith("/api/admin/")
          ? "admin route namespace"
          : "unknown",
    rbacAbacPdpDecision: route.policyRequired === true ? "UMA resource+scope" : "unknown",
    failClosed:
      route.policyRequired === true || route.permissionRequired !== "unknown"
        ? "source evidence"
        : "unknown",
    securityAudit:
      route.isMutation && route.auditEvent !== "unknown" ? route.auditEvent : "unknown",
    sourceFileRefs: route.sourceFileRefs,
  }));
}

function buildObservabilityInventory(routes) {
  return routes.map((route) => ({
    observabilityId: stableId("observability", route.routeId),
    routeId: route.routeId,
    method: route.method,
    path: route.path,
    traceSpan: route.traceSpan,
    structuredLog: route.logEvent,
    metric: route.metricName,
    errorLog: route.logEvent.includes("failed") ? route.logEvent : "unknown",
    correlationId: route.evidence.pipelineCorrelation ? "X-Request-Id/requestId" : "unknown",
    sourceFileRefs: route.sourceFileRefs,
  }));
}

function buildAuditInventory(routes) {
  return routes
    .filter((route) => route.isMutation)
    .map((route) => ({
      auditId: stableId("audit", route.routeId),
      routeId: route.routeId,
      method: route.method,
      path: route.path,
      auditEvent: route.auditEvent,
      actor: route.auditEvent === "unknown" ? "unknown" : "handler audit source",
      resource: route.auditEvent === "unknown" ? "unknown" : "handler audit source",
      beforeAfter: route.auditEvent === "unknown" ? "unknown" : "unknown",
      sourceFileRefs: route.sourceFileRefs,
    }));
}

function buildProofInventory(repoRoot, routes) {
  return walkFiles(path.join(repoRoot, "apps/platform-api/scripts"), (file) =>
    /runtime-proof\.ts$/.test(file)
  ).map((file) => {
    const text = readText(file);
    const routeHits = routes.filter((route) => text.includes(route.path));
    const level = classifyProofLevel(text);
    return {
      proofId: stableId("proof", rel(repoRoot, file)),
      file: rel(repoRoot, file),
      level,
      classification: proofLevelName(level),
      routeRefs: routeHits.map((route) => route.routeId),
      assertsSideEffects:
        /assert\..*(equal|ok|deep)|throw new Error/i.test(text) &&
        /select|find|get|list|status|state/i.test(text),
      assertsFailureMode: /reject|fail|forbidden|unauthorized|unreachable|invalid|error/i.test(
        text
      ),
      assertsObservabilityOrAudit: /audit|trace|metric|log|span/i.test(text),
      sourceFileRefs: [rel(repoRoot, file)],
    };
  });
}

function classifyProofLevel(text) {
  if (/docker|compose|postgres|redis|minio|loki|tempo|prometheus|fetch\(/i.test(text)) return 4;
  if (/state|transition|workflow|lifecycle/i.test(text)) return 3;
  if (/assert|expect|strictEqual|deepStrictEqual/i.test(text)) return 2;
  if (/schema|contract|zod/i.test(text)) return 1;
  return 0;
}

function proofLevelName(level) {
  return [
    "route/file existence only",
    "contract shape only",
    "isolated unit behaviour",
    "state transition behaviour",
    "live substrate behaviour",
    "end-to-end runtime behaviour",
  ][level];
}

function semanticRouteSet(ctx) {
  const paths = new Set();
  for (const capability of ctx.capabilities || []) {
    for (const match of String(capability.contract || "").matchAll(
      /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_:/.-]+)/g
    )) {
      paths.add(`${match[1]} ${match[2]}`);
    }
  }
  return paths;
}

function classifyGap(gap) {
  const kind = String(gap.kind || "").toLowerCase();
  const message = String(gap.message || "").toLowerCase();
  if (
    kind.includes("duplicate") ||
    message.includes("duplicate") ||
    message.includes("same subject")
  )
    return "duplicate-finding";
  if (message.includes("stale") || message.includes("obsolete") || message.includes("phantom"))
    return "obsolete-runtime-artifact";
  if (
    kind.includes("semantic") ||
    kind.includes("proof") ||
    kind.includes("route") ||
    kind.includes("audit") ||
    kind.includes("security") ||
    kind.includes("observability") ||
    kind.includes("storage") ||
    kind.includes("workflow") ||
    kind.includes("provider") ||
    kind.includes("event") ||
    kind.includes("ownership") ||
    kind.includes("command")
  )
    return "must-fix-in-v1";
  if (
    message.includes("external") &&
    (message.includes("dependency") ||
      message.includes("provider") ||
      message.includes("third-party"))
  )
    return "external-limited";
  return "must-fix-in-v1";
}

function gap(kind, subject, message, evidence = {}) {
  const item = { kind, subject, message, evidence };
  item.classification = classifyGap(item);
  return item;
}

function routeObservabilityReport(inventory) {
  const gaps = [];
  for (const route of inventory.routes) {
    if (route.traceSpan === "unknown")
      gaps.push(
        gap(
          "route-observability",
          `${route.method} ${route.path}`,
          "route without trace span",
          route.evidence
        )
      );
    if (route.logEvent === "unknown")
      gaps.push(
        gap(
          "route-observability",
          `${route.method} ${route.path}`,
          "route without structured complete/error logs",
          route.evidence
        )
      );
    if (route.metricName === "unknown")
      gaps.push(
        gap(
          "route-observability",
          `${route.method} ${route.path}`,
          "route without metric",
          route.evidence
        )
      );
    if (!route.evidence.pipelineCorrelation)
      gaps.push(
        gap(
          "route-observability",
          `${route.method} ${route.path}`,
          "route without correlation id evidence",
          route.evidence
        )
      );
    if (route.proofRequired && route.proofRef === "unknown")
      gaps.push(
        gap(
          "route-observability",
          `${route.method} ${route.path}`,
          "route without executable proof reference",
          route.evidence
        )
      );
    if (route.isMutation && route.auditEvent === "unknown")
      gaps.push(
        gap(
          "route-audit",
          `${route.method} ${route.path}`,
          "mutation route without route-local audit evidence",
          route.evidence
        )
      );
  }
  return { artefact: "route-observability-report", pass: gaps.length === 0, gaps };
}

function routeSecurityReport(inventory) {
  const gaps = [];
  for (const boundary of inventory.securityBoundaries) {
    const subject = `${boundary.method} ${boundary.path}`;
    if (boundary.authBoundary === "unknown")
      gaps.push(gap("route-security", subject, "route without auth decision", boundary));
    if (boundary.permissionBoundary === "unknown" && boundary.path.startsWith("/api/"))
      gaps.push(gap("route-security", subject, "API route without permission decision", boundary));
    if (boundary.tenantBoundary === "unknown" && boundary.path.startsWith("/api/"))
      gaps.push(gap("route-security", subject, "API route without tenant boundary", boundary));
    if (boundary.path.startsWith("/api/admin/") && boundary.rbacAbacPdpDecision === "unknown")
      gaps.push(
        gap(
          "route-security",
          subject,
          "admin route without route-level RBAC/ABAC/PDP evidence",
          boundary
        )
      );
    if (
      boundary.path.startsWith("/api/admin/") &&
      boundary.securityAudit === "unknown" &&
      inventory.routes.find((route) => route.routeId === boundary.routeId)?.isMutation
    )
      gaps.push(
        gap(
          "route-security",
          subject,
          "privileged mutation route without security audit evidence",
          boundary
        )
      );
  }
  return { artefact: "route-security-report", pass: gaps.length === 0, gaps };
}

function ownershipReport(ctx, inventory) {
  const gaps = [];
  const codeownersPresent = fs.existsSync(path.join(ctx.repoRoot, "CODEOWNERS"));
  const capabilities = (ctx.capabilities || []).map((capability) => {
    const name = capabilityName(capability);
    return {
      capability: name,
      ownerType: capability.ownerType ?? "unknown",
      ownerId:
        capability.ownerId ??
        capability.owner ??
        capability.operationalOwner ??
        capability.semanticCompleteness?.owner ??
        "unknown",
      ownerArtefact: capability.ownerArtefact ?? "v1-capability-closure.json",
      owningDomain: capability.owningDomain ?? capability.domain ?? "unknown",
      operationalOwner:
        capability.operationalOwner ??
        capability.owner ??
        capability.semanticCompleteness?.owner ??
        "unknown",
      securityOwner: capability.securityOwner ?? "unknown",
      dataOwner: capability.dataOwner ?? "unknown",
      runtimeOwner: capability.runtimeOwner ?? "unknown",
      sourceFileRefs: capability.sourceFileRefs ?? [
        "docs/v2-foundation/v1-capability-closure.json",
      ],
    };
  });
  for (const ownership of capabilities) {
    const name = ownership.capability;
    if (ownership.ownerId === "unknown")
      gaps.push(
        gap("ownership", name, "capability without explicit owner", {
          source: "v1-capability-closure.json",
        })
      );
    if (/data|storage|governance|retention|legal/i.test(name) && ownership.dataOwner === "unknown")
      gaps.push(
        gap("ownership", name, "data-owning capability without data owner", {
          source: "v1-capability-closure.json",
        })
      );
    if (
      inventory.providers.some((provider) =>
        provider.provider.toLowerCase().includes(name.toLowerCase())
      ) &&
      ownership.runtimeOwner === "unknown"
    )
      gaps.push(
        gap("ownership", name, "provider-backed capability without runtime owner", {
          source: "runtime-provider-inventory.json",
        })
      );
    if (/auth|security|permission|secret|idp/i.test(name) && ownership.securityOwner === "unknown")
      gaps.push(
        gap("ownership", name, "security capability without security owner", {
          source: "v1-capability-closure.json",
        })
      );
  }
  return {
    artefact: "ownership-assurance-report",
    codeownersPresent,
    capabilities,
    pass: gaps.length === 0,
    gaps,
  };
}

function proofBehaviourReport(inventory) {
  const gaps = [];
  for (const proof of inventory.proofs) {
    if (proof.level <= 1)
      gaps.push(gap("proof-behaviour", proof.file, "proof only checks file/contract shape", proof));
    if (!proof.assertsSideEffects)
      gaps.push(gap("proof-behaviour", proof.file, "proof does not assert side effects", proof));
    if (!proof.assertsFailureMode)
      gaps.push(gap("proof-behaviour", proof.file, "proof does not assert failure mode", proof));
    if (proof.routeRefs.length === 0)
      gaps.push(
        gap(
          "proof-behaviour",
          proof.file,
          "proof does not map to a discovered runtime route",
          proof
        )
      );
  }
  return {
    artefact: "proof-behaviour-report",
    pass: gaps.length === 0,
    gaps,
    proofs: inventory.proofs,
  };
}

function requiredBooleanReport(artefact, kind, records, checks) {
  const gaps = [];
  for (const record of records) {
    const subject = record.path
      ? `${record.method ?? ""} ${record.path}`.trim()
      : (record.file ?? record.eventName ?? record.provider ?? record.workflow ?? record.operation);
    for (const [field, message] of checks) {
      const value = record[field];
      if (value === false || value === "unknown" || value === "" || value == null) {
        gaps.push(gap(kind, subject, message ?? `missing ${field}`, record));
      }
    }
  }
  return { artefact, pass: gaps.length === 0, gaps };
}

function semanticRuntimeDiffReport(ctx, inventory) {
  const semanticRoutes = semanticRouteSet(ctx);
  const runtimeRoutes = new Set(inventory.routes.map((route) => `${route.method} ${route.path}`));
  const gaps = [];
  const semanticText = JSON.stringify(ctx.foundation || {}).toLowerCase();
  for (const route of runtimeRoutes) {
    if (!semanticRoutes.has(route))
      gaps.push(
        gap("semantic-runtime-diff", route, "runtime route has no semantic contract definition", {
          source: "runtime-route-inventory.json",
        })
      );
  }
  for (const route of semanticRoutes) {
    if (!runtimeRoutes.has(route))
      gaps.push(
        gap(
          "semantic-runtime-diff",
          route,
          "semantic route claim has no runtime route implementation",
          { source: "v1-capability-closure.json" }
        )
      );
  }
  for (const route of inventory.routes) {
    if (route.proofRequired && route.proofRef === "unknown")
      gaps.push(
        gap(
          "semantic-runtime-diff",
          `${route.method} ${route.path}`,
          "semantic/runtime route lacks executable proof",
          route
        )
      );
  }
  for (const command of inventory.commands) {
    if (!semanticText.includes(command.name.replace(/^npm run /, "").toLowerCase()))
      gaps.push(
        gap(
          "semantic-runtime-diff",
          command.name,
          "runtime command has no semantic catalogue link",
          {
            source: "runtime-command-inventory.json",
          }
        )
      );
  }
  for (const worker of inventory.workers) {
    if (!semanticText.includes(worker.key.toLowerCase()))
      gaps.push(
        gap(
          "semantic-runtime-diff",
          worker.key,
          "runtime worker has no semantic worker/event link",
          {
            source: "runtime-worker-inventory.json",
          }
        )
      );
  }
  for (const event of inventory.events) {
    if (!event.semanticDefinition)
      gaps.push(
        gap("semantic-runtime-diff", event.eventName, "runtime event has no semantic definition", {
          source: "runtime-event-inventory.json",
        })
      );
  }
  for (const provider of inventory.providers) {
    if (!semanticText.includes(provider.provider.toLowerCase()))
      gaps.push(
        gap(
          "semantic-runtime-diff",
          provider.provider,
          "runtime provider has no semantic/provider matrix link",
          {
            source: "runtime-provider-inventory.json",
          }
        )
      );
  }
  for (const operation of inventory.storageOperations) {
    if (!semanticText.includes(operation.operation.toLowerCase()))
      gaps.push(
        gap(
          "semantic-runtime-diff",
          operation.operation,
          "runtime storage operation has no semantic storage link",
          {
            source: "runtime-storage-operation-inventory.json",
          }
        )
      );
  }
  for (const workflow of inventory.workflows) {
    if (!semanticText.includes(workflow.workflow.toLowerCase()))
      gaps.push(
        gap(
          "semantic-runtime-diff",
          workflow.workflow,
          "runtime workflow has no semantic workflow/state-machine link",
          {
            source: "runtime-workflow-inventory.json",
          }
        )
      );
  }
  for (const audit of inventory.audits) {
    if (audit.auditEvent === "unknown")
      gaps.push(
        gap(
          "semantic-runtime-diff",
          `${audit.method} ${audit.path}`,
          "runtime audit requirement has no audit event mapping",
          {
            source: "runtime-audit-inventory.json",
          }
        )
      );
  }
  for (const observability of inventory.observability) {
    if (
      observability.traceSpan === "unknown" ||
      observability.structuredLog === "unknown" ||
      observability.metric === "unknown"
    )
      gaps.push(
        gap(
          "semantic-runtime-diff",
          `${observability.method} ${observability.path}`,
          "runtime observability surface lacks trace/log/metric mapping",
          { source: "runtime-observability-inventory.json" }
        )
      );
  }
  return { artefact: "semantic-runtime-diff-report", pass: gaps.length === 0, gaps };
}

function semanticOrphanReport(ctx, inventory) {
  const gaps = [];
  for (const route of inventory.routes) {
    if (route.capability === "unknown")
      gaps.push(
        gap("semantic-orphan", `${route.method} ${route.path}`, "route with no capability", route)
      );
  }
  for (const event of inventory.events) {
    if (!event.semanticDefinition)
      gaps.push(
        gap("semantic-orphan", event.eventName, "runtime event with no semantic definition", event)
      );
    if (event.consumer === "unknown")
      gaps.push(gap("semantic-orphan", event.eventName, "event with no consumer", event));
  }
  const routeCapabilities = new Set(
    inventory.routes.map((route) => route.capability).filter((item) => item !== "unknown")
  );
  for (const capability of ctx.capabilities || []) {
    const name = capabilityName(capability);
    if (String(capability.contract || "").includes("/api/") && !routeCapabilities.has(name))
      gaps.push(
        gap(
          "semantic-orphan",
          name,
          "semantic capability with route contract but no route mapping",
          { contract: capability.contract }
        )
      );
  }
  return { artefact: "semantic-orphan-runtime-report", pass: gaps.length === 0, gaps };
}

export function buildAdversarialUSFAudit(ctx) {
  const repoRoot = ctx.repoRoot;
  const proofScripts = walkFiles(path.join(repoRoot, "apps/platform-api/scripts"), (file) =>
    /runtime-proof\.ts$/.test(file)
  ).map((file) => ({ file: rel(repoRoot, file), text: readText(file) }));
  const sources = { proofScripts };
  const routes = buildRouteInventory(ctx, sources);
  const inventory = {
    routes,
    commands: buildCommandInventory(ctx),
    workers: buildWorkerInventory(repoRoot),
    events: buildEventInventory(ctx, sources),
    providers: buildProviderInventory(ctx, repoRoot),
    storageOperations: buildStorageInventory(repoRoot),
    workflows: buildWorkflowInventory(repoRoot),
    securityBoundaries: buildSecurityBoundaryInventory(routes),
    observability: buildObservabilityInventory(routes),
    audits: buildAuditInventory(routes),
    proofs: buildProofInventory(repoRoot, routes),
  };
  const reports = {
    semanticRuntimeDiff: semanticRuntimeDiffReport(ctx, inventory),
    routeObservability: routeObservabilityReport(inventory),
    routeSecurity: routeSecurityReport(inventory),
    ownership: ownershipReport(ctx, inventory),
    proofBehaviour: proofBehaviourReport(inventory),
    storage: requiredBooleanReport(
      "storage-assurance-report",
      "storage",
      inventory.storageOperations,
      [
        ["tenantPrefixIsolation", "storage operation without tenant prefix isolation evidence"],
        ["quotaBeforeWrite", "storage operation without quota-before-write evidence"],
        ["uploadStateTransition", "storage operation without lifecycle state transition evidence"],
        ["cleanRejectedLifecycle", "storage operation without clean/rejected lifecycle evidence"],
        ["avScan", "storage operation without AV scan evidence"],
        [
          "downloadBlockedUntilClean",
          "storage operation without download-blocked-until-clean evidence",
        ],
        ["signedUrlPolicy", "storage operation without signed URL policy evidence"],
        ["errorMapping", "storage operation without error mapping evidence"],
        [
          "backupExportRetentionRelationship",
          "storage operation without backup/export/retention relationship evidence",
        ],
        ["legalHoldDeletionBlock", "storage operation without legal hold deletion block evidence"],
        ["auditEvent", "storage operation without audit event evidence"],
        ["traceSpan", "storage operation without trace span evidence"],
        ["structuredLog", "storage operation without structured log evidence"],
        ["metric", "storage operation without metric evidence"],
        ["proofCoverage", "storage operation without executable proof coverage"],
      ]
    ),
    workflow: requiredBooleanReport("workflow-assurance-report", "workflow", inventory.workflows, [
      ["stateMachineDefinition", "workflow without state-machine definition evidence"],
      ["allowedTransitions", "workflow without allowed-transition evidence"],
      ["forbiddenTransitions", "workflow without forbidden-transition evidence"],
      ["idempotency", "workflow without idempotency evidence"],
      ["retry", "workflow without retry evidence"],
      ["timeout", "workflow without timeout evidence"],
      ["compensation", "workflow without compensation/cancel evidence"],
      ["failureHoldingState", "workflow without failure holding state evidence"],
      ["audit", "workflow without audit evidence"],
      ["trace", "workflow without trace evidence"],
      ["metric", "workflow without metric evidence"],
      ["operatorRecovery", "workflow without operator recovery evidence"],
      ["proofCoverage", "workflow without proof coverage"],
    ]),
    eventRuntime: requiredBooleanReport(
      "event-runtime-assurance-report",
      "event-runtime",
      inventory.events,
      [
        ["semanticDefinition", "event emitted but not semantically defined"],
        ["typedPayload", "event without typed payload/schema"],
        ["idempotencyKey", "event without idempotency key"],
        ["correlation", "event without trace/audit correlation"],
        ["retryPolicy", "event without retry policy"],
        ["dlqPolicy", "event without DLQ policy"],
        ["retention", "event without retention policy"],
        ["privacyClassification", "event without privacy classification"],
        ["proofExercisesPublishConsume", "event without executable publish/consume proof"],
      ]
    ),
    metricsAlerts: metricsAlertsReport(ctx, inventory),
    dataGovernance: dataGovernanceReport(ctx, inventory),
    providerReliability: providerReliabilityReport(inventory),
    semanticOrphan: semanticOrphanReport(ctx, inventory),
  };
  const gaps = Object.values(reports).flatMap((report) => report.gaps || []);
  return { inventory, reports, gaps, pass: gaps.length === 0 };
}

function metricsAlertsReport(ctx, inventory) {
  const gaps = [];
  const routes = [];
  const capabilities = [];
  for (const route of inventory.routes) {
    routes.push({
      routeId: route.routeId,
      method: route.method,
      path: route.path,
      metricType: route.metricName === "unknown" ? "unknown" : "counter/histogram",
      metricName: route.metricName,
      labels: route.metricName === "unknown" ? "unknown" : ["method", "route", "status", "tenant"],
      sloThreshold: "unknown",
      alertCondition: route.alertRequired ? "unknown" : "not-required",
      alertOwner: "unknown",
      alertRouting: "unknown",
      runbook: "unknown",
      proofRef: route.proofRef,
      sourceFileRefs: route.sourceFileRefs,
    });
    if (route.metricName === "unknown")
      gaps.push(
        gap("metrics-alerts", `${route.method} ${route.path}`, "route without metric name", route)
      );
    if (route.alertRequired)
      gaps.push(
        gap(
          "metrics-alerts",
          `${route.method} ${route.path}`,
          "route without route-specific alert condition/owner/runbook proof",
          route
        )
      );
  }
  for (const capability of ctx.capabilities || []) {
    const name = capabilityName(capability);
    const op = (ctx.foundation?.["operational-semantics.json"]?.capabilities || []).find(
      (row) => row.capability === name
    );
    capabilities.push({
      capability: name,
      metricType: present(op?.metrics) ? "semantic metric" : "unknown",
      metricName: op?.metrics ?? "unknown",
      labels: op?.labels ?? "unknown",
      sloThreshold: op?.sloThreshold ?? op?.slo ?? "unknown",
      alertCondition: op?.alertConditions ?? "unknown",
      alertOwner: op?.alertOwner ?? "unknown",
      alertRouting: op?.alertRouting ?? "unknown",
      runbook: op?.runbookReference ?? "unknown",
      proofRef: op?.proof ?? "unknown",
    });
    if (!present(op?.metrics))
      gaps.push(
        gap("metrics-alerts", name, "capability without metric definition", {
          source: "operational-semantics.json",
        })
      );
    if (!present(op?.alertConditions))
      gaps.push(
        gap("metrics-alerts", name, "capability without alert condition", {
          source: "operational-semantics.json",
        })
      );
    if (!present(op?.runbookReference))
      gaps.push(
        gap("metrics-alerts", name, "capability alert without runbook", {
          source: "operational-semantics.json",
        })
      );
  }
  return { artefact: "metrics-alerts-report", pass: gaps.length === 0, routes, capabilities, gaps };
}

function dataGovernanceReport(ctx, inventory) {
  const gaps = [];
  for (const capability of ctx.capabilities || []) {
    const name = capabilityName(capability);
    if (!/data|storage|audit|history|profile|tenant|retention|governance|billing/i.test(name))
      continue;
    if (!capability.dataOwner)
      gaps.push(
        gap("data-governance", name, "data-owning capability without data owner", capability)
      );
    for (const field of [
      "classification",
      "retention",
      "backup",
      "restore",
      "export",
      "legal hold",
      "DSR",
      "lineage",
      "tenant isolation",
      "audit",
    ]) {
      if (
        !JSON.stringify(capability).toLowerCase().includes(field.toLowerCase().replace(" ", "")) &&
        !JSON.stringify(capability).toLowerCase().includes(field.toLowerCase())
      )
        gaps.push(
          gap(
            "data-governance",
            name,
            `data-owning capability missing ${field} runtime proof`,
            capability
          )
        );
    }
  }
  for (const route of inventory.routes.filter(
    (item) => item.path.includes("/api/org/") || item.path.includes("/api/admin/tenants/")
  )) {
    if (route.authRequired !== true || route.permissionRequired === "unknown")
      gaps.push(
        gap(
          "data-governance",
          `${route.method} ${route.path}`,
          "tenant data route without proven tenant/auth boundary",
          route
        )
      );
  }
  return { artefact: "data-governance-runtime-report", pass: gaps.length === 0, gaps };
}

function providerReliabilityReport(inventory) {
  const gaps = [];
  for (const provider of inventory.providers) {
    for (const [field, message] of [
      ["adapterFile", "provider with no adapter"],
      ["configSource", "provider with no config source evidence"],
      ["secretSource", "provider with no secret source evidence"],
      ["timeout", "provider with no timeout evidence"],
      ["retry", "provider with no retry evidence"],
      ["degradedMode", "provider with no degraded/fail-closed evidence"],
      ["failClosed", "provider with no fail-closed evidence"],
      ["fallbackRationale", "provider with no fallback/no-fallback rationale"],
      ["healthCheck", "provider with no health/readiness check"],
      ["operatorRecovery", "provider with no operator recovery evidence"],
      ["unavailableProof", "provider unavailable path proof not mapped at provider level"],
      ["misconfiguredProof", "provider misconfigured path proof not mapped at provider level"],
    ]) {
      if (provider[field] === "unknown")
        gaps.push(gap("provider-reliability", provider.provider, message, provider));
    }
  }
  return {
    artefact: "provider-reliability-runtime-report",
    pass: gaps.length === 0,
    providers: inventory.providers,
    gaps,
  };
}
