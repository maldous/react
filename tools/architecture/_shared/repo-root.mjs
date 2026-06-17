import fs from "node:fs";
import path from "node:path";

// Ascend from startDir until an ancestor contains any of the given marker
// paths (file or directory). Falls back to path.resolve(startDir) when the
// filesystem root is reached without a match. This is the exact behaviour
// previously duplicated across the architecture tools; each tool passes its
// own marker(s) so resolution is unchanged.
export function findRepoRoot(startDir, markers) {
  const list = Array.isArray(markers) ? markers : [markers];
  let dir = path.resolve(startDir);
  while (true) {
    if (list.some((marker) => fs.existsSync(path.join(dir, marker)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}
