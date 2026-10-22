import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import { serverOnlyImportInClient } from "../../src/rules/server-only-import-in-client";
import { runRule, shadowParser } from "../support/tester";

/** `serverFn` as a Dusk module imports it, for the cases that need server functions. */
const startImport = 'import { serverFn } from "@shadow-js/dusk/server";\n';
const generic = [{ preset: "generic" }];

runRule("ESL-15", "server-only-import-in-client", serverOnlyImportInClient, {
  valid: [
    // --- ordinary client code -------------------------------------------------------------
    { code: "import { useSignal } from '@shadow-js/core';", filename: "src/components/A.tsx" },
    { code: "import { db } from '../lib/db';", filename: "src/components/A.tsx" },
    // The shared Dusk entry holds nothing server-only; so do the web renderer and the client entry.
    {
      code: "import { HttpError, redirect } from '@shadow-js/dusk';\nimport { hydrateDusk } from '@shadow-js/dusk/client';",
      filename: "src/routes/index.tsx",
    },
    {
      name: "[Dusk] @shadow-js/web/server is the codec the browser stubs use: not server-only",
      code: "import { serialize } from '@shadow-js/web/server';\nexport const x = serialize;",
      filename: "src/components/A.tsx",
    },
    // --- the Dusk boundary: only what the build protects ---------------------------------
    {
      name: "[Dusk] a route imports a module of server functions from src/server",
      code: "import { getPost, createPost } from '../../server/posts';\nexport const loader = ({ params }) => getPost({ id: params.id });",
      filename: "src/routes/posts/[id].tsx",
    },
    {
      name: "[Dusk] a module of server functions imports .server files for its handlers",
      code: `${startImport}import { findPost } from "./db.server";\nexport const getPost = serverFn({ method: "GET" }, ({ id }) => findPost(id));`,
      filename: "src/server/posts.ts",
    },
    {
      name: "[Dusk] the schema and the middleware of a server function are stripped too",
      code: `${startImport}import { auth } from "./auth.server";\nimport { schema } from "./schema.server";\nexport const f = serverFn({ input: schema, middleware: [auth] }, () => 1);`,
      filename: "src/server/f.ts",
    },
    {
      name: "[Dusk] a helper that only handlers use is stripped with its imports",
      code: `${startImport}import { db } from "./db.server";\nconst read = () => db.list();\nexport const list = serverFn({ method: "GET" }, () => read());`,
      filename: "src/server/list.ts",
    },
    {
      name: "[Dusk] helpers of helpers, declared as functions, arrows or classes, go with the handler",
      code: `${startImport}import { db } from "./db.server";\nimport { log } from "./log.server";\nclass Repo { all() { return db.list(); } }\nfunction read() { log("read"); return new Repo().all(); }\nconst f = serverFn({ method: "GET" }, () => read());\nexport { f };`,
      filename: "src/server/two-levels.ts",
    },
    {
      name: "[Dusk] serverFn through a namespace import or a renamed import",
      code: `import * as start from "@shadow-js/dusk/server";\nimport { serverFn as fn } from "@shadow-js/dusk/server";\nimport { db } from "./db.server";\nexport const a = start.serverFn({}, () => db.a);\nexport const b = fn({}, () => db.b);`,
      filename: "src/server/two.ts",
    },
    {
      name: "[Dusk] a dynamic import and a require inside a handler",
      code: `${startImport}export const f = serverFn({}, async () => (await import("node:fs")).readFileSync("a"));`,
      filename: "src/server/f.ts",
    },
    {
      name: "[Dusk] a server-only import used only as a type is erased",
      code: `import { db } from "./db.server";\nexport type Db = typeof db;\nexport const x: typeof db | null = null;`,
      filename: "src/lib/types.ts",
    },
    {
      name: "[Dusk] the router drops what a route's exports do not use: an unused import in a page",
      code: "import { db } from '../server/db.server';\nexport default function P() { return <p />; }",
      filename: "src/routes/zz.tsx",
    },
    {
      name: "[Dusk] ... and an import that only an unused function in a page uses",
      code: "import { db } from '../server/db.server';\nfunction unused() { return db.list(); }\nexport const loader = () => 1;\nexport default function P() { return <p />; }",
      filename: "src/routes/zz.tsx",
    },
    {
      name: "[Dusk] a use server function nothing uses, in a page",
      code: "import { db } from './db.server';\nasync function load() {\n  'use server';\n  return db.query();\n}\nexport default function P() { return <p />; }",
      filename: "src/routes/zz.tsx",
    },
    {
      name: "[Dusk] src/server/<name> without server functions is assumed to be server code",
      code: "import { readFile } from 'node:fs/promises';\nexport const read = () => readFile('a');",
      filename: "src/server/files.ts",
    },
    {
      name: "[Dusk] import paths under server/ are ordinary modules (the build does not protect them)",
      code: "import { db } from '../server/db';\nexport const view = () => db;",
      filename: "src/components/A.tsx",
    },
    // --- server files ----------------------------------------------------------------------
    { code: "import { readFile } from 'node:fs/promises';", filename: "src/server/files.ts" },
    { code: "import { db } from './db.server';", filename: "src/routes/data.server.ts" },
    {
      code: "import { handler } from '@shadow-js/dusk/server';",
      filename: "src/entry.server.tsx",
    },
    {
      name: "[Dusk] entry-server.ts holds the handler options and the middleware",
      code: "import { cors } from '@shadow-js/dusk/server';\nimport { createHash } from 'node:crypto';\nexport default { middleware: [cors()] };",
      filename: "src/entry-server.ts",
    },
    {
      name: "[Dusk] serve.mjs is the Node entry of the production build",
      code: 'import { fileURLToPath } from "node:url";\nimport { serve } from "@shadow-js/dusk/node";\nimport { handler } from "./dist/server/entry.js";\nawait serve(handler, { port: 3000 });',
      filename: "serve.mjs",
    },
    {
      name: "[Dusk] a CommonJS script is a Node entry as well",
      code: "const fs = require('fs');\nmodule.exports = fs;",
      filename: "bin/start.cjs",
    },
    {
      name: "an API route: HTTP-method exports and no default export",
      code: "import fs from 'fs';\nexport async function GET() { return new Response(await fs.promises.readFile('a')); }",
      filename: "src/routes/hello.ts",
    },
    {
      code: "import { db } from './db.server';\nexport const POST = () => db.save();",
      filename: "src/routes/save.ts",
    },
    { code: "import fs from 'fs';", filename: "scripts/build.ts" },
    { code: "import fs from 'fs';", filename: "vite.config.ts" },
    { code: "import fs from 'fs';", filename: "src/a.test.ts" },
    // A top-level "use server" directive makes the whole file server code.
    {
      code: "'use server';\nimport { db } from './db.server';",
      filename: "src/routes/actions.ts",
    },
    // --- type-only imports ----------------------------------------------------------------
    { code: "import type { Db } from './db.server';", filename: "src/components/A.tsx" },
    { code: "import { type Db } from './db.server';", filename: "src/components/A.tsx" },
    // --- "use server" functions -----------------------------------------------------------
    {
      code: "import { db } from './db.server';\nasync function load() {\n  'use server';\n  return db.query();\n}\nexport default function Page() { return <button onClick={() => load()}>Load</button>; }",
      filename: "src/routes/index.tsx",
    },
    {
      code: "export async function load() {\n  'use server';\n  return import('node:fs');\n}",
      filename: "src/routes/index.tsx",
    },
    // --- options --------------------------------------------------------------------------
    {
      name: "allow lists specifiers to ignore",
      code: "import x from './shared.server';",
      filename: "src/components/A.tsx",
      options: [{ allow: ["shared\\.server$"] }],
    },
    {
      name: "a local require binding is not Node's",
      code: "function f(require: (s: string) => unknown) { return require('fs'); }",
      filename: "src/a.ts",
    },
    {
      name: "words that merely contain server",
      code: "import { observer } from './observer';\nimport s from '../serverless/x';",
      filename: "src/a.tsx",
    },
    {
      name: "custom server file patterns add to the preset's",
      code: "import fs from 'fs';",
      filename: "src/backend/a.ts",
      options: [{ serverFiles: ["(^|/)backend/"] }],
    },
    {
      name: "... and the preset's patterns still apply",
      code: "import fs from 'fs';",
      filename: "serve.mjs",
      options: [{ serverFiles: ["(^|/)backend/"] }],
    },
    {
      name: "[generic] files under server/ are server code",
      code: "import { readFile } from 'node:fs/promises';",
      filename: "src/server/files.ts",
      options: generic,
    },
    {
      name: "[generic] a file with server functions under server/ is still server code",
      code: `${startImport}import { x } from './x.server';\nexport const y = x;`,
      filename: "src/server/files.ts",
      options: generic,
    },
    // --- edge cases: type-only forms, dynamic imports, comments, async, API routes ---------
    {
      name: "[ESL-15.E1] a re-export of types only is erased, like an import of types",
      code: "export { type Db } from './db.server';",
      filename: "src/components/A.tsx",
    },
    {
      name: "[ESL-15.E2] export type ... from, with a braced list or a star",
      code: "export type { Db, Row } from './db.server';\nexport type * from './rows.server';",
      filename: "src/components/A.tsx",
    },
    {
      name: "[ESL-15.E3] a comment above a type-only import changes nothing",
      code: "// only the shape of the module is used here\nimport type { Db } from './db.server';\nexport type Row = Db['row'];",
      filename: "src/components/A.tsx",
    },
    {
      name: "[ESL-15.E4] an import() type is a type, erased like import type",
      code: "type Db = import('./db.server').Db;\nexport const f = (db: Db) => db;",
      filename: "src/lib/types.ts",
    },
    {
      name: "[ESL-15.E5] an async serverFn handler keeps its server-only imports out of the browser",
      code: `${startImport}import { db } from "./db.server";\nexport const list = serverFn({ method: "GET" }, async ({ limit }) => (await db.query(limit)).rows);`,
      filename: "src/server/posts.ts",
    },
    {
      name: "[ESL-15.E6] a route destructures a server module from a dynamic import in its loader",
      code: "export const loader = async () => {\n  const { list } = await import('../../server/posts');\n  return list({});\n};\nexport default function P() { return <p />; }",
      filename: "src/routes/posts/index.tsx",
    },
    {
      name: "[ESL-15.E7] a default-export apiRoute from Dusk is an API route, server code",
      code: "import { apiRoute } from '@shadow-js/dusk/server';\nimport { db } from './db.server';\nexport default apiRoute({ GET: async () => Response.json(await db.list()) });",
      filename: "src/routes/api/posts.ts",
    },
    {
      name: "[ESL-15.E7b] apiRoute under another local name is still Dusk's",
      code: "import { apiRoute as route } from '@shadow-js/dusk/server';\nimport { db } from './db.server';\nexport default route({ GET: async () => Response.json(await db.list()) });",
      filename: "src/routes/api/aliased.ts",
    },
    {
      name: "[ESL-15.E7c] apiRoute through a namespace import",
      code: "import * as dusk from '@shadow-js/dusk/server';\nimport { db } from './db.server';\nexport default dusk.apiRoute({ GET: async () => Response.json(await db.list()) });",
      filename: "src/routes/api/namespace.ts",
    },
    {
      name: "[ESL-15.E8] tools/ at the project root is a script folder",
      code: "import fs from 'fs';\nexport const x = fs;",
      filename: "tools/release.ts",
    },
  ],
  invalid: [
    // --- genuine client-reachable imports -------------------------------------------------
    {
      name: "[Dusk] a .server module used in a component body",
      code: "import { secret } from './secret.server';\nexport default function Page() { return <p>{secret}</p>; }",
      filename: "src/components/Profile.tsx",
      errors: [
        {
          messageId: "serverOnly",
          data: { source: "./secret.server", file: "src/components/Profile.tsx" },
        },
      ],
    },
    {
      name: "[Dusk] a loader is isomorphic: the build does not strip it",
      code: "import { db } from '../../server/db.server';\nexport const loader = () => db.list();\nexport default function Page() { return <p />; }",
      filename: "src/routes/posts/index.tsx",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[Dusk] beforeLoad and head are not stripped either",
      code: "import { session } from './session.server';\nexport const beforeLoad = () => session.get();\nexport const head = () => [{ tag: 'title', children: session.title }];",
      filename: "src/routes/_layout.tsx",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[Dusk] used in the handler and at the top level of the module",
      code: `${startImport}import { db } from "./db.server";\nexport const count = db.size;\nexport const f = serverFn({}, () => db.list());`,
      filename: "src/server/posts.ts",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[Dusk] used by an exported helper next to the server functions",
      code: `${startImport}import { db } from "./db.server";\nexport function helper() { return db.size; }\nexport const f = serverFn({}, () => 1);`,
      filename: "src/server/posts.ts",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[Dusk] used by a helper that something outside the handlers uses",
      code: `${startImport}import { db } from "./db.server";\nconst read = () => db.list();\nexport const rows = read();\nexport const f = serverFn({}, () => read());`,
      filename: "src/server/posts.ts",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[Dusk] a local function called serverFn is not the framework's",
      code: `import { db } from "./db.server";\nfunction serverFn(options: object, handler: () => unknown) { return handler; }\nexport const f = serverFn({}, () => db.list());`,
      filename: "src/lib/posts.ts",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[Dusk] outside routes/ a use server function nothing uses keeps its import, like every unused declaration",
      code: "import { db } from './db.server';\nasync function load() {\n  'use server';\n  return db.query();\n}\nexport const x = 1;",
      filename: "src/lib/index.ts",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[Dusk] outside routes/ an unexported function nothing uses keeps its import",
      code: "import { db } from './db.server';\nfunction unused() { return db.list(); }\nexport const x = 1;",
      filename: "src/lib/index.ts",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[Dusk] a route file the router cannot split keeps its unused imports (no UI export)",
      code: "import { db } from '../server/db.server';\nexport const loader = () => 1;",
      filename: "src/routes/zz.ts",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[Dusk] ... and so does one with a top-level statement that runs code",
      code: "import { db } from '../server/db.server';\nconsole.log('loaded');\nexport default function P() { return <p />; }",
      filename: "src/routes/zz.tsx",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[Dusk] a module without server functions keeps every import, used or not",
      code: "import { db } from './db.server';\nfunction unused() { return db; }\nexport const x = 1;",
      filename: "src/lib/x.ts",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[Dusk] an import nothing uses stays in a module of server functions",
      code: `${startImport}import { db } from "./db.server";\nexport const f = serverFn({}, () => 1);`,
      filename: "src/server/posts.ts",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[Dusk] side-effect imports run in the browser",
      code: "import './setup.server';",
      filename: "src/routes/index.tsx",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: '[Dusk] the "server-only" marker package: the build refuses it in browser code',
      code: "import 'server-only';\nexport const region = 'eu';",
      filename: "src/lib/config.ts",
      errors: [
        { messageId: "serverOnly", data: { source: "server-only", file: "src/lib/config.ts" } },
      ],
    },
    {
      name: "[Dusk] re-exports",
      code: "export { db } from './db.server';\nexport * from './x.server';",
      filename: "src/components/index.ts",
      errors: [{ messageId: "serverOnly" }, { messageId: "serverOnly" }],
    },
    {
      name: "[Dusk] dynamic import and require outside a server function",
      code: "export const load = async () => (await import('./db.server')).db;\nconst fs = require('fs');",
      filename: "src/components/A.tsx",
      errors: [{ messageId: "serverOnly" }, { messageId: "serverOnly" }],
    },
    {
      name: "[Dusk] the server entries of Dusk",
      code: "import { createHandler } from '@shadow-js/dusk/server';\nimport { serve } from '@shadow-js/dusk/node';\nimport { prerender } from '@shadow-js/dusk/static';\nimport { createTestClient } from '@shadow-js/dusk/testing';\nexport const all = [createHandler, serve, prerender, createTestClient];",
      filename: "src/routes/index.tsx",
      errors: [
        ...["server", "node", "static", "testing"].map((name) => ({
          messageId: "serverOnly",
          data: { source: `@shadow-js/dusk/${name}`, file: "src/routes/index.tsx" },
        })),
      ],
    },
    {
      name: "[Dusk] every Node built-in, not a short list",
      code: "import { readFile } from 'node:fs/promises';\nimport path from 'path';\nimport { randomUUID } from 'crypto';\nimport url from 'url';\nimport fs from 'fs';\nexport const x = [readFile, path, randomUUID, url, fs];",
      filename: "src/routes/index.tsx",
      errors: [
        ...["node:fs/promises", "path", "crypto", "url", "fs"].map((source) => ({
          messageId: "serverOnly",
          data: { source, file: "src/routes/index.tsx" },
        })),
      ],
    },
    {
      name: "[Dusk] the .server suffix with and without an extension",
      code: "import a from './a.server';\nimport b from './b.server.ts';\nimport c from './c.server.mjs';\nexport const x = [a, b, c];",
      filename: "src/routes/index.tsx",
      errors: [
        { messageId: "serverOnly" },
        { messageId: "serverOnly" },
        { messageId: "serverOnly" },
      ],
    },
    {
      name: "a page that also exports GET is not an API route",
      code: "import fs from 'fs';\nexport const GET = () => fs;\nexport default function Page() { return <p />; }",
      filename: "src/routes/page.tsx",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "an api directory is ordinary client code (fetch wrappers live there)",
      code: "import fs from 'fs';\nexport const x = fs;",
      filename: "src/api/client.ts",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[Dusk] a server-only import used in the component and in a use server function",
      code: "import { db } from './db.server';\nexport const x = db.name;\nasync function load() {\n  'use server';\n  return db.query();\n}",
      filename: "src/routes/index.tsx",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "Windows paths are normalized",
      code: "import { db } from './db.server';\nexport const x = db;",
      filename: "src\\components\\Profile.tsx",
      errors: [
        {
          messageId: "serverOnly",
          data: { source: "./db.server", file: "src/components/Profile.tsx" },
        },
      ],
    },
    {
      name: "[Dusk] a .mjs file under src/ is a module like any other",
      code: "import { join } from 'node:path';\nexport const p = join('a');",
      filename: "src/lib/paths.mjs",
      errors: [{ messageId: "serverOnly" }],
    },

    {
      name: "custom import patterns add to the preset's",
      code: "import a from 'secret-lib';\nimport fs from 'fs';\nexport const x = [a, fs];",
      filename: "src/components/A.tsx",
      options: [{ serverImports: ["^secret-lib$"] }],
      errors: [
        { messageId: "serverOnly", data: { source: "secret-lib", file: "src/components/A.tsx" } },
        { messageId: "serverOnly", data: { source: "fs", file: "src/components/A.tsx" } },
      ],
    },
    // --- the generic preset keeps directory and driver conventions ------------------------
    {
      name: "[generic] server directory import from a component",
      code: "import { db } from '../server/db';\nexport const x = db;",
      filename: "src/components/Profile.tsx",
      options: generic,
      errors: [
        {
          messageId: "serverOnly",
          data: { source: "../server/db", file: "src/components/Profile.tsx" },
        },
      ],
    },
    {
      name: "[generic] database drivers, the server-only marker package and the web renderer",
      code: "import pg from 'pg';\nimport 'server-only';\nimport { renderToString } from '@shadow-js/web/server';\nexport const x = [pg, renderToString];",
      filename: "src/components/A.tsx",
      options: generic,
      errors: [
        { messageId: "serverOnly" },
        { messageId: "serverOnly" },
        { messageId: "serverOnly" },
      ],
    },
    {
      name: "[generic] node built-ins from the short list only",
      code: "import fs from 'fs';\nimport path from 'path';\nexport const x = [fs, path];",
      filename: "src/components/A.tsx",
      options: generic,
      errors: [{ messageId: "serverOnly", data: { source: "fs", file: "src/components/A.tsx" } }],
    },
    // --- edge cases -------------------------------------------------------------------------
    {
      name: "[ESL-15.E9] a re-export that keeps a value still reaches the browser",
      code: "export { type Db, db } from './db.server';",
      filename: "src/components/index.ts",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[ESL-15.E10] a namespace re-export of a server module",
      code: "export * as api from './api.server';",
      filename: "src/components/index.ts",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[ESL-15.E11] a server component used as a JSX element in a page",
      code: "import { Panel } from './panel.server';\nexport default function Page() { return <Panel />; }",
      filename: "src/routes/index.tsx",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[ESL-15.E12] a server value spread as JSX attributes in a component",
      code: "import { attrs } from './attrs.server';\nexport const el = <div {...attrs} />;",
      filename: "src/components/A.tsx",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[ESL-15.E13] TypeScript wrappers do not turn a value use into a type use",
      code: "import { db } from './db.server';\nexport const size = (db as Store)!.size;\nexport const same = db satisfies unknown;",
      filename: "src/lib/size.ts",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[ESL-15.E14] an async loader is browser code, like a sync one",
      code: "import { db } from '../server/db.server';\nexport const loader = async () => db.list();\nexport default function P() { return <p />; }",
      filename: "src/routes/zz.tsx",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[ESL-15.E15] a loader destructures a server module from a dynamic import",
      code: "export const loader = async () => {\n  const { listPosts } = await import('../server/db.server');\n  return listPosts();\n};\nexport default function P() { return <p />; }",
      filename: "src/routes/zz.tsx",
      errors: [{ messageId: "serverOnly" }],
    },
    {
      name: "[ESL-15.E16] an async function in a component that imports node:fs dynamically",
      code: "export async function load() {\n  return import('node:fs');\n}",
      filename: "src/components/A.tsx",
      errors: [
        { messageId: "serverOnly", data: { source: "node:fs", file: "src/components/A.tsx" } },
      ],
    },
    {
      name: "[ESL-15.E17] a comment above a server import: the report is on the import line",
      code: "// the secret stays on the server\nimport { secret } from './secret.server';\nexport const x = secret;",
      filename: "src/components/A.tsx",
      errors: [{ messageId: "serverOnly", line: 2 }],
    },
    {
      name: "[ESL-15.E18] a src/tools folder is browser code, not a script folder",
      code: "import fs from 'fs';\nexport const x = fs;",
      filename: "src/tools/Panel.tsx",
      errors: [{ messageId: "serverOnly", data: { source: "fs", file: "src/tools/Panel.tsx" } }],
    },
    {
      name: "[ESL-15.E19] an apiRoute that is not Dusk's does not make an API route",
      code: "import { apiRoute } from './lib/api';\nimport { db } from './db.server';\nexport default apiRoute({ GET: () => db.list() });",
      filename: "src/routes/api/other.ts",
      errors: [{ messageId: "serverOnly" }],
    },
  ],
});

