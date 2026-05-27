import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

const IMPORT_PATTERNS = [
  /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/dg,
  /export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/dg,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/dg
];

export function findPackageRoot(filePath) {
  let dir = path.dirname(filePath);
  while (true) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
        if (pkg.name) {
          const deps = pkg.architecture?.relations?.dependsOn;
          const allowedPlatformDeps = Array.isArray(deps) && deps.length > 0 ? deps : null;
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

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/.*/g, "");
}

function extractImports(source) {
  const stripped = stripComments(source);
  const specifiers = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of stripped.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }
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

    const imports = extractImports(source);
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
