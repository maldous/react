import path from "node:path";
import { createRequire } from "node:module";

// Canonical TypeScript-AST import/specifier discovery. Single source of truth shared by
// validate-source-imports (boundary rules) and tools/v2-readiness (package-removal scan), so the two
// tools can never drift to different definitions of "what imports a package" (ADR-0011 shared
// primitive; extracted from validate-source-imports/scanner.mjs, behaviour-preserving).
const require = createRequire(import.meta.url);
const ts = require("typescript");

function getScriptKind(filePath) {
  switch (path.extname(filePath)) {
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
 * @returns {{ imports: string[], importEdges: ImportEdge[], computedImports: ComputedImport[] }}
 *
 * Covers static imports, export-from, import-equals/require, import-type (type-only) and dynamic
 * import()/require() — package subpaths are returned verbatim in the specifier.
 */
export function extractImports(source, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath)
  );
  const seen = new Set();
  const importEdges = [];
  const computedImports = [];

  const addEdge = (specifier, isTypeOnly, isDynamic, pos) => {
    importEdges.push({ specifier, isTypeOnly, isDynamic, line: lineOf(sourceFile, pos) });
    seen.add(specifier);
  };

  // One handler per import-bearing node kind — keeps the visit() dispatch flat (low complexity).
  const onImportDecl = (node) => {
    if (ts.isStringLiteral(node.moduleSpecifier))
      addEdge(
        node.moduleSpecifier.text,
        node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword,
        false,
        node.getStart()
      );
  };
  const onExportDecl = (node) => {
    if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      addEdge(node.moduleSpecifier.text, !!node.isTypeOnly, false, node.getStart());
  };
  const onImportEquals = (node) => {
    const ref = node.moduleReference;
    if (ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression))
      addEdge(ref.expression.text, false, false, node.getStart());
  };
  const onImportType = (node) => {
    if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal))
      addEdge(node.argument.literal.text, true, false, node.getStart());
  };
  const onCall = (node) => {
    const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
    if (!((isImport || isRequire) && node.arguments.length >= 1)) return;
    const arg = node.arguments[0];
    if (ts.isStringLiteral(arg)) addEdge(arg.text, false, true, node.getStart());
    else computedImports.push({ line: lineOf(sourceFile, node.getStart()) });
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) onImportDecl(node);
    else if (ts.isExportDeclaration(node)) onExportDecl(node);
    else if (ts.isImportEqualsDeclaration(node)) onImportEquals(node);
    else if (ts.isImportTypeNode(node)) onImportType(node);
    else if (ts.isCallExpression(node)) onCall(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { imports: [...seen], importEdges, computedImports };
}

// The bare package a specifier targets: "@scope/name/sub" -> "@scope/name"; "name/sub" -> "name".
export function packageNameOf(specifier) {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}