describe("[ESL-15] paths are matched inside the project", () => {
  const run = (cwd: string, filename: string): number =>
    new Linter({ cwd, configType: "flat" }).verify(
      "import fs from 'fs';\nexport const x = fs;",
      [
        {
          files: ["**/*.{ts,tsx}"],
          languageOptions: { parser: shadowParser, ecmaVersion: 2023, sourceType: "module" },
          plugins: {
            shadow: { rules: { "server-only-import-in-client": serverOnlyImportInClient } },
          },
          rules: { "shadow/server-only-import-in-client": "error" },
        },
      ],
      { filename },
    ).length;

  it("[ESL-15.p1] a project checked out under tools/ or server/ is not server code", () => {
    expect(run("/home/me/tools/app", "/home/me/tools/app/src/components/A.tsx")).toBe(1);
    expect(run("/home/me/server/app", "/home/me/server/app/src/components/A.tsx")).toBe(1);
    expect(run("/home/me/app", "/home/me/app/scripts/build.ts")).toBe(0);
  });
});

describe("[ESL-15] the documented examples behave as documented", () => {
  const messages = (code: string, filename: string): string[] =>
    new Linter({ configType: "flat" })
      .verify(
        code,
        [
          {
            files: ["**/*.{ts,tsx,mjs}"],
            languageOptions: {
              parser: shadowParser,
              ecmaVersion: 2023,
              sourceType: "module",
              parserOptions: { ecmaFeatures: { jsx: true } },
            },
            plugins: {
              shadow: { rules: { "server-only-import-in-client": serverOnlyImportInClient } },
            },
            rules: { "shadow/server-only-import-in-client": "error" },
          },
        ],
        { filename },
      )
      .map((message) => message.ruleId ?? `fatal: ${message.message}`);

  const name = (example: string): string => /^\/\/ (\S+)/.exec(example)?.[1] ?? "src/file.tsx";

  it("[ESL-15.d1] every incorrect example is reported", () => {
    const { incorrect } = serverOnlyImportInClient.meta.docs.examples;
    expect(incorrect.length).toBeGreaterThan(2);
    for (const example of incorrect) {
      expect(messages(example, name(example)), example).toContain(
        "shadow/server-only-import-in-client",
      );
    }
  });

  it("[ESL-15.d2] every correct example passes", () => {
    const { correct } = serverOnlyImportInClient.meta.docs.examples;
    expect(correct.length).toBeGreaterThan(2);
    for (const example of correct) {
      expect(messages(example, name(example)), example).toEqual([]);
    }
  });
});
