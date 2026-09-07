/**
 * Fail if staged/packaged JS still requires @aurum/* workspace packages.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetArg = process.argv[2];
const target = targetArg
  ? path.resolve(process.cwd(), targetArg)
  : path.join(root, "app-dist");

const WORKSPACE_RE =
  /require\(["'](@aurum\/[^"']+)["']\)|from\s+["'](@aurum\/[^"']+)["']/g;

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, files);
    } else if (entry.isFile() && /\.(c?js|mjs)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const hits = [];
for (const file of walk(target)) {
  const src = fs.readFileSync(file, "utf8");
  for (const match of src.matchAll(WORKSPACE_RE)) {
    hits.push({
      file: path.relative(root, file),
      pkg: match[1] || match[2],
    });
  }
}

if (hits.length > 0) {
  console.error("Unresolved workspace imports in packaged JS:");
  for (const h of hits) {
    console.error(`  ${h.file} → ${h.pkg}`);
  }
  process.exit(1);
}

console.log(
  `OK: no @aurum/* workspace requires under ${path.relative(root, target) || "."}`,
);
