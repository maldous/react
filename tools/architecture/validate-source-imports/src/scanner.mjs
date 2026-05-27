import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

export function findPackageRoot(filePath) {
  let dir = path.dirname(filePath);
  while (true) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
        if (pkg.name) {
          const deps = pkg.architecture?.relations?.dependsOn;
          const allowedPlatformDeps = Array.isArray(deps) ? deps : null;
          return { packageRoot: dir, packageName: pkg.name, allowedPlatformDeps };
        }
      } catch {
        // skip unreadable or nameless package.json
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function isTestFile(filePath, packageRoot) {
  const relativePath = path.relative(packageRoot, filePath);
  const parts = relativePath.split(path.sep);
  if (parts.includes("tests") || parts.includes("test")) return true;
  const basename = path.basename(filePath);
  return /\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/.test(basename);
}

function getScriptKind(filePath) {
  const ext = path.extname(filePath);
  switch (ext) {
    case ".ts": return ts.ScriptKind.TS;
    case ".tsx": return ts.ScriptKind.TSX;
    case ".js":
    case ".mjs":
    case ".cjs": return ts.ScriptKind.JS;
    default: return ts.ScriptKind.Unknown;
  }
}

function extractImports(source, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    getScriptKind(filePath)
  );

  const specifiers = new Set();

  function visit(node) {
    // import ... from "specifier"  (including import type ...)
    if (ts.isImportDeclaration(node)) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.add(node.moduleSpecifier.text);
      }
    }
    // export ... from "specifier"  (including export type ...)
    else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.add(node.moduleSpecifier.text);
      }
    }
    // import foo = require("specifier")
    else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression)) {
        specifiers.add(ref.expression.text);
      }
    }
    // import("specifier") dynamic import and require("specifier")
    else if (ts.isCallExpression(node)) {
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      if ((isImport || isRequire) && node.arguments.length >= 1) {
        const arg = node.arguments[0];
        if (ts.isStringLiteral(arg)) {
          specifiers.add(arg.text);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...specifiers];
}

export function scanRoots(roots, repoRoot) {
  const files = [];
  const warnings = [];

  for (const root of roots) {
    const absoluteRoot = path.resolve(repoRoot, root);
    if (!fs.existsSync(absoluteRoot)) {
      warnings.push(`Scan root not found: ${root}`);
      continue;
    }
    walkDir(absoluteRoot);
  }

  return { files, warnings };

  function walkDir(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      warnings.push(`Cannot read directory: ${path.relative(repoRoot, dir)}`);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walkDir(fullPath);
        }
      } else if (entry.isFile()) {
        processFile(fullPath);
      }
    }
  }

  function processFile(filePath) {
    const ext = path.extname(filePath);
    if (!SOURCE_EXTENSIONS.has(ext)) return;
    if (filePath.endsWith(".d.ts")) return;

    const packageInfo = findPackageRoot(filePath);
    if (!packageInfo) return;

    const { packageRoot, packageName, allowedPlatformDeps } = packageInfo;
    const isTest = isTestFile(filePath, packageRoot);

    let source;
    try {
      source = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      warnings.push(`Cannot read file: ${path.relative(repoRoot, filePath)}: ${error.message}`);
      return;
    }

    const imports = extractImports(source, filePath);
    files.push({
      file: filePath,
      packageName,
      packageRoot,
      allowedPlatformDeps,
      isTestFile: isTest,
      imports
    });
  }
}
