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
    case ".ts":
      return ts.ScriptKind.TS;
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.Unknown;
  }
}

function lineOf(sourceFile, pos) {
  return ts.getLineAndCharacterOfPosition(sourceFile, pos).line + 1;
}

/**
 * @typedef {{ specifier: string, isTypeOnly: boolean, isDynamic: boolean, line: number }} ImportEdge
 * @typedef {{ line: number }} ComputedImport
 */

/**
 * @returns {{ imports: string[], importEdges: ImportEdge[], computedImports: ComputedImport[] }}
 */
function extractImports(source, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    getScriptKind(filePath)
  );

  const seen = new Set();
  /** @type {ImportEdge[]} */
  const importEdges = [];
  /** @type {ComputedImport[]} */
  const computedImports = [];

  function addEdge(specifier, isTypeOnly, isDynamic, pos) {
    importEdges.push({ specifier, isTypeOnly, isDynamic, line: lineOf(sourceFile, pos) });
    seen.add(specifier);
  }

  function visitImportDeclaration(node) {
    if (ts.isStringLiteral(node.moduleSpecifier)) {
      const isTypeOnly = node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
      addEdge(node.moduleSpecifier.text, isTypeOnly, false, node.getStart());
    }
  }

  function visitExportDeclaration(node) {
    if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      addEdge(node.moduleSpecifier.text, !!node.isTypeOnly, false, node.getStart());
    }
  }

  function visitImportEqualsDeclaration(node) {
    const ref = node.moduleReference;
    if (ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression)) {
      addEdge(ref.expression.text, false, false, node.getStart());
    }
  }

  function visitImportTypeNode(node) {
    if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      addEdge(node.argument.literal.text, true, false, node.getStart());
    }
  }

  function visitCallExpression(node) {
    const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
    if ((isImport || isRequire) && node.arguments.length >= 1) {
      const arg = node.arguments[0];
      if (ts.isStringLiteral(arg)) {
        addEdge(arg.text, false, true, node.getStart());
      } else {
        // computed dynamic import ? specifier cannot be statically determined
        computedImports.push({ line: lineOf(sourceFile, node.getStart()) });
      }
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) visitImportDeclaration(node);
    else if (ts.isExportDeclaration(node)) visitExportDeclaration(node);
    else if (ts.isImportEqualsDeclaration(node)) visitImportEqualsDeclaration(node);
    else if (ts.isImportTypeNode(node)) visitImportTypeNode(node);
    else if (ts.isCallExpression(node)) visitCallExpression(node);
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return {
    imports: [...seen],
    importEdges,
    computedImports,
  };
}

function walkScanDir(dir, repoRoot, files, warnings, processFileFn) {
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
        walkScanDir(fullPath, repoRoot, files, warnings, processFileFn);
      }
    } else if (entry.isFile()) {
      processFileFn(fullPath);
    }
  }
}

function processScanFile(filePath, repoRoot, files, warnings) {
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

  const { imports, importEdges, computedImports } = extractImports(source, filePath);
  files.push({
    file: filePath,
    packageName,
    packageRoot,
    allowedPlatformDeps,
    isTestFile: isTest,
    imports,
    importEdges,
    computedImports,
  });
}

export function scanRoots(roots, repoRoot) {
  const files = [];
  const warnings = [];
  const processFileFn = (filePath) => processScanFile(filePath, repoRoot, files, warnings);

  for (const root of roots) {
    const absoluteRoot = path.resolve(repoRoot, root);
    if (!fs.existsSync(absoluteRoot)) {
      warnings.push(`Scan root not found: ${root}`);
      continue;
    }
    walkScanDir(absoluteRoot, repoRoot, files, warnings, processFileFn);
  }

  return { files, warnings };
}
