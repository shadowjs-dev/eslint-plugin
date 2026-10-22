// Writes docs/rules/*.md from the rules' meta. Run through `npm run docs` (builds first).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderAllDocs } from "../dist/dev/docs.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of renderAllDocs()) {
  const target = join(root, file.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.content);
}
console.log("docs/rules generated");
