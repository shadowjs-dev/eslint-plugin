import { createConfig } from "./build/tsdown-preset.mjs";

// The plugin runs in Node only. The rules read the list of Node built-ins and the parser loads its
// dependencies with `node:module`; on the shared "neutral" platform such imports would be reported
// as unresolved. They are external by design.
const builds = createConfig({
  packageDir: import.meta.dirname,
  entries: { index: "src/index.ts", parser: "src/parser/index.ts", docs: "src/docs.ts" },
});

export default builds.map((build) => ({ ...build, deps: { neverBundle: [/^node:/] } }));
