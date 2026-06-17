import fs from "node:fs";

// Read and parse a UTF-8 JSON file. Mirrors the per-tool readJson helpers.
export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
